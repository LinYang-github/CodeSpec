import path from 'node:path';

import type { WorkspaceConfig } from './types.js';

export interface WorkspacePaths {
  codespecDir: string;
  business: string;
  configuration: string;
  changes: string;
  changeIndex: string;
  archive: string;
  currentSpecs: string;
  transactions: string;
  archivedChanges: string;
}

function resolveConfiguredPath(codespecDir: string, configuredPath: string, label: string): string {
  if (configuredPath.includes('\0')) {
    throw new Error(`${label} path must not contain null bytes`);
  }
  if (path.isAbsolute(configuredPath)) {
    throw new Error(`${label} path must be relative to codespecDir`);
  }

  const segments = configuredPath.split(/[\\/]+/);
  if (segments.some((segment) => segment === '..')) {
    throw new Error(`${label} path must not traverse outside codespecDir`);
  }

  const resolved = path.resolve(codespecDir, configuredPath);
  const relative = path.relative(codespecDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} path must resolve under codespecDir`);
  }

  return resolved;
}

export function getWorkspacePaths(codespecDir: string, config: WorkspaceConfig): WorkspacePaths {
  return {
    codespecDir,
    business: resolveConfiguredPath(codespecDir, config.paths.business, 'business'),
    configuration: resolveConfiguredPath(
      codespecDir,
      config.paths.configuration ?? 'configuration.yaml',
      'configuration'
    ),
    changes: resolveConfiguredPath(codespecDir, config.paths.changes, 'changes'),
    changeIndex: resolveConfiguredPath(codespecDir, config.paths.change_index, 'change_index'),
    archive: resolveConfiguredPath(codespecDir, config.paths.archive ?? 'archive', 'archive'),
    currentSpecs: resolveConfiguredPath(codespecDir, config.paths.specs, 'specs'),
    transactions: resolveConfiguredPath(
      codespecDir,
      config.paths.transactions ?? '.transactions',
      'transactions'
    ),
    archivedChanges: resolveConfiguredPath(
      codespecDir,
      config.paths.archived_changes ?? 'archive/changes',
      'archived_changes'
    ),
  };
}
