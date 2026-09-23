import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { parseChangeMetadata } from './schemas.js';
import type { WorkspaceContext } from './loaders.js';
import type { ChangeMetadata } from './types.js';

const active = new Set(['ANALYZE', 'DESIGN', 'PLAN', 'IMPLEMENT', 'VERIFY', 'ARCHIVE']);
export interface StaleChangeUpdate {
  changeId: string;
  file: string;
  before: string;
  after: string;
  updatedAt: string;
}

/** Plans stale metadata updates; the archive journal commits them with Current. */
export async function planStaleChanges(
  workspace: WorkspaceContext,
  currentFingerprint: string,
  excludedChangeId: string,
  updatedAt: string,
): Promise<StaleChangeUpdate[]> {
  const updates: StaleChangeUpdate[] = [];
  let entries;
  try { entries = await fs.readdir(workspace.paths.changes, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^CHG-\d{8}-\d{3}$/u.test(entry.name)) continue;
    if (entry.name === excludedChangeId) continue;
    const file = path.join(workspace.paths.changes, entry.name, 'metadata.yaml');
    let metadata: ChangeMetadata;
    let before: string;
    try { before = await fs.readFile(file, 'utf8'); metadata = parseChangeMetadata(parseYaml(before)); }
    catch (error) { throw new Error(`Cannot assess canonical Change ${entry.name}: ${error instanceof Error ? error.message : String(error)}`); }
    if (metadata.change.id !== entry.name) throw new Error(`Change directory ${entry.name} does not match metadata change.id ${metadata.change.id}`);
    if (!active.has(metadata.change.status)) continue;
    if (metadata.baseline.stale || metadata.baseline.current_fingerprint === currentFingerprint) continue;
    metadata.baseline.stale = true;
    metadata.change.updated_at = updatedAt;
    updates.push({
      changeId: metadata.change.id,
      file,
      before,
      after: stringifyYaml(metadata),
      updatedAt,
    });
  }
  return updates.sort((left, right) => left.changeId.localeCompare(right.changeId));
}
