import type { CurrentTasks } from './current-change-yaml.js';
import { buildCurrentSpecificationGraph } from './current-spec-graph.js';
import {
  parseBusinessRegistry,
  parseConfiguration,
  parseModuleInterface,
  type BusinessRegistry,
  type ConfigurationSnapshot,
  type ModuleInterface,
} from './current-spec-yaml.js';

export interface CurrentArchiveMergeInput {
  business: BusinessRegistry;
  interfaces: Map<string, ModuleInterface>;
  configuration: ConfigurationSnapshot;
  moduleDeltas: CurrentTasks['moduleDeltas'];
  moduleRegistrations?: CurrentTasks['moduleRegistrations'];
}

export interface CurrentArchiveMergeResult {
  business: BusinessRegistry;
  interfaces: Map<string, ModuleInterface>;
  apis: ReturnType<typeof buildCurrentSpecificationGraph>['apis'];
  configuration: ConfigurationSnapshot;
}

function interfaceFor(interfaces: Map<string, ModuleInterface>, module: string): ModuleInterface {
  const existing = interfaces.get(module);
  if (!existing) throw new Error(`Missing interface.yaml for module ${module}`);
  return existing;
}

/** Applies only approved typed deltas, then regenerates all derived business and API documents. */
export function mergeCurrentModuleDeltas(input: CurrentArchiveMergeInput): CurrentArchiveMergeResult {
  const registrations = new Map(input.business.modules.map((module) => [module.id, { id: module.id, name: module.name, status: module.status }]));
  for (const registration of input.moduleRegistrations?.upsert ?? []) {
    const previous = registrations.get(registration.id);
    registrations.set(registration.id, { id: registration.id, name: registration.name, status: previous?.status ?? 'ACTIVE' });
  }
  for (const module of input.moduleRegistrations?.retire ?? []) {
    const current = registrations.get(module);
    if (!current) throw new Error(`Cannot retire an unregistered module: ${module}`);
    registrations.set(module, { ...current, status: 'RETIRED' });
  }

  const interfaces = new Map([...input.interfaces].map(([module, document]) => [module, parseModuleInterface(document)]));
  for (const module of registrations.values()) {
    if (!interfaces.has(module.id)) interfaces.set(module.id, parseModuleInterface({ version: 1, module: module.id, relations: [] }));
  }
  for (const delta of input.moduleDeltas) {
    interfaceFor(interfaces, delta.module);
    for (const relationId of delta.interfaces.remove) {
      for (const [module, document] of interfaces) {
        interfaces.set(module, parseModuleInterface({ ...document, relations: document.relations.filter((relation) => relation.id !== relationId) }));
      }
    }
    for (const relation of delta.interfaces.upsert) {
      if (relation.fromModule !== delta.module && relation.toModule !== delta.module) {
        throw new Error(`Relation ${relation.id} must be declared by an endpoint module`);
      }
      if (!registrations.has(relation.fromModule) || !registrations.has(relation.toModule)) {
        throw new Error(`Relation ${relation.id} references an unregistered module`);
      }
      for (const [module, document] of interfaces) {
        const withoutPrior = document.relations.filter((candidate) => candidate.id !== relation.id);
        const endpoint = module === relation.fromModule || module === relation.toModule;
        interfaces.set(module, parseModuleInterface({ ...document, relations: endpoint ? [...withoutPrior, relation] : withoutPrior }));
      }
    }
  }

  const profiles = new Map(input.configuration.profiles.map((profile) => [profile.id, { id: profile.id, services: [...profile.services] }]));
  for (const delta of input.moduleDeltas) {
    for (const removal of delta.configurationChanges.remove) {
      const profile = profiles.get(removal.profile);
      if (!profile) continue;
      profiles.set(removal.profile, { ...profile, services: profile.services.filter((service) => service.id !== removal.service) });
    }
    for (const change of delta.configurationChanges.upsert) {
      const profile = profiles.get(change.profile) ?? { id: change.profile, services: [] };
      profiles.set(change.profile, {
        ...profile,
        services: [...profile.services.filter((service) => service.id !== change.service.id), change.service]
          .sort((left, right) => left.id.localeCompare(right.id)),
      });
    }
  }
  const configuration = parseConfiguration({
    version: 1,
    profiles: [...profiles.values()].sort((left, right) => left.id.localeCompare(right.id)),
  });
  const graph = buildCurrentSpecificationGraph({
    modules: [...registrations.values()].sort((left, right) => left.id.localeCompare(right.id)),
    interfaces: [...interfaces.values()].sort((left, right) => left.module.localeCompare(right.module)),
  });
  const activeModules = new Set(graph.business.modules.filter((module) => module.status === 'ACTIVE').map((module) => module.id));
  for (const profile of configuration.profiles) {
    for (const service of profile.services) {
      for (const binding of service.routeBindings) {
        if (!activeModules.has(binding.module)) {
          throw new Error(`Configuration service ${profile.id}/${service.id} references a non-active module ${binding.module}`);
        }
        const api = graph.apis.get(binding.module);
        if (!api?.routes.some((route) => route.path === binding.path)) {
          throw new Error(`Configuration service ${profile.id}/${service.id} references an unresolved route ${binding.module}${binding.path}`);
        }
      }
    }
  }
  return { business: parseBusinessRegistry(graph.business), interfaces, apis: graph.apis, configuration };
}
