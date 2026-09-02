# OpenSpec 默认 code-spec 与中文用户体验设计

## 1. 目标

将 OpenSpec 的默认项目协议切换为 canonical `code-spec`，并将整个面向用户的体验统一为中文。新项目和通过 `openspec init` 初始化的已有项目都直接进入 canonical 流程；旧 `spec-driven` Change 不再被兼容读取。

## 2. 设计边界

### 2.1 默认协议

- `openspec init` 默认写入 `schema: code-spec`。
- 已有 `openspec/config.yaml` 时，`init` 自动覆盖为 canonical 配置，不再等待交互确认。
- 已有旧文件不删除、不移动，但不再参与 Change、状态、校验、归档和索引解析。
- 已有 `code-spec` 配置和有效活动 Change 不重置；只有从旧配置切换时才重建 canonical 空索引。
- 新项目初始化时创建 `business.md`、`changes/index.yaml`、`archive/README.md` 以及 canonical 目录；已有用户文件仅在缺失时补建。
- canonical Change 使用 `CHG-YYYYMMDD-NNN`，Requirement 使用 `MOD-###-REQ-###`，任务沿用 canonical `SP-##` 格式。

### 2.2 中文用户体验

以下自然语言全部使用中文：

- CLI 帮助、子命令说明、参数说明和示例说明；
- 初始化、创建、状态、校验、归档、重基、分配和放弃流程的提示；
- 成功信息、错误信息、诊断信息、修复建议和手工操作指引；
- 生成给 Codex、Claude Code 及其他工具使用的 Skill、模板和工作流指导；
- README、用户文档和发布说明中的用户操作内容。

以下机器协议保持英文原样：

- 命令名、参数名、环境变量、路径、包名和 URL；
- YAML key、JSON key、schema 名称和稳定 ID；
- 状态枚举、Delta DSL Token、Scenario DSL Token；
- 外部工具自己的命令和调用语法。

状态在人类输出中采用中文标签加英文协议值，例如 `状态：分析（ANALYZE）`；JSON 和文件内容继续输出稳定英文值。

## 3. 初始化与迁移流程

初始化分为两个相互独立的阶段：

1. 工具集成阶段：安装或更新各工具的 Skill/命令适配文件。Codex 继续使用 Skill，不生成命令文件，但提示改为中文。
2. 项目协议阶段：确保项目根目录存在 canonical `openspec/config.yaml` 和完整目录骨架。

项目协议阶段根据现状执行：

| 当前状态 | 处理方式 |
| --- | --- |
| 没有 `openspec/` | 创建 canonical 根目录、配置、索引、业务注册表和 archive 骨架 |
| 有旧 `spec-driven` 配置 | 覆盖配置为 `code-spec`，保留旧 Change 文件，重建空 canonical 索引 |
| 已有 `code-spec` 配置 | 保留配置语义和有效索引，仅补齐缺失骨架，不清空活动 Change |
| 配置损坏或无法解析 | 用中文报告阻塞原因；不得在无法判断旧状态时盲目覆盖 |

自动覆盖只作用于项目协议配置和 canonical 索引，不删除用户内容。旧目录保留在原位置，但由于不在新的 canonical 索引中，所有 canonical loader 都不会读取它们。

## 4. 配置与 CLI 行为

- `DEFAULT_SCHEMA` 和根目录默认 schema 改为 `code-spec`。
- `openspec new change "变更描述"` 在 canonical 根目录中自动分配 Change ID，不接受旧 slug Change ID。
- `status`、`show`、`validate`、`instructions`、`archive`、`rebase`、`transition`、`abandon` 和 `allocate-requirements` 统一先检测 canonical workspace。
- 面向用户的错误消息说明“发生了什么、影响什么、下一步怎么做”；协议值和可复制命令保持原样。
- `--json` 输出保持机器契约，不把中文文本写入稳定 key、状态值或 ID；可读的 `message`、`fix` 字段使用中文。
- `spec-driven` 仅作为显式、非默认的通用 schema 能力保留；它不再作为 `init` 的自动选择，也不恢复旧 Change 兼容分支。

## 5. Skill、模板和文档

- 所有生成的自然语言正文、标题、步骤、说明和示例改为中文。
- Skill 中的命令、路径、ID、状态和 DSL 保留英文，确保工具可执行和解析稳定。
- `openspec-workflow` 作为薄编排层，负责上下文注入、Change 路由、状态门禁、追踪和证据；Superpowers 的方法论 Skill 不复制、不改写其核心协议。
- 旧的 `docs/superpowers/specs/`、`docs/superpowers/plans/` 仅作为本次设计/实现过程文档，不作为 OpenSpec 长期事实源。

## 6. 错误处理与安全边界

- 配置覆盖必须原子写入；写入失败时保留原配置并输出中文修复建议。
- 重建 canonical 索引前验证配置类型和目录边界；无法确认配置属于旧 `spec-driven` 时停止，不覆盖。
- 不删除、不递归清理旧 Change、旧规格或用户 Skill 文件。
- 生成文件继续使用现有路径安全、symlink 防护和原子写入机制。
- 初始化完成后输出实际 schema、创建/保留/跳过的文件以及下一条可复制命令。

## 7. 验证

新增或更新测试覆盖：

- 空项目初始化默认生成完整 `code-spec` 根目录；
- 旧 `spec-driven` 配置自动覆盖，旧文件保留且不被 loader 读取；
- 已有 canonical 配置和活动 Change 不被重置；
- 配置损坏时安全阻塞；
- 所有主要 CLI 人类输出为中文，机器协议和 JSON 稳定字段不变；
- Codex 等仅 Skill 工具的初始化提示正确；
- 新 Change、状态、校验、归档和生命周期命令仍通过完整回归测试。

验证命令：

```text
pnpm run build
pnpm run lint
pnpm test
git diff --check
```
