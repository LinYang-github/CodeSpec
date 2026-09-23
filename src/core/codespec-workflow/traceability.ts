import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { ChangeArtifacts } from './artifacts.js';
import type { CurrentSpecGraph } from './current-spec-graph.js';
import { parseCurrentSpecification, type CurrentSpecification } from './current-spec-model.js';
import type { WorkspacePaths } from './paths.js';
import type { CurrentTasks, CurrentVerification } from './current-change-yaml.js';
import { parseCurrentTasks, parseCurrentVerification, mergeCurrentVerificationPlans } from './current-change-yaml.js';
import { parse as parseYaml } from 'yaml';
import { parseAnalysisDocument } from './analysis.js';
import type { AnalysisDocument } from './analysis.js';
import { parseCurrentSpecDelta } from './current-spec-delta.js';
export interface TraceRow {
  acceptance_id?: string;
  requirement_id: string;
  scenario_id: string;
  task_id: string;
  test_id: string;
  evidence_id: string;
  result: 'PASS' | 'FAIL' | 'BLOCKED';
  code_reference?: string;
}

/** Validates the machine-readable Scenario → Test → Evidence portion of a Change matrix. */
export function validateTraceRows(
  rows: readonly TraceRow[],
  requirements: ReadonlyArray<{ requirementId: string; scenarioIds: readonly string[] }>,
): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = JSON.stringify([row.acceptance_id, row.requirement_id, row.scenario_id, row.task_id, row.test_id, row.evidence_id]);
    if (seen.has(key)) issues.push(`duplicate trace row for ${row.scenario_id}`);
    seen.add(key);
    if (!requirements.some((requirement) => requirement.requirementId === row.requirement_id && requirement.scenarioIds.includes(row.scenario_id))) issues.push(`trace row references unknown Requirement/Scenario ${row.requirement_id}/${row.scenario_id}`);
  }
  for (const requirement of requirements) {
    for (const scenarioId of requirement.scenarioIds) {
      const matching = rows.filter((row) => row.requirement_id === requirement.requirementId && row.scenario_id === scenarioId);
      if (!matching.length) {
        issues.push(`Scenario ${scenarioId} is not covered by a Test-to-Evidence trace row`);
        continue;
      }
      if (matching.some((row) => !row.task_id.trim() || !row.test_id.trim() || !row.evidence_id.trim() || row.result !== 'PASS')) {
        issues.push(`Scenario ${scenarioId} has an incomplete or failing trace row`);
      }
    }
  }
  return issues;
}
export interface TraceabilityResult { valid: boolean; issues: string[]; warnings?: string[]; traceRows?: TraceRow[]; links: Record<string, string[]> }
/** Validate the traceability edges that can be derived from one canonical Change. */
export function validateChangeTraceability(artifacts: ChangeArtifacts, requireEvidence = false): TraceabilityResult {
  return validateAcceptanceTraceability(artifacts, requireEvidence);
}

