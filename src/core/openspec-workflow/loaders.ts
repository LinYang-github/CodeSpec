import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { loadChangeArtifacts, type ChangeArtifacts } from './artifacts.js';
import { loadBusinessRegistry, type BusinessRegistry } from './business-registry.js';
import { loadChangeIndex, type ChangeIndex } from './change-index.js';
import { getWorkspacePaths, type WorkspacePaths } from './paths.js';
import { parseWorkspaceConfig } from './schemas.js';
import type { WorkspaceConfig } from './types.js';

export interface WorkspaceContext {
  openspecDir: string;
  config: WorkspaceConfig;
  paths: WorkspacePaths;
  registry: BusinessRegistry;
  index: ChangeIndex;
}

async function readWorkspaceConfig(openspecDir: string): Promise<WorkspaceConfig> {
  const configPath = path.join(openspecDir, 'config.yaml');
  const raw = parseYaml(await fs.readFile(configPath, 'utf8'));
  return parseWorkspaceConfig(raw);
}

export async function loadWorkspace(openspecDir: string): Promise<WorkspaceContext> {
  const config = await readWorkspaceConfig(openspecDir);
  const paths = getWorkspacePaths(openspecDir, config);
  const [registry, index] = await Promise.all([
    loadBusinessRegistry(paths),
    loadChangeIndex(paths),
  ]);

  return {
    openspecDir,
    config,
    paths,
    registry,
    index,
  };
}

export { loadBusinessRegistry, loadChangeArtifacts, loadChangeIndex };
export type { ChangeArtifacts, BusinessRegistry, ChangeIndex };
