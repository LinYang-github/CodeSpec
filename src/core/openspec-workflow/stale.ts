import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { WorkspaceContext } from './loaders.js';
import type { ChangeMetadata } from './types.js';

export async function detectStaleChanges(workspace: WorkspaceContext, archivedRequirementIds: string[]): Promise<string[]> {
  const affected: string[] = []; const archived = new Set(archivedRequirementIds);
  const entries = await fs.readdir(workspace.paths.changes, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^CHG-\d{8}-\d{3}$/.test(entry.name)) continue;
    const file = path.join(workspace.paths.changes, entry.name, 'metadata.yaml');
    try { const metadata = parseYaml(await fs.readFile(file, 'utf8')) as ChangeMetadata; if (['ARCHIVED', 'ABANDONED'].includes(metadata.change.status)) continue; const ids = Object.values(metadata.requirements).flat().map((r) => r.id); if (ids.some((id) => archived.has(id))) { metadata.baseline.stale = true; await fs.writeFile(file, stringifyYaml(metadata)); affected.push(metadata.change.id); } } catch { /* unsupported entries are outside canonical workflow */ }
  }
  return affected.sort();
}
