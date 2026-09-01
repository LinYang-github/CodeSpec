import { z } from 'zod';

import type {
  BusinessModule,
  BusinessModuleId,
  ChangeId,
  ChangeIndexEntry,
  ChangeMetadata,
  ChangeMode,
  ChangeStatus,
  ModuleOutcome,
  RequirementDelta,
  RequirementRef,
  RequirementId,
  WorkspaceConfig,
} from './types.js';

const nonEmptyString = z.string().min(1);
const isoDateTime = z.string().datetime({ offset: true });
const relativePathString = z.string().min(1).refine(
  (value) =>
    !value.includes('\0') &&
    !value.startsWith('/') &&
    !value.split(/[\\/]+/).some((segment) => segment === '..'),
  {
    message: 'must be a relative path under the change workspace',
  }
);

const businessModuleIdSchema = z.string().regex(/^MOD-\d{3}$/, {
  message: 'must match MOD-###',
});
const requirementIdSchema = z.string().regex(/^MOD-\d{3}-REQ-\d{3}$/, {
  message: 'must match MOD-###-REQ-###',
});
const changeIdSchema = z.string().regex(/^CHG-\d{8}-\d{3}$/, {
  message: 'must match CHG-YYYYMMDD-NNN',
});
const scenarioIdSchema = z.string().regex(/^SCN-\d{3}$/, {
  message: 'must match SCN-###',
});
const changeModeSchema = z.enum(['feature', 'bugfix', 'refactor']);
const changeStatusSchema = z.enum([
  'ANALYZE',
  'DESIGN',
  'PLAN',
  'IMPLEMENT',
  'VERIFY',
  'ARCHIVE',
  'ARCHIVED',
  'ABANDONED',
]);
const taskStatusSchema = z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED']);
const moduleOutcomeSchema = z.enum(['OWNED', 'DEPENDENCY', 'IRRELEVANT']);

const requirementRefSchema = z
  .object({
    id: requirementIdSchema,
    module: businessModuleIdSchema,
  })
  .strict();

const scenarioSchema = z
  .object({
    id: scenarioIdSchema,
    given: z.array(nonEmptyString),
    when: z.array(nonEmptyString),
    then: z.array(nonEmptyString),
  })
  .strict();

const workspaceConfigSchema = z
  .object({
    version: z.literal(1),
    project: z
      .object({
        name: nonEmptyString,
      })
      .strict(),
    paths: z
      .object({
        business: nonEmptyString,
        changes: nonEmptyString,
        change_index: nonEmptyString,
        archive: nonEmptyString,
        specs: nonEmptyString,
        archived_changes: nonEmptyString,
      })
      .strict(),
    workflow: z
      .object({
        multiple_active_changes: z.boolean(),
      })
      .strict(),
    requirements: z
      .object({
        id_format: nonEmptyString,
      })
      .strict(),
    changes: z
      .object({
        id_format: nonEmptyString,
      })
      .strict(),
    archive: z
      .object({
        update_index: z.boolean(),
        require_verification: z.boolean(),
        conflict_strategy: z.enum(['optimistic']),
      })
      .strict(),
  })
  .strict();

const businessModuleSchema = z
  .object({
    id: businessModuleIdSchema,
    name: nonEmptyString,
    description: nonEmptyString.optional(),
    responsibilities: z.array(nonEmptyString).min(1),
    keywords: z.array(nonEmptyString).min(1),
  })
  .strict();

const moduleBaselineSchema = z
  .object({
    outcome: moduleOutcomeSchema,
    latest_change: changeIdSchema.nullable(),
    requirement_ids: z.array(requirementIdSchema),
  })
  .strict();

const changeRelationListSchema = z.array(changeIdSchema);
const gateSchema = z
  .object({
    required: z.boolean(),
    satisfied: z.boolean(),
  })
  .strict();

const moduleSelectionSchema = z
  .object({
    module: businessModuleIdSchema,
    outcome: moduleOutcomeSchema,
    reason: nonEmptyString,
  })
  .strict();

const dependencyModuleSelectionSchema = z
  .object({
    module: businessModuleIdSchema,
    outcome: z.literal('DEPENDENCY'),
    reason: nonEmptyString,
  })
  .strict();

