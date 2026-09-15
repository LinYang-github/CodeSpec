import * as fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { parseAnalysisDocument } from './analysis.js';
import { validateAnalysisAgainstWorkspace } from './analysis-consistency.js';
import { approvalContentHash, revokeApprovals } from './approvals.js';
import { loadChangeArtifacts } from './artifacts.js';
import { captureBaseline } from './baseline.js';
import { loadChangeIndex, withChangeIndexLock } from './change-index.js';
import { parseCurrentTasks } from './current-change-yaml.js';
import type { WorkspaceContext } from './loaders.js';
import { metadataForPersistence } from './metadata-persistence.js';
import { incrementRevision } from './state-machine.js';
import { parseChangeMetadata } from './schemas.js';
import type { ApprovalStage } from './types.js';

export type RevisionRoute = 'ANALYZE' | 'DESIGN' | 'PLAN';
export type RevisionResult = {
  changeId: string;
  previousRevision: number;
  revision: number;
  route: RevisionRoute;
  invalidatedApprovals: ApprovalStage[];
};

export async function reviseChange(workspace: WorkspaceContext, changeId: string, reason: string): Promise<RevisionResult> {
  if (!reason.trim()) throw new Error('必须提供语义修订原因 (reason)。');
  return withChangeIndexLock(workspace.paths, async () => {
    const artifacts = await loadChangeArtifacts(workspace.paths, changeId);
    const metadata = artifacts.metadata;
    const artifactPath = (relative: string) => path.join(workspace.codespecDir, relative);
    const originals = new Map<string, string>();
    const metadataPath = artifactPath(metadata.artifacts.metadata);
    const metadataSource = await fs.readFile(metadataPath, 'utf8');
    if (!isDeepStrictEqual(parseChangeMetadata(parseYaml(metadataSource)), metadata)) {
      throw new Error('Revision 冲突：加载期间 metadata 已变更。');
    }
    originals.set(metadataPath, metadataSource);
    for (const name of ['analysis', 'proposal', 'design', 'spec', 'tasks', 'verification'] as const) {
      const relative = metadata.artifacts[name];
      if (relative) originals.set(artifactPath(relative), artifacts[name]!);
    }
    originals.set(workspace.paths.changeIndex, await fs.readFile(workspace.paths.changeIndex, 'utf8'));
    if (metadata.change.status === 'ARCHIVED' || metadata.change.status === 'ABANDONED') {
      throw new Error(`不能修订终态 Change：${metadata.change.status}`);
    }
    const canonical = !metadata.artifacts.proposal;
    const stages: ApprovalStage[] = canonical ? ['analyze', 'design', 'plan'] : ['design', 'plan'];
    const current = new Set<ApprovalStage>();
    let stale: ApprovalStage | undefined;
    for (const stage of stages) {
      const receipt = metadata.approvals[stage];
      if (receipt.status !== 'approved') continue;
      const hash = approvalContentHash(stage, artifacts);
      if (receipt.content_hash !== hash) {
        stale = stage;
        break;
      } else if (receipt.revision === metadata.change.revision) {
        current.add(stage);
      }
    }
    if (!stale) throw new Error('没有相对已批准 authority 的语义变更 (no semantic change)。');
    const route = stale.toUpperCase() as RevisionRoute;
    const invalidatedApprovals = stages.slice(stages.indexOf(stale));
    const next = revokeApprovals(incrementRevision(metadata), invalidatedApprovals);
    next.change.status = route;
    next.gates = structuredClone(metadata.gates);
    for (const stage of [...invalidatedApprovals, 'implement', 'verify', 'archive'] as const) next.gates[stage].satisfied = false;
    next.tasks = { total: 0, completed: 0, items: {} };
    next.verification = { requirements_verified: false, tests_passed: false, build_passed: false, lint_passed: false, verified_at: null };
    next.archive = { ready: false, conflict: false, archived_at: null };

    const revised = { ...artifacts, metadata: next };
    if (canonical && (route === 'ANALYZE' || current.has('analyze'))) {
      const analysis = parseAnalysisDocument(parseYaml(artifacts.analysis!));
      revised.analysis = stringifyYaml({ ...analysis, revision: next.change.revision });
    }
    if (canonical && route === 'PLAN') {
      revised.tasks = stringifyYaml({ ...parseCurrentTasks(parseYaml(artifacts.tasks)), changeRevision: next.change.revision });
    }
    // Revision fields participate in receipts. Carry only unchanged, current
    // upstream authority, retaining the user's original confirmation time.
    for (const stage of stages) {
      if (!invalidatedApprovals.includes(stage) && current.has(stage)) {
        next.approvals[stage] = {
          ...metadata.approvals[stage], revision: next.change.revision,
          content_hash: approvalContentHash(stage, revised),
        };
      }
    }
    if (canonical && (await validateAnalysisAgainstWorkspace(workspace, revised)).length === 0) {
      next.baseline = await captureBaseline(workspace, next);
    }

    const index = await loadChangeIndex(workspace.paths);
    const entry = { id: next.change.id, title: next.change.title, mode: next.change.mode, status: next.change.status, updated_at: next.change.updated_at };
    const entries = index.entries.some((item) => item.id === changeId)
      ? index.entries.map((item) => item.id === changeId ? entry : item)
      : [...index.entries, entry];
    const writes = new Map<string, string>();
    writes.set(artifactPath(metadata.artifacts.metadata), stringifyYaml(metadataForPersistence(next)));
    if (revised.analysis !== artifacts.analysis) writes.set(artifactPath(metadata.artifacts.analysis!), revised.analysis!);
    if (revised.tasks !== artifacts.tasks) writes.set(artifactPath(metadata.artifacts.tasks), revised.tasks);
    writes.set(artifactPath(metadata.artifacts.verification), canonical ? stringifyYaml({ version: 1, testCases: [] }) : '# Verification\n');
    writes.set(workspace.paths.changeIndex, stringifyYaml({ version: 1, changes: entries }));

    const token = `.revise-${process.pid}-${Date.now()}.tmp`;
    const committed: string[] = [];
    try {
      for (const [file, content] of writes) await fs.writeFile(`${file}${token}`, content, 'utf8');
      for (const [file, original] of originals) {
        if (await fs.readFile(file, 'utf8') !== original) {
          throw new Error(`Revision 冲突：暂存期间产物已变更：${file}`);
        }
      }
      for (const file of writes.keys()) {
        await fs.rename(`${file}${token}`, file);
        committed.push(file);
      }
    } catch (error) {
      const failures: unknown[] = [];
      for (const file of committed.reverse()) {
        try { await fs.writeFile(file, originals.get(file)!, 'utf8'); }
        catch (rollbackError) { failures.push(rollbackError); }
      }
      if (failures.length) throw new AggregateError([error, ...failures], 'Revision failed and rollback could not restore every artifact');
      throw error;
    } finally {
      await Promise.all([...writes.keys()].map((file) => fs.rm(`${file}${token}`, { force: true })));
    }
    return { changeId, previousRevision: metadata.change.revision, revision: next.change.revision, route, invalidatedApprovals };
  });
}
