import { Command } from 'commander';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  getGlobalConfigPath,
  getGlobalConfig,
  saveGlobalConfig,
  GlobalConfig,
} from '../core/global-config.js';
import type { Profile, Delivery } from '../core/global-config.js';
import {
  getNestedValue,
  setNestedValue,
  deleteNestedValue,
  coerceValue,
  formatValueYaml,
  validateConfigKeyPath,
  hasUnsafeKeySegment,
  validateConfig,
  DEFAULT_CONFIG,
} from '../core/config-schema.js';
import { CORE_WORKFLOWS, ALL_WORKFLOWS, getProfileWorkflows } from '../core/profiles.js';
import { OPENSPEC_DIR_NAME } from '../core/config.js';
import { hasProjectConfigDrift } from '../core/profile-sync-drift.js';
import { UpdateCommand } from '../core/update.js';
import { asErrorMessage, isPromptCancellationError } from './shared-output.js';

type ProfileAction = 'both' | 'delivery' | 'workflows' | 'keep';

interface ProfileState {
  profile: Profile;
  delivery: Delivery;
  workflows: string[];
}

interface ProfileStateDiff {
  hasChanges: boolean;
  lines: string[];
}

interface WorkflowPromptMeta {
  name: string;
  description: string;
}

export const WORKFLOW_PROMPT_META: Record<string, WorkflowPromptMeta> = {
  propose: {
    name: '提出 Change',
    description: '根据需求创建 proposal、design 和 tasks',
  },
  explore: {
    name: '探索想法',
    description: '在实现前调查问题',
  },
  new: {
    name: '新建 Change',
    description: '快速创建新的 Change 骨架',
  },
  continue: {
    name: '继续 Change',
    description: '继续已有 Change',
  },
  apply: {
    name: '执行任务',
    description: '实现当前 Change 中的任务',
  },
  update: {
    name: '更新 Change',
    description: '修订已有 Change 的规划产物',
  },
  ff: {
    name: '快速推进',
    description: '运行更快的实现工作流',
  },
  sync: {
    name: '同步 Spec',
    description: '将 Change 产物同步到 Spec',
  },
  archive: {
    name: '归档 Change',
    description: '完成并归档 Change',
  },
  'bulk-archive': {
    name: '批量归档',
    description: '一次归档多个已完成的 Change',
  },
  verify: {
    name: '验证 Change',
    description: '对 Change 执行验证检查',
  },
  onboard: {
    name: '入门引导',
    description: 'OpenSpec 入门引导流程',
  },
};


/**
 * Resolve the effective current profile state from global config defaults.
 */
export function resolveCurrentProfileState(config: GlobalConfig): ProfileState {
  const profile = config.profile || 'core';
  const delivery = config.delivery || 'both';
  const workflows = [
    ...getProfileWorkflows(profile, config.workflows ? [...config.workflows] : undefined),
  ];
  return { profile, delivery, workflows };
}

/**
 * Derive profile type from selected workflows.
 */
export function deriveProfileFromWorkflowSelection(selectedWorkflows: string[]): Profile {
  const isCoreMatch =
    selectedWorkflows.length === CORE_WORKFLOWS.length &&
    CORE_WORKFLOWS.every((w) => selectedWorkflows.includes(w));
  return isCoreMatch ? 'core' : 'custom';
}

/**
 * Format a compact workflow summary for the profile header.
 */
export function formatWorkflowSummary(workflows: readonly string[], profile: Profile): string {
  return `已选择 ${workflows.length} 项（${profile}）`;
}

function stableWorkflowOrder(workflows: readonly string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const workflow of ALL_WORKFLOWS) {
    if (workflows.includes(workflow) && !seen.has(workflow)) {
      ordered.push(workflow);
      seen.add(workflow);
    }
  }

  const extras = workflows.filter((w) => !ALL_WORKFLOWS.includes(w as (typeof ALL_WORKFLOWS)[number]));
  extras.sort();
  for (const extra of extras) {
    if (!seen.has(extra)) {
      ordered.push(extra);
      seen.add(extra);
    }
  }

  return ordered;
}

