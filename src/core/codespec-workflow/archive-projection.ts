import { stringify as stringifyYaml } from 'yaml';

import {
  parseBusinessRegistry,
  parseConfiguration,
  parseModuleApi,
  parseModuleInterface,
  type BusinessRegistry,
  type ConfigurationSnapshot,
  type ModuleApi,
  type ModuleInterface,
} from './current-spec-yaml.js';
import { buildCurrentSpecificationGraph } from './current-spec-graph.js';

export interface ArchiveModuleProjection {
  spec: string;
  interface: string;
  api: string;
}

export interface ArchiveProjection {
  modules: Map<string, ArchiveModuleProjection>;
  business: string;
  configuration: string;
}

export interface ArchiveProjectionInput {
  specs: Map<string, string>;
  business: BusinessRegistry;
  interfaces: Map<string, ModuleInterface>;
  configuration: ConfigurationSnapshot;
  newModuleIds?: ReadonlySet<string>;
}

function emptyApi(module: string): ModuleApi {
  return parseModuleApi({ version: 1, module, routes: [] });
}

/** Build the complete canonical Current Specification projection in memory. */
export function buildArchiveProjection(input: ArchiveProjectionInput): ArchiveProjection {
  const interfaces = new Map(
    [...input.interfaces.entries()]
      .map(([module, document]) => [module, parseModuleInterface(document)] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  for (const module of input.business.modules) {
    if (!interfaces.has(module.id) && input.newModuleIds?.has(module.id)) {
      interfaces.set(module.id, parseModuleInterface({ version: 1, module: module.id, relations: [] }));
    }
  }
  const graph = buildCurrentSpecificationGraph({
    modules: input.business.modules.map(({ id, name, status }) => ({ id, name, status })),
    interfaces: [...interfaces.values()],
  });
  const modules = new Map<string, ArchiveModuleProjection>();

  for (const module of graph.business.modules) {
    const spec = input.specs.get(module.id);
    if (spec === undefined) throw new Error(`Missing spec.md for module ${module.id}`);
    const document = interfaces.get(module.id);
    if (!document) throw new Error(`Missing interface.yaml for module ${module.id}`);
    const api = graph.apis.get(module.id) ?? emptyApi(module.id);
    modules.set(module.id, {
      spec,
      interface: stringifyYaml(document),
      api: stringifyYaml(api),
    });
  }

  return {
    modules,
    business: stringifyYaml(parseBusinessRegistry(graph.business)),
    configuration: stringifyYaml(parseConfiguration(input.configuration)),
  };
}
