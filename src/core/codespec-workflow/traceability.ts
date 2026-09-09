import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parseDeltaSpec } from './delta-parser.js';
import type { ChangeArtifacts } from './artifacts.js';
import type { CurrentSpecGraph } from './current-spec-graph.js';
import { parseCurrentSpecification, type CurrentSpecification } from './current-spec-model.js';
import type { WorkspacePaths } from './paths.js';
import type { CurrentTasks, CurrentVerification } from './current-change-yaml.js';
type Edge = [string, string];
export interface TraceRow {
  requirement_id: string;
  scenario_id: string;
  task_id: string;
  test_id: string;
  evidence_id: string;
  result: 'PASS' | 'FAIL';
  code_reference?: string;
}

/** Validates the machine-readable Scenario → Test → Evidence portion of a Change matrix. */
export function validateTraceRows(
  rows: readonly TraceRow[],
  requirements: ReadonlyArray<{ requirementId: string; scenarioIds: readonly string[] }>,
): string[] {
  const issues: string[] = [];
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
export interface TraceabilityArtifacts { modules: string[]; changes: string[]; requirements: string[]; scenarios: string[]; tasks: Array<{ id: string; requirementIds: string[] }>; tests: string[]; evidence: string[]; currentSpecs: string[]; archive: string[]; metadataRequirements: string[]; designRequirements: string[]; specRequirements: string[]; edges: { moduleToChange: Edge[]; changeToRequirement: Edge[]; requirementToScenario: Edge[]; scenarioToTask: Edge[]; taskToTest: Edge[]; testToEvidence: Edge[]; evidenceToCurrentSpec: Edge[]; currentSpecToArchive: Edge[] } }
export interface TraceabilityResult { valid: boolean; issues: string[]; links: Record<string, string[]> }
export function validateTraceability(artifacts: TraceabilityArtifacts): TraceabilityResult {
  const issues: string[] = []; const same = (a: string[], b: string[]) => [...a].sort().join('\0') === [...b].sort().join('\0');
  if (!same(artifacts.metadataRequirements, artifacts.designRequirements) || !same(artifacts.metadataRequirements, artifacts.specRequirements)) issues.push('metadata, design, and spec Requirement sets must be equal');
  const covered = new Set(artifacts.tasks.flatMap((task) => task.requirementIds)); for (const id of artifacts.specRequirements) if (!covered.has(id)) issues.push(`Requirement ${id} is not covered by a Task`);
  const edgeChecks: Array<[keyof TraceabilityArtifacts['edges'], string[], string[]]> = [['moduleToChange', artifacts.modules, artifacts.changes], ['changeToRequirement', artifacts.changes, artifacts.requirements], ['requirementToScenario', artifacts.requirements, artifacts.scenarios], ['scenarioToTask', artifacts.scenarios, artifacts.tasks.map((task) => task.id)], ['taskToTest', artifacts.tasks.map((task) => task.id), artifacts.tests], ['testToEvidence', artifacts.tests, artifacts.evidence], ['evidenceToCurrentSpec', artifacts.evidence, artifacts.currentSpecs], ['currentSpecToArchive', artifacts.currentSpecs, artifacts.archive]];
  for (const [key, left, right] of edgeChecks) { const edges = artifacts.edges[key]; for (const id of left) if (!edges.some(([from]) => from === id)) issues.push(`traceability edge ${key} missing from ${id}`); for (const id of right) if (!edges.some(([, to]) => to === id)) issues.push(`traceability edge ${key} missing to ${id}`); for (const [from, to] of edges) if (!left.includes(from) || !right.includes(to)) issues.push(`traceability edge ${key} references unknown node ${from} -> ${to}`); }
  for (const field of ['modules', 'changes', 'requirements', 'scenarios', 'tests', 'evidence', 'currentSpecs', 'archive'] as const) if (artifacts[field].length === 0) issues.push(`missing traceability ${field}`);
  return { valid: issues.length === 0, issues, links: { Module: artifacts.modules, Change: artifacts.changes, Requirement: artifacts.requirements, Scenario: artifacts.scenarios, Task: artifacts.tasks.map((task) => task.id), Test: artifacts.tests, Evidence: artifacts.evidence, 'Current Spec': artifacts.currentSpecs, Archive: artifacts.archive } };
}

const ID = /MOD-\d{3}-REQ-\d{3}/gu;
const SCN = /SCN-\d{3}/gu;

/** Validate the traceability edges that can be derived from one canonical Change. */
export function validateChangeTraceability(artifacts: ChangeArtifacts): TraceabilityResult {
  const metadataRequirements = Object.values(artifacts.metadata.requirements).flat().map((item) => item.id);
  const parsed = parseDeltaSpec(artifacts.spec);
  const specRequirements = parsed.entries.map((entry) => entry.id);
  const designRequirements = [...new Set(artifacts.design.match(ID) ?? [])];
  const taskText = Object.entries(artifacts.metadata.tasks.items)
    .map(([id, task]) => `${id} ${task.title ?? ''}`).join('\n') + `\n${artifacts.tasks}`;
  const taskRequirements = [...new Set(taskText.match(ID) ?? [])];
  const scenarioIds = [...new Set(parsed.entries.flatMap((entry) => entry.scenarios.map((item) => item.id)))];
  const taskScenarios = [...new Set(taskText.match(SCN) ?? [])];
  const issues: string[] = [];
  const equal = (left: string[], right: string[]) => [...new Set(left)].sort().join('\0') === [...new Set(right)].sort().join('\0');
  if (!equal(metadataRequirements, designRequirements)) issues.push('metadata and design Requirement sets must be equal');
  if (!equal(metadataRequirements, specRequirements)) issues.push('metadata and spec Requirement sets must be equal');
  if (specRequirements.some((id, index) => specRequirements.indexOf(id) !== index)) issues.push('spec contains duplicate Requirement IDs');
  for (const id of specRequirements) if (!taskRequirements.includes(id)) issues.push(`Requirement ${id} is not covered by a Task`);
  for (const id of scenarioIds) if (!taskScenarios.includes(id)) issues.push(`Scenario ${id} is not covered by a Task`);
  return { valid: issues.length === 0, issues, links: { Requirement: specRequirements, Scenario: scenarioIds, Task: Object.keys(artifacts.metadata.tasks.items) } };
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
