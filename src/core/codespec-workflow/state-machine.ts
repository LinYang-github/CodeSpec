import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ChangeArtifacts } from './artifacts.js';
import type { WorkspaceContext } from './loaders.js';
import type { ChangeMetadata, ChangeStatus } from './types.js';
import { validateEntryGate } from './gates.js';
import { loadChangeIndex, withChangeIndexLock } from './change-index.js';
import { assertTransitionApproval } from './approvals.js';
import { parseChangeMetadata } from './schemas.js';
import { createArchiveJournal, installArchiveJournal, markArchiveJournalCommitted, recoverPendingTransactions } from './transaction-journal.js';

const EDGES: Record<ChangeStatus, readonly ChangeStatus[]> = {
  ANALYZE: ['DESIGN', 'ABANDONED'], DESIGN: ['PLAN', 'ANALYZE', 'ABANDONED'], PLAN: ['IMPLEMENT', 'DESIGN', 'ABANDONED'],
  IMPLEMENT: ['VERIFY', 'PLAN', 'ABANDONED'], VERIFY: ['ARCHIVE', 'IMPLEMENT', 'DESIGN', 'ABANDONED'], ARCHIVE: ['VERIFY', 'ABANDONED'], ABANDONED: [],
};
export function canTransition(from: ChangeStatus, to: ChangeStatus): boolean { return EDGES[from]?.includes(to) ?? false; }
function isDesignReason(reason: string): boolean { return /spec|design|requirement|scope|goal|proposal/i.test(reason); }

/** Transition is deliberately async and requires loaded canonical artifacts, so no gate bypass overload exists. */
export async function transitionChange(workspace: WorkspaceContext, artifacts: ChangeArtifacts, target: ChangeStatus, reason: string): Promise<ChangeMetadata> {
  if (!workspace || !artifacts?.metadata) throw new Error('需要 canonical workspace 和 Change 产物；不支持绕过生命周期门禁。');
  const metadata = artifacts.metadata; const from = metadata.change.status;
  if (!canTransition(from, target)) throw new Error(`无效的生命周期转换：${from} -> ${target}`);
  if (!reason.trim()) throw new Error('必须提供状态转换原因。');
  if (from === 'VERIFY' && target === 'IMPLEMENT' && isDesignReason(reason)) throw new Error('VERIFY -> IMPLEMENT 仅适用于实现失败；Spec 或设计问题应转换到 DESIGN。');
  if (metadata.baseline.stale && target !== 'ABANDONED') throw new Error(`Change ${metadata.change.id} 已过期；请先执行 rebase。`);
  assertTransitionApproval(artifacts, target);
  const gate = await validateEntryGate(workspace, artifacts, target);
  if (!gate.ok) throw new Error(`生命周期转换 ${from} -> ${target} 被阻塞：${gate.errors.join('；')}`);
  const next: ChangeMetadata = {
    ...metadata,
    change: { ...metadata.change, status: target, updated_at: new Date().toISOString() },
    archive: target === 'ARCHIVE'
      ? { ...metadata.archive, ready: true }
      : metadata.archive,
    gates: target === 'ARCHIVE'
      ? { ...metadata.gates, archive: { ...metadata.gates.archive, satisfied: true } }
      : metadata.gates,
  };
  const metadataPath = path.join(workspace.codespecDir, metadata.artifacts.metadata);
  const indexPath = workspace.paths.changeIndex;
  await recoverPendingTransactions(workspace.paths);
  await withChangeIndexLock(workspace.paths, async () => {
    const originalMetadata = await fs.readFile(metadataPath, 'utf8');
    const originalIndex = await fs.readFile(indexPath, 'utf8');
    if (!isDeepStrictEqual(parseChangeMetadata(parseYaml(originalMetadata)), metadata)) {
      throw new Error('Transition conflict: metadata changed during load');
    }
    const index = await loadChangeIndex(workspace.paths);
    const nextIndex = {
      version: 1 as const,
      changes: index.entries.some((entry) => entry.id === next.change.id)
        ? index.entries.map((entry) => entry.id === next.change.id ? { ...entry, title: next.change.title, mode: next.change.mode, status: next.change.status, updated_at: next.change.updated_at } : entry)
        : [...index.entries, { id: next.change.id, title: next.change.title, mode: next.change.mode, status: next.change.status, updated_at: next.change.updated_at }],
    };
    let journal: Awaited<ReturnType<typeof createArchiveJournal>> | undefined;
    let committed = false;
    try {
      journal = await createArchiveJournal({
        paths: workspace.paths,
        transactionId: `transition-${metadata.change.id}-${randomUUID()}`,
        ownerPid: process.pid,
        files: [
          { target: metadataPath, before: originalMetadata, after: stringifyYaml(next) },
          { target: indexPath, before: originalIndex, after: stringifyYaml(nextIndex) },
        ],
      });
      await installArchiveJournal(journal);
      await markArchiveJournalCommitted(journal);
      committed = true;
      await recoverPendingTransactions(workspace.paths, journal.transactionId);
    } catch (error) {
      if (committed) throw new Error(`${String(error)} (transition committed; recovery requires retry)`);
      if (journal) await recoverPendingTransactions(workspace.paths, journal.transactionId);
      throw error;
    }
  });
  return next;
}

/** Pure counter update; reviseChange owns semantic classification and invalidation. */
export function incrementRevision(metadata: ChangeMetadata): ChangeMetadata {
  return { ...metadata, change: { ...metadata.change, revision: metadata.change.revision + 1, updated_at: new Date().toISOString() } };
}
