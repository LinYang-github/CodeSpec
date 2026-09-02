---
name: openspec-ff-change
description: 快速生成实现所需的全部 OpenSpec 产物。
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



### ff 阶段适配器

当前是 resume/forward 阶段。执行前解析 canonical 上下文：运行 `openspec context --json`，解析一个明确的 `CHG-YYYYMMDD-NNN`（上下文缺失或有歧义时明确停止），然后运行 `openspec status --change "<CHG-ID>" --json` 并加载声明的 `metadata.yaml` 和产物路径。将解析出的 Change ID、status、mode、baseline hash、Requirement ID、准确的 Scenario ID、Task ID、测试/证据引用、必需验证命令和 canonical 路径注入 resume/forward 提示。方法论路由：preserve the Change mode routing above and use the existing Superpowers methodology。动作完成后刷新状态，并在 canonical 产物中记录追踪关系。

快速完成规划工件创建：一次性生成开始实现所需的全部工件。

默认使用 `code-spec` schema。工件和依赖顺序必须以 `openspec status --change "<name>" --json` 的实际输出为准；默认工件包括 `metadata.yaml`、`proposal.md`、`design.md`、`spec.md`、`tasks.md` 和 `verification.md`。

**Store 选择：** 如果用户指定了 store（store 是本机注册的独立 OpenSpec 仓库），或当前工作位于 store 中，请运行 `openspec store list --json` 查找已注册的 store ID，然后在读写 Spec 和 Change 的命令中传入 `--store <id>`（包括 `new change`、`change new`、`status`、`instructions`、`list`、`show`、`validate`、`archive`、`doctor`、`context`、`schemas`、`view`、`rebase`、`transition`、`abandon`、`detect-stale`、`allocate-requirements`）。选择后，在本次工作流的后续步骤中持续使用 `--store <id>`。下面未带范围的命令示例都只是简写：执行前要追加该选项。例如运行 `openspec status --change "<name>" --json --store "<id>"`，不要直接运行未带选项的形式。其他命令不接受该选项。命令打印的后续提示已经带有该选项，继续使用即可。没有 store 时，命令作用于最近的本地 `openspec/` 根目录。

**输入**：用户请求应包含 Change 名称（kebab-case）或要构建内容的描述。

**步骤**

1. **理解请求**

   若输入不清晰，开放式询问：“你想处理什么 Change？请描述要新增、调整或修复的内容。” 从描述推导 kebab-case 名称（例如“新增用户认证”→ `add-user-auth`）。未理解目标前不得继续。

2. **创建 Change 目录**

   ```bash
   openspec new change "<name>"
   ```

   若用户明确指定了其他 schema，使用 `openspec new change "<name>" --schema "<schema-name>"`。若已选择注册的 Store，在所有支持的命令后附加 `--store "<store-id>"`。CLI 会在由配置解析的规划目录创建骨架；同名 Change 存在时，询问用户是否继续。

3. **获取工件构建顺序**

   ```bash
   openspec status --change "<name>" --json
   ```

   解析 `applyRequires`、每个工件的 `status` 与 `requires` 边，以及 `planningHome`、`changeRoot`、`artifactPaths`、`actionContext`。必须使用返回的路径与作用域，不得自行假定仓库内路径。

4. **创建所需集合中的全部工件**

   用待办列表跟踪进度，并按依赖顺序循环。对每个 `ready` 工件：
   - 运行 `openspec instructions <artifact-id> --change "<name>" --json`。
   - 将 `context` 与 `rules` 仅用作约束，绝不复制到产物；按 `template` 和 `instruction` 创建文件。若说明委派给特定 skill 或命令，调用它完成工件，然后验证 `resolvedOutputPath` 已存在。若路径是 glob，按 `instruction` 选择具体路径。
   - 每次都从磁盘重新读取已完成的 `dependencies`，即使本次对话已经读取过。
   - 简短汇报：“已创建 <artifact-id>”。

   每创建一个工件后重跑 `openspec status --change "<name>" --json`。所需集合是 `applyRequires` 加上沿 `status --json` 的 `requires` 边可达的全部传递依赖；不要创建集合外工件。

   `status` 只反映文件存在性。`applyRequires` 工件显示 `done` **不代表**依赖存在；必须根据每个工件的 `requires` 边而非 `status` 建立所需集合，即使 `done` 工件仍会列出其依赖。

   仅可跳过已显示 `status: "skipped"` 的工件（其文件不得存在），或在运行 `openspec instructions <artifact-id> --change "<name>" --json` 后、`instruction` 明确标记为可选的工件。不得自行判断跳过；应告知用户且不再反复考虑。依赖是启用条件而非阻塞门槛：若工件仅因跳过可选依赖而 `blocked`，仍应创建它。直到所需集合的每项均为 `done`、`skipped` 或已明确跳过才停止。

5. **展示最终状态**

   ```bash
   openspec status --change "<name>"
   ```

**输出**

汇总 Change 名称、位置、已创建工件、跳过原因，并说明：“实现所需的全部规划产物已就绪。准备实现时，运行 `/openspec-apply-change`。”

**护栏**

- 每类工件以 `openspec instructions` 的 `instruction` 为权威指导；schema 决定工件内容，`template` 决定文件结构。
- `context`、`rules`、`<context>`、`<rules>`、`<project_context>` 是约束，不得写入工件。
- 创建 apply 阶段传递依赖的全部工件，而非仅创建 `applyRequires` 中列出的 ID。
- 每次创建前从磁盘重读依赖；关键上下文不明确时询问用户，但轻微细节作合理决定并记录。
- 完成后验证每个工件文件存在。
