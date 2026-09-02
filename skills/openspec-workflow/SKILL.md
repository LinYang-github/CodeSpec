---
name: openspec-workflow
description: 将 OpenSpec code-spec 工作流路由到 canonical Change 流程。
allowed-tools: Bash(openspec:*)
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
---

## 中文用户体验约定

所有面向用户的解释、提问、进度、总结和生成产物正文使用中文。命令名、选项名、路径、YAML/JSON key、schema 名称、稳定 ID、状态枚举和 DSL Token 保持英文，确保协议可以执行和解析。状态展示使用中文标签并在括号中保留英文协议值，例如“状态：分析（ANALYZE）”。


## Canonical OpenSpec 工作流

将 code-spec 工作通过 `openspec-workflow` 适配器路由。解析或创建匹配 `CHG-YYYYMMDD-NNN` 的 canonical Change ID；不要使用 slug Change 或旧版 `.openspec.yaml` 元数据。Change 目录为 `openspec/changes/<CHG-ID>/`，状态以 `metadata.yaml` 为准。

在每次提示和命令中传递 Change ID、生命周期 status、baseline、Requirement ID（`MOD-###-REQ-###`）、Scenario、Task ID（`SP-##`）和元数据产物路径。`tasks.md` 只作为简洁的 `SP-##` 状态投影，不要在其中重复详细的 Superpowers 计划。在验证产物中记录必需的 Requirement/test/build/lint 命令及证据。

### 执行前解析并注入上下文

运行 `openspec context --json` 解析 canonical workspace。通过明确的 `CHG-YYYYMMDD-NNN` ID 或绑定上下文解析 Change，然后运行 `openspec status --change "<CHG-ID>" --json` 并加载 `openspec/changes/<CHG-ID>/metadata.yaml` 及其声明的产物路径。将实际 Change ID、status、baseline、受影响 Requirement ID 和 Scenario ID、Task ID、已有证据以及 canonical proposal/design/spec/tasks/verification 路径注入每个 Superpowers 提示。上下文缺失、元数据缺失或解析有歧义时，明确失败并停止；不要猜测，也不要回退到 slug/旧版元数据。

在规划、实现、验证或归档前，重新解析 status 和产物，并将结果上下文传给对应的 Superpowers skill。每次有实质动作后刷新状态，并将追踪关系/证据写回 canonical 产物。必需命令必须从解析出的 workspace 执行，并逐字记录命令及结果。

原样复用 Superpowers 方法论：brainstorming、writing-plans、TDD RED → GREEN、systematic debugging、fresh verification、code review 和 branch finishing。baseline 过期时，继续之前先通过 semantic rebase。



当 Superpowers skill 操作 OpenSpec code-spec 工作时，使用此适配器。

**Store 选择：** 如果用户指定了 store（store 是本机注册的独立 OpenSpec 仓库），或当前工作位于 store 中，请运行 `openspec store list --json` 查找已注册的 store ID，然后在读写 Spec 和 Change 的命令中传入 `--store <id>`（包括 `new change`、`change new`、`status`、`instructions`、`list`、`show`、`validate`、`archive`、`doctor`、`context`、`schemas`、`view`、`rebase`、`transition`、`abandon`、`detect-stale`、`allocate-requirements`）。选择后，在本次工作流的后续步骤中持续使用 `--store <id>`。下面未带范围的命令示例都只是简写：执行前要追加该选项。例如运行 `openspec status --change "<name>" --json --store "<id>"`，不要直接运行未带选项的形式。其他命令不接受该选项。命令打印的后续提示已经带有该选项，继续使用即可。没有 store 时，命令作用于最近的本地 `openspec/` 根目录。
