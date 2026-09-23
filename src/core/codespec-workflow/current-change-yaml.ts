import { createHash } from 'node:crypto';

import { z } from 'zod';
import type { CurrentSpecRequirement } from './current-spec-model.js';
import { parseCurrentSpecDelta, projectCurrentSpecDelta } from './current-spec-delta.js';
import { relationSchema, serviceSchema } from './current-spec-yaml.js';

const moduleId = z.string().regex(/^MOD-\d{3}$/u);
const requirementId = z.string().regex(/^MOD-\d{3}-REQ-\d{3}$/u);
const scenarioId = z.string().regex(/^MOD-\d{3}-REQ-\d{3}-SCN-\d{3}$/u);
const testCaseId = z.string().regex(/^MOD-\d{3}-REQ-\d{3}-SCN-\d{3}-TC-[A-Z]+-\d{2}$/u);
const nonEmpty = z.string().min(1);
const acceptanceIds = z.array(z.string().regex(/^AC-\d{3}$/u)).min(1).refine((ids) => new Set(ids).size === ids.length, 'duplicate acceptance criterion ID');
const repositoryRelativePath = nonEmpty.refine(
  (value) => !value.includes('\0') && !value.includes('\\') && !value.startsWith('/') && !/^[A-Za-z]:[\\/]/u.test(value) &&
    !value.split(/[\\/]+/u).includes('..'),
  'planned file must be a repository-relative path',
);

const verificationPlanSchema = z.object({
  testCase: testCaseId,
  runner: nonEmpty,
  command: nonEmpty,
  startup: nonEmpty.optional(),
  profile: nonEmpty,
  services: z.array(nonEmpty),
  browser: nonEmpty.optional(),
  prepare: nonEmpty,
  cleanup: nonEmpty,
}).strict();

const taskSchema = z.object({
  id: z.string().regex(/^CHG-\d{8}-\d{3}-TASK-\d{2,3}$/u),
  title: nonEmpty,
  status: z.enum(['PENDING', 'IN_PROGRESS', 'DONE']),
  acceptanceCriteria: acceptanceIds,
  module: moduleId.optional(),
  requirements: z.array(requirementId).min(1),
  scenarios: z.array(scenarioId).min(1),
  testCases: z.array(testCaseId).min(1),
  plannedFiles: z.array(repositoryRelativePath).min(1),
  verificationPlan: z.array(verificationPlanSchema).min(1),
}).strict();

const moduleRegistrationSchema = z.object({
  upsert: z.array(z.object({ id: moduleId, name: nonEmpty }).strict()),
  retire: z.array(moduleId),
}).strict();

const nestedConfigurationChangeSchema = z.object({
  profile: nonEmpty,
  service: serviceSchema,
}).strict();
const flatConfigurationChangeSchema = z.object({
  profile: nonEmpty,
  service: nonEmpty,
  hostAlias: nonEmpty,
  endpoint: z.string().url().optional(),
  endpointFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u).optional(),
  routeBindings: serviceSchema.shape.routeBindings,
  source: serviceSchema.shape.source,
}).strict().superRefine((value, context) => {
  if (Boolean(value.endpoint) === Boolean(value.endpointFingerprint)) {
    context.addIssue({ code: 'custom', path: ['endpoint'], message: 'exactly one of endpoint or endpointFingerprint is required' });
  }
}).transform(({ profile, service, ...details }) => ({
  profile,
  service: { id: service, ...details },
}));
const configurationChangeSchema = z.union([
  nestedConfigurationChangeSchema,
  flatConfigurationChangeSchema,
]);
const configurationChangeKeySchema = z.object({
  profile: nonEmpty,
  service: nonEmpty,
}).strict();

const currentTasksSchema = z.object({
  version: z.literal(1),
  changeRevision: z.number().int().positive(),
  tasks: z.array(taskSchema),
  moduleDeltas: z.array(z.object({
    module: moduleId,
    interfaces: z.object({ upsert: z.array(relationSchema), remove: z.array(z.string().regex(/^REL-CHG-\d{8}-\d{3}-\d{2}$/u)) }).strict(),
    configurationChanges: z.object({ upsert: z.array(configurationChangeSchema), remove: z.array(configurationChangeKeySchema) }).strict(),
  }).strict()),
  moduleRegistrations: moduleRegistrationSchema,
}).strict().superRefine((document, context) => {
  const addUnique = (values: readonly string[], path: ReadonlyArray<string | number>, label: string): void => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) {
        context.addIssue({ code: 'custom', path: [...path, index], message: `duplicate ${label}` });
      }
      seen.add(value);
    });
  };

  addUnique(document.tasks.map((task) => task.id), ['tasks'], 'task ID');
  for (const [index, task] of document.tasks.entries()) {
    for (const field of ['requirements', 'scenarios', 'testCases'] as const) addUnique(task[field], ['tasks', index, field], field);
    addUnique(task.verificationPlan.map((plan) => plan.testCase), ['tasks', index, 'verificationPlan'], 'verification plan test ID');
  }

  const relationIds: string[] = [];
  const configurationKeys: string[] = [];
  for (const [deltaIndex, delta] of document.moduleDeltas.entries()) {
    relationIds.push(...delta.interfaces.upsert.map((relation) => relation.id));
    configurationKeys.push(...delta.configurationChanges.upsert.map((change) => `${change.profile}\u0000${change.service.id}`));
    configurationKeys.push(...delta.configurationChanges.remove.map((change) => `${change.profile}\u0000${change.service}`));
    for (const [index, relation] of delta.interfaces.upsert.entries()) {
      if (relation.fromModule !== delta.module && relation.toModule !== delta.module) {
        context.addIssue({ code: 'custom', path: ['moduleDeltas', deltaIndex, 'interfaces', 'upsert', index], message: 'relation must include its module delta endpoint' });
      }
    }
  }
  addUnique(relationIds, ['moduleDeltas'], 'relation ID');
  addUnique(configurationKeys, ['moduleDeltas'], 'profile/service key');

  const registrationIds = [
    ...document.moduleRegistrations.upsert.map((registration) => registration.id),
    ...document.moduleRegistrations.retire,
  ];
  addUnique(registrationIds, ['moduleRegistrations'], 'module registration ID');
});

