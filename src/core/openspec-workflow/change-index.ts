import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { parseChangeIndexEntry } from './schemas.js';
import type { ChangeIndexEntry } from './types.js';
import type { WorkspacePaths } from './paths.js';

export async function withChangeIndexLock<T>(paths: WorkspacePaths, work: () => Promise<T>): Promise<T> {
  const lock = `${paths.changeIndex}.lock`;
  await fs.mkdir(path.dirname(lock), { recursive: true });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { await fs.mkdir(lock); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (attempt === 99) throw new Error('Change 索引正忙');
    }
  }
  try { return await work(); } finally { await fs.rm(lock, { recursive: true, force: true }); }
}

export interface ChangeIndex {
  version: 1;
  entries: ChangeIndexEntry[];
  byId: Map<string, ChangeIndexEntry>;
}

export async function loadChangeIndex(paths: WorkspacePaths): Promise<ChangeIndex> {
  const raw = parseYaml(await fs.readFile(paths.changeIndex, 'utf8')) as { version?: unknown; changes?: unknown[] } | null;
  if (!raw || raw.version !== 1 || !Array.isArray(raw.changes)) throw new Error(`Invalid canonical Change index ${paths.changeIndex}: expected version 1 and changes array`);

  const entries = (raw?.changes ?? []).map((entry) => parseChangeIndexEntry(entry));
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`Invalid canonical Change index ${paths.changeIndex}: duplicate Change ID ${entry.id}`);
    ids.add(entry.id);
  }
  return {
    version: 1,
    entries,
    byId: new Map(entries.map((entry) => [entry.id, entry])),
  };
}
