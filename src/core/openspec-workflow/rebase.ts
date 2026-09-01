import * as fs from 'node:fs/promises';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { captureBaseline, type Baseline } from './baseline.js';
import type { WorkspaceContext } from './loaders.js';
import { loadChangeArtifacts } from './loaders.js';
import type { ChangeMetadata } from './types.js';

export interface RebaseDecision { strategy: 'semantic-rebase'; route: 'DESIGN'; reason: string; current_specs: string[] }
export interface RebaseResult { change: ChangeMetadata['change']; baseline: Baseline; decision: RebaseDecision }
export async function rebaseChange(workspace: WorkspaceContext, changeId: string, currentSpecs: string[]): Promise<RebaseResult> {
  const artifacts = await loadChangeArtifacts(workspace.paths, changeId); const change = artifacts.metadata;
  if (!change.baseline.stale) throw new Error(`Change ${changeId} is not stale`);
  change.change.revision += 1; change.change.status = 'DESIGN'; change.change.updated_at = new Date().toISOString();
  const original = artifacts.spec;
  const sections = (value: string) => value.split(/(?=^###\s)/m).filter(Boolean);
  const originalSections = new Map(sections(original).map((section) => [section.match(/^###\s+([^\n]+)/m)?.[1] ?? section, section]));
  const incoming = currentSpecs.flatMap(sections);
  const conflicts: string[] = [];
  for (const section of incoming) {
    const key = section.match(/^###\s+([^\n]+)/m)?.[1];
    if (!key) continue;
    const previous = originalSections.get(key);
    if (previous && previous !== section) conflicts.push(key);
    originalSections.set(key, section);
  }
  const merged = [...originalSections.values()].sort((a, b) => a.localeCompare(b)).join('\n');
  const decision: RebaseDecision = { strategy: 'semantic-rebase', route: 'DESIGN', reason: conflicts.length ? `Unresolved Requirement conflicts: ${conflicts.join(', ')}` : 'Current specifications were deterministically merged by Requirement heading.', current_specs: currentSpecs };
  const metadataPath = path.join(workspace.openspecDir, change.artifacts.metadata); await fs.writeFile(metadataPath, stringifyYaml(change));
  await fs.writeFile(path.join(workspace.openspecDir, change.artifacts.spec), merged || original);
  await fs.writeFile(path.join(workspace.openspecDir, change.artifacts.design), `# Design\n\n## Rebase decision\n\n${stringifyYaml(decision)}`);
  const moduleId = change.requirements.modified[0]?.module ?? change.requirements.added[0]?.module;
  const baseline = await captureBaseline(workspace, change, moduleId ? { [moduleId]: merged || original } : {}); change.baseline = baseline;
  await fs.writeFile(metadataPath, stringifyYaml(change));
  return { change: change.change, baseline, decision };
}
