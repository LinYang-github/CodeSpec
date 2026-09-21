import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { buildArchiveProjection } from './archive-projection.js';
import { parseBusinessRegistry, parseConfiguration, parseModuleInterface } from './current-spec-yaml.js';
import type { WorkspaceContext } from './loaders.js';

export interface CurrentStateSnapshot {
  fingerprint: string;
  files: ReadonlyMap<string, string>;
}

async function readRegularFile(file: string): Promise<string> {
  const stat = await fs.lstat(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Current 文件必须是普通文件：${file}`);
  return fs.readFile(file, 'utf8');
}

export async function readCurrentState(workspace: WorkspaceContext): Promise<CurrentStateSnapshot> {
  const businessRaw = await readRegularFile(workspace.paths.business);
  const configurationRaw = await readRegularFile(workspace.paths.configuration);
  const business = parseBusinessRegistry(parseYaml(businessRaw));
  const configuration = parseConfiguration(parseYaml(configurationRaw));
  const specs = new Map<string, string>();
  const interfaces = new Map<string, ReturnType<typeof parseModuleInterface>>();
  const files = new Map<string, string>([
    ['business.yaml', businessRaw],
    ['configuration.yaml', configurationRaw],
  ]);

  for (const module of business.modules) {
    const directory = path.join(workspace.paths.currentSpecs, module.id);
    const spec = await readRegularFile(path.join(directory, 'spec.md'));
    const interfaceRaw = await readRegularFile(path.join(directory, 'interface.yaml'));
    specs.set(module.id, spec);
    interfaces.set(module.id, parseModuleInterface(parseYaml(interfaceRaw)));
    files.set(path.posix.join('specs', module.id, 'spec.md'), spec);
    files.set(path.posix.join('specs', module.id, 'interface.yaml'), interfaceRaw);
  }

  const projection = buildArchiveProjection({ specs, business, interfaces, configuration });
  for (const module of business.modules) {
    const apiPath = path.join(workspace.paths.currentSpecs, module.id, 'api.yaml');
    const api = await fs.lstat(apiPath).then(async (stat) => {
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Current 文件必须是普通文件：${apiPath}`);
      return fs.readFile(apiPath, 'utf8');
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return projection.modules.get(module.id)!.api;
    });
    files.set(path.posix.join('specs', module.id, 'api.yaml'), api);
  }

  const hash = createHash('sha256');
  for (const [relative, content] of [...files].sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(relative).update('\0').update(content).update('\0');
  }
  return { fingerprint: hash.digest('hex'), files };
}
