import { asStatus } from '../commands/shared-output.js';
import { Command, Option } from 'commander';
import { createRequire } from 'module';
import ora from 'ora';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, promises as fs } from 'fs';
import { AI_TOOLS, TOOL_ID_ALIASES } from '../core/config.js';
import { UpdateCommand } from '../core/update.js';
import {
  getAvailableCliUpdate,
  displayCliUpdateNote,
  shouldOfferUpgrade,
  getInstallDir,
  offerCliUpgrade,
  rerunUpdateWithUpgradedCli,
  displayUpgradeCommand,
  isSourceCheckout,
} from '../core/version-check.js';
import { ListCommand } from '../core/list.js';
import { ArchiveCommand, type ArchiveOptions } from '../core/archive.js';
import { ViewCommand } from '../core/view.js';
import { resolveRootForCommand, toRootOutput } from '../core/root-selection.js';
import { registerSpecCommand } from '../commands/spec.js';
import { ChangeCommand } from '../commands/change.js';
import { ValidateCommand } from '../commands/validate.js';
import { ShowCommand } from '../commands/show.js';
import { CompletionCommand } from '../commands/completion.js';
import { FeedbackCommand } from '../commands/feedback.js';
import { registerConfigCommand } from '../commands/config.js';
import { registerSchemaCommand } from '../commands/schema.js';
import { registerStoreCommand } from '../commands/store.js';
import { registerDoctorCommand } from '../commands/doctor.js';
import { registerContextCommand } from '../commands/context.js';
import { registerWorksetCommand } from '../commands/workset.js';
import {
  statusCommand,
  BATCH_STATUS_FAILURE_PAYLOAD,
  instructionsCommand,
  applyInstructionsCommand,
  archiveInstructionsCommand,
  templatesCommand,
  schemasCommand,
  newChangeCommand,
  DEFAULT_SCHEMA,
  type StatusOptions,
  type InstructionsOptions,
  type TemplatesOptions,
  type SchemasOptions,
  type NewChangeOptions,
} from '../commands/workflow/index.js';
import { rebaseChange } from '../core/openspec-workflow/rebase.js';
import { loadWorkspace, loadChangeArtifacts } from '../core/openspec-workflow/loaders.js';
import { transitionChange } from '../core/openspec-workflow/state-machine.js';
import { detectStaleChanges } from '../core/openspec-workflow/stale.js';
import { archiveChange } from '../core/openspec-workflow/archive-transaction.js';
import { allocateRequirementIds } from '../core/openspec-workflow/requirement-allocator.js';
import type { ChangeStatus } from '../core/openspec-workflow/types.js';
import { parse as parseYaml } from 'yaml';
import { maybeShowTelemetryNotice, trackCommand, shutdown } from '../telemetry/index.js';
import { maybeShowCompletionTip } from '../core/completion-tip.js';
import { COMMON_FLAGS } from '../core/completions/shared-flags.js';
import { isInteractive } from '../utils/interactive.js';
import { tryLoadCanonicalWorkspace } from '../commands/workflow/shared.js';

const STORE_OPTION_DESCRIPTION = COMMON_FLAGS.store.description;

// Deliberate rejection path: --store-path stays registered (hidden) so the
// resolver can explain that registering the path is the supported route,
// instead of Commander emitting a generic unknown-option error (or, for
// `show`, silently ignoring it via allowUnknownOption).
function hiddenStorePathOption(): Option {
  return new Option(
    '--store-path <path>',
    '不支持；请使用 "openspec store register <path>" 登记路径，再使用 --store <id>'
  ).hideHelp();
}

function failWithError(
  error: unknown,
  json?: { enabled: boolean | undefined; payload?: Record<string, unknown>; fallbackCode?: string }
): void {
  const status = asStatus(error, json?.fallbackCode ?? 'command_error');

  // The agent contract: every --json failure leaves exactly one JSON
  // document on stdout (the command's null-shape plus a status array).
  if (json?.enabled) {
    console.log(
      JSON.stringify(
        { ...(json.payload ?? {}), status: [status] },
        null,
        2
      )
    );
    process.exitCode = 1;
    return;
  }
  ora().fail(`错误：${status.message}`);
  if (status.fix) {
    console.error(`修复：${status.fix}`);
  }
  process.exitCode = process.exitCode ?? 1;
}

const program = new Command();
const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

