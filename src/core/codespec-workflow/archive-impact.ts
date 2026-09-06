import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import * as fs from 'node:fs/promises';
import path from 'node:path';

import { parseCurrentSpec } from './current-spec-parser.js';
import { documentSections } from './document-sections.js';
import type { RequirementDelta } from './types.js';
import type { WorkspaceContext } from './loaders.js';
import type { ChangeArtifacts } from './artifacts.js';
import { parseDeltaSpec } from './delta-parser.js';

const requirementId = z.string().regex(/^MOD-\d{3}-REQ-\d{3}$/u, 'must match MOD-###-REQ-###');
const scenarioId = z.string().regex(/^SCN-\d{3}$/u, 'must match SCN-###');

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

/** Check authored dispositions against the actual delta, using only relevant Current specs. */
export function validateArchiveImpactDeltas(
  impact: ArchiveImpact,
  deltas: readonly RequirementDelta[],
  current: ReadonlyMap<string, string>,
): string[] {
  const errors: string[] = [];
  const byId = new Map(deltas.map((delta) => [delta.id as string, delta]));
  for (const delta of deltas) {
    if (delta.action === 'ADDED') continue;
    const mappings = impact.references.filter((reference) => reference.current_requirement === delta.id);
    if (!mappings.length) errors.push(`${delta.id} 缺少归档影响映射，不能声明 outcome: none`);
    const previous = parseCurrentSpec(current.get(delta.module) ?? '').requirements.find((item) => item.id === delta.id);
    if (!previous) { errors.push(`ARCHIVE CONFLICT: missing ${delta.id}`); continue; }
    if (previous.raw.trim() !== delta.previous?.trim()) errors.push(`ARCHIVE CONFLICT: ${delta.id} Current does not match Previous`);
    const next = parseCurrentSpec(delta.next ?? '').requirements.find((item) => item.id === delta.id);
    for (const oldScenario of previous.scenarios) {
      const newScenario = next?.scenarios.find((item) => item.id === oldScenario.id);
      const behavior = (value: typeof oldScenario) => JSON.stringify([value.given, value.when, value.then, value.error]);
      if (newScenario && behavior(oldScenario) !== behavior(newScenario)) {
        errors.push(`${delta.id}/${oldScenario.id} 验收行为变化，必须使用新的 Scenario ID`);
      }
      if (!newScenario && !mappings.some((mapping) => mapping.current_scenario === oldScenario.id)) {
        errors.push(`${delta.id}/${oldScenario.id} 被移除或替代但缺少归档影响映射`);
      }
    }
  }
  for (const mapping of impact.references) {
    const source = byId.get(mapping.current_requirement);
    const replacement = byId.get(mapping.replacement_requirement);
    if (mapping.disposition === 'modified') {
      if (source?.action !== 'MODIFIED' || mapping.replacement_requirement !== mapping.current_requirement) {
        errors.push(`${mapping.current_requirement} modified 映射要求同一 Requirement 的 MODIFIED delta`);
      }
    } else if (source?.action !== 'REMOVED' || replacement?.action !== 'ADDED') {
      errors.push(`${mapping.current_requirement} superseded 映射要求 REMOVED 旧需求和 ADDED 替代需求`);
    }
    if (!findScenario(current.get(moduleFor(mapping.current_requirement)), mapping.current_requirement, mapping.current_scenario)) {
      errors.push(`归档影响映射缺少当前 Requirement/Scenario：${mapping.current_requirement}/${mapping.current_scenario}`);
    }
    if (!findScenario(replacement?.next, mapping.replacement_requirement, mapping.replacement_scenario)) {
      errors.push(`归档影响映射缺少替代 delta Scenario：${mapping.replacement_requirement}/${mapping.replacement_scenario}`);
    }
  }
  return errors;
}

export async function validateChangeArchiveImpact(workspace: WorkspaceContext, artifacts: ChangeArtifacts, state = artifacts.metadata.change.status): Promise<{
  impact: ArchiveImpact; deltas: RequirementDelta[]; current: Map<string, string>; issues: string[];
}> {
  const impact = parseArchiveImpact(artifacts.design);
  const deltas = parseDeltaSpec(artifacts.spec).entries;
  const metadata = artifacts.metadata;
  const modules = new Set([
    ...metadata.modules.confirmed.map((item) => item.module),
    ...deltas.map((item) => item.module),
    ...impact.references.map((item) => moduleFor(item.current_requirement)),
  ]);
  const current = new Map<string, string>();
  for (const module of modules) {
    const file = path.resolve(workspace.paths.currentSpecs, module, 'spec.md');
    // Check every ancestor through the workspace, including the Current specs root.
    let cursor = file;
    while (true) {
      try {
        if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error(`Current Specification path must not be a symlink: ${cursor}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (cursor === path.resolve(workspace.codespecDir)) break;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw new Error('Current Specification path escaped codespec');
      cursor = parent;
    }
    current.set(module, await fs.readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    }));
  }
  const issues = validateArchiveImpactDeltas(impact, deltas, current);
  for (const delta of deltas) {
    const owners = metadata.modules.confirmed.filter((item) => item.module === delta.module && item.outcome === 'OWNED');
    if (owners.length !== 1) issues.push(`${delta.id} 必须有唯一确认的 OWNED 模块`);
    const refs = metadata.requirements[delta.action === 'ADDED' ? 'added' : delta.action === 'MODIFIED' ? 'modified' : 'removed'];
    if (!refs.some((ref) => ref.id === delta.id && ref.module === delta.module)) issues.push(`${delta.id} delta 与 metadata 的 action 不一致`);
  }
  if (state !== 'DESIGN' && impact.outcome === 'affected') {
    const taskLines = artifacts.tasks.split('\n').filter((line) => /SP-\d+/u.test(line));
    for (const reference of impact.references) {
      for (const [requirement, scenario] of [
        [reference.current_requirement, reference.current_scenario],
        [reference.replacement_requirement, reference.replacement_scenario],
      ]) {
        if (!taskLines.some((line) => line.includes(requirement) && line.includes(scenario))) {
          issues.push(`归档影响 ${requirement}/${scenario} 缺少同一 Task 的追踪关联`);
        }
      }
    }
  }
  return { impact, deltas, current, issues };
}

export function validateArchiveRegressionEvidence(impact: ArchiveImpact, evidence: {
  commands: Array<{ kind: string; exit_code: number; requirement_ids?: string[]; scenario_ids?: string[] }>;
}): string[] {
  if (impact.outcome === 'none') return [];
  const successful = evidence.commands.filter((command) => command.kind === 'archive-regression' && command.exit_code === 0);
  const errors: string[] = [];
  for (const reference of impact.references) {
    for (const [requirement, scenario] of [
      [reference.current_requirement, reference.current_scenario],
      [reference.replacement_requirement, reference.replacement_scenario],
    ]) {
      if (!successful.some((command) => command.requirement_ids?.includes(requirement) && command.scenario_ids?.includes(scenario))) {
        errors.push(`archive-regression 缺少成功执行且覆盖 ${requirement}/${scenario} 的命令证据`);
      }
    }
  }
  return [...new Set(errors)];
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
