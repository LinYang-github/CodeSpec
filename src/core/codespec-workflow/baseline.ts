import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import { parseChangeMetadata } from './schemas.js';
import type { ChangeMetadata } from './types.js';
import type { WorkspaceContext } from './loaders.js';

export interface Baseline { created_at: string; stale: boolean; modules: ChangeMetadata['baseline']['modules'] }
const active = new Set(['ANALYZE', 'DESIGN', 'PLAN', 'IMPLEMENT', 'VERIFY', 'ARCHIVE']);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function blockFor(content: string, id: string): string {
  const headings = [...content.matchAll(/^###\s+(MOD-\d{3}-REQ-\d{3})(?:\s+.*)?$/gmu)];
  const hit = headings.find((item) => item[1] === id); if (!hit || hit.index === undefined) return '';
  const next = headings.find((item) => (item.index ?? 0) > hit.index!);
  return content.slice(hit.index, next?.index ?? content.length).trim();
}
export async function captureBaseline(workspace: WorkspaceContext, metadata: ChangeMetadata, authoredSpecs: Record<string, string> = {}): Promise<Baseline> {
  const modules: Baseline['modules'] = {};
  let entries: Dirent[];
  try { entries = await fs.readdir(workspace.paths.changes, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') entries = []; else throw error; }
  const candidates: ChangeMetadata[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^CHG-\d{8}-\d{3}$/u.test(entry.name)) continue;
    const file = path.join(workspace.paths.changes, entry.name, 'metadata.yaml');
    let candidate: ChangeMetadata;
    try { candidate = parseChangeMetadata(parseYaml(await fs.readFile(file, 'utf8'))); }
    catch (error) { throw new Error(`Cannot assess canonical Change ${entry.name}: ${error instanceof Error ? error.message : String(error)}`); }
    if (candidate.change.id !== entry.name) throw new Error(`Change directory ${entry.name} does not match metadata change.id ${candidate.change.id}`);
    if (active.has(candidate.change.status) && candidate.change.id !== metadata.change.id) candidates.push(candidate);
  }
  for (const selected of metadata.modules.confirmed) {
    const related = candidates.filter((candidate) => candidate.modules.confirmed.some((item) => item.module === selected.module)).sort((a, b) => b.change.updated_at.localeCompare(a.change.updated_at) || b.change.id.localeCompare(a.change.id));
    const latest_change = related[0]?.change.id ?? null;
    const specPath = path.join(workspace.paths.currentSpecs, selected.module, 'spec.md');
    let content: string;
    if (authoredSpecs[selected.module] !== undefined) content = authoredSpecs[selected.module];
    else { try { content = await fs.readFile(specPath, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') content = ''; else throw error; } }
    const requirement_ids = Object.values(metadata.requirements).flat().filter((item) => item.module === selected.module).map((item) => item.id);
    const requirements: Record<string, string> = {};
    for (const id of requirement_ids) requirements[id] = digest(blockFor(content, id));
    modules[selected.module] = { outcome: selected.outcome, latest_change, requirement_ids, spec_hash: digest(content), requirements };
  }
  return { created_at: new Date().toISOString(), stale: false, modules };
}