/**
 * Get the full command path for nested commands.
 * For example: 'change show' -> 'change:show'
 */
export function getCommandPath(command: Command): string {
  const names: string[] = [];
  let current: Command | null = command;

  while (current) {
    const name = current.name();
    // Skip the root 'openspec' command
    if (name && name !== 'openspec') {
      names.unshift(name);
    }
    current = current.parent;
  }

  return names.join(':') || 'openspec';
}

/**
 * True when the executing command asked for JSON output — used to suppress the
 * first-run telemetry notice so stdout stays a single valid JSON document.
 *
 * `--json` reaches commands three ways, so a single parsed option is not enough:
 * - declared on the leaf (`openspec status --json`) → `opts().json`
 * - declared on a parent group and read via globals (`openspec workset --json list`)
 *   → `optsWithGlobals().json`
 * - a residual arg on a permissive group that never declares the option
 *   (`openspec store --json`, which detects it from `command.args`) → `args`
 *
 * Suppressing is always safe: the disclosure is only deferred to the next
 * non-JSON run, never lost, whereas printing it on a JSON run corrupts stdout.
 */
export function isJsonRun(command: Command): boolean {
  return (
    command.optsWithGlobals().json === true ||
    command.args.includes('--json')
  );
}

/**
 * True for the commands that exist to serve shell completions: the user-facing
 * `openspec completion ...` group and the hidden `__complete` resolver that
 * generated completion scripts call on every Tab press. Tipping either about
 * completions is noise, and `__complete` would burn the one-shot tip invisibly.
 */
export function isCompletionRun(commandPath: string): boolean {
  return commandPath.split(':')[0] === 'completion' || commandPath === '__complete';
}

/**
 * True when the first-run completions tip must be deferred rather than shown.
 *
 * Deferring keeps the tip unconsumed, so it still reaches the user on a later
 * run that can actually carry it. All three cases are runs nobody would read a
 * hint from: JSON output, the completion machinery itself, and a stderr that is
 * not a terminal — pipes and the agent-driven runs that dominate this CLI's
 * usage would otherwise burn the user's one-shot tip into a log nobody opens.
 */
export function shouldDeferCompletionTip(command: Command, stderrIsTty: boolean): boolean {
  return isJsonRun(command) || isCompletionRun(getCommandPath(command)) || !stderrIsTty;
}

program
  .name('openspec')
  .description('面向 AI 的 code-spec 需求与变更管理工具')
  .version(version);

// Global options
program.option('--no-color', '禁用彩色输出');

// Apply global flags and telemetry before any command runs
// Note: preAction receives (thisCommand, actionCommand) where:
// - thisCommand: the command where hook was added (root program)
// - actionCommand: the command actually being executed (subcommand)
program.hook('preAction', async (thisCommand, actionCommand) => {
  const opts = thisCommand.opts();
  if (opts.color === false) {
    process.env.NO_COLOR = '1';
  }

  // Show first-run telemetry notice (if not seen). It's written to stderr, so it
  // never pollutes stdout — but --json runs still defer it (see isJsonRun) so the
  // very first invocation stays free of any incidental output on either stream.
  await maybeShowTelemetryNotice({ silent: isJsonRun(actionCommand) });

  // Track command execution (use actionCommand to get the actual subcommand)
  const commandPath = getCommandPath(actionCommand);

  await trackCommand(commandPath, version);
});

// Shutdown telemetry after command completes
program.hook('postAction', async (_thisCommand, actionCommand) => {
  // Show the first-run shell-completions tip (on stderr, so piped stdout stays
  // clean). postAction, not preAction: the tip trails the command's own output
  // instead of pushing an error message or `init`'s setup summary down the
  // screen. Deferred — not consumed — whenever nobody would read it: JSON runs,
  // `openspec completion ...`, and a stderr that is not a terminal (agents and
  // pipes would otherwise silently burn the user's one-shot tip).
  try {
    await maybeShowCompletionTip({
      silent: shouldDeferCompletionTip(actionCommand, Boolean(process.stderr.isTTY)),
    });
  } finally {
    // The flush runs even if the hint throws: parse() is synchronous, so a
    // rejection here has no catch anywhere above it.
    await shutdown();
  }
});

const availableToolIds = AI_TOOLS
  .filter((tool) => tool.skillsDir || tool.globalSkillsDir)
  .map((tool) => tool.value);
