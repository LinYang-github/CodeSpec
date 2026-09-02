/**
 * The `workset` command group (slice 7.1): compose, keep, and open
 * personal working views. A workset is purely local and personal -
 * never committed, never shared, never derived from declarations, and
 * never a membership truth. Opening hands the view to the user's tool:
 * editors get the generated .code-workspace; CLI agents take over this
 * terminal with every member attached and no starter prompt.
 */
import * as os from 'node:os';
import { createRequire } from 'node:module';
import type { spawn as nodeSpawn } from 'node:child_process';
import { Command, Option } from 'commander';

import {
  buildWorksetCodeWorkspaceJson,
  getWorkset,
  getWorksetCodeWorkspacePath,
  listWorksets,
  readWorksetsState,
  removeWorkset,
  updateWorksetsState,
  validateWorksetName,
  withWorkset,
  withWorksetsLock,
  worksetNotFoundError,
  type Workset,
  type WorksetMember,
} from '../core/worksets.js';
import {
  buildLaunchCommand,
  findOpener,
  isOpenerCommandAvailable,
  isOpenerEnabled,
  listOpenerChoices,
  mergeOpenerTable,
  resolveOpenerCommand,
  type LaunchCommand,
  type OpenerDefinition,
} from '../core/openers.js';
import { pathIsDirectory, writeFileAtomically } from '../core/file-state.js';
import {
  getGlobalConfig,
  getGlobalConfigPath,
} from '../core/global-config.js';
import { StoreError, type StoreDiagnostic } from '../core/store/errors.js';
import { isInteractive } from '../utils/interactive.js';
import {
  asErrorMessage,
  emitFailure,
  isPromptCancellationError,
  printJson,
} from './shared-output.js';
import {
  finalizeWorkset,
  firstInstalledAlternative,
  formatMemberRows,
  noToolInstalledError,
  resolveMemberFlags,
  toolUnavailableError,
  toolUnknownError,
} from './workset-input.js';
import {
  composeInteractively,
  confirmRemoveInteractively,
  promptOpenNow,
  promptToolFromChoices,
} from './workset-prompts.js';
import { COMMAND_REGISTRY } from '../core/completions/command-registry.js';

// cross-spawn is CJS with no types and only `workset open` needs it -
// loaded lazily so every other CLI invocation skips its module graph.
let cachedSpawn: typeof nodeSpawn | undefined;
function defaultSpawn(): typeof nodeSpawn {
  if (cachedSpawn === undefined) {
    const require = createRequire(import.meta.url);
    cachedSpawn = require('cross-spawn') as typeof nodeSpawn;
  }
  return cachedSpawn;
}

interface WorksetCreateOptions {
  member?: string[];
  tool?: string;
  json?: boolean;
}

interface WorksetOpenOptions {
  tool?: string;
  json?: boolean;
}

interface WorksetRemoveOptions {
  yes?: boolean;
  json?: boolean;
}

function readOpenerTable(): OpenerDefinition[] {
  return mergeOpenerTable(getGlobalConfig().openers, getGlobalConfigPath());
}

function worksetCliOpenerDisabledError(
  opener: OpenerDefinition,
  name: string
): StoreError {
  return new StoreError(
    `CLI-agent 打开流程正在调整，暂时不能使用 ${opener.label} 打开 Workset。目前请在 IDE 中打开 Workset。`,
    'workset_cli_opener_disabled',
    {
      target: 'workset.tool',
      fix: `使用 VS Code 或 Cursor 打开：openspec workset open ${name} --tool code`,
    }
  );
}

interface LaunchResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface LaunchOptions {
  spawnFn?: typeof nodeSpawn;
}

/**
 * Spawns the opener with this terminal's stdio. Resolves with the
 * child's exit facts (never rejects for a nonzero exit - for a
 * terminal handoff, the session is the command); rejects with
 * workset_launch_failed only when the spawn itself fails. While the
 * child runs, SIGINT/SIGTERM are ignored in this parent: the terminal
 * delivers Ctrl-C to the child, and the parent must survive to report
 * the child's real exit facts (the 128+n contract).
 */
