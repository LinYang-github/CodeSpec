---
name: openspec-new-change
description: 按步骤创建 OpenSpec Change 并准备第一个产物。
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



### new 阶段适配器

当前是 planning 阶段。执行前解析 canonical 上下文：运行 `openspec context --json`，解析一个明确的 `CHG-YYYYMMDD-NNN`（上下文缺失或有歧义时明确停止），然后运行 `openspec status --change "<CHG-ID>" --json` 并加载声明的 `metadata.yaml` 和产物路径。将解析出的 Change ID、status、mode、baseline hash、Requirement ID、准确的 Scenario ID、Task ID、测试/证据引用、必需验证命令和 canonical 路径注入 planning 提示。方法论路由：feature → brainstorming → planning → TDD; bugfix → systematic-debugging → spec-impact decision → TDD; refactor → design-impact → planning → TDD。动作完成后刷新状态，并在 canonical 产物中记录追踪关系。

开始新的 Change：创建 canonical 骨架并展示第一个待完成工件，不直接编写任何工件。

默认 schema 为 `code-spec`。默认工件顺序必须以 `openspec status --change "<name>" --json` 的实际输出为准，通常包括 `metadata.yaml`、`proposal.md`、`design.md`、`spec.md`、`tasks.md` 和 `verification.md`。

**Store 选择：** 如果用户指定了 store（store 是本机注册的独立 OpenSpec 仓库），或当前工作位于 store 中，请运行 `openspec store list --json` 查找已注册的 store ID，然后在读写 Spec 和 Change 的命令中传入 `--store <id>`（包括 `new change`、`change new`、`status`、`instructions`、`list`、`show`、`validate`、`archive`、`doctor`、`context`、`schemas`、`view`、`rebase`、`transition`、`abandon`、`detect-stale`、`allocate-requirements`）。选择后，在本次工作流的后续步骤中持续使用 `--store <id>`。下面未带范围的命令示例都只是简写：执行前要追加该选项。例如运行 `openspec status --change "<name>" --json --store "<id>"`，不要直接运行未带选项的形式。其他命令不接受该选项。命令打印的后续提示已经带有该选项，继续使用即可。没有 store 时，命令作用于最近的本地 `openspec/` 根目录。

**输入**：用户请求应包含 Change 名称（kebab-case）或要构建内容的描述。

**步骤**

1. **理解请求**

   若输入不明确，开放式询问：“你想处理什么 Change？请描述要新增、调整或修复的内容。”从描述推导 kebab-case 名称（例如“新增用户认证”→ `add-user-auth`）。在理解目标前不得继续。

2. **确定 schema**

   除非用户明确要求其他 schema，否则省略 `--schema` 并使用默认的 `code-spec`。用户明确指定 schema 时使用 `--schema <name>`；用户要求查看可用工作流时，运行 `openspec context --json` 解析根目录后，在返回的 `root.path` 中运行 `openspec schemas --json` 供其选择。

3. **创建 Change 目录**

   ```bash
   openspec new change "<name>"
   ```

   仅在用户指定其他 schema 时追加 `--schema <name>`。如已选择注册 Store，在此后支持该选项的命令中持续附加 `--store "<store-id>"`。CLI 会在解析出的规划目录创建 Change 骨架；不得手工创建 Change 目录。若同名 Change 已存在，建议继续现有 Change。

4. **展示工件状态**

   ```bash
   openspec status --change "<name>" --json
   ```

   使用返回的 `planningHome`、`changeRoot`、`artifactPaths`、`actionContext` 和 `nextSteps`，不得自行假定仓库内路径。

5. **获取第一个工件的说明**

   从 status 输出选择第一个 `status: "ready"` 的工件，然后运行：
   ```bash
   openspec instructions <first-artifact-id> --change "<name>" --json
   ```

   该命令返回模板、上下文与工件指导。

6. **停止并等待用户指示**

**输出**

汇总 Change 名称与位置、使用的 schema 和工件序列、当前进度、首个工件模板，并提示：“已准备好创建第一个工件。请描述这个 Change 的具体内容，或要求我继续。”

**护栏**

- 不创建任何工件，只展示第一个工件说明。
- 不得越过首个工件模板继续执行。
- 名称不符合 kebab-case 时要求用户提供有效名称。
- 使用非默认 schema 时传入 `--schema`。
