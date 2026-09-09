import { z } from 'zod';

const moduleIdSchema = z.string().regex(/^MOD-\d{3}$/u, 'must match MOD-###');
const requirementIdSchema = z.string().regex(/^MOD-\d{3}-REQ-\d{3}$/u, 'must match MOD-###-REQ-###');
const scenarioIdSchema = z.string().regex(
  /^MOD-\d{3}-REQ-\d{3}-SCN-\d{3}$/u,
  'must match MOD-###-REQ-###-SCN-###'
);
const relationIdSchema = z.string().regex(
  /^REL-CHG-\d{8}-\d{3}-\d{2}$/u,
  'must match REL-CHG-YYYYMMDD-NNN-##'
);
const nonEmptyString = z.string().min(1);

function addSortedUniqueIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  path: ReadonlyArray<string | number>,
): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) {
      context.addIssue({
        code: 'custom',
        path: [...path, index],
        message: 'values must be unique and sorted',
      });
    }
  }
}

export function normalizeRoutePath(value: string): string {
  if (value.length === 0 || value !== value.trim() || !value.startsWith('/')) {
    throw new Error('route path must start with / and contain no surrounding whitespace');
  }
  if (value.startsWith('//') || /[?#%]/u.test(value)) {
    throw new Error('route path must not contain an absolute URL, query, fragment, or encoded segment');
  }
  return value === '/' ? value : value.replace(/\/+$/u, '');
}

const canonicalRoutePathSchema = z.string().min(1).superRefine((value, context) => {
  try {
    if (normalizeRoutePath(value) !== value) {
      context.addIssue({ code: 'custom', message: 'route path must be canonical' });
    }
  } catch (error) {
    context.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : 'invalid route path',
    });
  }
});

const httpRelationSchema = z.object({
  id: relationIdSchema,
  kind: z.literal('http'),
  fromModule: moduleIdSchema,
  toModule: moduleIdSchema,
  path: canonicalRoutePathSchema,
  method: z.string().regex(/^[A-Z]+$/u, 'must be an uppercase HTTP method'),
  input: nonEmptyString,
  output: nonEmptyString,
  errors: nonEmptyString,
  requirements: z.array(requirementIdSchema).min(1),
  scenarios: z.array(scenarioIdSchema).min(1),
}).strict();

const eventTriggerSchema = z.object({
  path: canonicalRoutePathSchema,
  method: z.string().regex(/^[A-Z]+$/u, 'must be an uppercase HTTP method'),
}).strict();

const eventRelationSchema = z.object({
  id: relationIdSchema,
  kind: z.literal('event'),
  fromModule: moduleIdSchema,
  toModule: moduleIdSchema,
  event: nonEmptyString,
  triggeredBy: z.array(eventTriggerSchema).min(1).optional(),
  input: nonEmptyString,
  output: nonEmptyString,
  errors: nonEmptyString,
  requirements: z.array(requirementIdSchema).min(1),
  scenarios: z.array(scenarioIdSchema).min(1),
}).strict();

export const relationSchema = z.discriminatedUnion('kind', [httpRelationSchema, eventRelationSchema])
  .superRefine((relation, context) => {
    if (relation.fromModule === relation.toModule) {
      context.addIssue({ code: 'custom', path: ['toModule'], message: 'a relation must connect two modules' });
    }
    addSortedUniqueIssues(relation.requirements, context, ['requirements']);
    addSortedUniqueIssues(relation.scenarios, context, ['scenarios']);
    for (const [index, scenario] of relation.scenarios.entries()) {
      const requirementId = scenario.replace(/-SCN-\d{3}$/u, '');
      if (!relation.requirements.includes(requirementId)) {
        context.addIssue({
          code: 'custom',
          path: ['scenarios', index],
          message: 'each scenario must belong to a referenced requirement',
        });
      }
    }
  });

const moduleInterfaceSchema = z.object({
  version: z.literal(1),
  module: moduleIdSchema,
  relations: z.array(relationSchema),
}).strict().superRefine((document, context) => {
  const relationIds = new Set<string>();
  for (const [index, relation] of document.relations.entries()) {
    if (relationIds.has(relation.id)) {
      context.addIssue({ code: 'custom', path: ['relations', index, 'id'], message: 'duplicate relation ID' });
    }
    relationIds.add(relation.id);
    if (relation.fromModule !== document.module && relation.toModule !== document.module) {
      context.addIssue({
        code: 'custom',
        path: ['relations', index],
        message: 'each relation must include the current module as an endpoint',
      });
    }
  }
});