export function launchOpenerCommand(
  command: LaunchCommand,
  options: LaunchOptions = {}
): Promise<LaunchResult> {
  const spawnFn = options.spawnFn ?? defaultSpawn();

  return new Promise((resolve, reject) => {
    const launchFailure = (error: unknown): StoreError =>
      new StoreError(
        `无法启动 ${command.label}：${asErrorMessage(error)}`,
        'workset_launch_failed',
        {
          target: 'workset.tool',
          fix: `检查 '${command.executable}' 能否在当前终端运行，或使用 --tool 传入其他已安装工具。`,
        }
      );

    let child: ReturnType<typeof spawnFn>;
    try {
      child = spawnFn(command.executable, command.args, {
        cwd: command.cwd,
        stdio: 'inherit',
        shell: false,
      });
    } catch (error) {
      // Some spawn failures throw synchronously (platform-dependent);
      // they are the same launch failure.
      reject(launchFailure(error));
      return;
    }

    const ignoreSignal = (): void => undefined;
    process.on('SIGINT', ignoreSignal);
    process.on('SIGTERM', ignoreSignal);
    const cleanup = (): void => {
      process.removeListener('SIGINT', ignoreSignal);
      process.removeListener('SIGTERM', ignoreSignal);
    };

    child.on('error', (error) => {
      cleanup();
      reject(launchFailure(error));
    });

    child.on('close', (code, signal) => {
      cleanup();
      resolve({ code, signal });
    });
  });
}

/** 130 for SIGINT, 143 for SIGTERM - the shell's 128+n convention. */
export function exitCodeForLaunch(result: LaunchResult): number {
  if (result.signal !== null) {
    const signalNumber =
      os.constants.signals[result.signal as keyof typeof os.constants.signals];
    return 128 + (signalNumber ?? 1);
  }

  return result.code ?? 0;
}

interface PreparedOpen {
  workset: Workset;
  surviving: WorksetMember[];
  skipped: WorksetMember[];
  codeWorkspacePath: string;
}

class WorksetCommand {
  async create(
    name: string | undefined,
    options: WorksetCreateOptions = {}
  ): Promise<void> {
    try {
      const interactive = !options.json && isInteractive();

      let workset: Workset;
      let table: OpenerDefinition[] | undefined;
      if (interactive) {
        table = readOpenerTable();
        workset = await composeInteractively(
          name,
          { memberFlags: options.member ?? [], tool: options.tool },
          table
        );
      } else {
        workset = await this.composeFromFlags(name, options);
      }

      await updateWorksetsState((state) => withWorkset(state, workset));

      if (options.json) {
        printJson({ workset, status: [] });
        return;
      }

      console.log('');
      console.log(
        `已将 Workset '${workset.name}'（${workset.members.length} 个成员）保存到本机。`
      );

      if (interactive && workset.tool !== undefined && table !== undefined) {
        const label = findOpener(table, workset.tool)?.label ?? workset.tool;
        let openNow = false;
        try {
          openNow = await promptOpenNow(label);
        } catch (error) {
          // The workset is already durably saved: Ctrl-C here declines
          // the offer, it does not cancel the create.
          if (!isPromptCancellationError(error)) {
            throw error;
          }
        }

        if (openNow) {
          console.log('');
          await this.open(workset.name, {});
          return;
        }
      }

      console.log(
        `随时可使用以下命令打开：openspec workset open ${workset.name}`
      );
    } catch (error) {
      emitFailure(options.json, { workset: null, status: [] }, error, 'workset_error');
    }
  }

