import * as fs from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ZodError } from 'zod';

import {
  parseAnalysisDocument,
  type AnalysisDocument,
  validateAnalysisCompleteness,
} from './analysis.js';
import type { ChangeArtifacts } from './artifacts.js';
import { parseCurrentSpecification } from './current-spec-model.js';
import { getCurrentModuleArtifactPaths } from './current-spec-paths.js';
import type { WorkspaceContext } from './loaders.js';
import type { ChangeMetadata } from './types.js';

export type AnalysisProjection = {
  modules: ChangeMetadata['modules'];
  requirements: ChangeMetadata['requirements'];
};

const compareCodeUnits = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

export function projectAnalysisMetadata(document: AnalysisDocument): AnalysisProjection {
  const modules = [...document.modules].sort((left, right) => compareCodeUnits(left.module, right.module));
  const requirements = [...document.requirements].sort((left, right) => compareCodeUnits(left.id, right.id));
  const requirementRefs = (action: AnalysisDocument['requirements'][number]['action']) => requirements
    .filter((requirement) => requirement.action === action)
    .map((requirement) => ({
      id: requirement.id,
      module: requirement.id.slice(0, requirement.id.indexOf('-REQ-')) as `MOD-${string}`,
    }));

  return {
    modules: {
      candidates: modules,
      confirmed: modules,
      dependencies: modules.filter((module): module is typeof module & { outcome: 'DEPENDENCY' } => module.outcome === 'DEPENDENCY'),
    },
    requirements: {
      added: requirementRefs('ADDED'),
      modified: requirementRefs('MODIFIED'),
      removed: requirementRefs('REMOVED'),
    },
  };
}

function formatSchemaErrors(error: unknown): string[] {
  if (error instanceof ZodError) {
    return error.issues.map((issue) =>
      `analysis.yaml${issue.path.length ? `.${issue.path.join('.')}` : ''}: ${issue.message}`
    );
  }
  return [`analysis.yaml: ${error instanceof Error ? error.message : String(error)}`];
}

function isActiveChange(workspace: WorkspaceContext, artifacts: ChangeArtifacts): boolean {
  const relative = path.relative(workspace.paths.changes, artifacts.changeDir);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function readCurrentRequirementIds(
  workspace: WorkspaceContext,
  moduleId: string,
): Promise<{ ids: Set<string>; error?: string }> {
  const specPath = getCurrentModuleArtifactPaths(workspace.paths.currentSpecs, moduleId).spec;
  let content: string;
  try {
    content = await fs.readFile(specPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ids: new Set() };
    return { ids: new Set(), error: `${specPath}: ${error instanceof Error ? error.message : String(error)}` };
  }

  try {
    const specification = parseCurrentSpecification(content);
    if (specification.module !== moduleId) {
      return { ids: new Set(), error: `${specPath}: module ${specification.module} does not match ${moduleId}` };
    }
    return { ids: new Set(specification.requirements.map((requirement) => requirement.id)) };
  } catch (error) {
    return { ids: new Set(), error: `${specPath}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function validateAnalysisAgainstWorkspace(
  workspace: WorkspaceContext,
  artifacts: ChangeArtifacts,
): Promise<string[]> {
  if (artifacts.analysis === null) {
    return workspace.config.schema === 'code-spec' && isActiveChange(workspace, artifacts)
      ? ['analysis.yaml: active five-artifact Change must be migrated before ANALYZE can complete']
      : [];
  }

  let document: AnalysisDocument;
  try {
    document = parseAnalysisDocument(parseYaml(artifacts.analysis));
  } catch (error) {
    return formatSchemaErrors(error);
  }

  const errors = [...validateAnalysisCompleteness(document).errors];

  if (document.change !== artifacts.metadata.change.id) {
    errors.push(`analysis.yaml.change: expected ${document.change} to equal metadata.change.id ${artifacts.metadata.change.id}`);
  }
  if (document.revision !== artifacts.metadata.change.revision) {
    errors.push(`analysis.yaml.revision: expected ${document.revision} to equal metadata.change.revision`);
  }

  const owned = new Map<string, number>();
  for (const module of document.modules) {
    if (!workspace.registry.byId.has(module.module)) {
      errors.push(`modules[${document.modules.indexOf(module)}].module: ${module.module} is not registered in the workspace business registry`);
    }
    if (module.outcome === 'OWNED') owned.set(module.module, (owned.get(module.module) ?? 0) + 1);
  }

  const currentByModule = new Map<string, Promise<{ ids: Set<string>; error?: string }>>();
  for (const [index, requirement] of document.requirements.entries()) {
    const moduleId = requirement.id.slice(0, requirement.id.indexOf('-REQ-'));
    if (owned.get(moduleId) !== 1) {
      errors.push(`requirements[${index}].id: ${requirement.id} must belong to exactly one OWNED module`);
      continue;
    }
    let current = currentByModule.get(moduleId);
    if (!current) {
      current = readCurrentRequirementIds(workspace, moduleId);
      currentByModule.set(moduleId, current);
    }
    const snapshot = await current;
    if (snapshot.error) {
      errors.push(`requirements[${index}].id: cannot resolve ${requirement.id} from Current Specification: ${snapshot.error}`);
      continue;
    }
    const exists = snapshot.ids.has(requirement.id);
    if (requirement.action === 'ADDED' && exists) {
      errors.push(`requirements[${index}].id: ADDED Requirement ${requirement.id} already exists in the Current Specification`);
    }
    if ((requirement.action === 'MODIFIED' || requirement.action === 'REMOVED') && !exists) {
      errors.push(`requirements[${index}].id: ${requirement.action} Requirement ${requirement.id} does not exist in the Current Specification`);
    }
  }

  const projection = projectAnalysisMetadata(document);
  if (!isDeepStrictEqual(artifacts.metadata.modules, projection.modules)) {
    errors.push('metadata.modules: must exactly equal the projection derived from analysis.yaml');
  }
  if (!isDeepStrictEqual(artifacts.metadata.requirements, projection.requirements)) {
    errors.push('metadata.requirements: must exactly equal the projection derived from analysis.yaml');
  }
  return errors;
}
