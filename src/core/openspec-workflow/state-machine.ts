import * as fs from 'node:fs/promises';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import type { ChangeArtifacts } from './artifacts.js';
import type { WorkspaceContext } from './loaders.js';
import type { ChangeMetadata, ChangeStatus } from './types.js';
import { validateEntryGate } from './gates.js';
import { loadChangeIndex, withChangeIndexLock } from './change-index.js';

const EDGES: Record<ChangeStatus, readonly ChangeStatus[]> = {
  ANALYZE: ['DESIGN', 'ABANDONED'], DESIGN: ['PLAN', 'ANALYZE', 'ABANDONED'], PLAN: ['IMPLEMENT', 'DESIGN', 'ABANDONED'],
  IMPLEMENT: ['VERIFY', 'PLAN', 'ABANDONED'], VERIFY: ['ARCHIVE', 'IMPLEMENT', 'DESIGN', 'ABANDONED'], ARCHIVE: ['ARCHIVED', 'VERIFY', 'ABANDONED'], ARCHIVED: [], ABANDONED: [],
};
export function canTransition(from: ChangeStatus, to: ChangeStatus): boolean { return EDGES[from]?.includes(to) ?? false; }
function isDesignReason(reason: string): boolean { return /spec|design|requirement|scope|goal|proposal/i.test(reason); }

/** Transition is deliberately async and requires loaded canonical artifacts, so no gate bypass overload exists. */
export async function transitionChange(workspace: WorkspaceContext, artifacts: ChangeArtifacts, target: ChangeStatus, reason: string): Promise<ChangeMetadata> {
  if (!workspace || !artifacts?.metadata) throw new Error('Canonical workspace and artifacts are required; lifecycle gate bypass is unsupported');
  const metadata = artifacts.metadata; const from = metadata.change.status;
  if (!canTransition(from, target)) throw new Error(`Invalid lifecycle transition ${from} -> ${target}`);
  if (!reason.trim()) throw new Error('A transition reason is required');
  if (from === 'VERIFY' && target === 'IMPLEMENT' && isDesignReason(reason)) throw new Error('VERIFY -> IMPLEMENT is only valid for implementation failures; use DESIGN for spec/design errors');
  if (metadata.baseline.stale && target !== 'DESIGN' && target !== 'ABANDONED') throw new Error(`Change ${metadata.change.id} is stale; rebase to DESIGN before continuing`);
  const gate = validateEntryGate(workspace, artifacts, target);
  if (!gate.ok) throw new Error(`Lifecycle transition ${from} -> ${target} blocked: ${gate.errors.join('; ')}`);
  const next = { ...metadata, change: { ...metadata.change, status: target, updated_at: new Date().toISOString() } };
  const metadataPath = path.join(workspace.openspecDir, metadata.artifacts.metadata);
  const indexPath = workspace.paths.changeIndex;
  await withChangeIndexLock(workspace.paths, async () => {
    const originalMetadata = await fs.readFile(metadataPath, 'utf8');
    const originalIndex = await fs.readFile(indexPath, 'utf8');
    const index = await loadChangeIndex(workspace.paths);
    const nextIndex = {
      version: 1 as const,
      changes: index.entries.some((entry) => entry.id === next.change.id)
        ? index.entries.map((entry) => entry.id === next.change.id ? { ...entry, title: next.change.title, mode: next.change.mode, status: next.change.status, updated_at: next.change.updated_at } : entry)
        : [...index.entries, { id: next.change.id, title: next.change.title, mode: next.change.mode, status: next.change.status, updated_at: next.change.updated_at }],
    };
    const token = `.transition-${process.pid}-${Date.now()}`;
    const metadataTmp = `${metadataPath}${token}.tmp`;
    const indexTmp = `${indexPath}${token}.tmp`;
    try {
      await fs.writeFile(metadataTmp, stringifyYaml(next), 'utf8');
      await fs.writeFile(indexTmp, stringifyYaml(nextIndex), 'utf8');
      await fs.rename(metadataTmp, metadataPath);
      await fs.rename(indexTmp, indexPath);
    } catch (error) {
      await fs.writeFile(metadataPath, originalMetadata).catch(() => undefined);
      await fs.writeFile(indexPath, originalIndex).catch(() => undefined);
      await fs.rm(metadataTmp, { force: true }).catch(() => undefined);
      await fs.rm(indexTmp, { force: true }).catch(() => undefined);
      throw error;
    }
  });
  return next;
}

export function incrementRevision(metadata: ChangeMetadata, reason: string): ChangeMetadata {
  const semanticChange = /requirements?\s+(?:added|modified|removed|changed)|scope\s+changed/i.test(reason) && Object.values(metadata.requirements).some((items) => items.length > 0);
  const verifyToDesign = /^VERIFY\s*(?:->|to)\s*DESIGN(?:\s|$)/i.test(reason) && metadata.change.status === 'VERIFY';
  if (!semanticChange && !verifyToDesign) throw new Error('Revision increment requires an approved semantic Requirement/Scope change or VERIFY -> DESIGN');
  return { ...metadata, change: { ...metadata.change, revision: metadata.change.revision + 1, updated_at: new Date().toISOString() } };
}
