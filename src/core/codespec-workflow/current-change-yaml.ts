import { createHash } from 'node:crypto';

import { z } from 'zod';
import { parseCurrentSpecification } from './current-spec-model.js';

const moduleId = z.string().regex(/^MOD-\d{3}$/u);
const requirementId = z.string().regex(/^MOD-\d{3}-REQ-\d{3}$/u);
const scenarioId = z.string().regex(/^MOD-\d{3}-REQ-\d{3}-SCN-\d{3}$/u);
const testCaseId = z.string().regex(/^MOD-\d{3}-REQ-\d{3}-SCN-\d{3}-TC-[A-Z]+-\d{2}$/u);
const nonEmpty = z.string().min(1);

const verificationPlanSchema = z.object({
  testCase: testCaseId,
  runner: nonEmpty,
  command: nonEmpty,
  profile: nonEmpty,
  services: z.array(nonEmpty),
  prepare: nonEmpty,
  cleanup: nonEmpty,
}).strict();

const taskSchema = z.object({
  id: z.string().regex(/^CHG-\d{8}-\d{3}-TASK-\d{2}$/u),
  title: nonEmpty,
  status: z.enum(['PENDING', 'IN_PROGRESS', 'DONE']),
  requirements: z.array(requirementId).min(1),
  scenarios: z.array(scenarioId).min(1),
  testCases: z.array(testCaseId).min(1),
  plannedFiles: z.array(nonEmpty).min(1),
  verificationPlan: verificationPlanSchema,
}).strict();

const moduleRegistrationSchema = z.object({
  upsert: z.array(z.object({ id: moduleId, name: nonEmpty }).strict()),
  retire: z.array(moduleId),
}).strict();

const currentTasksSchema = z.object({
  version: z.literal(1),
  tasks: z.array(taskSchema),
  moduleDeltas: z.array(z.object({
    module: moduleId,
    interfaces: z.object({ upsert: z.array(z.unknown()), remove: z.array(nonEmpty) }).strict(),
    configurationChanges: z.object({ upsert: z.array(z.unknown()), remove: z.array(nonEmpty) }).strict(),
  }).strict()),
  moduleRegistrations: moduleRegistrationSchema,
}).strict();

const verificationCaseSchema = z.object({
  testCase: testCaseId,
  result: z.enum(['PASS', 'FAIL', 'SKIPPED']).default('PASS'),
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
  testCases: z.array(verificationCaseSchema),
}).strict();

export type CurrentTasks = z.infer<typeof currentTasksSchema>;
export type CurrentVerification = z.infer<typeof currentVerificationSchema>;

export function parseCurrentTasks(value: unknown): CurrentTasks {
  return currentTasksSchema.parse(value);
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