/** The canonical chain is derived from structured IDs, never from text matches. */
function validateAcceptanceTraceability(artifacts: ChangeArtifacts, requireEvidence: boolean): TraceabilityResult {
  const issues: string[] = []; const warnings: string[] = []; const rows: TraceRow[] = [];
  const analysis = parseAnalysisDocument(parseYaml(artifacts.analysis));
  const delta = parseCurrentSpecDelta(artifacts.spec);
  const tasks = parseCurrentTasks(parseYaml(artifacts.tasks));
  try { mergeCurrentVerificationPlans(tasks); }
  catch (error) { issues.push(error instanceof Error ? error.message : String(error)); }
  const verification = requireEvidence ? parseCurrentVerification(parseYaml(artifacts.verification)) : undefined;
  const revision = artifacts.metadata.change.revision;
  if (analysis.change !== artifacts.changeId || analysis.revision !== revision) issues.push('analysis Change revision differs');
  if (tasks.changeRevision !== revision) issues.push('tasks.yaml Change revision differs');
  if (verification && verification.changeRevision !== revision) issues.push('verification.yaml Change revision differs');
  const criteria = new Map(analysis.acceptanceCriteria.map((ac) => [ac.id, ac]));
  const requirements = new Map(delta.requirements.map((entry) => [entry.id, entry.next ?? entry.previous!]));
  const scenarios = new Map([...requirements.values()].flatMap((req) => req.scenarios.map((scenario) => [scenario.id, { requirement: req.id, scenario }] as const)));
  const tests = new Map([...scenarios.values()].flatMap(({ scenario, requirement }) => scenario.testCases.map((test) => [test.id, { scenario: scenario.id, requirement }] as const)));
  const records = new Map(verification?.testCases.map((record) => [record.testCase, record]));
  if (!analysis.goals.length) issues.push('Goal → Acceptance Criterion chain requires a Goal');
  if (!criteria.size) issues.push('Acceptance Criterion chain is empty');
  for (const task of tasks.tasks) {
    if (!task.id.startsWith(`${artifacts.changeId}-TASK-`)) issues.push(`Unknown Change task ID ${task.id}`);
    if (!task.acceptanceCriteria?.length) issues.push(`Task ${task.id} requires acceptanceCriteria`);
    for (const id of task.acceptanceCriteria ?? []) {
      const ac = criteria.get(id);
      if (!ac) issues.push(`Task ${task.id} references unknown acceptance criterion ${id}`);
      else if (!task.requirements.some((req) => ac.requirements.some((id) => id === req))) issues.push(`${id} Task ${task.id} has no related Requirement`);
    }
    for (const id of task.requirements) if (!requirements.has(id)) issues.push(`Task ${task.id} references unknown Requirement ${id}`);
    for (const id of task.scenarios) if (!scenarios.has(id) || !task.requirements.includes(scenarios.get(id)!.requirement)) issues.push(`Task ${task.id} references unknown or unrelated Scenario ${id}`);
    for (const id of task.testCases) {
      if (!tests.has(id) || !task.scenarios.includes(tests.get(id)!.scenario)) issues.push(`Task ${task.id} references unknown or unrelated Test ${id}`);
      if (!task.verificationPlan.some((plan) => plan.testCase === id)) issues.push(`Task ${task.id} Test ${id} has no verification plan`);
    }
    for (const plan of task.verificationPlan) if (!task.testCases.includes(plan.testCase)) issues.push(`Task ${task.id} references unknown planned Test ${plan.testCase}`);
  }
  for (const record of verification?.testCases ?? []) {
    if (!tests.has(record.testCase) || !tasks.tasks.some((task) => task.testCases.includes(record.testCase))) issues.push(`Evidence references unknown Test ${record.testCase}`);
    if (!record.acceptanceCriteria?.length) issues.push(`Evidence ${record.testCase} requires acceptanceCriteria`);
    for (const id of record.acceptanceCriteria ?? []) {
      if (!criteria.get(id)?.requirements.some((requirement) => requirement === tests.get(record.testCase)?.requirement) || !tasks.tasks.some((task) => task.testCases.includes(record.testCase) && task.acceptanceCriteria?.includes(id))) issues.push(`Evidence ${record.testCase} references unknown or unrelated acceptance criterion ${id}`);
    }
  }
  for (const ac of criteria.values()) {
    if (new Set(ac.requirements).size !== ac.requirements.length) issues.push(`${ac.id} contains duplicate Requirement IDs`);
    if (!ac.requirements.length) issues.push(`${ac.id} has no Requirement`);
    for (const id of ac.requirements) {
      const requirement = requirements.get(id);
      if (!requirement) { issues.push(`${ac.id} references unknown Requirement ${id}`); continue; }
      if (!requirement.scenarios.length) issues.push(`${ac.id} Requirement ${id} has no Scenario`);
      for (const scenario of requirement.scenarios) {
        const linked = tasks.tasks.filter((task) => task.acceptanceCriteria?.includes(ac.id) && task.requirements.includes(id) && task.scenarios.includes(scenario.id));
        if (!linked.length) issues.push(`${ac.id} Scenario ${scenario.id} has no Task`);
        if (!scenario.testCases.length) issues.push(`${ac.id} Scenario ${scenario.id} has no Test`);
        for (const test of scenario.testCases) {
          const planned = linked.filter((task) => task.testCases.includes(test.id) && task.verificationPlan.some((plan) => plan.testCase === test.id));
          if (!planned.length) issues.push(`${ac.id} Test ${test.id} has no Task verification plan`);
          if (!requireEvidence) continue;
          const record = records.get(test.id);
          if (!record || !record.acceptanceCriteria?.includes(ac.id)) {
            (ac.priority === 'MUST' ? issues : warnings).push(`${ac.id} Test ${test.id} has no evidence`);
            continue;
          }
          if (record.result !== 'PASS' || record.exitCode !== 0 || !record.cleanupSucceeded) issues.push(`${ac.id} Test ${test.id} evidence is ${record.result}; passing evidence required`);
          for (const task of planned) rows.push({ acceptance_id: ac.id, requirement_id: id, scenario_id: scenario.id, task_id: task.id, test_id: test.id, evidence_id: `verification:${artifacts.changeId}:${revision}:${test.id}`, result: record.result === 'SKIPPED' ? 'BLOCKED' : record.result, code_reference: record.testFile });
        }
      }
    }
  }
  for (const id of requirements.keys()) if (!analysis.acceptanceCriteria.some((ac) => ac.requirements.some((ref) => ref === id))) issues.push(`Requirement ${id} has no acceptance criterion`);
  return { valid: !issues.length, issues, warnings, traceRows: rows, links: {
    Goal: analysis.goals.map((goal) => goal.id), 'Acceptance Criterion': [...criteria.keys()], Requirement: [...requirements.keys()], Scenario: [...scenarios.keys()], Task: tasks.tasks.map((task) => task.id), Test: [...tests.keys()], Evidence: rows.map((row) => row.evidence_id),
    'Current Spec': [...new Set(delta.requirements.map((entry) => `specs/${entry.module}/spec.md`))],
  } };
}

