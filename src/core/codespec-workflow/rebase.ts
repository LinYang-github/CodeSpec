import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { isDeepStrictEqual } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { captureBaseline, hashAbsentRequirement, type Baseline } from './baseline.js';
import type { WorkspaceContext } from './loaders.js';
import { loadChangeArtifacts } from './loaders.js';
import { parseDeltaSpec } from './delta-parser.js';
import type { BusinessModuleId, ChangeMetadata, RequirementDelta, RequirementId } from './types.js';
import { documentSections, INLINE_DESIGN_SECTIONS } from './document-sections.js';
import { loadChangeIndex, withChangeIndexLock } from './change-index.js';
import { approvalContentHash, isApprovalCurrent, revokeApprovals } from './approvals.js';
import { metadataForPersistence } from './metadata-persistence.js';
import { parseAnalysisDocument, validateAnalysisCompleteness, type AnalysisDocument } from './analysis.js';
import { projectAnalysisMetadata } from './analysis-consistency.js';
import { parseCurrentSpecDelta, renderCurrentSpecDelta, type CurrentSpecDeltaDocument } from './current-spec-delta.js';
import { parseCurrentSpecification, hashRequirementSnapshot, type CurrentSpecification } from './current-spec-model.js';
import { parseChangeMetadata } from './schemas.js';
import { createArchiveJournal, installArchiveJournal, markArchiveJournalCommitted, recoverPendingTransactions } from './transaction-journal.js';

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

