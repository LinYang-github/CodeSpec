---
name: openspec-continue-change
description: 继续 OpenSpec Change，创建下一个产物。
allowed-tools: Bash(openspec:*)
license: MIT
compatibility: 需要 openspec CLI。
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



### continue 阶段适配器

当前是 resume/forward 阶段。执行前解析 canonical 上下文：运行 `openspec context --json`，解析一个明确的 `CHG-YYYYMMDD-NNN`（上下文缺失或有歧义时明确停止），然后运行 `openspec status --change "<CHG-ID>" --json` 并加载声明的 `metadata.yaml` 和产物路径。将解析出的 Change ID、status、mode、baseline hash、Requirement ID、准确的 Scenario ID、Task ID、测试/证据引用、必需验证命令和 canonical 路径注入 resume/forward 提示。方法论路由：preserve the Change mode routing above and use the existing Superpowers methodology。动作完成后刷新状态，并在 canonical 产物中记录追踪关系。

继续处理现有 Change：每次仅创建一个由 canonical status 指定的下一个工件。

**Store 选择：** 如果用户指定了 store（store 是本机注册的独立 OpenSpec 仓库），或当前工作位于 store 中，请运行 `openspec store list --json` 查找已注册的 store ID，然后在读写 Spec 和 Change 的命令中传入 `--store <id>`（包括 `new change`、`change new`、`status`、`instructions`、`list`、`show`、`validate`、`archive`、`doctor`、`context`、`schemas`、`view`、`rebase`、`transition`、`abandon`、`detect-stale`、`allocate-requirements`）。选择后，在本次工作流的后续步骤中持续使用 `--store <id>`。下面未带范围的命令示例都只是简写：执行前要追加该选项。例如运行 `openspec status --change "<name>" --json --store "<id>"`，不要直接运行未带选项的形式。其他命令不接受该选项。命令打印的后续提示已经带有该选项，继续使用即可。没有 store 时，命令作用于最近的本地 `openspec/` 根目录。

**输入**：可选地提供 Change ID；省略时从上下文解析或要求选择。

**步骤**

1. **选择 Change**

   用户提供了明确的 `CHG-YYYYMMDD-NNN` 时使用该 ID；否则从对话上下文推断。若只有一个活动 Change 可自动选择；如仍有歧义，运行 `openspec list --json`，按最近修改时间展示 3–4 个候选，让用户选择。候选展示 Change ID、schema、状态和最后修改时间；将最近修改项标为“推荐”。明确说明：“正在使用 Change：<id>”，并提示可用 `/openspec-continue-change <CHG-ID>` 覆盖。

2. **检查 canonical 状态**

   ```bash
   openspec status --change "<CHG-ID>" --json
   ```

   读取 `schemaName`、`artifacts`、`isPlanningComplete`、`planningHome`、`changeRoot`、`artifactPaths` 与 `actionContext`。使用返回的路径，不得假设仓库内路径。

3. **根据状态执行**

   若 `isPlanningComplete: true`，展示最终状态，说明规划已完成，可在新的用户请求中进入 apply；然后停止。

   否则选择 status 中第一个 `status: "ready"` 的工件，运行：
   ```bash
   openspec instructions <artifact-id> --change "<CHG-ID>" --json
   ```

   `instruction` 是权威指导，`template` 是文件结构，`context` 与 `rules` 仅是约束，绝不能复制到产物。始终从磁盘重新读取 `dependencies`；若说明委派给特定 skill 或命令，调用它完成工件并验证 `resolvedOutputPath` 存在。否则按 `template` 写入 `resolvedOutputPath`；路径为 glob 时按 `instruction` 选择具体路径。展示已创建的工件和新解锁项，然后停止。

   若没有 `ready` 工件，展示状态并提示检查 schema 或依赖问题。

4. **展示进度**

   ```bash
   openspec status --change "<CHG-ID>"
   ```

**输出**

每次调用说明创建了哪个工件、当前 schema、N/M 完成进度、已解锁工件，并提示：“需要继续时，运行 `/openspec-continue-change` 或直接告诉我下一步。”

**护栏**

- 每次调用只创建一个工件。
- 始终依据 schema 的工件序列，不得猜测工件名称或跳过、乱序创建。
- 上下文关键部分不明确时，先询问用户。
- 写入后确认工件文件存在，再报告进度。
- `context`、`rules`、`<context>`、`<rules>`、`<project_context>` 是约束，绝不能写入工件。
