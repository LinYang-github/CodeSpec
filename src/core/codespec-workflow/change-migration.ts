import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { parseAnalysisDocument, renderInitialAnalysis } from './analysis.js';
import { revokeApprovals } from './approvals.js';
import { loadChangeArtifacts, type ChangeArtifacts } from './artifacts.js';
import { loadChangeIndex } from './change-index.js';
import { acquireTransactionIndexLock, releaseTransactionIndexLock } from './archive-index-lock.js';
import type { WorkspaceContext } from './loaders.js';
import { parseChangeMetadata } from './schemas.js';
import { incrementRevision } from './state-machine.js';
import { createArchiveJournal, installArchiveJournal, markArchiveJournalCommitted, recoverPendingTransactions } from './transaction-journal.js';

export const CHANGE_MIGRATION_GUIDANCE = '迁移后回到 ANALYZE：请核对并补充 analysis.yaml，再手工将旧 spec.md 重写为 rich Requirement delta；完成前 DESIGN 持续阻塞。迁移不推断 Current baseline。';

export type ChangeMigrationResult = {
  changeId: string;
  fromArtifacts: 5;
  toArtifacts: 6;
  route: 'ANALYZE';
  unresolvedQuestionId: 'Q-MIGRATION-001';
  message: string;
};

const fiveNames = ['design.md', 'metadata.yaml', 'spec.md', 'tasks.yaml', 'verification.yaml'];
const fiveKeys = ['design', 'metadata', 'spec', 'tasks', 'verification'];

async function loadEligibleChange(workspace: WorkspaceContext, changeId: string): Promise<ChangeArtifacts> {
  if (workspace.config.schema !== 'code-spec') throw new Error('Migration requires a canonical code-spec workspace.');
  const artifacts = await loadChangeArtifacts(workspace.paths, changeId);
  if (path.resolve(artifacts.changeDir) !== path.resolve(workspace.paths.changes, changeId)
    || ['ARCHIVED', 'ABANDONED'].includes(artifacts.metadata.change.status)) {
    throw new Error('Migration requires an active Change; archived and terminal Changes are immutable.');
  }
  if (!isDeepStrictEqual(Object.keys(artifacts.metadata.artifacts).sort(), fiveKeys)) {
    throw new Error('Migration requires exactly five declared canonical artifacts without analysis.yaml or legacy proposal.md.');
  }
  const entries = await fs.readdir(artifacts.changeDir, { withFileTypes: true });
  if (!isDeepStrictEqual(entries.map((entry) => entry.name).sort(), fiveNames) || entries.some((entry) => !entry.isFile())) {
    throw new Error('Migration requires exactly the five canonical files; missing, extra or symlink artifacts are not supported.');
  }
  return artifacts;
}

