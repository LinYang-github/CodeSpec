import type { CurrentTasks, CurrentVerification } from './current-change-yaml.js';
import { validateCurrentVerificationTraceability } from './traceability.js';

function sameValues(left: string[], right: string[]): boolean {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

export function validateCurrentVerificationPlan(
  tasks: CurrentTasks,
  verification: CurrentVerification,
  baseline?: { commit: string | null; working_tree_fingerprint: string },
): string[] {
  const errors = validateCurrentVerificationTraceability(tasks, verification);
  const executed = new Map(verification.testCases.map((record) => [record.testCase, record]));
  for (const task of tasks.tasks) {
    for (const plan of task.verificationPlan) {
      const record = executed.get(plan.testCase);
      if (!record) {
        errors.push(`Missing verification record for ${plan.testCase}`);
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
