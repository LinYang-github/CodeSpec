import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { captureBaseline, hashAbsentRequirement, type Baseline } from './baseline.js';
import type { WorkspaceContext } from './loaders.js';
import { loadChangeArtifacts } from './loaders.js';
import type { BusinessModuleId, ChangeMetadata, RequirementId } from './types.js';
import { loadChangeIndex, withChangeIndexLock } from './change-index.js';
import { approvalContentHash, isApprovalCurrent, revokeApprovals } from './approvals.js';
import { parseAnalysisDocument, validateAnalysisCompleteness, type AnalysisDocument } from './analysis.js';
import { projectAnalysisMetadata } from './analysis-consistency.js';
import { parseCurrentSpecDelta, renderCurrentSpecDelta, type CurrentSpecDeltaDocument } from './current-spec-delta.js';
import { parseCurrentSpecification, hashRequirementSnapshot, type CurrentSpecification } from './current-spec-model.js';
import { parseChangeMetadata } from './schemas.js';
import { createArchiveJournal, installArchiveJournal, markArchiveJournalCommitted, recoverPendingTransactions } from './transaction-journal.js';
import { readCurrentModuleFiles } from './current-module-state.js';
import { readCurrentState } from './current-state.js';
import { parseBusinessRegistry } from './current-spec-yaml.js';

export interface RebaseDecision {
  strategy: 'semantic-rebase';
  route: 'ANALYZE' | 'DESIGN';
  reason: string;
  current_specs: string[];
  decisions: Array<{
    requirement_id: string;
    action: 'ADDED' | 'MODIFIED' | 'REMOVED';
    previous_hash: string | null;
    current_hash: string | null;
    outcome: 'REFRESHED' | 'ANALYSIS_CONFLICT';
  }>;
}
export interface RebaseResult { change: ChangeMetadata['change']; baseline: Baseline; decision: RebaseDecision }

/** Decide all conflicts before constructing any filesystem writes. */
function decideRebase(
  metadata: ChangeMetadata,
  analysis: AnalysisDocument,
  approved: boolean,
  delta: CurrentSpecDeltaDocument,
  current: Map<string, CurrentSpecification>,
  registeredModules: ReadonlySet<string>,
  currentPaths: string[],
): RebaseDecision {
  const conflicts = new Set<string>();
  const conflict = (reason: string) => { conflicts.add(reason); };
  if (!approved || analysis.change !== metadata.change.id || analysis.revision !== metadata.change.revision) {
    conflict('Analyze authority is not current and hash-valid; approved intent must be confirmed again.');
  } else {
    for (const issue of validateAnalysisCompleteness(analysis).errors) conflict(issue);
    const projection = projectAnalysisMetadata(analysis);
    if (!isDeepStrictEqual(metadata.modules, projection.modules)) conflict('OWNED module projection changed.');
    if (!isDeepStrictEqual(metadata.requirements, projection.requirements)) conflict('Requirement disposition projection changed.');
    for (const module of analysis.modules.filter((item) => item.outcome === 'OWNED')) {
      if (!registeredModules.has(module.module)) conflict(`OWNED module ${module.module} is no longer registered in Current.`);
      const baseline = metadata.baseline.modules[module.module];
      if (baseline && baseline.outcome !== 'OWNED') conflict(`OWNED module ${module.module} changed.`);
      const live = current.get(module.module);
      if (live && live.module !== module.module) conflict(`OWNED module ${module.module} no longer matches Current ${live.module}.`);
    }
    const entries = new Map(delta.requirements.map((entry) => [entry.id, entry]));
    for (const requirement of analysis.requirements) {
      if (entries.get(requirement.id)?.action !== requirement.action) conflict(`Approved disposition for ${requirement.id} no longer matches the delta.`);
    }
    for (const entry of delta.requirements) {
      if (!analysis.requirements.some((requirement) => requirement.id === entry.id && requirement.action === entry.action)) conflict(`Delta ${entry.id} is outside approved dispositions.`);
      if (!analysis.modules.some((module) => module.module === entry.module && module.outcome === 'OWNED')) conflict(`OWNED module for ${entry.id} changed.`);
      if (!analysis.acceptanceCriteria.some((criterion) => criterion.requirements.includes(entry.id as RequirementId))) conflict(`No approved acceptance criterion covers ${entry.id}.`);
    }
    for (const criterion of analysis.acceptanceCriteria) {
      for (const id of criterion.requirements) if (!entries.has(id)) conflict(`${criterion.id} no longer resolves to delta Requirement ${id}.`);
    }
    for (const assumption of analysis.assumptions.filter((item) => item.status === 'CONFIRMED')) {
      for (const id of assumption.requirements) {
        const module = id.slice(0, id.indexOf('-REQ-')) as BusinessModuleId;
        const snapshot = current.get(module)?.requirements.find((item) => item.id === id);
        const previous = metadata.baseline.modules[module]?.requirements?.[id];
        const latest = snapshot ? hashRequirementSnapshot(snapshot) : hashAbsentRequirement(id);
        if (previous !== latest) conflict(`${assumption.id}: Current drift touches confirmed assumption Requirement ${id}.`);
      }
    }
  }
  const decisions = delta.requirements.map((entry): RebaseDecision['decisions'][number] => {
    const existing = current.get(entry.module)?.requirements.find((item) => item.id === entry.id);
    const currentHash = existing ? hashRequirementSnapshot(existing) : null;
    if (approved) {
      if ((entry.action === 'ADDED') === Boolean(existing)) conflict(`${entry.action} disposition for ${entry.id} no longer holds in Current.`);
      if (entry.action === 'MODIFIED' && entry.next && currentHash === hashRequirementSnapshot(entry.next)) conflict(`${entry.id}: Current already satisfies New; acceptance/disposition requires re-analysis.`);
    }
    return { requirement_id: entry.id, action: entry.action, previous_hash: entry.previous ? hashRequirementSnapshot(entry.previous) : null, current_hash: currentHash, outcome: 'REFRESHED' };
  });
  const route = conflicts.size ? 'ANALYZE' : 'DESIGN';
  // A conflict blocks the entire refresh; never report an uncommitted entry as
  // REFRESHED when analysis must be resolved first. Reasons retain exact IDs.
  for (const item of decisions) if (route === 'ANALYZE') item.outcome = 'ANALYSIS_CONFLICT';
  return { strategy: 'semantic-rebase', route, reason: conflicts.size ? [...conflicts].join(' ') : 'Approved intent remains valid; refresh affected Requirement Previous snapshots from live Current.', current_specs: currentPaths, decisions };
}

