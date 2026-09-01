import { parseDeltaSpec } from './delta-parser.js';
import type { ChangeArtifacts } from './artifacts.js';
type Edge = [string, string];
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