export async function rebaseChange(workspace: WorkspaceContext, changeId: string, currentSpecs: string[] = []): Promise<RebaseResult> {
  const initial = await loadChangeArtifacts(workspace.paths, changeId);
  if (initial.metadata.artifacts.proposal) return rebaseLegacyChange(workspace, changeId, currentSpecs);
  return withChangeIndexLock(workspace.paths, async () => {
    const artifacts = await loadChangeArtifacts(workspace.paths, changeId);
    const metadata = artifacts.metadata;
    if (!metadata.baseline.stale) throw new Error(`Change ${changeId} is not stale`);
    if (['ARCHIVED', 'ABANDONED'].includes(metadata.change.status)) throw new Error(`Cannot rebase terminal Change ${metadata.change.status}`);
    const file = (relative: string) => path.join(workspace.codespecDir, relative);
    const metadataPath = file(metadata.artifacts.metadata);
    const metadataSource = await fs.readFile(metadataPath, 'utf8');
    if (!isDeepStrictEqual(parseChangeMetadata(parseYaml(metadataSource)), metadata)) throw new Error('Rebase conflict: metadata changed during load');
    const originals = new Map<string, string | null>([[metadataPath, metadataSource]]);
    for (const name of ['analysis', 'design', 'spec', 'tasks', 'verification'] as const) {
      if (metadata.artifacts[name]) originals.set(file(metadata.artifacts[name]!), artifacts[name]);
    }
    originals.set(workspace.paths.changeIndex, await fs.readFile(workspace.paths.changeIndex, 'utf8'));
    const analysis = parseAnalysisDocument(parseYaml(artifacts.analysis ?? ''));
    const approved = isApprovalCurrent('analyze', artifacts);
    const delta = parseCurrentSpecDelta(artifacts.spec);
    const modules = new Set([delta.module, ...Object.keys(metadata.baseline.modules)]);
    // Unapproved analysis can only trigger ANALYZE. It cannot choose a Current
    // source, refresh a baseline, or supply inferred user intent.
    if (approved) {
      for (const module of analysis.modules) modules.add(module.module);
      for (const assumption of analysis.assumptions) for (const id of assumption.requirements) modules.add(id.slice(0, id.indexOf('-REQ-')));
    }
    const currentPaths = [...modules].sort().map((module) => path.join(workspace.paths.currentSpecs, module, 'spec.md'));
    for (const supplied of currentSpecs) {
      if (!currentPaths.includes(path.resolve(supplied))) throw new Error('Canonical rebase only accepts configured live Current specification paths');
    }
    const current = new Map<string, CurrentSpecification>();
    const contents: Record<string, string> = {};
    for (const module of [...modules].sort()) {
      const target = path.join(workspace.paths.currentSpecs, module, 'spec.md');
      let source: string | null;
      try {
        // Reject aliases into archive or another module, including parent links.
        let cursor = target;
        while (cursor !== workspace.codespecDir) {
          if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error(`Current specification path must not contain a symlink: ${target}`);
          const parent = path.dirname(cursor);
          if (parent === cursor) throw new Error(`Current path escaped codespec: ${target}`);
          cursor = parent;
        }
        source = await fs.readFile(target, 'utf8');
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; source = null; }
      originals.set(target, source);
      contents[module] = source ?? '';
      if (source?.trim()) current.set(module, parseCurrentSpecification(source));
    }
    const decision = decideRebase(metadata, analysis, approved, delta, current, currentPaths);
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
    next.archive = { ready: false, conflict: false, archived_at: null };
    let spec = artifacts.spec;
    const revised = { ...artifacts, metadata: next };
    if (decision.route === 'DESIGN') {
      const refreshed = structuredClone(delta);
      for (const entry of refreshed.requirements) if (entry.previous) entry.previous = current.get(entry.module)!.requirements.find((item) => item.id === entry.id)!;
      spec = renderCurrentSpecDelta(refreshed);
      revised.analysis = stringifyYaml({ ...analysis, revision: next.change.revision });
      next.approvals.analyze = { ...metadata.approvals.analyze, revision: next.change.revision, content_hash: approvalContentHash('analyze', revised) };
      next.baseline = await captureBaseline(workspace, next, contents);
    }
    // ANALYZE retains the old analysis/baseline for comparison. It cannot stamp
    // invalid intent or stale tasks as regenerated for the new revision.
    const index = await loadChangeIndex(workspace.paths);
    const entry = { id: next.change.id, title: next.change.title, mode: next.change.mode, status: next.change.status, updated_at: next.change.updated_at };
    const entries = index.entries.some((item) => item.id === changeId) ? index.entries.map((item) => item.id === changeId ? entry : item) : [...index.entries, entry];
    const writes = new Map<string, string>([[metadataPath, stringifyYaml(metadataForPersistence(next))]]);
    if (revised.analysis !== artifacts.analysis) writes.set(file(metadata.artifacts.analysis!), revised.analysis!);
    writes.set(file(metadata.artifacts.spec), spec);
    if (metadata.artifacts.design) writes.set(file(metadata.artifacts.design), `${artifacts.design.trimEnd()}\n\n## Rebase decision (revision ${next.change.revision})\n\n${stringifyYaml(decision)}`);
    writes.set(file(metadata.artifacts.verification), stringifyYaml({ version: 1, testCases: [] }));
    writes.set(workspace.paths.changeIndex, stringifyYaml({ version: 1, changes: entries }));
    const read = async (target: string) => {
      try { return await fs.readFile(target, 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    };
    const checkReadOnlyInputs = async () => {
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

function requirementBlock(spec: string, id: string): string | undefined {
  const headings = [...spec.matchAll(/^###\s+(MOD-\d{3}-REQ-\d{3})(?:\s+.*)?$/gmu)];
  const heading = headings.find((item) => item[1] === id); if (!heading || heading.index === undefined) return undefined;
  const next = headings.find((item) => (item.index ?? 0) > heading.index!);
  return spec.slice(heading.index, next?.index ?? spec.length).trim();
}
function withoutHeading(value: string): string { return value.replace(/^###[ \t]+MOD-\d{3}-REQ-\d{3}(?:[ \t]+[^\n]*)?\n?/u, '').trim(); }
function renderDelta(entries: RequirementDelta[], current: Map<string, string>): string {
  const sections = new Map<RequirementDelta['action'], RequirementDelta[]>([['ADDED', []], ['MODIFIED', []], ['REMOVED', []]]);
  for (const original of entries) {
    const entry = structuredClone(original);
    const latest = current.get(entry.module); const block = latest ? requirementBlock(latest, entry.id) : undefined;
    if ((entry.action === 'MODIFIED' || entry.action === 'REMOVED') && block) entry.previous = withoutHeading(block);
    sections.get(entry.action)!.push(entry);
  }
  return [...sections.entries()].filter(([, items]) => items.length).map(([action, items]) => [
    `## ${action}`,
    ...items.map((entry) => {
      const title = entry.title ?? entry.id;
      const parts = [`### ${entry.id} ${title}`];
      if (entry.previous) parts.push('**Previous**', entry.previous);
      if (entry.next) parts.push('**New**', withoutHeading(entry.next));
      if (entry.reason) parts.push('**Reason**', entry.reason);
      return parts.filter(Boolean).join('\n');
    }),
  ].join('\n')).join('\n\n').trim() + '\n';
}

async function loadCurrentSpecs(workspace: WorkspaceContext, metadata: ChangeMetadata, supplied: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const configured = new Set(metadata.modules.confirmed.map((item) => item.module));
  const suppliedContents: string[] = [];
  for (const item of supplied) {
    if (/^###\s+MOD-\d{3}-REQ-\d{3}/mu.test(item)) suppliedContents.push(item);
    else {
      const resolved = path.resolve(item);
      const relative = path.relative(workspace.codespecDir, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Current specification path must be under codespec: ${item}`);
      let cursor = resolved;
      while (true) {
        const stat = await fs.lstat(cursor);
        if (stat.isSymbolicLink()) throw new Error(`Current specification path must not contain a symlink: ${item}`);
        if (cursor === workspace.codespecDir) break;
        const parent = path.dirname(cursor);
        if (parent === cursor) throw new Error(`Current specification path escaped codespec: ${item}`);
        cursor = parent;
      }
      suppliedContents.push(await fs.readFile(resolved, 'utf8'));
    }
  }
  for (const content of suppliedContents) {
    const module = [...content.matchAll(/^###\s+(MOD-\d{3})-REQ-/gmu)][0]?.[1];
    if (module) result.set(module, content);
  }
  for (const module of configured) if (!result.has(module)) {
    const file = path.join(workspace.paths.currentSpecs, module, 'spec.md');
    try { result.set(module, await fs.readFile(file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; result.set(module, ''); }
  }
  return result;
}

async function rebaseLegacyChange(workspace: WorkspaceContext, changeId: string, currentSpecs: string[] = []): Promise<RebaseResult> {
  const artifacts = await loadChangeArtifacts(workspace.paths, changeId); const change = structuredClone(artifacts.metadata);
  if (!change.baseline.stale) throw new Error(`Change ${changeId} is not stale`);
  const current = await loadCurrentSpecs(workspace, change, currentSpecs);
  let entries: RequirementDelta[];
  try { entries = parseDeltaSpec(artifacts.spec).entries; }
  catch (error) { throw new Error(`Cannot semantically rebase malformed delta spec: ${error instanceof Error ? error.message : String(error)}`); }
  const decisions = entries.map((entry) => ({ requirement_id: entry.id, action: entry.action, previous: current.get(entry.module) ? requirementBlock(current.get(entry.module)!, entry.id) ?? '' : '' }));
  const unresolved = decisions.filter((item) => (item.action !== 'ADDED' && !item.previous));
  if (unresolved.length) throw new Error(`Unresolved Rebase decisions for Requirements: ${unresolved.map((item) => item.requirement_id).join(', ')}`);
  const nextSpec = renderDelta(entries, current);
  const hash = (text: string | undefined) => text ? createHash('sha256').update(text).digest('hex') : null;
  const decision: RebaseDecision = { strategy: 'semantic-rebase', route: 'DESIGN', reason: 'Re-evaluated each Requirement against the configured Current Specification; authored New/Reason content was preserved.', current_specs: [...current.values()], decisions: decisions.map((item, index) => ({ requirement_id: item.requirement_id, action: item.action, previous_hash: hash(entries[index].previous), current_hash: hash(item.previous), outcome: 'REFRESHED' })) };
  change.change.revision += 1; change.change.status = 'DESIGN'; change.change.updated_at = new Date().toISOString();
  change.approvals = revokeApprovals(change).approvals;
  // A rebase invalidates implementation and verification conclusions. Force
  // the workflow through planning and a new VERIFY run instead of allowing
  // stale task/evidence state to satisfy downstream gates.
  change.tasks = { total: 0, completed: 0, items: {} };
  for (const name of ['design', 'plan', 'implement', 'verify', 'archive'] as const) change.gates[name].satisfied = false;
  change.verification = {
    requirements_verified: false, tests_passed: false, build_passed: false,
    lint_passed: false, verified_at: null,
  };
  change.archive = { ready: false, conflict: false, archived_at: null };
  const baseline = await captureBaseline(workspace, change, Object.fromEntries(current));
  change.baseline = baseline;
  const metadataPath = path.join(workspace.codespecDir, change.artifacts.metadata); const specPath = path.join(workspace.codespecDir, change.artifacts.spec); const designPath = change.artifacts.design ? path.join(workspace.codespecDir, change.artifacts.design) : null;
  const token = `.rebase-${process.pid}-${Date.now()}`; const metadataTmp = `${metadataPath}.${token}.tmp`; const specTmp = `${specPath}.${token}.tmp`; const designTmp = designPath ? `${designPath}.${token}.tmp` : null;
  const verificationPath = path.join(workspace.codespecDir, change.artifacts.verification);
  const original = { metadata: await fs.readFile(metadataPath, 'utf8'), spec: await fs.readFile(specPath, 'utf8'), design: designPath ? await fs.readFile(designPath, 'utf8') : null, verification: await fs.readFile(verificationPath, 'utf8') };
  const inlineDesign = documentSections(original.spec)
    .filter((section) => INLINE_DESIGN_SECTIONS.has(section.title))
    .map((section) => section.raw.trim()).join('\n\n');
  const rebasedSpec = inlineDesign ? `${nextSpec.trimEnd()}\n\n${inlineDesign}\n` : nextSpec;
  const verificationTmp = `${verificationPath}.${token}.tmp`;
  return withChangeIndexLock(workspace.paths, async () => {
    const current = {
      metadata: await fs.readFile(metadataPath),
      spec: await fs.readFile(specPath),
      design: designPath ? await fs.readFile(designPath) : null,
      verification: await fs.readFile(verificationPath),
    };
    const currentDesign = current.design === null ? null : current.design.toString();
    if (current.metadata.toString() !== original.metadata || current.spec.toString() !== original.spec ||
      currentDesign !== original.design || current.verification.toString() !== original.verification) {
      throw new Error('Rebase 冲突：Change 在重基线期间发生变化，请重新运行 rebase');
    }
    try {
      await fs.writeFile(metadataTmp, stringifyYaml(metadataForPersistence(change))); await fs.writeFile(specTmp, rebasedSpec);
      if (designTmp && original.design !== null) await fs.writeFile(designTmp, `${original.design}\n\n## Rebase decision (revision ${change.change.revision})\n\n${stringifyYaml(decision)}`);
      await fs.writeFile(verificationTmp, '# Verification\n');
      await fs.rename(metadataTmp, metadataPath); await fs.rename(specTmp, specPath); if (designTmp && designPath) await fs.rename(designTmp, designPath);
      await fs.rename(verificationTmp, verificationPath);
    } catch (error) {
      await fs.writeFile(metadataPath, original.metadata).catch(() => undefined); await fs.writeFile(specPath, original.spec).catch(() => undefined); if (designPath && original.design !== null) await fs.writeFile(designPath, original.design).catch(() => undefined);
      await fs.rm(metadataTmp, { force: true }).catch(() => undefined); await fs.rm(specTmp, { force: true }).catch(() => undefined); if (designTmp) await fs.rm(designTmp, { force: true }).catch(() => undefined);
      await fs.writeFile(path.join(workspace.codespecDir, change.artifacts.verification), original.verification ?? '# Verification\n').catch(() => undefined);
      await fs.rm(verificationTmp, { force: true }).catch(() => undefined);
      throw error;
    }
    return { change: change.change, baseline, decision };
  });
}
