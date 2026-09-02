/**
 * Status Command
 *
 * Displays artifact completion status for a change.
 */

import ora from 'ora';
import chalk from 'chalk';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { getChangeDir } from '../../core/planning-home.js';
import {
  resolveRootForCommand,
  toPlanningHome,
  toRootOutput,
  withStoreFlag,
  isStoreSelectedRoot,
} from '../../core/root-selection.js';
import {
  loadChangeContext,
  formatChangeStatus,
  type ChangeStatus,
} from '../../core/artifact-graph/index.js';
import { asStatus } from '../shared-output.js';
import { formatStatusLabel } from '../../ui/user-facing-messages.js';
import { loadWorkspace, loadChangeArtifacts } from '../../core/openspec-workflow/loaders.js';
import { validateExitGate } from '../../core/openspec-workflow/gates.js';
import type { StoreDiagnostic } from '../../core/store/errors.js';
import {
  validateChangeExists,
  validateSchemaExists,
  getAvailableChanges,
  getStatusIndicator,
  getStatusColor,
  tryLoadCanonicalWorkspace,
} from './shared.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface StatusOptions {
  change?: string;
  all?: boolean;
  schema?: string;
  store?: string;
  storePath?: string;
  json?: boolean;
}

// -----------------------------------------------------------------------------
// Command Implementation
// -----------------------------------------------------------------------------

// A batch entry is either a fully loaded status or, for a change that failed
// to load, the change name plus the diagnostic — the sweep never aborts.
type BatchStatusEntry = ChangeStatus | { changeName: string; status: StoreDiagnostic[] };

// The --all --json failure null-shape. Root-selection failures (handled in
// resolveRootForCommand) and thrown errors (caught by the CLI wrapper) must
// emit the same shape, so both call sites reference this one constant.
export const BATCH_STATUS_FAILURE_PAYLOAD: Record<string, unknown> = {
  changes: [],
  root: null,
};

