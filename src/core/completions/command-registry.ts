import { COMMON_FLAGS } from './shared-flags.js';
import type { CommandDefinition } from './types.js';
export const COMMAND_REGISTRY: CommandDefinition[] = [
  {
    name: 'rebase',
    description: '对过期的 canonical Change 执行语义 rebase',
    flags: [
      { name: 'change', description: 'canonical Change ID', takesValue: true },
      { name: 'current-spec', description: '当前 Spec 路径', takesValue: true },
      COMMON_FLAGS.store,
    ],
  },
  {
    name: 'transition',
    description: '在状态门禁校验后持久化 canonical Change 生命周期转换',
    flags: [
      { name: 'change', description: 'canonical Change ID', takesValue: true },
      { name: 'to', description: '目标生命周期状态', takesValue: true },
      { name: 'reason', description: '人类可读的转换原因', takesValue: true },
      COMMON_FLAGS.store,
    ],
  },
  {
    name: 'abandon',
    description: '通过生命周期门禁放弃 canonical Change',
    flags: [
      { name: 'change', description: 'canonical Change ID', takesValue: true },
      { name: 'reason', description: '放弃 Change 的原因', takesValue: true },
      COMMON_FLAGS.store,
    ],
  },
  {
    name: 'detect-stale',
    description: '检测与已归档 Requirement 重叠的活动 Change',
    flags: [
      { name: 'requirements', description: '逗号分隔的已归档 Requirement ID；默认使用全部已归档 Change', takesValue: true },
      COMMON_FLAGS.store,
    ],
  },
  {
    name: 'allocate-requirements',
    description: '以原子方式预留下一组 canonical Requirement ID',
    flags: [
      { name: 'module', description: '业务 Module ID，例如 MOD-001', takesValue: true },
      { name: 'count', description: '要预留的 Requirement ID 数量', takesValue: true },
      { name: 'change', description: '接收预留 ID 的活动 Change', takesValue: true },
      COMMON_FLAGS.store,
    ],
  },
  {
    name: 'init',
    description: '在项目中初始化 OpenSpec',
    acceptsPositional: true,
    positionalType: 'path',
    positionals: [{ name: 'path', type: 'path', optional: true }],
    flags: [
      {
        name: 'tools',
        description: '以非交互方式配置 AI 工具（例如 "all"、"none" 或逗号分隔的工具 ID）',
        takesValue: true,
      },
      {
        name: 'language',
        description: '使用指定语言编写新的 OpenSpec 产物',
        takesValue: true,
      },
      {
        name: 'force',
        description: '无需提示，自动清理旧文件',
      },
      {
        name: 'profile',
        description: '覆盖全局配置 Profile（core 或 custom）',
        takesValue: true,
        values: ['core', 'custom'],
      },
      {
        name: 'no-animation',
        description: '使用静态欢迎界面而不是动画',
      },
      {
        name: 'copilot-cloud',
        description: '生成 GitHub Copilot 云端编码代理文件（主动启用；默认询问）',
      },
      {
        name: 'no-copilot-cloud',
        description: '跳过生成 GitHub Copilot 云端编码代理文件',
      },
    ],
  },
  {
    name: 'update',
    description: '更新 OpenSpec 指导文件',
    acceptsPositional: true,
    positionalType: 'path',
    positionals: [{ name: 'path', type: 'path', optional: true }],
    flags: [
      {
        name: 'force',
        description: '即使工具已是最新也强制更新',
      },
    ],
  },
  {
    name: 'list',
    description: '列出条目（默认列出 Change；使用 --specs 列出 Spec）',
    flags: [
      {
        name: 'specs',
        description: '列出 Spec，而不是 Change',
      },
      {
        name: 'changes',
        description: '明确列出 Change（默认）',
      },
      {
        name: 'sort',
        description: '排序方式："recent"（默认）或 "name"',
        takesValue: true,
        values: ['recent', 'name'],
      },
      COMMON_FLAGS.json,
      COMMON_FLAGS.store,
    ],
  },
  {
    name: 'view',
    description: '显示 Spec 和 Change 的交互式面板',
    flags: [
      COMMON_FLAGS.store,
    ],
  },
  {
    name: 'validate',
    description: '校验 Change 和 Spec',
    acceptsPositional: true,
    positionalType: 'change-or-spec-id',
    positionals: [{ name: 'item-name', type: 'change-or-spec-id', optional: true }],
    flags: [
      {
        name: 'all',
        description: '校验全部 Change 和 Spec',
      },
      {
        name: 'changes',
        description: '校验全部 Change',
      },
      {
        name: 'specs',
        description: '校验全部 Spec',
      },
      {
        name: 'archived',
        description: '校验已归档 Change 的任务是否全部完成（用于提交前 lint）',
      },
      COMMON_FLAGS.type,
      COMMON_FLAGS.strict,
      COMMON_FLAGS.jsonValidation,
      {
        name: 'concurrency',
        description: '最大并发校验数（默认读取环境变量 OPENSPEC_CONCURRENCY，或使用 6）',
        takesValue: true,
      },
      COMMON_FLAGS.noInteractive,
      COMMON_FLAGS.store,
    ],
  },
  {
    name: 'show',
    description: '显示 Change 或 Spec',
    acceptsPositional: true,
    positionalType: 'change-or-spec-id',
    positionals: [{ name: 'item-name', type: 'change-or-spec-id', optional: true }],
    flags: [
      COMMON_FLAGS.json,
      COMMON_FLAGS.type,
      COMMON_FLAGS.noInteractive,
      {
        name: 'deltas-only',
        description: '仅显示增量（仅 JSON，Change 专用）',
      },
      {
        name: 'requirements-only',
        description: '--deltas-only 的弃用别名（Change 专用）',
      },
      {
        name: 'diff',
        description: '显示增量 Spec 的逐条 Requirement 差异（Change 专用）',
      },
      {
        name: 'requirements',
        description: '仅显示 Requirement，排除场景（仅 JSON，Spec 专用）',
      },
      {
        name: 'no-scenarios',
        description: '排除场景内容（仅 JSON，Spec 专用）',
      },
      {
        name: 'requirement',
        short: 'r',
        description: '按 ID 显示指定 Requirement（仅 JSON，Spec 专用）',
        takesValue: true,
      },
      COMMON_FLAGS.store,
    ],
  },
  {
    name: 'archive',
    description: '归档已完成的 Change 并更新主 Spec',
    acceptsPositional: true,
    positionalType: 'change-id',
    positionals: [{ name: 'change-name', type: 'change-id', optional: true }],
    flags: [
      {
        name: 'yes',
        short: 'y',
        description: '跳过确认提示',
      },
      {
        name: 'skip-specs',
        description: '跳过 Spec 更新操作',
      },
      {
        name: 'no-validate',
        description: '跳过校验（不建议）',
      },
      {
        name: 'json',
        description: '以 JSON 输出（非交互模式）',
      },
      COMMON_FLAGS.store,
    ],
  },
  {
    name: 'status',
    description: '显示 Change 的产物完成状态',
    flags: [
      {
        name: 'change',
        description: '要显示状态的 Change 名称',
        takesValue: true,
      },
      {
        name: 'all',
        description: '显示全部活动 Change 的状态',
      },
      {
        name: 'schema',
        description: 'Schema 覆盖值',
        takesValue: true,
      },
      COMMON_FLAGS.json,
      COMMON_FLAGS.store,
    ],
  },
  {
    name: 'instructions',
    description: '输出产物、apply 或 archive 的增强指导',
    acceptsPositional: true,
    positionals: [{ name: 'artifact', optional: true }],
    flags: [
      {
        name: 'change',
        description: 'Change 名称',
        takesValue: true,
      },
      {
        name: 'schema',
        description: 'Schema 覆盖值',
        takesValue: true,
      },
      COMMON_FLAGS.json,
      COMMON_FLAGS.store,
    ],
  },
  {
    name: 'templates',
    description: '显示 Schema 中所有产物解析后的模板路径',
    flags: [
      {
        name: 'schema',
        description: '使用的 Schema',
        takesValue: true,
      },
      COMMON_FLAGS.json,
    ],
  },
  {
    name: 'schemas',
    description: '列出可用工作流 Schema 及其说明',
    flags: [
      COMMON_FLAGS.json,
      COMMON_FLAGS.store,
    ],
  },
  {
    name: 'new',
    description: '创建新条目',
    flags: [],
    subcommands: [
      {
        name: 'change',
        description: '创建新的 Change 目录',
        acceptsPositional: true,
        positionals: [{ name: 'name' }],
        flags: [
          {
            name: 'description',
            description: '要写入 README.md 的描述',
            takesValue: true,
          },
          {
            name: 'goal',
            description: '随 Change 保存的可选目标元数据',
            takesValue: true,
          },
          {
            name: 'schema',
            description: '使用的工作流 Schema',
            takesValue: true,
          },
          COMMON_FLAGS.json,
          COMMON_FLAGS.store,
        ],
      },
    ],
  },
  {
    name: 'store',
    description:
      '创建并管理 Store——在本机登记的独立 OpenSpec 仓库',
    flags: [],
    subcommands: [
      {
        name: 'setup',
        description: '创建或登记本地 Store',
        acceptsPositional: true,
        positionals: [{ name: 'id', optional: true }],
        flags: [
          {
            name: 'path',
            description: 'Store 使用的目录',
            takesValue: true,
            completionType: 'path',
          },
          {
            name: 'init-git',
            description: '在 Store 中初始化 Git 仓库',
          },
          {
            name: 'no-init-git',
            description: '跳过 Git 仓库初始化',
          },
          {
            name: 'remote',
            description: '记录在 store.yaml 中的 canonical 克隆源',
            takesValue: true,
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'register',
        description: '登记已有的 Store 目录',
        acceptsPositional: true,
        positionals: [{ name: 'path', type: 'path', optional: true }],
        flags: [
          {
            name: 'id',
            description: 'Store ID',
            takesValue: true,
          },
          {
            name: 'yes',
            description: '确认创建 Store 身份元数据',
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'unregister',
        description: '移除本地 Store 登记，但不删除文件',
        acceptsPositional: true,
        positionals: [{ name: 'id' }],
        flags: [
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'remove',
        description: '移除本地 Store 登记并删除本地目录',
        acceptsPositional: true,
        positionals: [{ name: 'id' }],
        flags: [
          {
            name: 'yes',
            description: '确认删除本地 Store 目录',
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'list',
        description: '列出已登记的 Store',
        flags: [
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'ls',
        description: '列出已登记的 Store',
        flags: [
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'doctor',
        description: '检查本地 Store 登记和元数据',
        acceptsPositional: true,
        positionals: [{ name: 'id', optional: true }],
        flags: [
          COMMON_FLAGS.json,
        ],
      },
    ],
  },
  {
    name: 'context',
    description: '输出解析后 OpenSpec 根目录的工作上下文',
    flags: [
      COMMON_FLAGS.json,
      COMMON_FLAGS.store,
      {
        name: 'code-workspace',
        description: '同时为该工作集写入 VS Code workspace 文件',
        takesValue: true,
        completionType: 'path',
      },
      {
        name: 'force',
        description: '覆盖已有的 --code-workspace 文件',
      },
    ],
  },
  {
    name: 'doctor',
    description: '报告解析后 OpenSpec 根目录的关联健康状态',
    flags: [
      COMMON_FLAGS.json,
      COMMON_FLAGS.store,
    ],
  },
  {
    name: 'workset',
    description: '创建、保留并打开个人工作视图（完全本地）',
    flags: [],
    subcommands: [
      {
        name: 'create',
        description: '创建并保存由你选择目录组成的命名工作视图',
        acceptsPositional: true,
        positionals: [{ name: 'name', optional: true }],
        flags: [
          {
            name: 'member',
            description:
              'Member folder as <path> or <name>=<path>; repeatable, first is the primary',
            takesValue: true,
            completionType: 'path',
          },
          {
            name: 'tool',
            description: '优先用于打开此 Workset 的工具',
            takesValue: true,
          },
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'list',
        description: '显示已保存的 Workset 及其成员',
        flags: [COMMON_FLAGS.json],
      },
      {
        name: 'ls',
        description: '显示已保存的 Workset 及其成员',
        flags: [COMMON_FLAGS.json],
      },
      {
        name: 'open',
        description:
          'Open a saved workset in your tool (editor window or agent session)',
        acceptsPositional: true,
        positionals: [{ name: 'name' }],
        flags: [
          {
            name: 'tool',
            description: '仅本次使用此工具打开',
            takesValue: true,
          },
        ],
      },
      {
        name: 'remove',
        description: '删除已保存的 Workset（不会修改成员目录）',
        acceptsPositional: true,
        positionals: [{ name: 'name' }],
        flags: [
          {
            name: 'yes',
            description: '确认以非交互方式删除',
          },
          COMMON_FLAGS.json,
        ],
      },
    ],
  },
  {
    name: 'feedback',
    description: '提交 OpenSpec 反馈',
    acceptsPositional: true,
    positionals: [{ name: 'message' }],
    flags: [
      {
        name: 'body',
        description: '反馈的详细说明',
        takesValue: true,
      },
    ],
  },
  {
    name: 'change',
    description: '管理 OpenSpec Change 提案（已弃用）',
    flags: [],
    subcommands: [
      {
        name: 'new',
        description: '创建 Change（已弃用别名）',
        acceptsPositional: true,
        positionals: [{ name: 'name' }],
        flags: [
          { name: 'description', description: '要写入 README.md 的描述', takesValue: true },
          { name: 'goal', description: '随 Change 保存的可选目标元数据', takesValue: true },
          { name: 'schema', description: '使用的工作流 Schema', takesValue: true },
          COMMON_FLAGS.json,
          COMMON_FLAGS.store,
        ],
      },
      {
        name: 'show',
        description: '显示 Change 提案',
        acceptsPositional: true,
        positionalType: 'change-id',
        positionals: [{ name: 'change-name', type: 'change-id', optional: true }],
        flags: [
          COMMON_FLAGS.json,
          {
            name: 'deltas-only',
            description: '仅显示增量（仅 JSON）',
          },
          {
            name: 'requirements-only',
            description: '--deltas-only 的弃用别名',
          },
          {
            name: 'diff',
            description: '显示增量 Spec 的逐条 Requirement 差异',
          },
          COMMON_FLAGS.noInteractive,
        ],
      },
      {
        name: 'list',
        description: '列出全部活动 Change（已弃用）',
        flags: [
          COMMON_FLAGS.json,
          {
            name: 'long',
            description: '显示 ID、标题和数量',
          },
        ],
      },
      {
        name: 'validate',
        description: '校验 Change 提案',
        acceptsPositional: true,
        positionalType: 'change-id',
        positionals: [{ name: 'change-name', type: 'change-id', optional: true }],
        flags: [
          COMMON_FLAGS.strict,
          COMMON_FLAGS.jsonValidation,
          COMMON_FLAGS.noInteractive,
        ],
      },
    ],
  },
  {
    name: 'spec',
    description: '管理 OpenSpec Spec',
    flags: [],
    subcommands: [
      {
        name: 'show',
        description: '显示 Spec',
        acceptsPositional: true,
        positionalType: 'spec-id',
        positionals: [{ name: 'spec-id', type: 'spec-id', optional: true }],
        flags: [
          COMMON_FLAGS.json,
          {
            name: 'requirements',
            description: '仅显示 Requirement，排除场景（仅 JSON）',
          },
          {
            name: 'no-scenarios',
            description: '排除场景内容（仅 JSON）',
          },
          {
            name: 'requirement',
            short: 'r',
            description: '按 ID 显示指定 Requirement（仅 JSON）',
            takesValue: true,
          },
          COMMON_FLAGS.noInteractive,
        ],
      },
      {
        name: 'list',
        description: '列出全部 Spec',
        flags: [
          COMMON_FLAGS.json,
          {
            name: 'long',
            description: '显示 ID、标题和数量',
          },
        ],
      },
      {
        name: 'validate',
        description: '校验 Spec',
        acceptsPositional: true,
        positionalType: 'spec-id',
        positionals: [{ name: 'spec-id', type: 'spec-id', optional: true }],
        flags: [
          COMMON_FLAGS.strict,
          COMMON_FLAGS.jsonValidation,
          COMMON_FLAGS.noInteractive,
        ],
      },
    ],
  },
  {
    name: 'completion',
    description: '管理 OpenSpec CLI 的 Shell 补全',
    flags: [],
    subcommands: [
      {
        name: 'generate',
        description: '生成 Shell 补全脚本（输出到 stdout）',
        acceptsPositional: true,
        positionalType: 'shell',
        positionals: [{ name: 'shell', type: 'shell', optional: true }],
        flags: [],
      },
      {
        name: 'install',
        description: '安装 Shell 补全脚本',
        acceptsPositional: true,
        positionalType: 'shell',
        positionals: [{ name: 'shell', type: 'shell', optional: true }],
        flags: [
          {
            name: 'verbose',
            description: '显示详细安装输出',
          },
        ],
      },
      {
        name: 'uninstall',
        description: '卸载 Shell 补全脚本',
        acceptsPositional: true,
        positionalType: 'shell',
        positionals: [{ name: 'shell', type: 'shell', optional: true }],
        flags: [
          {
            name: 'yes',
            short: 'y',
            description: '跳过确认提示',
          },
        ],
      },
    ],
  },
  {
    name: 'config',
    description: '查看和修改全局 OpenSpec 配置',
    flags: [
      {
        name: 'scope',
        description: '配置范围（当前仅支持 "global"）',
        takesValue: true,
        values: ['global'],
      },
    ],
    subcommands: [
      {
        name: 'path',
        description: '显示配置文件位置',
        flags: [],
      },
      {
        name: 'list',
        description: '显示当前全部设置',
        flags: [
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'get',
        description: '获取指定值（原始值，适合脚本使用）',
        acceptsPositional: true,
        positionals: [{ name: 'key' }],
        flags: [],
      },
      {
        name: 'set',
        description: '设置值（自动转换类型）',
        acceptsPositional: true,
        positionals: [{ name: 'key' }, { name: 'value' }],
        flags: [
          {
            name: 'string',
            description: '强制以字符串保存值',
          },
          {
            name: 'allow-unknown',
            description: '允许设置未知键',
          },
        ],
      },
      {
        name: 'unset',
        description: '移除配置键（恢复默认值）',
        acceptsPositional: true,
        positionals: [{ name: 'key' }],
        flags: [],
      },
      {
        name: 'reset',
        description: '将配置重置为默认值',
        flags: [
          {
            name: 'all',
            description: '重置全部配置（必需）',
          },
          {
            name: 'yes',
            short: 'y',
            description: '跳过确认提示',
          },
        ],
      },
      {
        name: 'edit',
        description: '使用 $EDITOR 打开配置',
        flags: [],
      },
      {
        name: 'profile',
        description: '配置工作流 Profile（交互式选择或预设快捷方式）',
        acceptsPositional: true,
        positionals: [{ name: 'preset', optional: true }],
        flags: [],
      },
    ],
  },
  {
    name: 'schema',
    description: '管理工作流 Schema',
    flags: [],
    subcommands: [
      {
        name: 'which',
        description: '显示 Schema 的解析来源',
        acceptsPositional: true,
        positionalType: 'schema-name',
        positionals: [{ name: 'name', type: 'schema-name', optional: true }],
        flags: [
          COMMON_FLAGS.json,
          {
            name: 'all',
            description: '列出全部 Schema 及其解析来源',
          },
        ],
      },
      {
        name: 'validate',
        description: '校验 Schema 结构和模板',
        acceptsPositional: true,
        positionalType: 'schema-name',
        positionals: [{ name: 'name', type: 'schema-name', optional: true }],
        flags: [
          COMMON_FLAGS.json,
          {
            name: 'verbose',
            description: '显示详细校验步骤',
          },
        ],
      },
      {
        name: 'fork',
        description: '复制已有 Schema 到项目中进行定制',
        acceptsPositional: true,
        positionalType: 'schema-name',
        positionals: [
          { name: 'source', type: 'schema-name' },
          { name: 'name', optional: true },
        ],
        flags: [
          COMMON_FLAGS.json,
          {
            name: 'force',
            description: '覆盖已有目标',
          },
        ],
      },
      {
        name: 'init',
        description: '创建新的项目级 Schema',
        acceptsPositional: true,
        positionals: [{ name: 'name' }],
        flags: [
          COMMON_FLAGS.json,
          {
            name: 'description',
            description: 'Schema 描述',
            takesValue: true,
          },
          {
            name: 'artifacts',
            description: '逗号分隔的产物 ID',
            takesValue: true,
          },
          {
            name: 'default',
            description: '设为项目默认 Schema',
          },
          {
            name: 'no-default',
            description: '不询问是否设为默认值',
          },
          {
            name: 'force',
            description: '覆盖已有 Schema',
          },
        ],
      },
    ],
  },
];
