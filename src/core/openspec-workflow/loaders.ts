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
  if ((await fs.lstat(configPath)).isSymbolicLink()) throw new Error(`Canonical workspace config must not be a symlink: ${configPath}`);
  const raw = parseYaml(await fs.readFile(configPath, 'utf8'));
  return parseWorkspaceConfig(raw);
}

async function assertConfiguredPathsAreSafe(paths: WorkspacePaths): Promise<void> {
  for (const [label, target] of Object.entries(paths)) {
    let current = target;
    while (true) {
      try {
        if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`${label} path must not contain a symlink: ${target}`);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
      }
    }
  }
}

export async function loadWorkspace(openspecDir: string): Promise<WorkspaceContext> {
  const config = await readWorkspaceConfig(openspecDir);
  const paths = getWorkspacePaths(openspecDir, config);
  await assertConfiguredPathsAreSafe(paths);
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