export async function statusCommand(options: StatusOptions): Promise<void> {
  if (options.all && options.change) {
    throw new Error('--all 和 --change 不能同时使用。');
  }

  // The root resolves (and the store banner prints) before the spinner starts
  // so the two do not fight over stderr. The batch null-shape rides along so
  // a root-selection failure under --all --json still carries `changes: []`.
  const root = await resolveRootForCommand(options, {
    json: options.json,
    failurePayload: options.all ? BATCH_STATUS_FAILURE_PAYLOAD : undefined,
  });
  if (!root) {
    return;
  }

  const spinner = options.json ? undefined : ora('正在加载 Change 状态...').start();

  try {
    const planningHome = toPlanningHome(root);
    const projectRoot = root.path;
    const rootOutput = toRootOutput(root);
    const newChangeHint = withStoreFlag(root, 'openspec new change <name>');

    // Single definition of "load one change's status" so the batch and
    // single-change payloads can never drift apart.
    const loadStatus = (changeName: string): ChangeStatus =>
      formatChangeStatus(
        loadChangeContext(projectRoot, changeName, options.schema, {
          changeDir: getChangeDir(planningHome, changeName),
          planningHome,
        }),
        isStoreSelectedRoot(root) ? { storeId: root.storeId } : {}
      );

    const canonicalStatus = async (changeName: string): Promise<Record<string, unknown> | null> => {
      if (!/^CHG-\d{8}-\d{3}$/.test(changeName)) return null;
      const canonicalWorkspace = await tryLoadCanonicalWorkspace(projectRoot);
      if (!canonicalWorkspace) return null;
      const openspecDir = canonicalWorkspace.openspecDir;
      const metadataPath = path.join(canonicalWorkspace.paths.changes, changeName, 'metadata.yaml');
      if (!(await fs.access(metadataPath).then(() => true).catch(() => false))) {
        throw new Error(`未找到 canonical Change 元数据：${metadataPath}`);
      }
      {
        const workspace = canonicalWorkspace;
        const artifacts = await loadChangeArtifacts(workspace.paths, changeName);
        const gate = validateExitGate(workspace, artifacts, artifacts.metadata.change.status);
        return {
          changeId: changeName, status: artifacts.metadata.change.status,
          revision: artifacts.metadata.change.revision, title: artifacts.metadata.change.title,
          baseline: artifacts.metadata.baseline, requirements: artifacts.metadata.requirements,
          verification: artifacts.metadata.verification, gateErrors: gate.errors,
        };
      }
    };

    // Handle no-changes case gracefully — status is informational,
    // so "no changes" is a valid state, not an error.
    if (!options.change) {
      // Validate before the no-changes early return so a bogus --schema
      // fails the same way whether or not any change exists yet.
      if (options.all && options.schema) {
        validateSchemaExists(options.schema, projectRoot);
      }

      const available = await getAvailableChanges(projectRoot, root.changesDir);
      if (available.length === 0) {
        spinner?.stop();
        if (options.json) {
          console.log(
              JSON.stringify(
                { changes: [], message: '没有活动 Change。', root: rootOutput },
              null,
              2
            )
          );
          return;
        }
        console.log(`没有活动 Change。可使用以下命令创建：${newChangeHint}`);
        return;
      }

      if (options.all) {
        // readdir order is platform-dependent; sort for deterministic output,
        // with the same comparator validate --all uses so the two batch
        // commands order a given change set identically.
        const entries: BatchStatusEntry[] = [];
        const canonicalWorkspace = await tryLoadCanonicalWorkspace(projectRoot);
        for (const changeName of available.sort((a, b) => a.localeCompare(b))) {
          try {
            const canonical = canonicalWorkspace ? await canonicalStatus(changeName) : null;
            if (canonical) entries.push(canonical as unknown as BatchStatusEntry);
            else entries.push(loadStatus(changeName));
          } catch (error) {
            // One malformed change must not blank the sweep; carry its
            // diagnostic in place and keep going.
            entries.push({ changeName, status: [asStatus(error, 'change_error')] });
          }
        }

        spinner?.stop();
        const failed = entries.some((entry) => !('artifacts' in entry) && !('changeId' in entry));

        if (options.json) {
          console.log(JSON.stringify({ changes: entries, root: rootOutput }, null, 2));
          if (failed) {
            process.exitCode = 1;
          }
          return;
        }

        entries.forEach((entry, index) => {
          if (index > 0) {
            console.log();
          }
          if ('artifacts' in entry) {
            printStatusText(entry);
          } else if ('changeId' in entry) {
            const canonicalEntry = entry as unknown as { changeId: string; status: string; revision: number; gateErrors?: string[] };
            console.log(`Change：${canonicalEntry.changeId}`);
            console.log(`状态：${formatStatusLabel(canonicalEntry.status)}`);
            console.log(`修订：${canonicalEntry.revision}`);
            if (Array.isArray(canonicalEntry.gateErrors) && canonicalEntry.gateErrors.length > 0) console.log(chalk.red(`状态门禁阻塞：${canonicalEntry.gateErrors.join('；')}`));
          } else {
            console.log(chalk.red(`✗ ${entry.changeName}: ${entry.status[0]?.message}`));
          }
        });
        // A partial load is still a failed command in both output modes;
        // JSON callers can parse the complete envelope independently of
        // the process exit code.
        if (failed) {
          process.exitCode = 1;
        }
        return;
      }

      // Changes exist but neither --change nor --all provided. Name --all
      // here too: it is the other way to answer this prompt, and a caller
      // who wants every change should not have to find it in --help.
      spinner?.stop();
      throw new Error(
        `缺少必需选项 --change（或使用 --all 查看全部活动 Change）。可用 Change：\n  ${available.join('\n  ')}`
      );
    }

    if (options.change && /^CHG-\d{8}-\d{3}$/.test(options.change)) {
      const canonicalWorkspace = await tryLoadCanonicalWorkspace(projectRoot);
      if (canonicalWorkspace) {
        const metadataPath = path.join(canonicalWorkspace.paths.changes, options.change, 'metadata.yaml');
        if (!(await fs.access(metadataPath).then(() => true).catch(() => false))) throw new Error(`未找到 canonical Change 元数据：${metadataPath}`);
      }
    }
    const canonicalWorkspaceForLookup = await tryLoadCanonicalWorkspace(projectRoot);
    const changeName = canonicalWorkspaceForLookup && options.change && /^CHG-\d{8}-\d{3}$/.test(options.change)
      ? options.change
      : await validateChangeExists(options.change, projectRoot, root.changesDir, { newChangeHint });

    // Validate schema if explicitly provided
    if (options.schema) {
      validateSchemaExists(options.schema, projectRoot);
    }

    const canonical = await canonicalStatus(changeName);
    if (canonical) {
      spinner?.stop();
      if (options.json) { console.log(JSON.stringify({ ...canonical, root: rootOutput }, null, 2)); return; }
      console.log(`Change：${canonical.changeId}`);
      console.log(`状态：${formatStatusLabel(canonical.status)}`);
      console.log(`修订：${canonical.revision}`);
      if (Array.isArray(canonical.gateErrors) && canonical.gateErrors.length > 0) {
        console.log(`状态门禁阻塞：${canonical.gateErrors.join('；')}`);
      }
      return;
    }

    // loadChangeContext will auto-detect schema from metadata if not provided
    const status = loadStatus(changeName);

    spinner?.stop();

    if (options.json) {
      console.log(JSON.stringify({ ...status, root: rootOutput }, null, 2));
      return;
    }

    printStatusText(status);
  } catch (error) {
    spinner?.stop();
    throw error;
  }
}

export function printStatusText(status: ChangeStatus): void {
  const doneCount = status.artifacts.filter((a) => a.status === 'done').length;
  const skippedCount = status.artifacts.filter((a) => a.status === 'skipped').length;
  const total = status.artifacts.length - skippedCount;

  console.log(`Change：${status.changeName}`);
  console.log(`Schema：${status.schemaName}`);
  if (status.changeRoot) {
    console.log(`Change 根目录：${status.changeRoot}`);
  }
  const skippedSuffix = skippedCount > 0 ? `（已跳过 ${skippedCount} 个）` : '';
  console.log(`进度：${doneCount}/${total} 个产物已完成${skippedSuffix}`);
  console.log();

  for (const artifact of status.artifacts) {
    const indicator = getStatusIndicator(artifact.status);
    const color = getStatusColor(artifact.status);
    let line = `${indicator} ${artifact.id}`;

    if (artifact.status === 'skipped') {
      line += color('（已跳过：Change 声明了 skip_specs）');
    }

    if (artifact.status === 'blocked' && artifact.missingDeps && artifact.missingDeps.length > 0) {
      line += color(`（阻塞依赖：${artifact.missingDeps.join('、')}）`);
    }

    console.log(line);
  }

  if (status.isPlanningComplete) {
    console.log();
    console.log(chalk.green('全部规划产物已完成！'));
  }
}
