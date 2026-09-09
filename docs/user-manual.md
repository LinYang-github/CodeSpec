# CodeSpec 用户手册

这份手册带你完成一次 CodeSpec 使用流程：安装、初始化项目、让 AI 创建 Change、验证、查看 UI，并归档完成的 Change。

CodeSpec 有两个入口：

- **终端**：运行 `codespec ...` 命令，负责安装、初始化、查看、校验和归档。
- **AI 对话**：调用 `codespec-workflow`、`codespec-rebase-change` 和 `codespec-archive-change`，负责分析需求、编写产物和推动开发。

不要把终端命令粘贴到 AI 对话，也不要把 AI 技能名称粘贴到终端。

## 开始前确认环境

CodeSpec `1.0.0` 需要 Node.js `20.19.0` 或更高版本。

在终端执行：

```powershell
node --version
```

Windows 还可以检查实际使用的 Node.js 路径：

```powershell
where.exe node
```

如果 `where.exe node` 返回多个路径，请确认较新的 Node.js 路径排在旧路径前面。

## 安装 CodeSpec

选择一种安装方式。离线发布包适用于不能访问 npm registry 的环境；同一个 tgz 可以在 Windows、macOS 和 Linux 上使用。

### 在线安装

在终端执行：

```npm
npm install -g @hrhy-ai/codespec@1.0.0
```

安装完成后验证：

```bash
codespec --version
```

预期输出：

```text
1.0.0
```

### 离线安装

离线安装只需要 Node.js、npm 和发布包：

```text
hrhy-ai-codespec-1.0.0.tgz
```

发布包已经包含生产依赖。目标机器不需要安装 pnpm，也不需要访问网络。

Windows PowerShell：

```powershell
npm install -g "D:\packages\hrhy-ai-codespec-1.0.0.tgz" --offline --no-audit --no-fund
```

macOS/Linux：

```bash
npm install -g ./hrhy-ai-codespec-1.0.0.tgz --offline --no-audit --no-fund
```

安装后验证：

```bash
codespec --version
```

如果 npm 报 `ENOTCACHED`，请确认你使用的是依赖已内置的离线 tgz，并且命令包含 `--offline`、`--no-audit` 和 `--no-fund`。

## 初始化项目

在项目根目录执行：

```bash
codespec init
```

初始化会询问你使用的 AI 编码工具。你也可以直接指定工具：

```bash
codespec init --tools claude,cursor
```

没有需要配置的 AI 工具时：

```bash
codespec init --tools none --no-animation
```

### 初始化后会生成什么

项目根目录会出现以下 CodeSpec 文件：

```text
codespec/
├── business.yaml           # 由模块关系生成的业务注册表
├── configuration.yaml      # CodeSpec 验证使用的运行连接快照
├── config.yaml             # CodeSpec 配置
├── specs/                  # 当前有效的 Specification
├── changes/                # 活动 Change
│   └── index.yaml          # Change 索引
└── .transactions/          # 可恢复的归档事务日志
```

AI 工具文件的位置取决于你选择的工具。例如，工具可能使用 `.agents/skills/`、`.claude/skills/` 或其他工具自己的目录。以 `codespec init` 实际输出的路径为准。

如果你使用了 `--force`，初始化会自动清理允许清理的旧 CodeSpec 文件。执行前请先确认这些文件不再需要。

## 在 AI 对话中使用工作流

初始化完成后，在你使用的 AI 编码工具中调用对应技能。不同工具的调用前缀可能不同，`codespec init` 会打印准确入口。

### 创建或继续 Change

使用 `codespec-workflow`：

```text
codespec-workflow 新增用户详情弹窗
```

AI 会根据需求创建或更新 Change 产物，并在开始实现前让你确认设计和计划。

### 恢复过期 Change

当 Core 报告 Change 为 `STALE`，或当前 Spec 已经发生变化时，使用 `codespec-rebase-change`：

```text
codespec-rebase-change CHG-20260906-001
```

它会先读取当前 Spec 和 Change 基线，再提出需要重做或确认的内容。不要直接手工修改 `metadata.yaml` 中的 revision 或 baseline。

### 准备归档

实现和验证完成后，使用 `codespec-archive-change`：

```text
codespec-archive-change CHG-20260906-001
```