  private async composeFromFlags(
    name: string | undefined,
    options: WorksetCreateOptions
  ): Promise<Workset> {
    if (!name) {
      throw new StoreError('Pass a workset name.', 'workset_name_required', {
        target: 'workset.name',
        fix: 'openspec workset create <name> --member <path>',
      });
    }

    validateWorksetName(name);

    const memberFlags = options.member ?? [];
    if (memberFlags.length === 0) {
      throw new StoreError(
        'Pass at least one member folder.',
        'workset_members_required',
        {
          target: 'workset.member',
          fix: `openspec workset create ${name} --member <path> --member <name>=<path>`,
        }
      );
    }

    const members = await resolveMemberFlags(memberFlags);
    // The opener table is read only when a tool is actually named - a
    // tool-less scripted create must not fail on unrelated config rows.
    const table = options.tool !== undefined ? readOpenerTable() : [];
    if (options.tool !== undefined) {
      const chosen = findOpener(table, options.tool);
      if (chosen !== null && !isOpenerEnabled(chosen)) {
        throw worksetCliOpenerDisabledError(chosen, name);
      }
    }
    return finalizeWorkset(name, members, options.tool, table);
  }

  async list(options: { json?: boolean } = {}): Promise<void> {
    try {
      const state = await readWorksetsState();
      const worksets = listWorksets(state);

      if (options.json) {
        printJson({ worksets, status: [] });
        return;
      }

      if (worksets.length === 0) {
        console.log(
          '尚未保存 Workset。可使用 openspec workset create 创建。'
        );
        return;
      }

      // The table is consulted only to render tool labels.
      const table = worksets.some((workset) => workset.tool !== undefined)
        ? readOpenerTable()
        : [];
      for (const workset of worksets) {
        const toolLabel =
          workset.tool !== undefined
            ? `（使用 ${findOpener(table, workset.tool)?.label ?? workset.tool} 打开）`
            : '';
        console.log(`${workset.name}${toolLabel}`);
        for (const row of formatMemberRows(workset.members)) {
          console.log(`  ${row}`);
        }
      }
    } catch (error) {
      emitFailure(options.json, { worksets: [], status: [] }, error, 'workset_error');
    }
  }

