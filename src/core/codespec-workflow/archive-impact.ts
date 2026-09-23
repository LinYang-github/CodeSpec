import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { parseCurrentSpec } from './current-spec-parser.js';
import { documentSections } from './document-sections.js';
import type { WorkspaceContext } from './loaders.js';
import type { ChangeArtifacts } from './artifacts.js';
import type { CurrentSpecDeltaDocument } from './current-spec-delta.js';
import { validateCurrentChangeDelta } from './current-archive-preflight.js';

const requirementId = z.string().regex(/^MOD-\d{3}-REQ-\d{3}$/u, 'must match MOD-###-REQ-###');
const scenarioId = z.string().regex(/^(?:MOD-\d{3}-REQ-\d{3}-)?SCN-\d{3}$/u, 'must match SCN-### or MOD-###-REQ-###-SCN-###');

const archiveImpactSchema = z
  .object({
    outcome: z.enum(['none', 'affected']),
    references: z.array(
      z.object({
        current_requirement: requirementId,
        current_scenario: scenarioId,
        disposition: z.enum(['modified', 'superseded']),
        replacement_requirement: requirementId,
        replacement_scenario: scenarioId,
      }).strict(),
    ),
    verification: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    for (const reference of value.references) {
      const key = `${reference.current_requirement}/${reference.current_scenario}`;
      if (seen.has(key)) context.addIssue({ code: 'custom', message: `重复归档影响映射：${key}` });
      seen.add(key);
    }
    if (value.outcome === 'none' && (value.references.length > 0 || value.verification.length > 0)) {
      context.addIssue({ code: 'custom', message: 'outcome none requires empty references and verification' });
    }
    if (value.outcome === 'affected' && value.references.length === 0) {
      context.addIssue({ code: 'custom', message: 'outcome affected requires at least one reference' });
    }
    if (value.outcome === 'affected' && !value.verification.includes('archive-regression')) {
      context.addIssue({ code: 'custom', message: 'outcome affected requires archive-regression verification' });
    }
  });

export type ArchiveImpact = z.infer<typeof archiveImpactSchema>;

export function parseArchiveImpact(content: string): ArchiveImpact {
  const sections = documentSections(content).filter((section) => section.title === '归档影响分析');
  if (sections.length > 1) throw new Error('归档影响分析章节必须唯一，不能重复。');
  const block = sections[0]?.body.trim().match(/^```yaml[ \t]*\n([\s\S]*?)\n```$/u);
  if (!block) throw new Error('归档影响分析缺少 YAML 数据区块。');

  try {
    return archiveImpactSchema.parse(parseYaml(block[1]));
  } catch (error) {
    throw new Error(`归档影响分析无效：${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function validateChangeArchiveImpact(workspace: WorkspaceContext, artifacts: ChangeArtifacts): Promise<{
  impact: ArchiveImpact; current: Map<string, string>; issues: string[]; richDelta: CurrentSpecDeltaDocument;
}> {
  const check = await validateCurrentChangeDelta(workspace, artifacts);
  const impact = parseArchiveImpact(artifacts.design);
  return {
    impact,
    richDelta: check.delta,
    current: new Map([[check.delta.module, check.current ?? '']]),
    issues: [...check.issues, ...validateCurrentArchiveImpact(impact, check.delta)],
  };
}

/** Rich snapshots have already been normalized by the shared semantic parser. */
function validateCurrentArchiveImpact(impact: ArchiveImpact, delta: CurrentSpecDeltaDocument): string[] {
  const errors: string[] = [];
  const byId = new Map(delta.requirements.map((entry) => [entry.id, entry]));
  for (const entry of delta.requirements) {
    for (const old of entry.previous?.scenarios ?? []) {
      const next = entry.next?.scenarios.find((scenario) => scenario.id === old.id);
      const behavior = (scenario: typeof old) => JSON.stringify([scenario.given, scenario.when, scenario.then, scenario.error]);
      if (next && behavior(old) !== behavior(next)) errors.push(`${entry.id}/${old.id} 验收行为变化，必须使用新的 Scenario ID`);
      if (!next && !impact.references.some((mapping) => mapping.current_requirement === entry.id && mapping.current_scenario === old.id)) {
        errors.push(`${entry.id}/${old.id} 被移除或替代但缺少归档影响映射`);
      }
    }
  }
  for (const mapping of impact.references) {
    const source = byId.get(mapping.current_requirement);
    const replacement = byId.get(mapping.replacement_requirement);
    if (!source?.previous?.scenarios.some((scenario) => scenario.id === mapping.current_scenario)) {
      errors.push(`归档影响映射缺少当前 Requirement/Scenario：${mapping.current_requirement}/${mapping.current_scenario}`);
    }
    if (!replacement?.next?.scenarios.some((scenario) => scenario.id === mapping.replacement_scenario)) {
      errors.push(`归档影响映射缺少替代 delta Scenario：${mapping.replacement_requirement}/${mapping.replacement_scenario}`);
    }
    if (mapping.disposition === 'modified') {
      if (source?.action !== 'MODIFIED' || mapping.replacement_requirement !== mapping.current_requirement) {
        errors.push(`${mapping.current_requirement} modified 映射要求同一 Requirement 的 MODIFIED delta`);
      }
    } else if (source?.action !== 'REMOVED' || replacement?.action !== 'ADDED') {
      errors.push(`${mapping.current_requirement} superseded 映射要求 REMOVED 旧需求和 ADDED 替代需求`);
    }
  }
  return errors;
}

function findScenario(spec: string | undefined, requirementId: string, scenarioId: string): boolean {
  if (!spec) return false;
  const requirement = parseCurrentSpec(spec).requirements.find((item) => item.id === requirementId);
  return requirement?.scenarios.some((scenario) => scenario.id === scenarioId) ?? false;
}

function moduleFor(requirementId: string): string {
  return requirementId.split('-REQ-')[0];
}

export function validateArchiveImpactMappings(
  impact: ArchiveImpact,
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string[] {
  if (impact.outcome === 'none') return [];

  const errors: string[] = [];
  for (const reference of impact.references) {
    if (!findScenario(before.get(moduleFor(reference.current_requirement)), reference.current_requirement, reference.current_scenario)) {
      errors.push(`归档影响映射缺少当前 Requirement/Scenario：${reference.current_requirement}/${reference.current_scenario}`);
    }
    if (!findScenario(after.get(moduleFor(reference.replacement_requirement)), reference.replacement_requirement, reference.replacement_scenario)) {
      errors.push(`归档影响映射缺少替代 Requirement/Scenario：${reference.replacement_requirement}/${reference.replacement_scenario}`);
    }
  }
  return errors;
}
