import { createHash } from 'node:crypto';

import { z } from 'zod';
import { parseCurrentSpecification } from './current-spec-model.js';
import { relationSchema, serviceSchema } from './current-spec-yaml.js';

const moduleId = z.string().regex(/^MOD-\d{3}$/u);
const requirementId = z.string().regex(/^MOD-\d{3}-REQ-\d{3}$/u);
const scenarioId = z.string().regex(/^MOD-\d{3}-REQ-\d{3}-SCN-\d{3}$/u);
const testCaseId = z.string().regex(/^MOD-\d{3}-REQ-\d{3}-SCN-\d{3}-TC-[A-Z]+-\d{2}$/u);
const nonEmpty = z.string().min(1);
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
  module: moduleId.optional(),
  requirements: z.array(requirementId).min(1),
  scenarios: z.array(scenarioId).min(1),
  testCases: z.array(testCaseId).min(1),
  plannedFiles: z.array(repositoryRelativePath).min(1),
  // The v1 contract uses an array because one implementation task may cover
  // multiple runners/cases. Accept the original single-object form while
  // normalizing it to the canonical array for all consumers.
  verificationPlan: z.union([verificationPlanSchema, z.array(verificationPlanSchema).min(1)]).transform((value) =>
    Array.isArray(value) ? value : [value]
  ),
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
  testCase: testCaseId.optional(),
  id: testCaseId.optional(),
  result: z.enum(['PASS', 'FAIL', 'SKIPPED']).default('PASS'),
  testFile: nonEmpty,
  testId: nonEmpty,
  command: nonEmpty,
  profile: nonEmpty,
  services: z.array(nonEmpty),
  browser: nonEmpty,
  exitCode: z.number().int(),
  gitRevision: z.string().regex(/^[0-9a-f]{7,64}$/u).optional(),
  commit: z.string().regex(/^[0-9a-f]{7,64}$/u).optional(),
  treeFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/u).optional(),
  workingTreeFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/u).optional(),
  executedAt: z.string().datetime({ offset: true }),
  summary: nonEmpty,
  cleanupSucceeded: z.boolean(),
}).strict().superRefine((record, context) => {
  if (!record.testCase && !record.id) context.addIssue({ code: 'custom', path: ['testCase'], message: 'testCase or id is required' });
  if (record.testCase && record.id && record.testCase !== record.id) context.addIssue({ code: 'custom', path: ['id'], message: 'testCase and id must match' });
  if (!record.gitRevision && !record.commit) context.addIssue({ code: 'custom', path: ['gitRevision'], message: 'gitRevision or commit is required' });
  if (record.gitRevision && record.commit && record.gitRevision !== record.commit) context.addIssue({ code: 'custom', path: ['commit'], message: 'gitRevision and commit must match' });
  if (!record.treeFingerprint && !record.workingTreeFingerprint) context.addIssue({ code: 'custom', path: ['treeFingerprint'], message: 'treeFingerprint or workingTreeFingerprint is required' });
  if (record.treeFingerprint && record.workingTreeFingerprint && record.treeFingerprint !== record.workingTreeFingerprint) context.addIssue({ code: 'custom', path: ['workingTreeFingerprint'], message: 'treeFingerprint and workingTreeFingerprint must match' });
}).transform((record) => {
  const { id: _id, commit: _commit, workingTreeFingerprint: _workingTreeFingerprint, ...canonical } = record;
  return {
    ...canonical,
    testCase: record.testCase ?? record.id!,
    gitRevision: record.gitRevision ?? record.commit!,
    treeFingerprint: record.treeFingerprint ?? record.workingTreeFingerprint!,
  };
});
const currentVerificationSchema = z.object({
  version: z.literal(1),
  changeRevision: z.number().int().positive().optional(),
  testCases: z.array(verificationCaseSchema),
}).strict();

export type CurrentTasks = z.infer<typeof currentTasksSchema>;
export type CurrentVerification = z.infer<typeof currentVerificationSchema>;

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
  try {
    const parsed = parseCurrentSpecification(spec);
    return {
      module: parsed.module,
      requirements: parsed.requirements.map((requirement) => ({
        id: requirement.id,
        title: requirement.title,
        scenarios: requirement.scenarios.map((scenario) => ({
          id: scenario.id,
          title: scenario.title,
          given: scenario.given,
          when: scenario.when,
          then: scenario.then,
          error: scenario.error,
          testCases: scenario.testCases.map(({ automationTest: _automationTest, testId: _testId, latestVerification: _latestVerification, ...testCase }) => testCase),
        })),
      })),
      engineeringFiles: parsed.engineeringFiles.map(({ path: _path, ...file }) => file),
    };
  } catch {
    return spec.replace(/\r\n/gu, '\n').trimEnd();
  }
}

/** The design approval intentionally excludes test cases and file locators. */
export function projectCurrentSpecForDesignApproval(spec: string): unknown {
  try {
    const parsed = parseCurrentSpecification(spec);
    return {
      module: parsed.module,
      requirements: parsed.requirements.map((requirement) => ({
        id: requirement.id,
        title: requirement.title,
        scenarios: requirement.scenarios.map(({ id, title, given, when, then, error }) => ({ id, title, given, when, then, error })),
      })),
    };
  } catch {
    return spec.replace(/\r\n/gu, '\n').trimEnd();
  }
}