AI 会检查归档门禁、验证证据和 Spec 影响，然后给出需要你在终端确认的归档命令。AI 不会替你绕过人工确认。

## 理解 Change 生命周期

所有 SDD 等级使用同一套生命周期：

```text
ANALYZE → DESIGN → PLAN → IMPLEMENT → VERIFY → ARCHIVE → ARCHIVED
```

`ABANDONED` 是活动 Change 的终止分支。SDD 等级不会改变生命周期顺序，只会改变每个阶段所需的产物、验证证据和门禁强度。

### SDD 等级

| 等级 | 适用场景 | 主要要求 |
| --- | --- | --- |
| Level 1 | 单模块、低风险的小 bugfix 或小行为修改 | 通用产物；设计说明可以内嵌到 `spec.md` |
| Level 2 | 普通功能、多文件改动或接口、数据模型修改 | `design.md`、BDD 场景和集成验证；这是默认等级 |
| Level 3 | 架构、安全、数据迁移、跨系统、breaking change、高可靠或高并发改动 | 完整设计、接口或数据契约、追踪矩阵、代码引用、回滚和更严格验证 |

Level 1、Level 2 和 Level 3 都必须通过归档门禁。较低等级不能跳过 `VERIFY` 或人工归档确认。

## 查看 Change 产物

在终端执行以下命令查看内容：

```bash
codespec list --changes
codespec list --specs
codespec show CHG-20260906-001 --type change
codespec status --change CHG-20260906-001
codespec instructions --change CHG-20260906-001
```

一个完整 Change 通常包含：

```text
codespec/changes/<change-id>/
├── metadata.yaml       # Change ID、状态、SDD 等级和归档状态
├── design.md           # 目标、范围和技术设计
├── spec.md             # Requirement、Scenario 和测试用例增量
├── tasks.yaml          # 结构化实施任务、关系和配置增量
└── verification.yaml   # 结构化验证命令和证据
```

实际产物以当前 Change 的 `metadata.yaml` 和 Schema 要求为准。

## 使用 CodeSpec UI

在终端启动 UI：

```bash
codespec ui
```

UI 提供以下页面：

- **业务功能**：查看 `codespec/business.yaml` 中的业务模块、关系投影和 API 查询数据。
- **活动 Change**：查看尚未归档的 Change、状态、SDD 等级和业务模块。
- **可归档 Change**：查看归档门禁、验证摘要、Spec 影响和归档目标。
- **归档事务**：查看当前规格、活动 Change 和可恢复事务状态；canonical 归档不创建 Change 历史副本。
- **命令助手**：展示并复制常用 CLI 命令和 AI 工作流技能，不会在页面中执行命令。

右上角主题只提供“深色”和“浅色”。首次打开时，页面根据系统深浅色初始化；用户手动切换后保存明确选择。

页面归档只对通过预检和归档门禁的 Change 显示归档操作。点击归档后仍需要人工确认，失败时页面保留当前状态并显示原因。

## 归档 Change

### 先检查门禁

在终端执行：

```bash
codespec validate CHG-20260906-001 --type change
codespec status --change CHG-20260906-001
```

归档前至少确认以下内容：

- Requirement 和 Scenario 已验证。
- 必需的测试、构建和 Lint 已通过。
- `tasks.yaml` 中的任务已完成，且任务确认仍对应当前 revision。
- `verification.yaml` 包含当前 baseline 的命令和证据。
- 归档影响分析已经处理，不存在未解决的冲突。

### 执行归档

在终端执行：

```bash
codespec archive CHG-20260906-001
```

归档命令会先校验，再要求人工确认。不要使用 `--yes` 绕过确认，除非你明确知道当前运行环境无法提供交互输入，并且已经在外部完成了人工审批。

归档完成后，CodeSpec 会：

1. 将 approved module delta 合并到 `codespec/specs/<MOD-ID>/` 的 `spec.md`、`interface.yaml` 和派生 `api.yaml`。
2. 更新根级 `business.yaml` 和 `configuration.yaml`。
3. 通过 `.transactions/` 写入可恢复事务，提交后删除活动 Change 和索引项。

默认情况下，归档后的 Change 不保留新的副本；Git 历史仍由项目自身负责。

### 发现归档冲突时

