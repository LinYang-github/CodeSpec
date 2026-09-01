import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { BusinessModuleId } from './types.js';

export interface RequirementWorkspace { paths: { currentSpecs: string; changes: string } }

export async function allocateRequirementIds(workspace: RequirementWorkspace, moduleId: BusinessModuleId, count: number): Promise<string[]> {
  const used = new Set<number>();
  const collect = (value: string) => { for (const match of value.matchAll(new RegExp(`${moduleId}-REQ-(\\d{3})`, 'g'))) used.add(Number(match[1])); };
  async function scan(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await scan(full);
      else if (entry.isFile()) collect(await fs.readFile(full, 'utf8').catch(() => ''));
    }
  }
  await scan(workspace.paths.currentSpecs);
  const entries = await fs.readdir(workspace.paths.changes, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === 'reservations.txt') { collect(await fs.readFile(path.join(workspace.paths.changes, entry.name), 'utf8')); continue; }
    if (!entry.isDirectory()) continue;
    const metadata = path.join(workspace.paths.changes, entry.name, 'metadata.yaml');
    const content = await fs.readFile(metadata, 'utf8').catch(() => '');
    if (content && !/status:\s*(?:ARCHIVED|ABANDONED)\b/u.test(content)) collect(content);
  }
  const result: string[] = [];
  for (let n = Math.max(0, ...used) + 1; result.length < count; n++) if (!used.has(n)) { result.push(`${moduleId}-REQ-${String(n).padStart(3, '0')}`); used.add(n); }
  return result;
}
