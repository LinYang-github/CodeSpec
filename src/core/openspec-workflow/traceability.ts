export interface TraceabilityArtifacts { modules: string[]; changes: string[]; requirements: string[]; scenarios: string[]; tasks: Array<{ id: string; requirementIds: string[] }>; tests: string[]; evidence: string[]; currentSpecs: string[]; archive: string[]; metadataRequirements: string[]; designRequirements: string[]; specRequirements: string[] }
export interface TraceabilityResult { valid: boolean; issues: string[]; links: Record<string, string[]> }
export function validateTraceability(artifacts: TraceabilityArtifacts): TraceabilityResult {
  const issues: string[] = []; const same = (a: string[], b: string[]) => [...a].sort().join('\0') === [...b].sort().join('\0');
  if (!same(artifacts.metadataRequirements, artifacts.designRequirements) || !same(artifacts.metadataRequirements, artifacts.specRequirements)) issues.push('metadata, design, and spec Requirement sets must be equal');
  const covered = new Set(artifacts.tasks.flatMap((task) => task.requirementIds)); for (const id of artifacts.specRequirements) if (!covered.has(id)) issues.push(`Requirement ${id} is not covered by a Task`);
  for (const field of ['modules', 'changes', 'requirements', 'scenarios', 'tests', 'evidence', 'currentSpecs', 'archive'] as const) if (artifacts[field].length === 0) issues.push(`missing traceability ${field}`);
  return { valid: issues.length === 0, issues, links: { Module: artifacts.modules, Change: artifacts.changes, Requirement: artifacts.requirements, Scenario: artifacts.scenarios, Task: artifacts.tasks.map((task) => task.id), Test: artifacts.tests, Evidence: artifacts.evidence, 'Current Spec': artifacts.currentSpecs, Archive: artifacts.archive } };
}
