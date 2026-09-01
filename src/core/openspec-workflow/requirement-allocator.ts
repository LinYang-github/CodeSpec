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
  await scan(workspace.paths.changes);
  const result: string[] = [];
  for (let n = 1; result.length < count; n++) if (!used.has(n)) { result.push(`${moduleId}-REQ-${String(n).padStart(3, '0')}`); used.add(n); }
  return result;
}
