import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ChangeMetadata } from './types.js';
import type { WorkspaceContext } from './loaders.js';

export interface Baseline { created_at: string; stale: boolean; modules: ChangeMetadata['baseline']['modules'] }
export async function captureBaseline(workspace: WorkspaceContext, metadata: ChangeMetadata): Promise<Baseline> {
  const modules: Baseline['modules'] = {};
  for (const selected of metadata.modules.confirmed) {
    const requirement_ids = Object.values(metadata.requirements).flat().filter((r) => r.module === selected.module).map((r) => r.id);
    let latest_change: ChangeMetadata['change']['id'] | null = null;
    const entries = await fs.readdir(workspace.paths.changes, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) if (entry.isDirectory() && entry.name.startsWith('CHG-')) {
      try { const candidate = parseYaml(await fs.readFile(path.join(workspace.paths.changes, entry.name, 'metadata.yaml'), 'utf8')) as ChangeMetadata; if (candidate.change.id !== metadata.change.id && candidate.modules.confirmed.some((m) => m.module === selected.module)) latest_change = candidate.change.id; } catch { /* ignore non-canonical entries */ }
    }
    modules[selected.module] = { outcome: selected.outcome, latest_change, requirement_ids };
  }
  return { created_at: new Date().toISOString(), stale: false, modules };
}
