import {
  parseBusinessRegistry,
  parseModuleApi,
  type BusinessRegistry,
  type ModuleApi,
  type ModuleInterface,
} from './current-spec-yaml.js';

export interface RegisteredBusinessModule {
  id: string;
  name: string;
  status: 'ACTIVE' | 'RETIRED';
}

export interface CurrentSpecificationGraphInput {
  modules: RegisteredBusinessModule[];
  interfaces: ModuleInterface[];
}

export interface CurrentSpecificationGraph {
  business: BusinessRegistry;
  apis: Map<string, ModuleApi>;
  relations: ModuleInterface['relations'];
}
export type CurrentSpecGraph = CurrentSpecificationGraph;
export type CurrentSpecGraphInput = CurrentSpecificationGraphInput;

type Relation = ModuleInterface['relations'][number];

function stableRelationValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableRelationValue).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableRelationValue(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function collectMirroredRelations(documents: ModuleInterface[]): Relation[] {
  const occurrences = new Map<string, Array<{ module: string; relation: Relation }>>();
  for (const document of documents) {
    for (const relation of document.relations) {
      const current = occurrences.get(relation.id) ?? [];
      current.push({ module: document.module, relation });
      occurrences.set(relation.id, current);
    }
  }

  const relations: Relation[] = [];
  for (const [id, entries] of occurrences) {
    if (entries.length !== 2) throw new Error(`Relation ${id} must have exactly two endpoint mirrors`);
    const [first, second] = [...entries].sort((left, right) => left.module.localeCompare(right.module));
    if (!first || !second || first.module === second.module) {
      throw new Error(`Relation ${id} must be mirrored in two distinct endpoint modules`);
    }
    if (stableRelationValue(first.relation) !== stableRelationValue(second.relation)) {
      throw new Error(`Relation ${id} endpoint mirrors must be identical`);
    }
    const endpoints = [first.relation.fromModule, first.relation.toModule].sort();
    if (first.module !== endpoints[0] || second.module !== endpoints[1]) {
      throw new Error(`Relation ${id} mirrors must be stored at its endpoints`);
    }
    relations.push(first.relation);
  }
  return relations.sort((left, right) => left.id.localeCompare(right.id));
}

export function buildCurrentSpecificationGraph(input: CurrentSpecificationGraphInput): CurrentSpecificationGraph {
  const modules = [...input.modules].sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(modules.map((module) => module.id)).size !== modules.length) {
    throw new Error('Business module registrations must have unique IDs');
  }
  const moduleById = new Map(modules.map((module) => [module.id, module]));
  if (new Set(input.interfaces.map((document) => document.module)).size !== input.interfaces.length) {
    throw new Error('Each module may have only one interface document');
  }
  const relations = collectMirroredRelations(input.interfaces);

  const concepts = new Map(modules.map((module) => [module.id, {
    inputs: new Set<string>(), outputs: new Set<string>(), relatedModules: new Set<string>(),
  }]));
  for (const relation of relations) {
    const from = moduleById.get(relation.fromModule);
    const to = moduleById.get(relation.toModule);
    if (!from || !to) throw new Error(`Relation ${relation.id} references an unregistered module`);
    if (from.status !== 'ACTIVE' || to.status !== 'ACTIVE') {
      throw new Error(`Relation ${relation.id} cannot reference a retired module`);
    }
    const fromConcepts = concepts.get(from.id)!;
    const toConcepts = concepts.get(to.id)!;
    fromConcepts.outputs.add(relation.input);
    toConcepts.inputs.add(relation.input);
    toConcepts.outputs.add(relation.output);
    fromConcepts.relatedModules.add(to.id);
    toConcepts.relatedModules.add(from.id);
  }

  const business = parseBusinessRegistry({
    version: 1,
    modules: modules.map((module) => {
      const generated = concepts.get(module.id)!;
      return {
        ...module,
        inputs: module.status === 'ACTIVE' ? [...generated.inputs].sort() : [],
        outputs: module.status === 'ACTIVE' ? [...generated.outputs].sort() : [],
        relatedModules: module.status === 'ACTIVE' ? [...generated.relatedModules].sort() : [],
      };
    }),
  });

  const routes = new Map<string, Map<string, { inputModules: Set<string>; outputModules: Set<string> }>>();
  const routeFor = (module: string, path: string) => {
    const byPath = routes.get(module) ?? new Map<string, { inputModules: Set<string>; outputModules: Set<string> }>();
    routes.set(module, byPath);
    const route = byPath.get(path) ?? { inputModules: new Set<string>(), outputModules: new Set<string>() };
    byPath.set(path, route);
    return route;
  };
  for (const relation of relations) {
    if (relation.kind === 'http') {
      routeFor(relation.toModule, relation.path).inputModules.add(relation.fromModule);
      continue;
    }
    for (const trigger of relation.triggeredBy ?? []) {
      routeFor(relation.fromModule, trigger.path).outputModules.add(relation.toModule);
    }
  }
  const apis = new Map<string, ModuleApi>();
  for (const module of modules) {
    if (module.status === 'RETIRED') continue;
    const byPath = routes.get(module.id) ?? new Map();
    apis.set(module.id, parseModuleApi({
      version: 1,
      module: module.id,
      routes: [...byPath.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([path, route]) => ({
        path,
        inputModules: [...route.inputModules].sort(),
        outputModules: [...route.outputModules].sort(),
      })),
    }));
  }

  return { business, apis, relations };
}

export function buildCurrentSpecGraph(input: CurrentSpecGraphInput): CurrentSpecGraph {
  return buildCurrentSpecificationGraph(input);
}

export function projectApi(moduleId: string, graph: CurrentSpecGraph): ModuleApi {
  const api = graph.apis.get(moduleId);
  if (!api) throw new Error(`No active API projection for module ${moduleId}`);
  return api;
}

export function projectBusiness(graph: CurrentSpecGraph): BusinessRegistry {
  return graph.business;
}

export function incomingRelations(moduleId: string, graph: CurrentSpecGraph): Relation[] {
  return graph.relations.filter((relation) => relation.toModule === moduleId);
}

export function outgoingRelations(moduleId: string, graph: CurrentSpecGraph): Relation[] {
  return graph.relations.filter((relation) => relation.fromModule === moduleId);
}
