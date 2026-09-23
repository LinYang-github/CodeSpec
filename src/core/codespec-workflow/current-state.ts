import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { buildArchiveProjection } from './archive-projection.js';
import { readCurrentModuleFiles } from './current-module-state.js';
import { parseBusinessRegistry, parseConfiguration, parseModuleInterface } from './current-spec-yaml.js';
import type { WorkspaceContext } from './loaders.js';
import { assertPathWithoutSymlinks } from './path-safety.js';

export interface CurrentStateSnapshot {
  fingerprint: string;
  files: ReadonlyMap<string, string>;
}

export function fingerprintCurrentFiles(files: ReadonlyMap<string, string>): string {
  const hash = createHash('sha256');
  for (const [relative, content] of [...files].sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(relative).update('\0').update(content).update('\0');
  }
  return hash.digest('hex');
}

async function readRegularFile(file: string): Promise<string> {
  const stat = await fs.lstat(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Current 文件必须是普通文件：${file}`);
  return fs.readFile(file, 'utf8');
}

export async function readCurrentState(workspace: WorkspaceContext): Promise<CurrentStateSnapshot> {
  await Promise.all([
    assertPathWithoutSymlinks(workspace.codespecDir, workspace.paths.business),
    assertPathWithoutSymlinks(workspace.codespecDir, workspace.paths.configuration),
    assertPathWithoutSymlinks(workspace.codespecDir, workspace.paths.currentSpecs),
  ]);
  const businessRaw = await readRegularFile(workspace.paths.business);
  const configurationRaw = await readRegularFile(workspace.paths.configuration);
  const business = parseBusinessRegistry(parseYaml(businessRaw));
  const configuration = parseConfiguration(parseYaml(configurationRaw));
  const specs = new Map<string, string>();
  const interfaces = new Map<string, ReturnType<typeof parseModuleInterface>>();
  const moduleFiles = new Map<string, Awaited<ReturnType<typeof readCurrentModuleFiles>>>();
  const files = new Map<string, string>([
    ['business.yaml', businessRaw],
    ['configuration.yaml', configurationRaw],
  ]);

  for (const module of business.modules) {
    const current = await readCurrentModuleFiles(workspace.paths.currentSpecs, module.id);
    moduleFiles.set(module.id, current);
    if (!current) continue;
    specs.set(module.id, current.spec);
    interfaces.set(module.id, parseModuleInterface(parseYaml(current.interface)));
    files.set(path.posix.join('specs', module.id, 'spec.md'), current.spec);
    files.set(path.posix.join('specs', module.id, 'interface.yaml'), current.interface);
  }

  const projection = buildArchiveProjection({ specs, business, interfaces, configuration });
  for (const [module, current] of moduleFiles) {
    if (!current) continue;
    const api = current.api ?? projection.modules.get(module)!.api;
    files.set(path.posix.join('specs', module, 'api.yaml'), api);
  }

  return { fingerprint: fingerprintCurrentFiles(files), files };
}
