import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
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
  const baseline = await captureBaseline(workspace, change); change.baseline = baseline;
  const decision: RebaseDecision = { strategy: 'semantic-rebase', route: 'DESIGN', reason: 'Current specifications were re-evaluated against the original goal.', current_specs: currentSpecs };
  const metadataPath = path.join(workspace.openspecDir, change.artifacts.metadata); await fs.writeFile(metadataPath, stringifyYaml(change));
  await fs.writeFile(path.join(workspace.openspecDir, change.artifacts.design), `# Design\n\n## Rebase decision\n\n${stringifyYaml(decision)}`);
  return { change: change.change, baseline, decision };
}
