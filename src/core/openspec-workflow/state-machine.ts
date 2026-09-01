import type { ChangeArtifacts } from './artifacts.js';
import type { WorkspaceContext } from './loaders.js';
import type { ChangeMetadata, ChangeStatus } from './types.js';
import { validateEntryGate } from './gates.js';

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
  const gate = validateEntryGate(workspace, artifacts, target);
  if (!gate.ok) throw new Error(`Lifecycle transition ${from} -> ${target} blocked: ${gate.errors.join('; ')}`);
  return { ...metadata, change: { ...metadata.change, status: target, updated_at: new Date().toISOString() } };
}

export function incrementRevision(metadata: ChangeMetadata, reason: string): ChangeMetadata {
  const semanticChange = /requirements?\s+(?:added|modified|removed|changed)|scope\s+changed/i.test(reason) && Object.values(metadata.requirements).some((items) => items.length > 0);
  const verifyToDesign = /^VERIFY\s*(?:->|to)\s*DESIGN(?:\s|$)/i.test(reason) && metadata.change.status === 'VERIFY';
  if (!semanticChange && !verifyToDesign) throw new Error('Revision increment requires an approved semantic Requirement/Scope change or VERIFY -> DESIGN');
  return { ...metadata, change: { ...metadata.change, revision: metadata.change.revision + 1, updated_at: new Date().toISOString() } };
}