  async open(name: string, options: WorksetOpenOptions = {}): Promise<void> {
    let prepared: PreparedOpen | undefined;

    try {
      if (options.json) {
        throw new StoreError(
          'workset open 会将当前终端交给所选工具，不能使用 JSON 模式。',
          'workset_open_json_unsupported',
          {
            target: 'workset.tool',
            fix: '使用以下命令查看 Workset：openspec workset list --json',
          }
        );
      }

      // Regenerate the derived file FIRST (under the lock), so every
      // cannot-drive failure below can name an existing, current file.
      prepared = await withWorksetsLock(async (state): Promise<PreparedOpen> => {
        const workset = getWorkset(state, name);
        if (workset === null) {
          throw worksetNotFoundError(name, state);
        }

        const checks = await Promise.all(
          workset.members.map(async (member) => ({
            member,
            exists: await pathIsDirectory(member.path),
          }))
        );
        const surviving = checks
          .filter((check) => check.exists)
          .map((check) => check.member);
        const skipped = checks
          .filter((check) => !check.exists)
          .map((check) => check.member);

        if (surviving.length === 0) {
          throw new StoreError(
            `Workset '${name}' 的成员目录在本机均不存在。`,
            'workset_no_members_available',
            {
              target: 'workset.member',
              fix: `重新创建：openspec workset remove ${name} --yes && openspec workset create ${name} --member <path>`,
            }
          );
        }

        const codeWorkspacePath = getWorksetCodeWorkspacePath(name);
        await writeFileAtomically(
          codeWorkspacePath,
          buildWorksetCodeWorkspaceJson(surviving)
        );

        return { workset, surviving, skipped, codeWorkspacePath };
      });

      for (const member of prepared.skipped) {
        console.error(
          `已跳过 '${member.name}'（${member.path} 不可用）。`
        );
      }
      if (prepared.workset.members[0] !== prepared.surviving[0]) {
        const primary = prepared.surviving[0];
        console.error(
          `Using '${primary.name}' (${primary.path}) as the primary for this open.`
        );
      }

      const table = readOpenerTable();

      const toolId = options.tool ?? prepared.workset.tool;
      let opener: OpenerDefinition;
      if (toolId !== undefined) {
        const found = findOpener(table, toolId);
        if (found === null) {
          throw toolUnknownError(toolId, table);
        }
        if (!isOpenerEnabled(found)) {
          throw worksetCliOpenerDisabledError(found, name);
        }
        if (!isOpenerCommandAvailable(found.command)) {
          throw toolUnavailableError(found, table, name);
        }
        opener = found;
      } else {
        if (!isInteractive()) {
          throw new StoreError(
            `Workset '${name}' 没有保存的工具。`,
            'workset_tool_required',
            {
              target: 'workset.tool',
              fix: `openspec workset open ${name} --tool <id>`,
            }
          );
        }

        // The prompt offers only available openers, so the selection
        // needs no second scan.
        const available = listOpenerChoices(table).filter(
          (choice) => choice.available
        );
        if (available.length === 0) {
          throw noToolInstalledError(table, name);
        }
        const selectedId = await promptToolFromChoices(available);
        opener = available.find(
          (choice) => choice.opener.id === selectedId
        )!.opener;
      }

      // Use the same exact PATH hit that made the opener available. Passing
      // the bare command here would let execvp skip a broken earlier PATH
      // entry and launch a different installation later in PATH.
      const resolvedCommand = resolveOpenerCommand(opener.command);
      if (resolvedCommand === null) {
        throw toolUnavailableError(opener, table, name);
      }

      const launch = buildLaunchCommand(
        { ...opener, command: resolvedCommand },
        {
          members: prepared.surviving,
          codeWorkspacePath: prepared.codeWorkspacePath,
        }
      );

      if (opener.style === 'workspace-file') {
        console.log(
          `正在使用 ${opener.label} 打开 '${name}'（将打开窗口，当前命令随后返回）。`
        );
      } else {
        console.log(
          `正在将当前终端交给 ${opener.label} 打开 '${name}'（退出时会结束当前会话）。`
        );
      }

      let result: LaunchResult;
      try {
        result = await launchOpenerCommand(launch);
      } catch (error) {
        // Make the launch-failure fix pasteable when an alternative is
        // installed (the launcher itself does not know the table).
        if (
          error instanceof StoreError &&
          error.diagnostic.code === 'workset_launch_failed'
        ) {
          const alternative = firstInstalledAlternative(table, opener.id);
          if (alternative !== null) {
            throw new StoreError(error.message, 'workset_launch_failed', {
              target: 'workset.tool',
              fix: `运行：openspec workset open ${name} --tool ${alternative}`,
            });
          }
        }
        throw error;
      }

      const exitCode = exitCodeForLaunch(result);
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    } catch (error) {
      emitFailure(options.json, { status: [] }, error, 'workset_error');

      // Never strand the user: once the derived file is regenerated,
      // every failure (except a prompt cancellation) carries the
      // manual route - the file path plus the members it contains.
      if (
        !options.json &&
        prepared !== undefined &&
        !isPromptCancellationError(error)
      ) {
        console.error('请手动打开：');
        console.error(`  Workspace 文件：${prepared.codeWorkspacePath}`);
        console.error('  成员：');
        for (const row of formatMemberRows(prepared.surviving)) {
          console.error(`    ${row}`);
        }
      }
    }
  }

  async remove(name: string, options: WorksetRemoveOptions = {}): Promise<void> {
    try {
      if (!options.yes) {
        // The pre-read serves the not-found priority and the confirm
        // display; the --yes path skips it (removeWorkset re-checks
        // under the lock anyway).
        const state = await readWorksetsState();
        const workset = getWorkset(state, name);
        if (workset === null) {
          throw worksetNotFoundError(name, state);
        }

        if (options.json || !isInteractive()) {
          throw new StoreError(
            'Pass --yes to remove a workset non-interactively.',
            'workset_remove_confirmation_required',
            {
              target: 'workset.name',
              fix: `openspec workset remove ${name} --yes`,
            }
          );
        }

        const confirmed = await confirmRemoveInteractively(workset);
        if (!confirmed) {
          throw new StoreError(
            'Workset 删除已取消。',
            'workset_remove_cancelled',
            {
              target: 'workset.name',
              fix: '准备好后重新运行 remove。',
            }
          );
        }
      }

      await removeWorkset(name);

      if (options.json) {
        printJson({ removed: { name }, status: [] });
        return;
      }

      console.log(`已移除 Workset '${name}'。成员目录未被修改。`);
    } catch (error) {
      emitFailure(options.json, { removed: null, status: [] }, error, 'workset_error');
    }
  }
}

