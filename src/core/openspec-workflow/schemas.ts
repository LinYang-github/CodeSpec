import { z } from 'zod';

import type {
  BusinessModule,
  ChangeIndexEntry,
  ChangeMetadata,
  RequirementDelta,
  RequirementRef,
  WorkspaceConfig,
} from './types.js';

const nonEmptyString = z.string().min(1);
const isoDateTime = z.string().datetime({ offset: true });
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

const requirementRefSchema = z
  .object({
    id: nonEmptyString,
    module: nonEmptyString,
  })
  .strict();

const scenarioSchema = z
  .object({
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
    id: nonEmptyString,
    name: nonEmptyString,
    description: nonEmptyString.optional(),
    responsibilities: z.array(nonEmptyString).min(1),
    keywords: z.array(nonEmptyString).min(1),
  })
  .strict();

const changeMetadataSchema = z
  .object({
    schema_version: z.literal(1),
    change: z
      .object({
        id: nonEmptyString,
        revision: z.number().int().min(1),
        title: nonEmptyString,
        mode: changeModeSchema,
        status: changeStatusSchema,
        created_at: isoDateTime,
        updated_at: isoDateTime,
      })
      .strict(),
    baseline: z
      .object({
        created_at: isoDateTime.nullable(),
        stale: z.boolean(),
        modules: z.record(z.string(), z.unknown()),
      })
      .strict(),
    relations: z
      .object({
        depends_on: z.array(nonEmptyString),
        related_to: z.array(nonEmptyString),
        conflicts_with: z.array(nonEmptyString),
        supersedes: z.array(nonEmptyString),
      })
      .strict(),
    modules: z
      .object({
        candidates: z.array(nonEmptyString),
        confirmed: z.array(nonEmptyString),
        dependencies: z.array(nonEmptyString),
      })
      .strict(),
    requirements: z
      .object({
        added: z.array(requirementRefSchema),
        modified: z.array(requirementRefSchema),
        removed: z.array(requirementRefSchema),
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
    id: nonEmptyString,
    title: nonEmptyString,
    mode: changeModeSchema,
    status: changeStatusSchema,
    updated_at: isoDateTime,
  })
  .strict();

const requirementDeltaSchema = z
  .object({
    id: nonEmptyString,
    module: nonEmptyString,
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

export type { WorkspaceConfig, BusinessModule, ChangeMetadata, ChangeIndexEntry, RequirementRef };