如果新 Change 与当前 Spec 或其他活动 Change 修改了相同 Requirement，不要手工覆盖 `codespec/specs/`。先在终端运行：

```bash
codespec rebase --change CHG-20260906-001
```

然后回到 AI 对话中使用 `codespec-rebase-change`，确认新的基线、Requirement 和 Scenario。重新验证通过后才能归档。

## 常用 CLI 命令

| 目的 | 命令 |
| --- | --- |
| 初始化项目 | `codespec init` |
| 更新 AI 指导文件 | `codespec update` |
| 创建 Change 目录 | `codespec new change <name>` |
| 列出活动 Change | `codespec list --changes` |
| 列出当前 Spec | `codespec list --specs` |
| 查看 Change | `codespec show <id> --type change` |
| 查看状态 | `codespec status --change <id>` |
| 查看下一步指导 | `codespec instructions --change <id>` |
| 校验 Change | `codespec validate <id> --type change` |
| 校验全部内容 | `codespec validate --all` |
| 校验已归档任务 | `codespec validate --archived` |
| 启动 UI | `codespec ui` |
| 归档 Change | `codespec archive <id>` |
| 迁移旧工作区 | `codespec migrate --json` |
| 查看版本 | `codespec --version` |

需要脚本或 AI 读取结构化结果时，优先使用支持 `--json` 的命令。

## 更新和卸载

### 更新在线安装

在终端执行：

```bash
npm install -g @hrhy-ai/codespec@1.0.0
codespec update
```

`codespec update` 会按照当前配置重新生成 AI 指导文件。更新后请按工具提示重启 IDE 或重新加载 AI 工具。

### 更新离线安装

使用新的 tgz 重新安装：

```powershell
npm install -g "D:\packages\hrhy-ai-codespec-1.0.0.tgz" --offline --no-audit --no-fund
codespec update
```

### 卸载 CLI

在终端执行：

```bash
npm uninstall -g @hrhy-ai/codespec
```

卸载 CLI 不会自动删除项目中的 `codespec/`、AI 技能文件或历史 Change。删除这些文件前，请先确认项目不再需要它们。

## 常见问题

### `node:util` 不提供 `styleText`

原因是 Node.js 版本过低，或 Windows PATH 指向了旧 Node.js。

检查版本：

```powershell
node --version
where.exe node
```

升级到 Node.js `20.19.0` 或更高版本，重新打开终端后再运行 `codespec --version`。

### npm 报 `ENOTCACHED`

原因通常是以下之一：

- 使用了普通 tgz，而不是依赖已内置的离线 tgz。
- 命令中的 `--offline`、`--no-audit` 或 `--no-fund` 拼写错误。
- tgz 路径没有加引号，导致 Windows 路径被拆开。

Windows 正确写法：

```powershell
npm install -g "D:\packages\hrhy-ai-codespec-1.0.0.tgz" --offline --no-audit --no-fund
```

### `codespec` 不是内部或外部命令

先确认 npm 全局 bin 目录已经加入 PATH：

```powershell
npm prefix -g
where.exe codespec
```

如果刚修改过 PATH，请重新打开终端。不要在 CodeSpec 初始化过程中自动修改 PowerShell Profile。

### `codespec init` 生成的命令找不到

不同 AI 工具可能使用 skills、命令文件或自己的提示库。重新运行：

```bash
codespec update
```

然后按照命令输出的实际路径和调用方式重启或重新加载对应工具。技能文件不存在不一定是失败，某些工具只支持 skills。

### UI 显示内容为空

确认你在包含 `codespec/` 的项目根目录启动：

```bash
codespec ui
```

如果刚由 AI 创建或修改了文件，点击 UI 中的“重新扫描”。如果仍然为空，先检查：

```bash
codespec list --changes
codespec list --specs
```

这两个命令也找不到内容时，问题通常是项目路径或初始化状态，而不是 UI 渲染问题。

## 继续阅读

- [快速入门](getting-started.md)：五分钟完成第一次 Change。
- [CLI 参考](cli.md)：查看全部命令、选项和 JSON 输出。
- [命令如何工作](how-commands-work.md)：区分终端命令和 AI 技能。
- [工作流](workflows.md)：按场景选择 CodeSpec 工作方式。
- [故障排查](troubleshooting.md)：查看更完整的错误处理说明。