function collectMember(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function registerWorksetCommand(program: Command): void {
  const worksetCommand = new WorksetCommand();
  const groupDescription =
    COMMAND_REGISTRY.find((entry) => entry.name === 'workset')?.description ??
    '创建、保存并打开个人工作视图（仅保存在本机）';
  const workset = program.command('workset').description(groupDescription);
  // Parsed at the group level so `openspec workset --json` keeps the
  // one-JSON-document contract instead of a raw Commander error. The
  // parent option matches anywhere; actions read optsWithGlobals().
  workset.addOption(new Option('--json', '以 JSON 输出').hideHelp());

  workset
    .command('create [name]')
    .description('创建并保存由你选择目录组成的命名工作视图')
    .option(
      '--member <member>',
      '成员目录格式为 <path> 或 <name>=<path>；可重复，第一项为主目录',
      collectMember,
      [] as string[]
    )
    .option('--tool <id>', '打开此 Workset 时优先使用的工具')
    .option('--json', '以 JSON 输出')
    .action(async (name: string | undefined, _options: WorksetCreateOptions, command: Command) => {
      await worksetCommand.create(name, command.optsWithGlobals());
    });

  workset
    .command('list')
    .alias('ls')
    .description('显示已保存的 Workset 及其成员')
    .option('--json', '以 JSON 输出')
    .action(async (_options: { json?: boolean }, command: Command) => {
      await worksetCommand.list(command.optsWithGlobals());
    });

  workset
    .command('open <name>')
    .description('在工具中打开已保存的 Workset（编辑器窗口或 Agent 会话）')
    .option('--tool <id>', '仅本次使用此工具打开')
    .addOption(
      // Parsed so Commander never owns the error; rejected in the
      // action with one JSON document. Hidden because help should not
      // advertise a mode that only rejects.
      new Option('--json', 'Not supported for open').hideHelp()
    )
    .action(async (name: string, _options: WorksetOpenOptions, command: Command) => {
      await worksetCommand.open(name, command.optsWithGlobals());
    });

  workset
    .command('remove <name>')
    .description('删除已保存的 Workset（不会修改成员目录）')
    .option('--yes', '以非交互方式确认删除')
    .option('--json', '以 JSON 输出')
    .action(async (name: string, _options: WorksetRemoveOptions, command: Command) => {
      await worksetCommand.remove(name, command.optsWithGlobals());
    });

  const subcommandsLine = workset.commands
    .map((subcommand) => {
      const aliases = subcommand.aliases();
      return aliases.length > 0
        ? `${subcommand.name()} (${aliases.join(', ')})`
        : subcommand.name();
    })
    .join(', ');

  // One handler owns missing AND unknown subcommands: known
  // subcommands dispatch above; everything else lands in this action
  // (allowExcessArguments routes the unknown operand here), keeping
  // the one-JSON-document contract for `--json` probes.
  workset.allowExcessArguments(true);
  workset.action(() => {
    const attempted = workset.args.filter(
      (operand) => !operand.startsWith('-')
    );
    const message =
      attempted.length > 0
        ? `'openspec workset' 中的未知命令 '${attempted[0]}'。Workset 子命令：${subcommandsLine}。`
        : `缺少 'openspec workset' 子命令。Workset 子命令：${subcommandsLine}。`;
    if (workset.opts().json) {
      printJson({
        status: [
          {
            severity: 'error',
            code: 'unknown_workset_subcommand',
            message,
            fix: '运行其中一个 Workset 子命令。',
          } satisfies StoreDiagnostic,
        ],
      });
    } else {
      console.error(`错误：${message}`);
    }
    process.exitCode = 1;
  });
}
