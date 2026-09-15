import { stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import type { BusinessModuleId, ChangeId, RequirementId } from './types.js';

const nonEmpty = z.string().min(1);
const changeId = z.custom<ChangeId>(
  (value) => typeof value === 'string' && /^CHG-\d{8}-\d{3}$/u.test(value),
  'must match CHG-YYYYMMDD-NNN',
);
const moduleId = z.custom<BusinessModuleId>(
  (value) => typeof value === 'string' && /^MOD-\d{3}$/u.test(value),
  'must match MOD-###',
);
const requirementId = z.custom<RequirementId>(
  (value) => typeof value === 'string' && /^MOD-\d{3}-REQ-\d{3}$/u.test(value),
  'must match MOD-###-REQ-###',
);

const goalSchema = z.object({
  id: z.string().regex(/^GOAL-\d{3}$/u),
  statement: nonEmpty,
}).strict();
const nonGoalSchema = z.object({
  id: z.string().regex(/^NON-GOAL-\d{3}$/u),
  statement: nonEmpty,
}).strict();
const constraintSchema = z.object({
  id: z.string().regex(/^CONSTRAINT-\d{3}$/u),
  statement: nonEmpty,
  source: nonEmpty,
}).strict();
const assumptionSchema = z.object({
  id: z.string().regex(/^ASSUMPTION-\d{3}$/u),
  statement: nonEmpty,
  status: z.enum(['PROPOSED', 'CONFIRMED', 'REJECTED']),
  requirements: z.array(requirementId).default([]),
}).strict();
const questionSchema = z.object({
  id: z.string().regex(/^(?:QUESTION-\d{3}|Q-MIGRATION-001)$/u),
  question: nonEmpty,
  status: z.enum(['OPEN', 'RESOLVED']),
  resolution: nonEmpty.optional(),
}).strict().superRefine((question, context) => {
  if (question.status === 'RESOLVED' && !question.resolution) {
    context.addIssue({ code: 'custom', path: ['resolution'], message: 'resolved question requires a resolution' });
  }
});
const acceptanceCriterionSchema = z.object({
  id: z.string().regex(/^AC-\d{3}$/u),
  statement: nonEmpty,
  priority: z.enum(['MUST', 'SHOULD', 'COULD']),
  requirements: z.array(requirementId),
}).strict();
const moduleSchema = z.object({
  module: moduleId,
  outcome: z.enum(['OWNED', 'DEPENDENCY', 'IRRELEVANT']),
  reason: nonEmpty,
}).strict();
const requirementSchema = z.object({
  id: requirementId,
  action: z.enum(['ADDED', 'MODIFIED', 'REMOVED']),
  reason: nonEmpty,
}).strict();

function addUniqueIdIssues(
  values: readonly { id: string }[],
  path: string,
  label: string,
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value.id)) {
      context.addIssue({ code: 'custom', path: [path, index, 'id'], message: `duplicate ${label} ID: ${value.id}` });
    }
    seen.add(value.id);
  }
}

export const analysisDocumentSchema = z.object({
  version: z.literal(1),
  change: changeId,
  revision: z.number().int().positive(),
  problem: z.string(),
  goals: z.array(goalSchema),
  nonGoals: z.array(nonGoalSchema),
  scope: z.object({ in: z.array(nonEmpty), out: z.array(nonEmpty) }).strict(),
  actors: z.array(nonEmpty),
  constraints: z.array(constraintSchema),
  assumptions: z.array(assumptionSchema),
  openQuestions: z.array(questionSchema),
  acceptanceCriteria: z.array(acceptanceCriterionSchema),
  modules: z.array(moduleSchema),
  requirements: z.array(requirementSchema),
}).strict().superRefine((document, context) => {
  addUniqueIdIssues(document.goals, 'goals', 'goal', context);
  addUniqueIdIssues(document.nonGoals, 'nonGoals', 'non-goal', context);
  addUniqueIdIssues(document.constraints, 'constraints', 'constraint', context);
  addUniqueIdIssues(document.assumptions, 'assumptions', 'assumption', context);
  addUniqueIdIssues(document.openQuestions, 'openQuestions', 'question', context);
  addUniqueIdIssues(document.acceptanceCriteria, 'acceptanceCriteria', 'acceptance criterion', context);
  addUniqueIdIssues(document.requirements, 'requirements', 'requirement', context);
});

export type AnalysisDocument = z.infer<typeof analysisDocumentSchema>;
export type AnalysisCompletenessResult = { ok: boolean; errors: string[] };

