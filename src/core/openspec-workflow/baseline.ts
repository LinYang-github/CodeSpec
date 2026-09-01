import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import type { ChangeMetadata } from './types.js';
import type { WorkspaceContext } from './loaders.js';

export interface Baseline { created_at: string; stale: boolean; modules: ChangeMetadata['baseline']['modules'] }
export async function captureBaseline(workspace: WorkspaceContext, metadata: ChangeMetadata, authoredSpecs: Record<string, string> = {}): Promise<Baseline> {
  const modules: Baseline['modules'] = {};
  for (const selected of metadata.modules.confirmed) {
    const requirement_ids = Object.values(metadata.requirements).flat().filter((r) => r.module === selected.module).map((r) => r.id);
    let latest_change: ChangeMetadata['change']['id'] | null = null;
    const entries = await fs.readdir(workspace.paths.changes, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) if (entry.isDirectory() && entry.name.startsWith('CHG-')) {
      try { const candidate = parseYaml(await fs.readFile(path.join(workspace.paths.changes, entry.name, 'metadata.yaml'), 'utf8')) as ChangeMetadata; if (candidate.change.id !== metadata.change.id && candidate.modules.confirmed.some((m) => m.module === selected.module)) latest_change = candidate.change.id; } catch { /* ignore non-canonical entries */ }
    }
    const specPath = path.join(workspace.paths.currentSpecs, selected.module, 'spec.md');
    const content = authoredSpecs[selected.module] ?? await fs.readFile(specPath, 'utf8').catch(() => '');
    const requirements: Record<string, string> = {};
    for (const id of requirement_ids) {
      const start = content.indexOf(id); const end = start < 0 ? -1 : content.indexOf('\n### ', start + id.length);
      const block = start < 0 ? '' : content.slice(start, end < 0 ? content.length : end);
      requirements[id] = createHash('sha256').update(block).digest('hex');
    }
    modules[selected.module] = { outcome: selected.outcome, latest_change, requirement_ids, spec_hash: createHash('sha256').update(content).digest('hex'), requirements };
  }
  return { created_at: new Date().toISOString(), stale: false, modules };
}
