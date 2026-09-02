import { isInteractive } from '../utils/interactive.js';
import { getActiveChangeIds, getSpecIds } from '../utils/item-discovery.js';
import {
  resolveRootForCommand,
  toRootOutput,
  withStoreFlag,
  type ResolvedOpenSpecRoot,
  type RootOutput,
  isStoreSelectedRoot,
} from '../core/root-selection.js';
import { ChangeCommand } from './change.js';
import { SpecCommand } from './spec.js';
import { nearestMatches } from '../utils/match.js';
import { tryLoadCanonicalWorkspace } from './workflow/shared.js';
import { loadChangeArtifacts } from '../core/openspec-workflow/loaders.js';
import { formatStatusLabel } from '../ui/user-facing-messages.js';

type ItemType = 'change' | 'spec';

const CHANGE_FLAG_KEYS = new Set(['deltasOnly', 'requirementsOnly', 'diff']);
const SPEC_FLAG_KEYS = new Set(['requirements', 'scenarios', 'requirement']);

interface ShowExecuteOptions {
  json?: boolean;
  type?: string;
  noInteractive?: boolean;
  store?: string;
  storePath?: string;
  [k: string]: any;
}

export class ShowCommand {
  async execute(itemName?: string, options: ShowExecuteOptions = {}): Promise<void> {
    const root = await resolveRootForCommand(options, { json: options.json });
    if (!root) {
      return;
    }

    const interactive = isInteractive(options);
    const typeOverride = this.normalizeType(options.type);
    const canonicalWorkspace = await tryLoadCanonicalWorkspace(root.path);
    if (canonicalWorkspace) {
      await this.showCanonical(itemName, options, root, canonicalWorkspace, interactive, typeOverride);
      return;
    }

    if (!itemName) {
      if (interactive) {
        const { select } = await import('@inquirer/prompts');
        const type = await select<ItemType>({
          message: '要查看什么？',
          choices: [
            { name: 'Change', value: 'change' as const },
            { name: 'Spec', value: 'spec' as const },
          ],
        });
        await this.runInteractiveByType(type, options, root);
        return;
      }
      this.printNonInteractiveHint(root);
      process.exitCode = 1;
      return;
    }

    await this.showDirect(itemName, { typeOverride, options, root });
  }

  private async showCanonical(
    itemName: string | undefined,
    options: ShowExecuteOptions,
    root: ResolvedOpenSpecRoot,
    workspace: Awaited<ReturnType<typeof tryLoadCanonicalWorkspace>>,
    interactive: boolean,
    typeOverride?: ItemType,
  ): Promise<void> {
    if (!workspace) return;
    const active = workspace.index.entries.filter((entry) => ['ANALYZE', 'DESIGN', 'PLAN', 'IMPLEMENT', 'VERIFY', 'ARCHIVE'].includes(entry.status));
    let selected = itemName;
    if (!selected && interactive && active.length) {
      const { select } = await import('@inquirer/prompts');
      selected = await select({ message: '选择 Change', choices: active.map((entry) => ({ name: entry.id, value: entry.id })) });
    }
    if (!selected) {
      const message = active.length ? `未指定 Change。可用 ID：${active.map((entry) => entry.id).join('、')}` : '未找到活动 Change。';
      if (options.json) console.log(JSON.stringify({ status: [{ severity: 'error', code: 'change_required', message }] }, null, 2));
      else console.error(message);
      process.exitCode = 1;
      return;
    }
    if (typeOverride === 'spec' || !/^CHG-\d{8}-\d{3}$/u.test(selected)) {
      const message = `canonical code-spec show 要求 Change ID 匹配 CHG-YYYYMMDD-NNN；'${selected}' 不受支持。`;
      if (options.json) console.log(JSON.stringify({ status: [{ severity: 'error', code: 'legacy_change_unsupported', message }] }, null, 2));
      else console.error(message);
      process.exitCode = 1;
      return;
    }
    const artifacts = await loadChangeArtifacts(workspace.paths, selected);
    if (options.json) {
      console.log(JSON.stringify({ changeId: selected, status: artifacts.metadata.change.status, revision: artifacts.metadata.change.revision, title: artifacts.metadata.change.title, requirements: artifacts.metadata.requirements, spec: artifacts.spec, root: toRootOutput(root) }, null, 2));
    } else {
      console.log(`# Change：${selected}\n\n状态：${formatStatusLabel(artifacts.metadata.change.status)}\n修订：${artifacts.metadata.change.revision}\n\n${artifacts.spec}`);
    }
  }

  private normalizeType(value?: string): ItemType | undefined {
    if (!value) return undefined;
    const v = value.toLowerCase();
    if (v === 'change' || v === 'spec') return v;
    return undefined;
  }

  private delegateOptions(root: ResolvedOpenSpecRoot, options: ShowExecuteOptions): ShowExecuteOptions & { rootOutput?: RootOutput } {
    return {
      ...options,
      ...(options.json ? { rootOutput: toRootOutput(root) } : {}),
    };
  }

