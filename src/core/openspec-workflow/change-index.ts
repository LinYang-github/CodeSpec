import * as fs from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

import { parseChangeIndexEntry } from './schemas.js';
import type { ChangeIndexEntry } from './types.js';
import type { WorkspacePaths } from './paths.js';

export interface ChangeIndex {
  entries: ChangeIndexEntry[];
  byId: Map<string, ChangeIndexEntry>;
}

export async function loadChangeIndex(paths: WorkspacePaths): Promise<ChangeIndex> {
  const raw = parseYaml(await fs.readFile(paths.changeIndex, 'utf8')) as
    | { changes?: unknown[] }
    | null;

  const entries = (raw?.changes ?? []).map((entry) => parseChangeIndexEntry(entry));
  return {
    entries,
    byId: new Map(entries.map((entry) => [entry.id, entry])),
  };
}