/** A task may implement multiple criteria; evidence only names those owning this test's Requirement. */
export function acceptanceCriteriaForTest(tasks: CurrentTasks, analysis: AnalysisDocument, testCase: string): string[] {
  const linked = new Set(tasks.tasks.filter((task) => task.testCases.includes(testCase)).flatMap((task) => task.acceptanceCriteria ?? []));
  return analysis.acceptanceCriteria.filter((ac) => linked.has(ac.id) && ac.requirements.some((requirement) => testCase.startsWith(`${requirement}-SCN-`))).map((ac) => ac.id).sort();
}

/**
 * Validates that every relation in the generated graph can be followed back to
 * the requirement and scenario that define it in the current module specs.
 */
export function validateCurrentSpecGraphTraceability(
  graph: CurrentSpecGraph,
  specifications: readonly CurrentSpecification[],
): TraceabilityResult {
  const requirementIds = new Set<string>();
  const scenarioIds = new Set<string>();
  const engineeringFiles = new Set<string>();
  const issues: string[] = [];

  for (const specification of specifications) {
    for (const file of specification.engineeringFiles) engineeringFiles.add(file.path);
    for (const requirement of specification.requirements) {
      if (requirementIds.has(requirement.id)) issues.push(`Requirement ${requirement.id} is defined by more than one current specification`);
      requirementIds.add(requirement.id);
      for (const scenario of requirement.scenarios) {
        if (scenarioIds.has(scenario.id)) issues.push(`Scenario ${scenario.id} is defined by more than one current specification`);
        scenarioIds.add(scenario.id);
      }
    }
  }

  for (const relation of graph.relations) {
    for (const requirementId of relation.requirements) {
      if (!requirementIds.has(requirementId)) {
        issues.push(`Relation ${relation.id} references unknown Requirement ${requirementId}`);
      }
    }
    for (const scenarioId of relation.scenarios) {
      if (!scenarioIds.has(scenarioId)) {
        issues.push(`Relation ${relation.id} references unknown Scenario ${scenarioId}`);
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    links: {
      Module: graph.business.modules.map((module) => module.id),
      Relation: graph.relations.map((relation) => relation.id),
      Requirement: [...requirementIds].sort(),
      Scenario: [...scenarioIds].sort(),
      'Engineering File': [...engineeringFiles].sort(),
    },
  };
}

/** Ensures each planned task test case resolves to exactly one executed record. */
export function validateCurrentVerificationTraceability(
  tasks: CurrentTasks,
  verification: CurrentVerification,
): string[] {
  const errors: string[] = [];
  const records = new Map<string, number>();
  for (const record of verification.testCases) records.set(record.testCase, (records.get(record.testCase) ?? 0) + 1);
  for (const task of tasks.tasks) {
    for (const plan of task.verificationPlan) {
      if (!task.testCases.includes(plan.testCase)) {
        errors.push(`Task ${task.id} does not reference verification test case ${plan.testCase}`);
      }
      const count = records.get(plan.testCase) ?? 0;
      if (count !== 1) errors.push(`Verification plan ${plan.testCase} must have exactly one execution record`);
    }
  }
  return errors;
}

/** Loads v1 module specs from disk before validating their graph traceability. */
export async function validateCurrentSpecGraphTraceabilityFromWorkspace(
  paths: WorkspacePaths,
  graph: CurrentSpecGraph,
): Promise<TraceabilityResult> {
  const specifications: CurrentSpecification[] = [];
  for (const module of graph.business.modules) {
    if (module.status === 'RETIRED') continue;
    const file = path.join(paths.currentSpecs, module.id, 'spec.md');
    try {
      specifications.push(parseCurrentSpecification(await fs.readFile(file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return validateCurrentSpecGraphTraceability(graph, specifications);
}
