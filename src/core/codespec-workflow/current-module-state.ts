import * as fs from 'node:fs/promises';

import { getCurrentModuleArtifactPaths } from './current-spec-paths.js';
import { assertPathWithoutSymlinks } from './path-safety.js';

export interface CurrentModuleFiles {
  spec: string;
  interface: string;
  api: string | null;
}

async function existsAsRegularFile(file: string): Promise<boolean> {
  const stat = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat) return false;
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Current 文件必须是普通文件：${file}`);
  return true;
}

export async function inspectCurrentModuleState(
  currentSpecsDirectory: string,
  moduleId: string,
): Promise<'absent' | 'materialized'> {
  const paths = getCurrentModuleArtifactPaths(currentSpecsDirectory, moduleId);
  await assertPathWithoutSymlinks(currentSpecsDirectory, paths.directory);
  const [hasSpec, hasInterface, hasApi] = await Promise.all([
    existsAsRegularFile(paths.spec),
    existsAsRegularFile(paths.interface),
    existsAsRegularFile(paths.api),
  ]);
  if (!hasSpec && !hasInterface && !hasApi) return 'absent';
  if (!hasSpec) throw new Error(`当前模块 ${moduleId} 缺少 spec.md，无法读取 Current`);
  if (!hasInterface) throw new Error(`当前模块 ${moduleId} 缺少 interface.yaml，无法读取 Current`);
  return 'materialized';
}

/** All files absent means the registered module has not completed its first archive. */
export async function readCurrentModuleFiles(currentSpecsDirectory: string, moduleId: string): Promise<CurrentModuleFiles | null> {
  const paths = getCurrentModuleArtifactPaths(currentSpecsDirectory, moduleId);
  if (await inspectCurrentModuleState(currentSpecsDirectory, moduleId) === 'absent') return null;
  const [spec, moduleInterface, api] = await Promise.all([
    fs.readFile(paths.spec, 'utf8'),
    fs.readFile(paths.interface, 'utf8'),
    fs.readFile(paths.api, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    }),
  ]);
  return { spec, interface: moduleInterface, api };
}