const verificationCaseSchema = z.object({
  acceptanceCriteria: acceptanceIds,
  testCase: testCaseId,
  result: z.enum(['PASS', 'FAIL', 'BLOCKED', 'SKIPPED']),
  testFile: nonEmpty,
  testId: nonEmpty,
  command: nonEmpty,
  profile: nonEmpty,
  services: z.array(nonEmpty),
  browser: nonEmpty,
  exitCode: z.number().int(),
  gitRevision: z.string().regex(/^[0-9a-f]{7,64}$/u),
  treeFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  executedAt: z.string().datetime({ offset: true }),
  summary: nonEmpty,
  cleanupSucceeded: z.boolean(),
}).strict();
const currentVerificationSchema = z.object({
  version: z.literal(1),
  changeRevision: z.number().int().positive(),
  artifactIdentity: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  testCases: z.array(verificationCaseSchema),
}).strict().superRefine((document, context) => {
  const ids = new Set<string>();
  for (const [index, record] of document.testCases.entries()) {
    if (ids.has(record.testCase)) context.addIssue({ code: 'custom', path: ['testCases', index], message: 'duplicate verification test case ID' });
    ids.add(record.testCase);
  }
});

export type CurrentTasks = z.infer<typeof currentTasksSchema>;
export type CurrentVerification = z.infer<typeof currentVerificationSchema>;

/** Normalize one executable plan per Test Case while retaining the original task graph for traceability. */
export function mergeCurrentVerificationPlans(tasks: CurrentTasks): CurrentTasks['tasks'][number]['verificationPlan'] {
  const merged = new Map<string, z.infer<typeof verificationPlanSchema>>();
  for (const task of tasks.tasks) {
    for (const definition of task.verificationPlan) {
      const plan = verificationPlanSchema.parse(definition);
      plan.services = [...plan.services].sort();
      const previous = merged.get(plan.testCase);
      if (previous && JSON.stringify(previous) !== JSON.stringify(plan)) {
        throw new Error(`Conflicting verification plan for ${plan.testCase}: all shared definitions must agree`);
      }
      if (!previous) merged.set(plan.testCase, plan);
    }
  }
  return [...merged.values()];
}

export function parseCurrentTasks(value: unknown): CurrentTasks {
  return currentTasksSchema.parse(value);
}

/** Public contract name used by callers that treat tasks.yaml as a document. */
export function parseTasksDocument(value: unknown): CurrentTasks {
  return parseCurrentTasks(value);
}

export function parseCurrentVerification(value: unknown): CurrentVerification {
  return currentVerificationSchema.parse(value);
}

export function hashTaskApprovalContent(input: { design: string; spec: string; tasks: CurrentTasks }): string {
  const plan = {
    ...input.tasks,
    tasks: input.tasks.tasks.map(({ status: _status, ...task }) => task),
  };
  return createHash('sha256').update(JSON.stringify({
    design: input.design.replace(/\r\n/gu, '\n').trimEnd(),
    spec: projectCurrentSpecForPlanApproval(input.spec),
    tasks: plan,
  })).digest('hex');
}

/** Excludes execution evidence and verified UI locators from the approved task plan. */
export function projectCurrentSpecForPlanApproval(spec: string): unknown {
  return projectDeltaApproval(spec, true);
}

/** The design approval intentionally excludes test cases and file locators. */
export function projectCurrentSpecForDesignApproval(spec: string): unknown {
  return projectDeltaApproval(spec, false);
}

function projectDeltaApproval(spec: string, includePlan: boolean): unknown {
  try {
    const parsed = projectCurrentSpecDelta(parseCurrentSpecDelta(spec));
    const snapshot = (requirement: CurrentSpecRequirement) => ({
      id: requirement.id,
      title: requirement.title,
      scenarios: requirement.scenarios.map(({ id, title, given, when, then, error, testCases }) => ({
        id, title, given, when, then, error,
        ...(includePlan ? { testCases: testCases.map(({ id, title, type, steps }) => ({ id, title, type, steps })) } : {}),
      })),
    });
    return {
      module: parsed.module,
      ...(parsed.inlineDesign ? { inlineDesign: parsed.inlineDesign } : {}),
      requirements: parsed.requirements.map(({ previous, next, ...entry }) => ({
        ...entry,
        ...(previous ? { previous: snapshot(previous) } : {}),
        ...(next ? { next: snapshot(next) } : {}),
      })),
      ...(includePlan ? { engineeringFiles: parsed.engineeringFiles } : {}),
    };
  } catch {
    // Incomplete authoring still needs a changing receipt so revise can return
    // to DESIGN. Validation, not this projection, accepts or rejects the delta.
    return spec.replace(/\r\n/gu, '\n').trimEnd();
  }
}