const toolAliasNote = Object.entries(TOOL_ID_ALIASES)
  .map(([retired, current]) => `${retired} (now ${current})`)
  .join(', ');
const toolsOptionDescription = `非交互式配置 AI 工具。可使用 "all"、"none"，或逗号分隔的工具 ID：${availableToolIds.join(', ')}。也接受：${toolAliasNote}`;

program
  .command('init [path]')
  .description('在项目中初始化 OpenSpec')
  .option('--tools <tools>', toolsOptionDescription)
  .option('--language <language>', '使用指定语言编写新的 OpenSpec 产物')
  .option('--schema <code-spec|spec-driven>', '选择工作流 schema（默认：code-spec）', DEFAULT_SCHEMA)
  .option('--force', '无需提示，自动清理旧文件')
  .option('--profile <profile>', '覆盖全局工作流配置（core 或 custom）')
  .option('--no-animation', '使用静态欢迎界面而不是动画')
  .option('--copilot-cloud', '无需提示，设置 GitHub Copilot 云端编码代理文件')
  .option('--no-copilot-cloud', '无需提示，跳过 GitHub Copilot 云端编码代理文件')
  .action(async (targetPath = '.', options?: { tools?: string; language?: string; schema?: 'code-spec' | 'spec-driven'; force?: boolean; profile?: string; animation?: boolean; copilotCloud?: boolean }) => {
    try {
      // Validate that the path is a valid directory
      const resolvedPath = path.resolve(targetPath);

      try {
        const stats = await fs.stat(resolvedPath);
        if (!stats.isDirectory()) {
          throw new Error(`路径 "${targetPath}" 不是目录`);
        }
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          // Directory doesn't exist, but we can create it
          console.log(`目录 "${targetPath}" 不存在，将自动创建。`);
        } else if (error.message && error.message.includes('not a directory')) {
          throw error;
        } else {
          throw new Error(`无法访问路径 "${targetPath}"：${error.message}`);
        }
      }

      const { InitCommand } = await import('../core/init.js');
      const initCommand = new InitCommand({
        tools: options?.tools,
        language: options?.language,
        schema: options?.schema,
        force: options?.force,
        profile: options?.profile,
        animation: options?.animation,
        copilotCloud: options?.copilotCloud,
      });
      await initCommand.execute(targetPath);
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

// Hidden alias: 'experimental' -> 'init' for backwards compatibility
program
  .command('experimental', { hidden: true })
  .description('init 的别名（已弃用）')
  .option('--tool <tool-id>', '目标 AI 工具（映射到 --tools）')
  .option('--no-interactive', '禁用交互式提示')
  .action(async (options?: { tool?: string; noInteractive?: boolean }) => {
    try {
      console.log('提示："openspec experimental" 已弃用，请改用 "openspec init"。');
      const { InitCommand } = await import('../core/init.js');
      const initCommand = new InitCommand({
        tools: options?.tool,
        interactive: options?.noInteractive === true ? false : undefined,
      });
      await initCommand.execute('.');
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

program
  .command('update [path]')
  .description('更新 OpenSpec 指导文件')
  .option('--force', '即使工具已是最新也强制更新')
  .action(async (targetPath = '.', options?: { force?: boolean }) => {
    try {
      const installDir = getInstallDir();
      // Running from a clone: the version is whatever the branch says, so any
      // upgrade advice would be noise. Decided before the request, so a
      // contributor never waits on an answer that gets thrown away.
      const latestVersion = isSourceCheckout(installDir) ? null : await getAvailableCliUpdate();
      const announce = latestVersion !== null;
      // Offer to upgrade first: this process generates files from its own
      // templates, so upgrading afterwards would leave the old ones on disk.
      // Both streams must be a terminal — with stdout redirected the question
      // lands in the file and the user waits at a blank screen forever.
      const canOffer =
        announce &&
        shouldOfferUpgrade({
          installDir,
          projectPath: targetPath,
          interactive: isInteractive(),
          stdoutIsTty: Boolean(process.stdout.isTTY),
        });

      let declined = false;
      if (latestVersion && canOffer) {
        displayCliUpdateNote(latestVersion, targetPath, { withCommand: false });
        const outcome = await offerCliUpgrade(latestVersion);

        // Set the code and return rather than process.exit: exiting here would
        // skip commander's postAction hook, killing the telemetry flush
        // mid-request.
        if (outcome === 'cancelled') {
          // Ctrl-C means stop the command, not fall through to more prompts.
          process.exitCode = 130;
          return;
        }
        if (outcome === 'upgraded') {
          process.exitCode = await rerunUpdateWithUpgradedCli(targetPath, {
            force: options?.force,
          });
          return;
        }
        // Declined, failed, or upgraded-but-unreachable: fall through to the
        // update, then leave the command on screen underneath it.
        declined = true;
      }

      const updateCommand = new UpdateCommand({ force: options?.force });
      await updateCommand.execute(targetPath);

      if (declined) {
        // The headline was printed before the prompt; only the manual route is
        // still owed, and it belongs where the user is looking now.
        displayUpgradeCommand(targetPath);
      } else if (latestVersion) {
        displayCliUpdateNote(latestVersion, targetPath);
      }
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('列出项目条目（默认列出 Change）；使用 --specs 列出 Spec。')
  .option('--specs', '列出 Spec，而不是 Change')
  .option('--changes', '明确列出 Change（默认）')
  .option('--sort <order>', '排序方式："recent"（默认）或 "name"', 'recent')
  .option('--json', '以 JSON 输出（供程序使用）')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (options?: { specs?: boolean; changes?: boolean; sort?: string; json?: boolean; store?: string; storePath?: string }) => {
    try {
      const root = await resolveRootForCommand(options ?? {}, {
        json: options?.json,
        failurePayload: options?.specs ? { specs: [], root: null } : { changes: [], root: null },
        // Preserve the cwd fallback for pre-config.yaml projects. The resolver
        // still lets a registered/default store take precedence over it.
        allowImplicitRoot: existsSync(path.join(process.cwd(), 'openspec', 'project.md')),
      });
      if (!root) {
        return;
      }
      const listCommand = new ListCommand();
      const mode: 'changes' | 'specs' = options?.specs ? 'specs' : 'changes';
      const sort = options?.sort === 'name' ? 'name' : 'recent';
      const canonicalWorkspace = mode === 'changes' ? await tryLoadCanonicalWorkspace(root.path) : null;
      if (canonicalWorkspace) {
        const changes = canonicalWorkspace.index.entries
          .filter((entry) => ['ANALYZE', 'DESIGN', 'PLAN', 'IMPLEMENT', 'VERIFY', 'ARCHIVE'].includes(entry.status))
          .sort((a, b) => sort === 'name' ? a.id.localeCompare(b.id) : b.updated_at.localeCompare(a.updated_at))
          .map((entry) => ({ name: entry.id, completedTasks: 0, totalTasks: 0, lastModified: entry.updated_at, status: entry.status }));
        if (options?.json) console.log(JSON.stringify({ changes, root: toRootOutput(root) }, null, 2));
        else if (!changes.length) console.log('未找到活动 Change。');
        else { console.log('Change：'); for (const change of changes) console.log(`  ${change.name}     ${change.status}`); }
        return;
      }
      await listCommand.execute(root.path, mode, {
        sort,
        json: options?.json,
        ...(options?.json ? { root: toRootOutput(root) } : {}),
      });
    } catch (error) {
      failWithError(error, {
        enabled: options?.json,
        payload: options?.specs ? { specs: [], root: null } : { changes: [], root: null },
        fallbackCode: 'list_error',
      });
      process.exit(1);
    }
  });

program
  .command('view')
  .description('显示 Spec 和 Change 的交互式面板')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (options?: { store?: string; storePath?: string }) => {
    try {
      // Implicit cwd fallback stays enabled so `view` keeps accepting the same
      // directories as `list`/`status` — notably pre-config.yaml `openspec/`
      // dirs. ViewCommand still reports a missing openspec/ directory itself.
      const root = await resolveRootForCommand(options ?? {});
      if (!root) {
        return;
      }
      const viewCommand = new ViewCommand();
      await viewCommand.execute(root.path);
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

// Change command with subcommands
const changeCmd = program
  .command('change')
  .description('管理 OpenSpec Change 提案');

// Deprecation notice for noun-based commands
changeCmd.hook('preAction', () => {
  console.error('警告："openspec change ..." 命令已弃用，建议使用动词优先的命令（例如 "openspec list"、"openspec validate --changes"）。');
});

changeCmd
  .command('new <name>')
  .description('创建 Change（"openspec new change" 的弃用别名）')
  .option('--description <text>', '要写入 README.md 的描述')
  .option('--goal <text>', '随 Change 保存的可选目标元数据')
  .option('--schema <name>', `使用的工作流 Schema（默认：${DEFAULT_SCHEMA}）`)
  .option('--json', '以 JSON 输出')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .addOption(new Option('--initiative <id>', '不再支持').hideHelp())
  .addOption(new Option('--areas <names>', '不再支持').hideHelp())
  .action(async (name: string, options: NewChangeOptions) => {
    try {
      await newChangeCommand(name, options);
    } catch (error) {
      failWithError(error, { enabled: options.json, fallbackCode: 'change_error' });
      process.exit(1);
    }
  });

changeCmd
  .command('show [change-name]')
  .description('以 JSON 或 Markdown 格式显示 Change 提案')
  .option('--json', '以 JSON 输出')
  .option('--deltas-only', '仅显示增量（仅 JSON）')
  .option('--requirements-only', '--deltas-only 的弃用别名')
  .option('--diff', '显示增量 Spec 的逐条 Requirement 差异')
  .option('--no-interactive', '禁用交互式提示')
  .action(async (changeName?: string, options?: { json?: boolean; requirementsOnly?: boolean; deltasOnly?: boolean; diff?: boolean; noInteractive?: boolean }) => {
    try {
      const changeCommand = new ChangeCommand();
      await changeCommand.show(changeName, options);
    } catch (error) {
      console.error(`错误：${(error as Error).message}`);
      process.exitCode = 1;
    }
  });

changeCmd
  .command('list')
  .description('列出全部活动 Change（已弃用：请改用 "openspec list"）')
  .option('--json', '以 JSON 输出')
  .option('--long', '显示 ID、标题和数量')
  .action(async (options?: { json?: boolean; long?: boolean }) => {
    try {
      console.error('警告："openspec change list" 已弃用，请改用 "openspec list"。');
      const changeCommand = new ChangeCommand();
      await changeCommand.list(options);
    } catch (error) {
      console.error(`错误：${(error as Error).message}`);
      process.exitCode = 1;
    }
  });

changeCmd
  .command('validate [change-name]')
  .description('校验 Change 提案')
  .option('--strict', '启用严格校验模式')
  .option('--json', '以 JSON 输出校验报告')
  .option('--no-interactive', '禁用交互式提示')
  .action(async (changeName?: string, options?: { strict?: boolean; json?: boolean; noInteractive?: boolean }) => {
    try {
      const changeCommand = new ChangeCommand();
      // validate() already sets process.exitCode, and Node honours it at
      // natural exit. Calling process.exit() here would skip commander's
      // postAction hook — the same trap called out for `update` below — which
      // kills the telemetry flush and the first-run completions tip on what is
      // a routine outcome, not an error: a change that fails validation.
      await changeCommand.validate(changeName, options);
    } catch (error) {
      console.error(`错误：${(error as Error).message}`);
      process.exitCode = 1;
    }
  });

program
  .command('archive [change-name]')
  .description('归档已完成的 Change 并更新主 Spec')
  .option('-y, --yes', '跳过确认提示')
  .option('--skip-specs', '跳过 Spec 更新（适用于基础设施、工具或仅文档变更）')
  .option('--no-validate', '跳过校验（不建议，且需要确认）')
  .option('--json', '以 JSON 输出（非交互模式）')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (changeName?: string, options?: ArchiveOptions) => {
    try {
      if (changeName && !/^CHG-\d{8}-\d{3}$/u.test(changeName)) {
        const root = await resolveRootForCommand(options ?? {}, { json: Boolean(options?.json) });
        if (!root) return;
        if (await tryLoadCanonicalWorkspace(root.path)) throw new Error(`canonical code-spec 归档要求 Change ID 符合 CHG-YYYYMMDD-NNN；不支持 '${changeName}'。`);
      }
      if (changeName?.startsWith('CHG-')) {
        const root = await resolveRootForCommand(options ?? {}, { json: Boolean(options?.json) });
        if (!root) return;
        const workspace = await loadWorkspace(path.join(root.path, 'openspec'));
        const result = await archiveChange(workspace, changeName);
        if (options?.json) console.log(JSON.stringify(result));
        else console.log(`已归档 ${result.changeId}`);
        return;
      }
      const archiveCommand = new ArchiveCommand();
      await archiveCommand.execute(changeName, options);
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

program
  .command('allocate-requirements')
  .description('以原子方式预留下一组 canonical Requirement ID')
  .requiredOption('--module <id>', 'Business Module ID，例如 MOD-001')
  .requiredOption('--count <n>', '要预留的 Requirement ID 数量')
  .option('--change <id>', '接收预留 ID 的活动 Change')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (options: { module: `MOD-${string}`; count: string; change?: `CHG-${string}-${string}`; store?: string; storePath?: string }) => {
    try {
      const root = await resolveRootForCommand(options, { json: true });
      if (!root) return;
      const workspace = await loadWorkspace(path.join(root.path, 'openspec'));
      const ids = options.change
        ? await allocateRequirementIds(workspace, options.change, options.module, Number(options.count))
        : await allocateRequirementIds(workspace, options.module, Number(options.count));
      console.log(JSON.stringify({ module: options.module, changeId: options.change ?? null, requirementIds: ids }, null, 2));
    } catch (error) {
      failWithError(error, { enabled: true, fallbackCode: 'allocation_error' });
      process.exit(1);
    }
  });

registerSpecCommand(program);
registerConfigCommand(program);
registerSchemaCommand(program);
registerStoreCommand(program);
registerDoctorCommand(program);
registerContextCommand(program);
registerWorksetCommand(program);

// Top-level validate command
program
  .command('validate [item-name]')
  .description('校验 Change 和 Spec')
  .option('--all', '校验全部 Change 和 Spec')
  .option('--changes', '校验全部 Change')
  .option('--specs', '校验全部 Spec')
  .option('--archived', '校验已归档 Change 的任务是否全部完成（用于提交前 lint）')
  .option('--type <type>', '条目类型不明确时指定：change|spec')
  .option('--strict', '启用严格校验模式')
  .option('--json', '以 JSON 输出校验结果')
  .option('--concurrency <n>', '最大并发校验数（默认读取 OPENSPEC_CONCURRENCY，或使用 6）')
  .option('--no-interactive', '禁用交互式提示')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (itemName?: string, options?: { all?: boolean; changes?: boolean; specs?: boolean; archived?: boolean; type?: string; strict?: boolean; json?: boolean; noInteractive?: boolean; concurrency?: string; store?: string; storePath?: string }) => {
    try {
      const validateCommand = new ValidateCommand();
      await validateCommand.execute(itemName, options);
    } catch (error) {
      failWithError(error, { enabled: options?.json, fallbackCode: 'validate_error' });
      process.exit(1);
    }
  });

// Top-level show command
program
  .command('show [item-name]')
  .description('显示 Change 或 Spec')
  .option('--json', '以 JSON 输出')
  .option('--type <type>', '条目类型不明确时指定：change|spec')
  .option('--no-interactive', '禁用交互式提示')
  // change-only flags
  .option('--deltas-only', '仅显示增量（仅 JSON，change）')
  .option('--requirements-only', '--deltas-only 的弃用别名（change）')
  .option('--diff', '显示增量 Spec 的逐条 Requirement 差异（change）')
  // spec-only flags
  .option('--requirements', '仅 JSON：只显示 Requirement（排除场景）')
  .option('--no-scenarios', '仅 JSON：排除场景内容')
  .option('-r, --requirement <id>', '仅 JSON：按 ID 显示指定 Requirement（从 1 开始）')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  // Explicit registration required: allowUnknownOption would otherwise
  // silently swallow --store-path instead of rejecting it deliberately.
  .addOption(hiddenStorePathOption())
  // allow unknown options to pass-through to underlying command implementation
  .allowUnknownOption(true)
  .action(async (itemName?: string, options?: { json?: boolean; type?: string; noInteractive?: boolean; [k: string]: any }) => {
    try {
      const showCommand = new ShowCommand();
      await showCommand.execute(itemName, options ?? {});
    } catch (error) {
      failWithError(error, { enabled: options?.json, fallbackCode: 'show_error' });
      process.exit(1);
    }
  });

// Feedback command
program
  .command('feedback <message>')
  .description('提交 OpenSpec 反馈')
  .option('--body <text>', '反馈的详细说明')
  .action(async (message: string, options?: { body?: string }) => {
    try {
      const feedbackCommand = new FeedbackCommand();
      await feedbackCommand.execute(message, options);
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

// Completion command with subcommands
const completionCmd = program
  .command('completion')
  .description('管理 OpenSpec CLI 的 Shell 补全');

completionCmd
  .command('generate [shell]')
  .description('生成 Shell 补全脚本（输出到 stdout）')
  .action(async (shell?: string) => {
    try {
      const completionCommand = new CompletionCommand();
      await completionCommand.generate({ shell });
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

completionCmd
  .command('install [shell]')
  .description('安装 Shell 补全脚本')
  .option('--verbose', '显示详细安装输出')
  .action(async (shell?: string, options?: { verbose?: boolean }) => {
    try {
      const completionCommand = new CompletionCommand();
      await completionCommand.install({ shell, verbose: options?.verbose });
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

completionCmd
  .command('uninstall [shell]')
  .description('卸载 Shell 补全脚本')
  .option('-y, --yes', '跳过确认提示')
  .action(async (shell?: string, options?: { yes?: boolean }) => {
    try {
      const completionCommand = new CompletionCommand();
      await completionCommand.uninstall({ shell, yes: options?.yes });
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

// Hidden command for machine-readable completion data
program
  .command('__complete <type>', { hidden: true })
  .description('以机器可读格式输出补全数据（内部使用）')
  .action(async (type: string) => {
    try {
      const completionCommand = new CompletionCommand();
      await completionCommand.complete({ type });
    } catch (error) {
      // Silently fail for graceful shell completion experience
      process.exitCode = 1;
    }
  });

// ═══════════════════════════════════════════════════════════
// Workflow Commands (formerly experimental)
// ═══════════════════════════════════════════════════════════

program
  .command('rebase')
  .description('对过期的 canonical Change 执行语义 rebase')
  .requiredOption('--change <id>', 'Canonical Change ID')
  .option('--current-spec <path>', '当前 Spec 路径', (value, previous: string[] = []) => [...previous, value], [])
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (options: { change: string; currentSpec: string[]; store?: string; storePath?: string }) => {
    try {
      const root = await resolveRootForCommand(options, { json: true });
      if (!root) return;
      const workspace = await loadWorkspace(path.join(root.path, 'openspec'));
      const result = await rebaseChange(workspace, options.change, options.currentSpec);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      failWithError(error, { enabled: true, fallbackCode: 'rebase_error' });
      process.exit(1);
    }
  });

program
  .command('transition')
  .description('在状态门禁校验后持久化 canonical Change 生命周期转换')
  .requiredOption('--change <id>', 'Canonical Change ID')
  .requiredOption('--to <state>', '目标生命周期状态')
  .requiredOption('--reason <text>', '人类可读的转换原因')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (options: { change: string; to: string; reason: string; store?: string; storePath?: string }) => {
    try {
      const root = await resolveRootForCommand(options, { json: true });
      if (!root) return;
      const workspace = await loadWorkspace(path.join(root.path, 'openspec'));
      const artifacts = await loadChangeArtifacts(workspace.paths, options.change);
      const result = await transitionChange(workspace, artifacts, options.to as ChangeStatus, options.reason);
      console.log(JSON.stringify({ changeId: options.change, status: result.change.status, revision: result.change.revision }, null, 2));
    } catch (error) {
      failWithError(error, { enabled: true, fallbackCode: 'transition_error' });
      process.exit(1);
    }
  });

program
  .command('abandon')
  .description('通过生命周期门禁放弃 canonical Change')
  .requiredOption('--change <id>', 'Canonical Change ID')
  .option('--reason <text>', '放弃 Change 的原因', '用户请求放弃')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (options: { change: string; reason: string; store?: string; storePath?: string }) => {
    try {
      const root = await resolveRootForCommand(options, { json: true });
      if (!root) return;
      const workspace = await loadWorkspace(path.join(root.path, 'openspec'));
      const artifacts = await loadChangeArtifacts(workspace.paths, options.change);
      const result = await transitionChange(workspace, artifacts, 'ABANDONED', options.reason);
      console.log(JSON.stringify({ changeId: options.change, status: result.change.status }, null, 2));
    } catch (error) {
      failWithError(error, { enabled: true, fallbackCode: 'abandon_error' });
      process.exit(1);
    }
  });

program
  .command('detect-stale')
  .description('检测与已归档 Requirement 重叠的活动 Change')
  .option('--requirements <ids>', '逗号分隔的已归档 Requirement ID；默认使用全部已归档 Change')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (options: { requirements?: string; store?: string; storePath?: string }) => {
    try {
      const root = await resolveRootForCommand(options, { json: true });
      if (!root) return;
      const workspace = await loadWorkspace(path.join(root.path, 'openspec'));
      let ids = options.requirements?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
      if (!ids.length) {
        const entries = await fs.readdir(workspace.paths.archivedChanges, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          if (!entry.isDirectory() || !/^CHG-\d{8}-\d{3}$/.test(entry.name)) continue;
          const raw = await fs.readFile(path.join(workspace.paths.archivedChanges, entry.name, 'metadata.yaml'), 'utf8').catch(() => '');
          try {
            const metadata = parseYaml(raw) as any;
            ids.push(...Object.values(metadata?.requirements ?? {}).flat().map((item: any) => item.id).filter(Boolean));
          } catch { /* malformed archive is reported by archive validation */ }
        }
      }
      const stale = await detectStaleChanges(workspace, [...new Set(ids)]);
      console.log(JSON.stringify({ stale }, null, 2));
    } catch (error) {
      failWithError(error, { enabled: true, fallbackCode: 'stale_error' });
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description('显示 Change 的产物完成状态')
  .option('--change <id>', '要显示状态的 Change 名称')
  .option('--all', '显示全部活动 Change 的状态')
  .option('--schema <name>', 'Schema 覆盖值（自动从 config.yaml 检测）')
  .option('--json', '以 JSON 输出')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (options: StatusOptions) => {
    try {
      await statusCommand(options);
    } catch (error) {
      failWithError(error, {
        enabled: options.json,
        // The batch null-shape; the single-change failure shape is
        // pre-existing contract and stays payload-free.
        payload: options.all ? BATCH_STATUS_FAILURE_PAYLOAD : undefined,
        fallbackCode: 'change_error',
      });
      process.exit(1);
    }
  });

// Instructions command
program
  .command('instructions [artifact]')
  .description('输出产物、apply 或 archive 的增强指导')
  .option('--change <id>', 'Change 名称')
  .option('--schema <name>', 'Schema 覆盖值（自动从 config.yaml 检测）')
  .option('--json', '以 JSON 输出')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (artifactId: string | undefined, options: InstructionsOptions) => {
    try {
      // Workflow instruction surfaces are reserved command branches, not artifacts.
      if (artifactId === 'apply') {
        await applyInstructionsCommand(options);
      } else if (artifactId === 'archive') {
        await archiveInstructionsCommand(options);
      } else {
        await instructionsCommand(artifactId, options);
      }
    } catch (error) {
      failWithError(error, { enabled: options.json, fallbackCode: 'change_error' });
      process.exit(1);
    }
  });

// Templates command
program
  .command('templates')
  .description('显示 Schema 中所有产物解析后的模板路径')
  .option('--schema <name>', `使用的 Schema（默认：${DEFAULT_SCHEMA}）`)
  .option('--json', '以 JSON 映射输出产物 ID 和模板路径')
  .action(async (options: TemplatesOptions) => {
    try {
      await templatesCommand(options);
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

// Schemas command
program
  .command('schemas')
  .description('列出可用工作流 Schema 及其说明')
  .option('--json', '以 JSON 输出（供 Agent 使用）')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (options: SchemasOptions) => {
    try {
      await schemasCommand(options);
    } catch (error) {
      failWithError(error, {
        enabled: options.json,
        payload: { schemas: [], root: null },
        fallbackCode: 'schemas_error',
      });
      process.exit(1);
    }
  });

// New command group with change subcommand
const newCmd = program.command('new').description('创建新条目');

newCmd
  .command('change <name>')
  .description('创建新的 Change 目录')
  .option('--description <text>', '写入 README.md 的说明')
  .option('--goal <text>', '要写入 Change 的可选目标元数据')
  .option('--schema <name>', `使用的工作流 Schema（默认：${DEFAULT_SCHEMA}）`)
  .option('--json', '以 JSON 输出')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  // Removed options kept registered (hidden) so users get a deliberate
  // explanation instead of a generic unknown-option error.
  .addOption(new Option('--initiative <id>', '不再支持').hideHelp())
  .addOption(new Option('--areas <names>', '不再支持').hideHelp())
  .action(async (name: string, options: NewChangeOptions) => {
    try {
      await newChangeCommand(name, options);
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

export { program };

export function runCli(argv = process.argv): void {
  program.parse(argv);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
