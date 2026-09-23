import * as fs from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

import { buildCurrentSpecGraph, type CurrentSpecGraph } from './current-spec-graph.js';
import { readCurrentModuleFiles } from './current-module-state.js';
import { parseBusinessRegistry, parseModuleInterface } from './current-spec-yaml.js';
import type { WorkspacePaths } from './paths.js';

export async function loadCurrentSpecGraph(paths: WorkspacePaths): Promise<CurrentSpecGraph> {
  const business = parseBusinessRegistry(parseYaml(await fs.readFile(paths.business, 'utf8')));
  const interfaces = (await Promise.all(business.modules.map(async (module) => {
    const current = await readCurrentModuleFiles(paths.currentSpecs, module.id);
    return current ? parseModuleInterface(parseYaml(current.interface)) : null;
  }))).filter((document) => document !== null);
  return buildCurrentSpecGraph({
    modules: business.modules.map(({ id, name, status }) => ({ id, name, status })),
    interfaces,
  });
}