/**
 * Build a user-facing diff summary between two profile states.
 */
export function diffProfileState(before: ProfileState, after: ProfileState): ProfileStateDiff {
  const lines: string[] = [];

  if (before.delivery !== after.delivery) {
    lines.push(`delivery：${before.delivery} -> ${after.delivery}`);
  }

  if (before.profile !== after.profile) {
    lines.push(`profile：${before.profile} -> ${after.profile}`);
  }

  const beforeOrdered = stableWorkflowOrder(before.workflows);
  const afterOrdered = stableWorkflowOrder(after.workflows);
  const beforeSet = new Set(beforeOrdered);
  const afterSet = new Set(afterOrdered);

  const added = afterOrdered.filter((w) => !beforeSet.has(w));
  const removed = beforeOrdered.filter((w) => !afterSet.has(w));

  if (added.length > 0 || removed.length > 0) {
    const tokens: string[] = [];
    if (added.length > 0) {
      tokens.push(`新增 ${added.join('、')}`);
    }
    if (removed.length > 0) {
      tokens.push(`移除 ${removed.join('、')}`);
    }
    lines.push(`workflows：${tokens.join('；')}`);
  }

  return {
    hasChanges: lines.length > 0,
    lines,
  };
}

function maybeWarnProjectConfigDrift(
  projectDir: string,
  state: ProfileState,
  colorize: (message: string) => string
): void {
  const openspecDir = path.join(projectDir, OPENSPEC_DIR_NAME);
  if (!fs.existsSync(openspecDir)) {
    return;
  }
  if (!hasProjectConfigDrift(projectDir, state.workflows, state.delivery)) {
    return;
  }
  console.log(colorize('警告：全局配置尚未应用到此项目。请运行 `openspec update` 同步。'));
}

function printConfigProfileApplyGuidance(): void {
  console.log('配置已更新。请在项目中运行 `openspec update` 应用配置。');
}

/**
 * Register the config command and all its subcommands.
 *
 * @param program - The Commander program instance
 */
