import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ChangeArtifacts } from './artifacts.js';
import type { WorkspaceContext } from './loaders.js';
import { parseAnalysisDocument, validateAnalysisCompleteness } from './analysis.js';
import { projectAnalysisMetadata } from './analysis-consistency.js';
import { parseCurrentSpecDelta, validateCurrentSpecDeltaAgainstCurrent } from './current-spec-delta.js';
import { currentSpecDeltaBaseline } from './archive-projection.js';
import { validateCurrentDesignOwnership } from './current-spec-model.js';

/** Reads the live module only, checking containment before following any ancestor. */
export async function readCurrentDeltaBaseline(workspace: WorkspaceContext, module: string): Promise<string | null> {
  const file = path.resolve(workspace.paths.currentSpecs, module, 'spec.md');
  let cursor = file;
  while (true) {
    const stat = await fs.lstat(cursor).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat?.isSymbolicLink()) throw new Error(`Current Specification path must not be a symlink: ${cursor}`);
    if (cursor === path.resolve(workspace.codespecDir)) break;
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error('Current Specification path escaped codespec');
    cursor = parent;
  }
  return fs.readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
}

/** Shared DESIGN-and-later boundary for the six-artifact contract. */
export async function validateCurrentChangeDelta(workspace: WorkspaceContext, artifacts: ChangeArtifacts) {
  if (!artifacts.metadata.artifacts.analysis || artifacts.analysis === null) {
    throw new Error('analysis.yaml: active five-artifact Change must be migrated before delta validation');
  }
  let delta;
  try { delta = parseCurrentSpecDelta(artifacts.spec); }
  catch (error) { throw new Error(`ARCHIVE CONFLICT: ${error instanceof Error ? error.message : String(error)}`); }
  const current = await readCurrentDeltaBaseline(workspace, delta.module);
  const issues = validateCurrentSpecDeltaAgainstCurrent(currentSpecDeltaBaseline(current, delta), delta);
  const analysis = parseAnalysisDocument(parseYaml(artifacts.analysis));
  issues.push(...validateAnalysisCompleteness(analysis).errors.map((error) => `analysis.yaml.${error}`));
  if (analysis.change !== artifacts.metadata.change.id || analysis.revision !== artifacts.metadata.change.revision) {
    issues.push('analysis.yaml Change/revision must equal metadata.change');
  }
  const expected = projectAnalysisMetadata(analysis).requirements;
  for (const [action, key] of [['ADDED', 'added'], ['MODIFIED', 'modified'], ['REMOVED', 'removed']] as const) {
    const ids = (refs: Array<{ id: string; module: string }>) => refs.map((ref) => `${ref.module}/${ref.id}`).sort();
    const actual = delta.requirements.filter((entry) => entry.action === action);
    if (JSON.stringify(ids(expected[key])) !== JSON.stringify(ids(actual))) {
      issues.push(`analysis.yaml.requirements and spec.md ${action} Requirement sets must be equal`);
    }
    if (JSON.stringify(ids(artifacts.metadata.requirements[key])) !== JSON.stringify(ids(actual))) {
      issues.push(`metadata.requirements.${key} and spec.md ${action} Requirement sets must be equal`);
    }
  }
  const ids = new Set(delta.requirements.map((entry) => entry.id));
  const justified = new Set<string>();
  for (const criterion of analysis.acceptanceCriteria) {
    for (const id of criterion.requirements) {
      if (!ids.has(id)) issues.push(`analysis.yaml ${criterion.id} references Requirement ${id} absent from spec.md`);
      justified.add(id);
    }
  }
  for (const entry of delta.requirements) {
    if (!justified.has(entry.id)) issues.push(`analysis.yaml acceptanceCriteria: ${entry.id} needs at least one acceptance criterion`);
    for (const [owner, modules] of [['analysis.yaml', analysis.modules], ['metadata', artifacts.metadata.modules.confirmed]] as const) {
      if (modules.filter((module) => module.module === entry.module && module.outcome === 'OWNED').length !== 1) {
        issues.push(`${owner}: ${entry.id} must have exactly one OWNED module`);
      }
    }
  }
  issues.push(...validateCurrentDesignOwnership(artifacts.design, {
    title: delta.title, module: delta.module, version: '1', engineeringFiles: [],
    requirements: delta.requirements.flatMap((entry) => [entry.previous, entry.next].filter((value) => value !== undefined)),
  }));
  return { delta, current, issues };
}

export interface CurrentArchivePreflightInput {
  designApproved?: boolean;
  planApproved: boolean;
  taskStatuses: Array<'PENDING' | 'IN_PROGRESS' | 'DONE'>;
  verificationErrors: string[];
}

export function validateCurrentArchivePreflight(input: CurrentArchivePreflightInput): string[] {
  const errors: string[] = [];
  if (input.designApproved === false) errors.push('Design approval is required before archive');
  if (!input.planApproved) errors.push('Task approval is required before archive');
  if (input.taskStatuses.some((status) => status !== 'DONE')) errors.push('All current Change tasks must be DONE');
  errors.push(...input.verificationErrors);
  return errors;
}