  private async runInteractiveByType(
    type: ItemType,
    options: ShowExecuteOptions,
    root: ResolvedOpenSpecRoot
  ): Promise<void> {
    const { select } = await import('@inquirer/prompts');
    if (type === 'change') {
      const changes = await getActiveChangeIds(root.path);
      if (changes.length === 0) {
        console.error('未找到 Change。');
        process.exitCode = 1;
        return;
      }
      const picked = await select<string>({ message: '选择 Change', choices: changes.map(id => ({ name: id, value: id })) });
      const cmd = new ChangeCommand(root.path);
      await cmd.show(picked, this.delegateOptions(root, options) as any);
      return;
    }

    const specs = await getSpecIds(root.path);
    if (specs.length === 0) {
      console.error('未找到 Spec。');
      process.exitCode = 1;
      return;
    }
    const picked = await select<string>({ message: '选择 Spec', choices: specs.map(id => ({ name: id, value: id })) });
    const cmd = new SpecCommand(root.path);
    await cmd.show(picked, this.delegateOptions(root, options) as any);
  }

  private async showDirect(
    itemName: string,
    params: { typeOverride?: ItemType; options: ShowExecuteOptions; root: ResolvedOpenSpecRoot }
  ): Promise<void> {
    const root = params.root;
    // Optimize lookups when type is pre-specified
    let isChange = false;
    let isSpec = false;
    let changes: string[] = [];
    let specs: string[] = [];
    if (params.typeOverride === 'change') {
      changes = await getActiveChangeIds(root.path);
      isChange = changes.includes(itemName);
    } else if (params.typeOverride === 'spec') {
      specs = await getSpecIds(root.path);
      isSpec = specs.includes(itemName);
    } else {
      [changes, specs] = await Promise.all([getActiveChangeIds(root.path), getSpecIds(root.path)]);
      isChange = changes.includes(itemName);
      isSpec = specs.includes(itemName);
    }

    const resolvedType = params.typeOverride ?? (isChange ? 'change' : isSpec ? 'spec' : undefined);

    if (!resolvedType) {
      const suggestions = nearestMatches(itemName, [...changes, ...specs]);
      const message = suggestions.length
        ? `未知条目 '${itemName}'。你是否想输入：${suggestions.join('、')}？`
        : `未知条目 '${itemName}'。`;
      if (params.options.json) {
        console.log(
          JSON.stringify(
            { status: [{ severity: 'error', code: 'unknown_item', message }] },
            null,
            2
          )
        );
      } else {
        console.error(message);
      }
      process.exitCode = 1;
      return;
    }

    if (!params.typeOverride && isChange && isSpec) {
      if (params.options.json) {
        console.log(
          JSON.stringify(
            {
              status: [
                {
                  severity: 'error',
                  code: 'ambiguous_item',
                  message: `条目 '${itemName}' 同时匹配 Change 和 Spec，无法确定类型。`,
                  fix: '传入 --type change|spec。',
                },
              ],
            },
            null,
            2
          )
        );
        process.exitCode = 1;
        return;
      }
      console.error(`条目 '${itemName}' 同时匹配 Change 和 Spec，无法确定类型。`);
      // The noun-form commands are cwd-based and cannot reach a selected store.
      if (isStoreSelectedRoot(root)) {
        console.error('传入 --type change|spec。');
      } else {
        console.error('传入 --type change|spec，或使用：openspec change show / openspec spec show');
      }
      process.exitCode = 1;
      return;
    }

    this.warnIrrelevantFlags(resolvedType, params.options);
    if (resolvedType === 'change') {
      const cmd = new ChangeCommand(root.path);
      await cmd.show(itemName, this.delegateOptions(root, params.options) as any);
      return;
    }
    const cmd = new SpecCommand(root.path);
    await cmd.show(itemName, this.delegateOptions(root, params.options) as any);
  }

  private printNonInteractiveHint(root: ResolvedOpenSpecRoot): void {
    console.error('没有可显示的条目。请尝试以下命令之一：');
    console.error(`  ${withStoreFlag(root, 'openspec show <item>')}`);
    if (isStoreSelectedRoot(root)) {
      // The noun-form commands are cwd-based and cannot reach a selected store.
      console.error(`  ${withStoreFlag(root, 'openspec show <item> --type change')}`);
      console.error(`  ${withStoreFlag(root, 'openspec show <item> --type spec')}`);
    } else {
      console.error('  openspec change show');
      console.error('  openspec spec show');
    }
    console.error('或在交互式终端中运行。');
  }

  private warnIrrelevantFlags(type: ItemType, options: { [k: string]: any }): boolean {
    const irrelevant: string[] = [];
    // --no-scenarios makes commander default `scenarios` to true, so its
    // presence alone does not mean the user passed it — only false does.
    const isUserProvided = (k: string) =>
      k === 'scenarios' ? options[k] === false : k in options;
    if (type === 'change') {
      for (const k of SPEC_FLAG_KEYS) if (isUserProvided(k)) irrelevant.push(k);
    } else {
      for (const k of CHANGE_FLAG_KEYS) if (isUserProvided(k)) irrelevant.push(k);
    }
    if (irrelevant.length > 0) {
      console.error(`警告：忽略不适用于 ${type} 的选项：${irrelevant.join('、')}`);
      return true;
    }
    return false;
  }
}
