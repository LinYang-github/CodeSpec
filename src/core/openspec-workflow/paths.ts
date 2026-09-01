import path from 'node:path';

import type { WorkspaceConfig } from './types.js';

export interface WorkspacePaths {
  openspecDir: string;
  business: string;
  changes: string;
  changeIndex: string;
  archive: string;
  currentSpecs: string;
  archivedChanges: string;
}

function resolveConfiguredPath(openspecDir: string, configuredPath: string, label: string): string {
  if (configuredPath.includes('\0')) {
    throw new Error(`${label} path must not contain null bytes`);
  }
  if (path.isAbsolute(configuredPath)) {
    throw new Error(`${label} path must be relative to openspecDir`);
  }

  const segments = configuredPath.split(/[\\/]+/);
  if (segments.some((segment) => segment === '..')) {
    throw new Error(`${label} path must not traverse outside openspecDir`);
  }

  const resolved = path.resolve(openspecDir, configuredPath);
  const relative = path.relative(openspecDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} path must resolve under openspecDir`);
  }

  return resolved;
}

export function getWorkspacePaths(openspecDir: string, config: WorkspaceConfig): WorkspacePaths {
  return {
    openspecDir,
    business: resolveConfiguredPath(openspecDir, config.paths.business, 'business'),
    changes: resolveConfiguredPath(openspecDir, config.paths.changes, 'changes'),
    changeIndex: resolveConfiguredPath(openspecDir, config.paths.change_index, 'change_index'),
    archive: resolveConfiguredPath(openspecDir, config.paths.archive, 'archive'),
    currentSpecs: resolveConfiguredPath(openspecDir, config.paths.specs, 'specs'),
    archivedChanges: resolveConfiguredPath(
      openspecDir,
      config.paths.archived_changes,
      'archived_changes'
    ),
  };
}