export function parseAnalysisDocument(value: unknown): AnalysisDocument {
  return analysisDocumentSchema.parse(value);
}

export function renderInitialAnalysis(input: {
  changeId: string;
  revision: number;
  problem: string;
}): string {
  return stringifyYaml(parseAnalysisDocument({
    version: 1,
    change: input.changeId,
    revision: input.revision,
    problem: input.problem,
    goals: [],
    nonGoals: [],
    scope: { in: [], out: [] },
    actors: [],
    constraints: [],
    assumptions: [],
    openQuestions: [],
    acceptanceCriteria: [],
    modules: [],
    requirements: [],
  }));
}

const compareCodeUnits = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const sortedStrings = (values: readonly string[]): string[] => [...values].sort(compareCodeUnits);
const byId = <T extends { id: string }>(values: readonly T[]): T[] => [...values].sort((left, right) => compareCodeUnits(left.id, right.id));

/**
 * Converts collection ordering into a canonical form while retaining every
 * user-authored decision that participates in analyze approval.
 */
export function projectAnalysisForApproval(document: AnalysisDocument): unknown {
  return {
    version: document.version,
    change: document.change,
    revision: document.revision,
    problem: document.problem,
    goals: byId(document.goals),
    nonGoals: byId(document.nonGoals),
    scope: { in: sortedStrings(document.scope.in), out: sortedStrings(document.scope.out) },
    actors: sortedStrings(document.actors),
    constraints: byId(document.constraints),
    assumptions: byId(document.assumptions).map((assumption) => ({ ...assumption, requirements: sortedStrings(assumption.requirements) })),
    openQuestions: byId(document.openQuestions),
    acceptanceCriteria: byId(document.acceptanceCriteria).map((criterion) => ({ ...criterion, requirements: sortedStrings(criterion.requirements) })),
    modules: [...document.modules].sort((left, right) => compareCodeUnits(left.module, right.module)),
    requirements: byId(document.requirements),
  };
}

export function validateAnalysisCompleteness(document: AnalysisDocument): AnalysisCompletenessResult {
  const errors: string[] = [];
  const hasNonGoalBoundary = document.nonGoals.length > 0 || document.scope.out.length > 0;
  const ownedModules = new Set(document.modules.filter((module) => module.outcome === 'OWNED').map((module) => module.module));
  const affectedRequirementIds = new Set(document.requirements.map((requirement) => requirement.id));

  if (!document.problem.trim()) errors.push('problem: must be non-empty');
  if (!document.goals.length) errors.push('goals: at least one goal is required');
  if (!document.scope.in.length) errors.push('scope.in: at least one in-scope item is required');
  if (!hasNonGoalBoundary) {
    errors.push('nonGoals: at least one non-goal or out-of-scope item is required');
    errors.push('scope.out: at least one non-goal or out-of-scope item is required');
  }

  document.assumptions.forEach((assumption, index) => {
    if (assumption.status === 'PROPOSED') errors.push(`assumptions[${index}].status: PROPOSED assumptions must be CONFIRMED or REJECTED`);
  });
  document.openQuestions.forEach((question, index) => {
    if (question.status === 'OPEN') errors.push(`openQuestions[${index}].status: OPEN questions must be resolved`);
  });

  if (!document.acceptanceCriteria.length) errors.push('acceptanceCriteria: at least one acceptance criterion is required');
  document.acceptanceCriteria.forEach((criterion, criterionIndex) => {
    if (criterion.priority !== 'MUST') return;
    if (!criterion.requirements.length) {
      errors.push(`acceptanceCriteria[${criterionIndex}].requirements: MUST acceptance criteria must map to an affected Requirement`);
      return;
    }
    criterion.requirements.forEach((id, requirementIndex) => {
      if (!affectedRequirementIds.has(id)) {
        errors.push(`acceptanceCriteria[${criterionIndex}].requirements[${requirementIndex}]: must reference an affected Requirement`);
      }
    });
  });

  if (!ownedModules.size) errors.push('modules: at least one OWNED module must be confirmed');
  if (!document.requirements.length) errors.push('requirements: at least one affected Requirement is required');
  document.requirements.forEach((requirement, index) => {
    const module = moduleId.parse(requirement.id.slice(0, requirement.id.indexOf('-REQ-')));
    if (!ownedModules.has(module)) {
      errors.push(`requirements[${index}].id: Requirement must belong to a confirmed OWNED module`);
    }
  });

  return { ok: errors.length === 0, errors };
}