const routeSchema = z.object({
  path: canonicalRoutePathSchema,
  inputModules: z.array(moduleIdSchema),
  outputModules: z.array(moduleIdSchema),
}).strict().superRefine((route, context) => {
  addSortedUniqueIssues(route.inputModules, context, ['inputModules']);
  addSortedUniqueIssues(route.outputModules, context, ['outputModules']);
});

const moduleApiSchema = z.object({
  version: z.literal(1),
  module: moduleIdSchema,
  routes: z.array(routeSchema),
}).strict().superRefine((document, context) => {
  addSortedUniqueIssues(document.routes.map((route) => route.path), context, ['routes']);
});

const businessModuleSchema = z.object({
  id: moduleIdSchema,
  name: nonEmptyString,
  status: z.enum(['ACTIVE', 'RETIRED']),
  inputs: z.array(nonEmptyString),
  outputs: z.array(nonEmptyString),
  relatedModules: z.array(moduleIdSchema),
}).strict().superRefine((module, context) => {
  addSortedUniqueIssues(module.inputs, context, ['inputs']);
  addSortedUniqueIssues(module.outputs, context, ['outputs']);
  addSortedUniqueIssues(module.relatedModules, context, ['relatedModules']);
});

const businessRegistrySchema = z.object({
  version: z.literal(1),
  modules: z.array(businessModuleSchema),
}).strict().superRefine((document, context) => {
  addSortedUniqueIssues(document.modules.map((module) => module.id), context, ['modules']);
});

const relativeRepositoryFileSchema = z.string().min(1).refine(
  (value) => !value.includes('\0') && !value.includes('\\') && !value.startsWith('/') &&
    !/^[A-Za-z]:\//u.test(value) && !value.split('/').includes('..') && !value.split('/').includes(''),
  'must be a repository-relative file path'
);
const configurationSourceSchema = z.discriminatedUnion('format', [
  z.object({
    kind: z.literal('repo-file'),
    file: relativeRepositoryFileSchema,
    format: z.literal('dotenv'),
    key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/u, 'must be a dotenv key'),
  }).strict(),
  z.object({
    kind: z.literal('repo-file'),
    file: relativeRepositoryFileSchema,
    format: z.union([z.literal('json'), z.literal('yaml')]),
    key: z.string().regex(/^\/(?:[^~\/]|~[01])*(?:\/(?:[^~\/]|~[01])*)*$/u, 'must be a JSON Pointer'),
  }).strict(),
]);
const routeBindingSchema = z.object({
  module: moduleIdSchema,
  path: canonicalRoutePathSchema,
}).strict();
export const serviceSchema = z.object({
  id: nonEmptyString,
  hostAlias: nonEmptyString,
  endpoint: z.string().url().optional(),
  endpointFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u).optional(),
  routeBindings: z.array(routeBindingSchema).min(1),
  source: configurationSourceSchema,
}).strict().superRefine((service, context) => {
  if (Boolean(service.endpoint) === Boolean(service.endpointFingerprint)) {
    context.addIssue({
      code: 'custom',
      message: 'exactly one of endpoint or endpointFingerprint is required',
    });
  }
  addSortedUniqueIssues(
    service.routeBindings.map((binding) => `${binding.module}\u0000${binding.path}`),
    context,
    ['routeBindings'],
  );
});
const profileSchema = z.object({
  id: nonEmptyString,
  services: z.array(serviceSchema),
}).strict().superRefine((profile, context) => {
  addSortedUniqueIssues(profile.services.map((service) => service.id), context, ['services']);
});
const configurationSchema = z.object({
  version: z.literal(1),
  profiles: z.array(profileSchema),
}).strict().superRefine((document, context) => {
  addSortedUniqueIssues(document.profiles.map((profile) => profile.id), context, ['profiles']);
});

export type ModuleInterface = z.infer<typeof moduleInterfaceSchema>;
export type ModuleApi = z.infer<typeof moduleApiSchema>;
export type BusinessRegistry = z.infer<typeof businessRegistrySchema>;
export type ConfigurationSnapshot = z.infer<typeof configurationSchema>;
export type RuntimeConfiguration = ConfigurationSnapshot;
export type Relation = z.infer<typeof relationSchema>;

export function parseModuleInterface(value: unknown): ModuleInterface {
  return moduleInterfaceSchema.parse(value);
}

export function parseModuleApi(value: unknown): ModuleApi {
  return moduleApiSchema.parse(value);
}

export function parseBusinessRegistry(value: unknown): BusinessRegistry {
  return businessRegistrySchema.parse(value);
}

export function parseConfiguration(value: unknown): ConfigurationSnapshot {
  return configurationSchema.parse(value);
}

/** Public contract name used by the current-spec consolidation plan. */
export function parseRuntimeConfiguration(value: unknown): RuntimeConfiguration {
  return parseConfiguration(value);
}
