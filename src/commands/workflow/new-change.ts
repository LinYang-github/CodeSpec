/**
 * New Change Command
 *
 * Creates a new change directory with optional description and schema in the
 * resolved OpenSpec root. `--store <id>` selects a registered store's
 * root; initiative linking and workspace affected areas are no longer part of
 * this command.
 */

import ora from 'ora';
import path from 'path';
import { promises as fs } from 'fs';
import { createChange, validateChangeName } from '../../utils/change-utils.js';
import {
  createCanonicalChange,
} from '../../core/openspec-workflow/change-manager.js';
import { formatChangeLocation } from '../../core/planning-home.js';
import {
  resolveRootForCommand,
  RootSelectionError,
  toPlanningHome,
  toRootOutput,
  withStoreFlag,
  type ResolvedOpenSpecRoot,
  type RootOutput,
  isStoreSelectedRoot,
} from '../../core/root-selection.js';
import { printJson, statusFromError, validateSchemaExists, tryLoadCanonicalWorkspace } from './shared.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface NewChangeOptions {
  description?: string;
  goal?: string;
  schema?: string;
  store?: string;
  storePath?: string;
  initiative?: string;
  areas?: string;
  json?: boolean;
}

interface NewChangeOutput {
  change: {
    id: string;
    path: string;
    metadataPath: string;
    schema: string;
  };
  root: RootOutput;
}

// -----------------------------------------------------------------------------
// Command Implementation
// -----------------------------------------------------------------------------

function assertRemovedOptionsAbsent(options: NewChangeOptions): void {
  if (options.initiative !== undefined) {
    throw new RootSelectionError(
      '--initiative 已不再支持。普通 Change 不再关联 initiative；使用 --store <id> 选择 OpenSpec 根目录。',
      'initiative_option_removed',
      { target: 'change.options' }
    );
  }

  if (options.areas !== undefined) {
    throw new RootSelectionError(
      '--areas 已不再支持。普通 OpenSpec 根目录不再维护 workspace affected areas。',
      'areas_option_removed',
      { target: 'change.options' }
    );
  }
}

function printCreatedChangeHuman(
  payload: NewChangeOutput,
  root: ResolvedOpenSpecRoot
): void {
  // A relative path is only honest when the root is where the user
  // stands; a distant ancestor root gets the absolute path.
  const location =
    !isStoreSelectedRoot(root) && root.path === process.cwd()
      ? formatChangeLocation(toPlanningHome(root), payload.change.id)
      : payload.change.path;
  console.log(`已创建 Change：${payload.change.id}，位置：${location}/`);
  console.log(`Schema：${payload.change.schema}`);
  console.log(`下一步：${withStoreFlag(root, `openspec status --change ${payload.change.id}`)}`);
}

export async function newChangeCommand(name: string | undefined, options: NewChangeOptions): Promise<void> {
  const spinner = options.json ? undefined : ora();

  try {
    if (!name) {
      throw new Error('缺少必需参数 <name>。');
    }

    assertRemovedOptionsAbsent(options);

    const root = await resolveRootForCommand(options, {
      json: options.json,
      failurePayload: { change: null },
    });
    if (!root) {
      return;
    }

    const projectRoot = root.path;
    const canonicalWorkspace = await tryLoadCanonicalWorkspace(projectRoot);

    if (canonicalWorkspace) {
      if (/^CHG-\d{8}-\d{3}$/.test(name)) {
        throw new Error('canonical Change ID 会自动分配，请提供描述性的 Change 标题。');
      }
      if (options.schema) {
        throw new Error('canonical code-spec Change 不支持 --schema；请使用默认 schema。');
      }
    } else {
      const validation = validateChangeName(name);
      if (!validation.valid) {
        throw new Error(validation.error);
      }
    }

    // Validate schema if provided
    if (options.schema) {
      validateSchemaExists(options.schema, projectRoot);
    }

    const resolvedSchema = options.schema ?? root.defaultSchema;
    if (spinner) {
      spinner.start(`正在使用 schema '${resolvedSchema}' 创建 Change '${name}'...`);
    }

    const result = canonicalWorkspace
      ? {
          kind: 'canonical' as const,
          value: await createCanonicalChange(canonicalWorkspace, {
            title: name,
            summary: options.goal ?? options.description ?? name,
            mode: 'feature',
          }),
        }
      : {
          kind: 'legacy' as const,
          value: await createChange(projectRoot, name, {
            schema: options.schema,
            defaultSchema: root.defaultSchema,
            changesDir: root.changesDir,
            metadata: {
              ...(options.goal ? { goal: options.goal } : {}),
            },
          }),
        };

    // If description provided, create README.md with description
    if (options.description) {
      const { promises: fs } = await import('fs');
      const readmePath = path.join(result.value.changeDir, 'README.md');
      await fs.writeFile(readmePath, `# ${name}\n\n${options.description}\n`, 'utf-8');
    }

    const payload: NewChangeOutput = {
      change: {
        id: result.kind === 'canonical' ? result.value.changeId : name,
        path: result.value.changeDir,
        metadataPath:
          result.kind === 'canonical'
            ? result.value.metadataPath
            : path.join(result.value.changeDir, '.openspec.yaml'),
        schema: result.kind === 'canonical' ? 'code-spec' : result.value.schema,
      },
      root: toRootOutput(root),
    };

    if (options.json) {
      printJson(payload);
      return;
    }

    spinner?.stop();
    printCreatedChangeHuman(payload, root);
  } catch (error) {
    spinner?.stop();
    if (options.json) {
      printJson({
        change: null,
        status: [statusFromError(error)],
      });
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}