export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command('config')
    .description('查看和修改全局 OpenSpec 配置')
    .option('--scope <scope>', '配置范围（当前仅支持 "global"）')
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.opts();
      if (opts.scope && opts.scope !== 'global') {
        console.error('错误：项目级配置尚未实现。');
        process.exit(1);
      }
    });

  // config path
  configCmd
    .command('path')
    .description('显示配置文件位置')
    .action(() => {
      console.log(getGlobalConfigPath());
    });

  // config list
  configCmd
    .command('list')
    .description('显示当前全部设置')
    .option('--json', '以 JSON 输出')
    .action((options: { json?: boolean }) => {
      const config = getGlobalConfig();

      if (options.json) {
        console.log(JSON.stringify(config, null, 2));
      } else {
        // Read raw config to determine which values are explicit vs defaults
        const configPath = getGlobalConfigPath();
        let rawConfig: Record<string, unknown> = {};
        try {
          if (fs.existsSync(configPath)) {
            rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          }
        } catch {
          // If reading fails, treat all as defaults
        }

        console.log(formatValueYaml(config));

        // Annotate profile settings
        const profileSource = rawConfig.profile !== undefined ? '（显式）' : '（默认）';
        const deliverySource = rawConfig.delivery !== undefined ? '（显式）' : '（默认）';
        console.log(`\nProfile 设置：`);
        console.log(`  profile：${config.profile} ${profileSource}`);
        console.log(`  delivery：${config.delivery} ${deliverySource}`);
        if (config.profile === 'core') {
          console.log(`  workflows：${CORE_WORKFLOWS.join('、')}（来自 core profile）`);
        } else if (config.workflows && config.workflows.length > 0) {
          console.log(`  workflows：${config.workflows.join('、')}（显式）`);
        } else {
          console.log('  workflows：（无）');
        }
      }
    });

  // config get
  configCmd
    .command('get <key>')
    .description('获取指定配置值（原始值，适合脚本使用）')
    .action((key: string) => {
      const config = getGlobalConfig();
      const value = getNestedValue(config as Record<string, unknown>, key);

      if (value === undefined) {
        process.exitCode = 1;
        return;
      }

      if (typeof value === 'object' && value !== null) {
        console.log(JSON.stringify(value));
      } else {
        console.log(String(value));
      }
    });

  // config set
  configCmd
    .command('set <key> <value>')
    .description('设置配置值（自动转换类型）')
    .option('--string', '强制以字符串保存')
    .option('--allow-unknown', '允许设置未知配置键')
    .action((key: string, value: string, options: { string?: boolean; allowUnknown?: boolean }) => {
      const allowUnknown = Boolean(options.allowUnknown);
      const keyValidation = validateConfigKeyPath(key);
      // --allow-unknown relaxes the known-key check, but never the prototype-safety check.
      const unsafeKey = hasUnsafeKeySegment(key);
      if (!keyValidation.valid && (!allowUnknown || unsafeKey)) {
        const reason = keyValidation.reason ? ` ${keyValidation.reason}.` : '';
        console.error(`错误：配置键 "${key}" 无效。${reason}`);
        console.error('使用 "openspec config list" 查看可用配置键。');
        if (!allowUnknown && !unsafeKey) {
          console.error('可传入 --allow-unknown 跳过此检查。');
        }
        process.exitCode = 1;
        return;
      }

      const config = getGlobalConfig() as Record<string, unknown>;
      const coercedValue = coerceValue(value, options.string || false);

      // Create a copy to validate before saving
      const newConfig = JSON.parse(JSON.stringify(config));
      setNestedValue(newConfig, key, coercedValue);

      // Validate the new config
      const validation = validateConfig(newConfig);
      if (!validation.success) {
        console.error(`错误：配置无效：${validation.error}`);
        process.exitCode = 1;
        return;
      }

      // Apply changes and save
      setNestedValue(config, key, coercedValue);
      saveGlobalConfig(config as GlobalConfig);

      const displayValue =
        typeof coercedValue === 'string' ? `"${coercedValue}"` : String(coercedValue);
      console.log(`已设置 ${key} = ${displayValue}`);
    });

  // config unset
  configCmd
    .command('unset <key>')
    .description('移除配置键（恢复默认值）')
    .action((key: string) => {
      const config = getGlobalConfig() as Record<string, unknown>;
      const existed = deleteNestedValue(config, key);

      if (existed) {
        saveGlobalConfig(config as GlobalConfig);
        console.log(`已取消设置 ${key}（已恢复默认值）`);
      } else {
        console.log(`配置键 "${key}" 未设置。`);
      }
    });

  // config reset
  configCmd
    .command('reset')
    .description('将配置重置为默认值')
    .option('--all', '重置全部配置（必需）')
    .option('-y, --yes', '跳过确认提示')
    .action(async (options: { all?: boolean; yes?: boolean }) => {
      if (!options.all) {
        console.error('错误：重置配置必须提供 --all。');
        console.error('用法：openspec config reset --all [-y]');
        process.exitCode = 1;
        return;
      }

      if (!options.yes) {
        const { confirm } = await import('@inquirer/prompts');
        let confirmed: boolean;
        try {
          confirmed = await confirm({
            message: '将全部配置重置为默认值？',
            default: false,
          });
        } catch (error) {
          if (isPromptCancellationError(error)) {
            console.log('已取消重置。');
            process.exitCode = 130;
            return;
          }
          throw error;
        }

        if (!confirmed) {
          console.log('已取消重置。');
          return;
        }
      }

      saveGlobalConfig({ ...DEFAULT_CONFIG });
      console.log('配置已重置为默认值。');
    });

  // config edit
  configCmd
    .command('edit')
    .description('使用 $EDITOR 打开配置')
    .action(async () => {
      const editor = process.env.EDITOR || process.env.VISUAL;

      if (!editor) {
        console.error('错误：未配置编辑器。');
        console.error('请设置 EDITOR 或 VISUAL 环境变量，指定偏好的编辑器。');
        console.error('示例：export EDITOR=vim');
        process.exitCode = 1;
        return;
      }

      const configPath = getGlobalConfigPath();

      // Ensure config file exists with defaults
      if (!fs.existsSync(configPath)) {
        saveGlobalConfig({ ...DEFAULT_CONFIG });
      }

      // Spawn editor and wait for it to close
      // Avoid shell parsing to correctly handle paths with spaces in both
      // the editor path and config path
      const child = spawn(editor, [configPath], {
        stdio: 'inherit',
        shell: false,
      });

      await new Promise<void>((resolve, reject) => {
        child.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`编辑器退出码为 ${code}`));
          }
        });
        child.on('error', reject);
      });

      try {
        const rawConfig = fs.readFileSync(configPath, 'utf-8');
        const parsedConfig = JSON.parse(rawConfig);
        const validation = validateConfig(parsedConfig);

        if (!validation.success) {
          console.error(`错误：配置无效：${validation.error}`);
          process.exitCode = 1;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          console.error(`错误：未找到配置文件：${configPath}`);
        } else if (error instanceof SyntaxError) {
          console.error(`错误：${configPath} 中的 JSON 无效。`);
          console.error(error.message);
        } else {
          console.error(`错误：无法校验配置：${error instanceof Error ? error.message : String(error)}`);
        }
        process.exitCode = 1;
      }
    });

  // config profile [preset]
  configCmd
    .command('profile [preset]')
    .description('配置工作流 Profile（交互式选择或预设快捷方式）')
    .action(async (preset?: string) => {
      // Preset shortcut: `openspec config profile core`
      if (preset === 'core') {
        const config = getGlobalConfig();
        config.profile = 'core';
        config.workflows = [...CORE_WORKFLOWS];
        // Preserve delivery setting
        saveGlobalConfig(config);
        printConfigProfileApplyGuidance();
        return;
      }

      if (preset) {
        console.error(`错误：未知的 Profile 预设 "${preset}"。可用预设：core`);
        process.exitCode = 1;
        return;
      }

      // Non-interactive check
      if (!process.stdout.isTTY) {
        console.error('此操作需要交互模式。请使用 `openspec config profile core`，或通过环境变量/选项设置配置。');
        process.exitCode = 1;
        return;
      }

      // Interactive picker
      const { select, checkbox, confirm } = await import('@inquirer/prompts');
      const chalk = (await import('chalk')).default;

      try {
        const config = getGlobalConfig();
        const currentState = resolveCurrentProfileState(config);

        console.log(chalk.bold('\n当前 Profile 设置'));
        console.log(`  Delivery：${currentState.delivery}`);
        console.log(`  Workflows：${formatWorkflowSummary(currentState.workflows, currentState.profile)}`);
        console.log(chalk.dim('  Delivery = 工作流安装位置（skills、commands 或两者）'));
        console.log(chalk.dim('  Workflows = 可用操作（propose、explore、apply 等）'));
        console.log();

        const action = await select<ProfileAction>({
          message: '要配置什么？',
          choices: [
            {
              value: 'both',
              name: 'Delivery 和 Workflows',
              description: '同时更新安装方式和可用操作',
            },
            {
              value: 'delivery',
              name: '仅 Delivery',
              description: '修改工作流安装位置',
            },
            {
              value: 'workflows',
              name: '仅 Workflows',
              description: '修改可用的工作流操作',
            },
            {
              value: 'keep',
              name: '保留当前设置（退出）',
              description: '保持配置不变并退出',
            },
          ],
        });

        if (action === 'keep') {
          console.log('配置没有变化。');
          maybeWarnProjectConfigDrift(process.cwd(), currentState, chalk.yellow);
          return;
        }

        const nextState: ProfileState = {
          profile: currentState.profile,
          delivery: currentState.delivery,
          workflows: [...currentState.workflows],
        };
        let workflowSelectionChanged = false;

        if (action === 'both' || action === 'delivery') {
          const deliveryChoices: { value: Delivery; name: string; description: string }[] = [
            {
              value: 'both' as Delivery,
              name: '两者（skills + commands）',
              description: '同时以 skills 和 slash commands 安装工作流',
            },
            {
              value: 'skills' as Delivery,
              name: '仅 skills',
              description: '仅以 skills 安装工作流',
            },
            {
              value: 'commands' as Delivery,
              name: '仅 commands',
              description: '仅以 slash commands 安装工作流',
            },
          ];
          for (const choice of deliveryChoices) {
            if (choice.value === currentState.delivery) {
              choice.name += ' [current]';
            }
          }

          nextState.delivery = await select<Delivery>({
            message: 'Delivery 模式（工作流安装方式）：',
            choices: deliveryChoices,
            default: currentState.delivery,
          });
        }

        if (action === 'both' || action === 'workflows') {
          const formatWorkflowChoice = (workflow: string) => {
            const metadata = WORKFLOW_PROMPT_META[workflow] ?? {
              name: workflow,
              description: `Workflow：${workflow}`,
            };
            return {
              value: workflow,
              name: metadata.name,
              description: metadata.description,
              short: metadata.name,
              checked: currentState.workflows.includes(workflow),
            };
          };

          const selectedWorkflows = await checkbox<string>({
            // The `instructions` option was removed in @inquirer/checkbox v5.
            // Its replacement, the built-in keys help tip, renders
            // "↑↓ navigate • space select • ⏎ submit" by default — a superset of
            // the hint this used to pass — so no theme override is needed here.
            message: '选择要启用的 Workflows：',
            pageSize: ALL_WORKFLOWS.length,
            theme: {
              icon: {
                checked: '[x]',
                unchecked: '[ ]',
              },
            },
            choices: ALL_WORKFLOWS.map(formatWorkflowChoice),
          });
          nextState.workflows = selectedWorkflows;
          workflowSelectionChanged =
            selectedWorkflows.length !== currentState.workflows.length ||
            selectedWorkflows.some((workflow) => !currentState.workflows.includes(workflow));
          nextState.profile = workflowSelectionChanged
            ? deriveProfileFromWorkflowSelection(selectedWorkflows)
            : currentState.profile;
        }

        const diff = diffProfileState(currentState, nextState);
        if (!diff.hasChanges) {
          console.log('配置没有变化。');
          maybeWarnProjectConfigDrift(process.cwd(), nextState, chalk.yellow);
          return;
        }

        console.log(chalk.bold('\n配置变更：'));
        for (const line of diff.lines) {
          console.log(`  ${line}`);
        }
        console.log();

        config.profile = nextState.profile;
        config.delivery = nextState.delivery;
        if (currentState.profile !== 'custom' || workflowSelectionChanged) {
          config.workflows = nextState.workflows;
        }
        saveGlobalConfig(config);

        // Check if inside an OpenSpec project
        const projectDir = process.cwd();
        const openspecDir = path.join(projectDir, OPENSPEC_DIR_NAME);
        if (fs.existsSync(openspecDir)) {
          const applyNow = await confirm({
            message: '立即将变更应用到此项目？',
            default: true,
          });

          if (applyNow) {
            try {
              await new UpdateCommand().execute(projectDir);
              console.log('请在其他项目中运行 `openspec update` 应用配置。');
            } catch (error) {
              console.error(`\`openspec update\` 失败：${asErrorMessage(error)}`);
              console.error('请手动运行该命令应用 Profile 变更。');
              process.exitCode = 1;
            }
            return;
          }
        }

        printConfigProfileApplyGuidance();
      } catch (error) {
        if (isPromptCancellationError(error)) {
          console.log('已取消 Profile 配置。');
          process.exitCode = 130;
          return;
        }
        throw error;
      }
    });
}