export async function migrateActiveChangeAnalysis(workspace: WorkspaceContext, changeId: string): Promise<ChangeMigrationResult> {
  // Reject unsupported input without acquiring a write lock or creating a journal.
  await loadEligibleChange(workspace, changeId);
  const transactionId = `migrate-${changeId}-${randomUUID()}`;
  try {
    await acquireTransactionIndexLock(workspace.paths, transactionId);
    const artifacts = await loadEligibleChange(workspace, changeId);
    const metadata = artifacts.metadata;
    const file = (name: string) => path.join(artifacts.changeDir, name);
    const metadataSource = await fs.readFile(file('metadata.yaml'), 'utf8');
    if (!isDeepStrictEqual(parseChangeMetadata(parseYaml(metadataSource)), metadata)) throw new Error('Migration conflict: metadata changed during loading.');
    const originals = new Map<string, string | null>([
      [file('metadata.yaml'), metadataSource], [file('analysis.yaml'), null],
      [file('design.md'), artifacts.design], [file('spec.md'), artifacts.spec],
      [file('tasks.yaml'), artifacts.tasks], [file('verification.yaml'), artifacts.verification],
      [workspace.paths.changeIndex, await fs.readFile(workspace.paths.changeIndex, 'utf8')],
    ]);
    const next = revokeApprovals(incrementRevision(metadata));
    next.change.status = 'ANALYZE';
    next.artifacts = { ...metadata.artifacts, analysis: path.relative(workspace.codespecDir, file('analysis.yaml')) };
    next.gates = structuredClone(metadata.gates);
    for (const gate of Object.values(next.gates)) gate.satisfied = false;
    next.tasks = { total: 0, completed: 0, items: {} };
    next.verification = { requirements_verified: false, tests_passed: false, build_passed: false, lint_passed: false, verified_at: null };
    next.archive = { ready: false, conflict: false, archived_at: null };

    const analysis = parseAnalysisDocument(parseYaml(renderInitialAnalysis({ changeId, revision: next.change.revision, problem: metadata.impact.summary })));
    // Only existing explicit decisions are copied. Candidate-only modules
    // remain in metadata for the user to review, never promoted to confirmed.
    analysis.modules = structuredClone(metadata.modules.confirmed);
    analysis.requirements = (['added', 'modified', 'removed'] as const).flatMap((action) => metadata.requirements[action].map((ref) => ({
      id: ref.id, action: action.toUpperCase() as 'ADDED' | 'MODIFIED' | 'REMOVED',
      reason: `迁移自 metadata.requirements.${action}；请用户核对。`,
    })));
    analysis.openQuestions = [{
      id: 'Q-MIGRATION-001', status: 'OPEN',
      question: '请核对并补充目标、非目标、范围、约束、假设、验收标准，以及模块归属和 Requirement action；确认后手工将旧 spec.md 重写为 rich Requirement delta，以 Current Specification 明确填写 Previous。',
    }];
    const analysisSource = stringifyYaml(parseAnalysisDocument(analysis));
    const index = await loadChangeIndex(workspace.paths);
    const entry = { id: next.change.id, title: next.change.title, mode: next.change.mode, status: next.change.status, updated_at: next.change.updated_at };
    const entries = index.entries.some((item) => item.id === changeId)
      ? index.entries.map((item) => item.id === changeId ? entry : item) : [...index.entries, entry];
    const writes = new Map([
      [file('metadata.yaml'), stringifyYaml(next)], [file('analysis.yaml'), analysisSource],
      [file('verification.yaml'), stringifyYaml({ version: 1, testCases: [] })],
      [workspace.paths.changeIndex, stringifyYaml({ version: 1, changes: entries })],
    ]);
    const checkReadOnlyInputs = async () => {
      const names = await fs.readdir(artifacts.changeDir);
      if (names.some((name) => ![...fiveNames, 'analysis.yaml'].includes(name))) throw new Error('Migration conflict: Change artifact set changed.');
      for (const [target, original] of originals) {
        if (!writes.has(target) && await fs.readFile(target, 'utf8') !== original) throw new Error(`Migration conflict: artifact changed: ${target}`);
      }
    };
    let journal: Awaited<ReturnType<typeof createArchiveJournal>> | undefined;
    let committed = false;
    try {
      await checkReadOnlyInputs();
      // Shared journal owns displacement, no-clobber publication, rollback,
      // crash recovery and manual-only escrow for preexisting open handles.
      journal = await createArchiveJournal({
        paths: workspace.paths, transactionId, ownerPid: process.pid,
        files: [...writes].map(([target, after]) => ({ target, before: originals.get(target)!, after })),
      });
      await installArchiveJournal(journal, checkReadOnlyInputs);
      await checkReadOnlyInputs();
      await markArchiveJournalCommitted(journal);
      committed = true;
      await recoverPendingTransactions(workspace.paths, journal.transactionId);
    } catch (error) {
      if (committed) throw new Error(`${String(error)} (migration committed; recovery requires retry)`);
      if (journal) {
        try { await recoverPendingTransactions(workspace.paths, journal.transactionId); }
        catch (failure) { throw new AggregateError([error, failure], `Migration failed: ${String(error)}; rollback conflict or incomplete recovery: ${String(failure)}`); }
      }
      throw error;
    }
    return { changeId, fromArtifacts: 5, toArtifacts: 6, route: 'ANALYZE', unresolvedQuestionId: 'Q-MIGRATION-001', message: CHANGE_MIGRATION_GUIDANCE };
  } finally {
    await releaseTransactionIndexLock(workspace.paths, transactionId);
  }
}
