import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { parseChangeMetadata } from './schemas.js';
import type { WorkspaceContext } from './loaders.js';
import type { ChangeMetadata } from './types.js';

const active = new Set(['ANALYZE', 'DESIGN', 'PLAN', 'IMPLEMENT', 'VERIFY', 'ARCHIVE']);
export async function detectStaleChanges(workspace: WorkspaceContext, archivedRequirementIds: string[]): Promise<string[]> {
  const affected: string[] = []; const archived = new Set(archivedRequirementIds);
  let entries;
  try { entries = await fs.readdir(workspace.paths.changes, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^CHG-\d{8}-\d{3}$/u.test(entry.name)) continue;
    const file = path.join(workspace.paths.changes, entry.name, 'metadata.yaml'); let metadata: ChangeMetadata;
    try { metadata = parseChangeMetadata(parseYaml(await fs.readFile(file, 'utf8'))); }
    catch (error) { throw new Error(`Cannot assess canonical Change ${entry.name}: ${error instanceof Error ? error.message : String(error)}`); }
    if (metadata.change.id !== entry.name) throw new Error(`Change directory ${entry.name} does not match metadata change.id ${metadata.change.id}`);
    if (!active.has(metadata.change.status)) continue;
    const ids = Object.values(metadata.requirements).flat().map((item) => item.id);
    if (!ids.some((id) => archived.has(id))) continue;
    metadata.baseline.stale = true;
    metadata.change.updated_at = new Date().toISOString();
    const temporary = `${file}.${process.pid}.tmp`; await fs.writeFile(temporary, stringifyYaml(metadata)); await fs.rename(temporary, file);
    affected.push(metadata.change.id);
  }
  return affected.sort();
}