export async function rebaseChange(workspace: WorkspaceContext, changeId: string): Promise<RebaseResult> {
  return withChangeIndexLock(workspace.paths, async () => {
    const artifacts = await loadChangeArtifacts(workspace.paths, changeId);
    const metadata = artifacts.metadata;
    if (!metadata.baseline.stale) throw new Error(`Change ${changeId} is not stale`);
    if (metadata.change.status === 'ABANDONED') throw new Error(`Cannot rebase terminal Change ${metadata.change.status}`);
    const file = (relative: string) => path.join(workspace.codespecDir, relative);
    const metadataPath = file(metadata.artifacts.metadata);
    const metadataSource = await fs.readFile(metadataPath, 'utf8');
    if (!isDeepStrictEqual(parseChangeMetadata(parseYaml(metadataSource)), metadata)) throw new Error('Rebase conflict: metadata changed during load');
    const originals = new Map<string, string | null>([[metadataPath, metadataSource]]);
    for (const name of ['analysis', 'design', 'spec', 'tasks', 'verification'] as const) {
      originals.set(file(metadata.artifacts[name]), artifacts[name]);
    }
    originals.set(workspace.paths.changeIndex, await fs.readFile(workspace.paths.changeIndex, 'utf8'));
    const analysis = parseAnalysisDocument(parseYaml(artifacts.analysis));
    const approved = isApprovalCurrent('analyze', artifacts);
    const delta = parseCurrentSpecDelta(artifacts.spec);
    const currentState = await readCurrentState(workspace);
    const registeredModules = new Set(parseBusinessRegistry(parseYaml(await fs.readFile(workspace.paths.business, 'utf8'))).modules.map((module) => module.id));
    const modules = new Set([delta.module, ...Object.keys(metadata.baseline.modules)]);
    // Unapproved analysis can only trigger ANALYZE. It cannot choose a Current
    // source, refresh a baseline, or supply inferred user intent.
    if (approved) {
      for (const module of analysis.modules) modules.add(module.module);
      for (const assumption of analysis.assumptions) for (const id of assumption.requirements) modules.add(id.slice(0, id.indexOf('-REQ-')));
    }
    const currentPaths = [...modules].sort().map((module) => path.join(workspace.paths.currentSpecs, module, 'spec.md'));
    const current = new Map<string, CurrentSpecification>();
    const contents: Record<string, string> = {};
    for (const module of [...modules].sort()) {
      const target = path.join(workspace.paths.currentSpecs, module, 'spec.md');
      const source = (await readCurrentModuleFiles(workspace.paths.currentSpecs, module))?.spec ?? null;
      originals.set(target, source);
      contents[module] = source ?? '';
      if (source?.trim()) current.set(module, parseCurrentSpecification(source));
    }
    const decision = decideRebase(metadata, analysis, approved, delta, current, registeredModules, currentPaths);
    const next = structuredClone(metadata);
    next.change.revision += 1;
    next.change.status = decision.route;
    next.change.updated_at = new Date().toISOString();
    next.approvals = revokeApprovals(next).approvals;
    next.tasks = { total: 0, completed: 0, items: {} };
    for (const stage of ['analyze', 'design', 'plan', 'implement', 'verify', 'archive'] as const) {
      if (stage !== 'analyze' || decision.route === 'ANALYZE') next.gates[stage].satisfied = false;
    }
    next.verification = { requirements_verified: false, tests_passed: false, build_passed: false, lint_passed: false, verified_at: null };
    next.archive = { ready: false, conflict: false };
    let spec = artifacts.spec;
    const revised = { ...artifacts, metadata: next };
    if (decision.route === 'DESIGN') {
      const refreshed = structuredClone(delta);
      for (const entry of refreshed.requirements) if (entry.previous) entry.previous = current.get(entry.module)!.requirements.find((item) => item.id === entry.id)!;
      spec = renderCurrentSpecDelta(refreshed);
      revised.analysis = stringifyYaml({ ...analysis, revision: next.change.revision });
      next.approvals.analyze = { ...metadata.approvals.analyze, revision: next.change.revision, content_hash: approvalContentHash('analyze', revised) };
      next.baseline = await captureBaseline(workspace, next, contents);
      if (next.baseline.current_fingerprint !== currentState.fingerprint) throw new Error('Rebase conflict: complete Current changed while rebuilding the baseline');
    }
    // ANALYZE retains the old analysis/baseline for comparison. It cannot stamp
    // invalid intent or stale tasks as regenerated for the new revision.
    const index = await loadChangeIndex(workspace.paths);
    const entry = { id: next.change.id, title: next.change.title, mode: next.change.mode, status: next.change.status, updated_at: next.change.updated_at };
    const entries = index.entries.some((item) => item.id === changeId) ? index.entries.map((item) => item.id === changeId ? entry : item) : [...index.entries, entry];
    const writes = new Map<string, string>([[metadataPath, stringifyYaml(next)]]);
    if (revised.analysis !== artifacts.analysis) writes.set(file(metadata.artifacts.analysis), revised.analysis);
    writes.set(file(metadata.artifacts.spec), spec);
    writes.set(file(metadata.artifacts.design), `${artifacts.design.trimEnd()}\n\n## Rebase decision (revision ${next.change.revision})\n\n${stringifyYaml(decision)}`);
    writes.set(file(metadata.artifacts.verification), stringifyYaml({ version: 1, testCases: [] }));
    writes.set(workspace.paths.changeIndex, stringifyYaml({ version: 1, changes: entries }));
    const read = async (target: string) => {
      try { return await fs.readFile(target, 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    };
    const checkReadOnlyInputs = async () => {
      if ((await readCurrentState(workspace)).fingerprint !== currentState.fingerprint) {
        throw new Error('Rebase conflict: complete Current changed during rebase');
      }
      for (const [target, original] of originals) {
        if (!writes.has(target) && await read(target) !== original) throw new Error(`Rebase conflict: artifact or Current changed: ${target}`);
      }
    };
    let journal: Awaited<ReturnType<typeof createArchiveJournal>> | undefined;
    let committed = false;
    try {
      await checkReadOnlyInputs();
      // Use the same owned-entry installation and recovery as archive. It
      // validates the actual displaced inode and publishes without replacing
      // an editor's new file. Recovery retains displaced inodes in durable,
      // manual-only escrow for writes through handles opened before rebase.
      journal = await createArchiveJournal({
        paths: workspace.paths, transactionId: `rebase-${changeId}-${randomUUID()}`, ownerPid: process.pid,
        files: [...writes].map(([target, after]) => ({ target, before: originals.get(target)!, after })),
      });
      await installArchiveJournal(journal, checkReadOnlyInputs);
      await checkReadOnlyInputs();
      await markArchiveJournalCommitted(journal);
      committed = true;
      await recoverPendingTransactions(workspace.paths, journal.transactionId);
    } catch (error) {
      if (committed) throw new Error(`${String(error)} (rebase committed; recovery requires retry)`);
      if (journal) {
        try { await recoverPendingTransactions(workspace.paths, journal.transactionId); }
        catch (failure) { throw new AggregateError([error, failure], `Rebase failed: ${String(error)}; rollback conflict or incomplete recovery: ${String(failure)}`); }
      }
      throw error;
    }
    return { change: next.change, baseline: next.baseline as Baseline, decision };
  });
}
