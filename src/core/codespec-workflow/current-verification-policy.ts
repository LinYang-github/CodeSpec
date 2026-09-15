import type { CurrentTasks, CurrentVerification } from './current-change-yaml.js';
import { mergeCurrentVerificationPlans } from './current-change-yaml.js';
import { validateCurrentVerificationTraceability } from './traceability.js';

function sameValues(left: string[], right: string[]): boolean {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

export function validateCurrentVerificationPlan(
  tasks: CurrentTasks,
  verification: CurrentVerification,
  baseline?: { commit: string | null; working_tree_fingerprint: string; revision?: number },
  options: { optionalEvidence?: ReadonlySet<string> } = {},
): string[] {
  const requiredTasks = options.optionalEvidence ? { ...tasks, tasks: tasks.tasks.map((task) => ({ ...task, verificationPlan: task.verificationPlan.filter((plan) => !options.optionalEvidence!.has(plan.testCase) || verification.testCases.some((record) => record.testCase === plan.testCase)) })) } : tasks;
  const errors = validateCurrentVerificationTraceability(requiredTasks, verification);
  try { mergeCurrentVerificationPlans(tasks); }
  catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  if (baseline?.revision !== undefined && tasks.tasks.length > 0 && verification.changeRevision !== baseline.revision) {
    errors.push(`Verification Change revision differs (expected ${baseline.revision})`);
  }
  const executed = new Map(verification.testCases.map((record) => [record.testCase, record]));
  for (const task of tasks.tasks) {
    for (const plan of task.verificationPlan) {
      const record = executed.get(plan.testCase);
      if (!record) {
        if (!options.optionalEvidence?.has(plan.testCase)) errors.push(`Missing verification record for ${plan.testCase}`);
        continue;
      }
      if (record.command !== plan.command) errors.push(`Verification command differs for ${plan.testCase}`);
      if (record.profile !== plan.profile) errors.push(`Verification profile differs for ${plan.testCase}`);
      if (!sameValues(record.services, plan.services)) errors.push(`Verification services differ for ${plan.testCase}`);
      if (record.result !== 'PASS') errors.push(`Verification result must be PASS (not ${record.result}) for ${plan.testCase}`);
      if (record.exitCode !== 0) errors.push(`Verification exit code must be 0 for ${plan.testCase}`);
      if (!record.cleanupSucceeded) errors.push(`Verification cleanup must succeed for ${plan.testCase}`);
      if (baseline?.commit && record.gitRevision !== baseline.commit) errors.push(`Verification git revision differs for ${plan.testCase}`);
      if (baseline && record.treeFingerprint !== baseline.working_tree_fingerprint) errors.push(`Verification tree fingerprint differs for ${plan.testCase}`);
    }
  }
  return errors;
}
