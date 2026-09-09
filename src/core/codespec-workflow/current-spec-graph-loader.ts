import * as fs from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

import { buildCurrentSpecGraph, type CurrentSpecGraph } from './current-spec-graph.js';
import { parseBusinessRegistry, parseModuleInterface } from './current-spec-yaml.js';
import type { WorkspacePaths } from './paths.js';

export async function loadCurrentSpecGraph(paths: WorkspacePaths): Promise<CurrentSpecGraph> {
  const business = parseBusinessRegistry(parseYaml(await fs.readFile(paths.business, 'utf8')));
  const interfaces = await Promise.all(business.modules.map(async (module) => {
    const file = `${paths.currentSpecs}/${module.id}/interface.yaml`;
    try {
      return parseModuleInterface(parseYaml(await fs.readFile(file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Missing interface.yaml for registered module ${module.id}`);
      }
      throw error;
    }
  }));
  return buildCurrentSpecGraph({
    modules: business.modules.map(({ id, name, status }) => ({ id, name, status })),
    interfaces,
  });
}