const changeMetadataSchema = z
  .object({
    schema_version: z.literal(1),
    change: z
      .object({
        id: changeIdSchema,
        revision: z.number().int().min(1),
        title: nonEmptyString,
        mode: changeModeSchema,
        status: changeStatusSchema,
        created_at: isoDateTime,
        updated_at: isoDateTime,
      })
      .strict(),
    impact: z
      .object({
        summary: nonEmptyString,
        mode: changeModeSchema,
        scope: z.enum(['single-module', 'cross-module']),
      })
      .strict(),
    baseline: z
      .object({
        created_at: isoDateTime.nullable(),
        stale: z.boolean(),
        modules: z.record(businessModuleIdSchema, moduleBaselineSchema),
      })
      .strict(),
    relations: z
      .object({
        depends_on: changeRelationListSchema,
        related_to: changeRelationListSchema,
        conflicts_with: changeRelationListSchema,
        supersedes: changeRelationListSchema,
      })
      .strict(),
    gates: z
      .object({
        analyze: gateSchema,
        design: gateSchema,
        plan: gateSchema,
        implement: gateSchema,
        verify: gateSchema,
        archive: gateSchema,
      })
      .strict(),
    modules: z
      .object({
        candidates: z.array(moduleSelectionSchema),
        confirmed: z.array(moduleSelectionSchema),
        dependencies: z.array(dependencyModuleSelectionSchema),
      })
      .strict(),
    requirements: z
      .object({
        added: z.array(requirementRefSchema),
        modified: z.array(requirementRefSchema),
        removed: z.array(requirementRefSchema),
      })
      .strict(),
    artifacts: z
      .object({
        metadata: relativePathString,
        proposal: relativePathString,
        design: relativePathString,
        spec: relativePathString,
        tasks: relativePathString,
        verification: relativePathString,
      })
      .strict(),
    tasks: z
      .object({
        total: z.number().int().min(0),
        completed: z.number().int().min(0),
        items: z.record(
          z.string(),
          z
            .object({
              title: nonEmptyString.optional(),
              status: taskStatusSchema,
            })
            .strict()
        ),
      })
      .strict(),
    verification: z
      .object({
        requirements_verified: z.boolean(),
        tests_passed: z.boolean(),
        build_passed: z.boolean(),
        lint_passed: z.boolean(),
        verified_at: isoDateTime.nullable(),
      })
      .strict(),
    archive: z
      .object({
        ready: z.boolean(),
        conflict: z.boolean(),
        archived_at: isoDateTime.nullable(),
      })
      .strict(),
  })
  .strict();

const changeIndexEntrySchema = z
  .object({
    id: changeIdSchema,
    title: nonEmptyString,
    mode: changeModeSchema,
    status: changeStatusSchema,
    updated_at: isoDateTime,
  })
  .strict();

const requirementDeltaSchema = z
  .object({
    id: requirementIdSchema,
    module: businessModuleIdSchema,
    action: z.enum(['ADDED', 'MODIFIED', 'REMOVED']),
    previous: nonEmptyString.optional(),
    next: nonEmptyString.optional(),
    reason: nonEmptyString.optional(),
    scenarios: z.array(scenarioSchema),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === 'ADDED' && value.next === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'ADDED requirement deltas must include next',
        path: ['next'],
      });
    }

    if (value.action === 'MODIFIED') {
      if (value.previous === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'MODIFIED requirement deltas must include previous',
          path: ['previous'],
        });
      }
      if (value.next === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'MODIFIED requirement deltas must include next',
          path: ['next'],
        });
      }
    }

    if (value.action === 'REMOVED') {
      if (value.previous === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'REMOVED requirement deltas must include previous',
          path: ['previous'],
        });
      }
      if (value.reason === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'REMOVED requirement deltas must include reason',
          path: ['reason'],
        });
      }
    }
  });

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const joinedPath = issue.path.join('.');
      return joinedPath ? `${joinedPath}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

function parseWithSchema<T>(label: string, schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid ${label}: ${formatIssues(result.error)}`);
  }
  return result.data;
}

export function parseWorkspaceConfig(value: unknown): WorkspaceConfig {
  return parseWithSchema('workspace config', workspaceConfigSchema, value);
}

export function parseBusinessModule(value: unknown): BusinessModule {
  return parseWithSchema('business module', businessModuleSchema, value);
}

export function parseChangeMetadata(value: unknown): ChangeMetadata {
  return parseWithSchema('change metadata', changeMetadataSchema, value);
}

export function parseChangeIndexEntry(value: unknown): ChangeIndexEntry {
  return parseWithSchema('change index entry', changeIndexEntrySchema, value);
}

export function parseRequirementDelta(value: unknown): RequirementDelta {
  return parseWithSchema('requirement delta', requirementDeltaSchema, value);
}

export type {
  WorkspaceConfig,
  BusinessModule,
  BusinessModuleId,
  ChangeId,
  ChangeIndexEntry,
  ChangeMetadata,
  ChangeMode,
  ChangeStatus,
  ModuleOutcome,
  RequirementId,
  RequirementRef,
};
