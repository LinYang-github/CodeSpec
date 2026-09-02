---
name: openspec-apply-change
description: 根据 OpenSpec Change 中的任务实现变更。
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



### apply 阶段适配器

当前是 implementation 阶段。执行前解析 canonical 上下文：运行 `openspec context --json`，解析一个明确的 `CHG-YYYYMMDD-NNN`（上下文缺失或有歧义时明确停止），然后运行 `openspec status --change "<CHG-ID>" --json` 并加载声明的 `metadata.yaml` 和产物路径。将解析出的 Change ID、status、mode、baseline hash、Requirement ID、准确的 Scenario ID、Task ID、测试/证据引用、必需验证命令和 canonical 路径注入 implementation 提示。方法论路由：preserve the Change mode routing above and use the existing Superpowers methodology。动作完成后刷新状态，并在 canonical 产物中记录追踪关系。

Implement tasks from an OpenSpec change.

**Store 选择：** 如果用户指定了 store（store 是本机注册的独立 OpenSpec 仓库），或当前工作位于 store 中，请运行 `openspec store list --json` 查找已注册的 store ID，然后在读写 Spec 和 Change 的命令中传入 `--store <id>`（包括 `new change`、`change new`、`status`、`instructions`、`list`、`show`、`validate`、`archive`、`doctor`、`context`、`schemas`、`view`、`rebase`、`transition`、`abandon`、`detect-stale`、`allocate-requirements`）。选择后，在本次工作流的后续步骤中持续使用 `--store <id>`。下面未带范围的命令示例都只是简写：执行前要追加该选项。例如运行 `openspec status --change "<name>" --json --store "<id>"`，不要直接运行未带选项的形式。其他命令不接受该选项。命令打印的后续提示已经带有该选项，继续使用即可。没有 store 时，命令作用于最近的本地 `openspec/` 根目录。

**Input**: Optionally specify a change name (e.g., `/openspec-apply-change add-auth`). If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Steps**

1. **Select the change**

   If a name is provided, use it. Otherwise:
   - Infer from conversation context if the user mentioned a change
   - Auto-select if only one active change exists
   - If ambiguous, run `openspec list --json` to get available changes and ask the user to select one

   Always announce: "Using change: <name>" and how to override (e.g., `/openspec-apply-change <other>`).

2. **Check status to understand the schema**
   ```bash
   openspec status --change "<name>" --json
   ```
   Parse the JSON to understand:
   - `schemaName`: The workflow being used (e.g., "spec-driven")
   - `planningHome`, `changeRoot`, and `actionContext`: planning scope and edit constraints
   - Which artifact contains the tasks (typically "tasks" for spec-driven, check status for others)

3. **Get apply instructions**

   ```bash
   openspec instructions apply --change "<name>" --json
   ```

   This returns:
   - `contextFiles`: artifact ID -> array of concrete file paths (varies by schema - could be proposal/specs/design/tasks or spec/tests/implementation/docs)
   - Progress (total, complete, remaining)
   - Task list with status
   - Dynamic instruction based on current state
   - Optional `context`: current required project instruction input from the selected root
   - Optional `operationGuidance`: current advisory guidance for apply

   **Handle states:**
   - If `state: "blocked"` (missing artifacts): show message, suggest using `/openspec-continue-change` (if it is not installed, run `openspec status --change "<name>" --json` to see the next artifact and `openspec instructions <artifact-id> --change "<name>" --json` for how to create it)
   - If `state: "all_done"`: congratulate, suggest archive
   - Otherwise: proceed to implementation

   Treat `context` as a required prompt-level input. Read and consider it, and
   apply relevant project facts, conventions, and constraints while implementing.
   Treat `operationGuidance` as optional additive advice. Read and consider every
   entry, and follow entries that are applicable and compatible with the built-in
   workflow.

   Keep both fields separate from CLI-returned state, missing artifacts, tasks,
   progress, `contextFiles`, and the built-in `instruction`. They are not
   evidence of task completion, do not replace the built-in instruction, and do
   not permit bypassing a blocked state. If context conflicts with the built-in
   instruction, an explicit user choice, or a CLI-controlled value, report the
   conflict and preserve the controlling value. If guidance is inapplicable or
   conflicts with those controlling inputs, do not follow it and explain why.
   These are prompt-level behavior contracts, not enforceable checks.

4. **Read context files**

   Read every file path listed under `contextFiles` from the apply instructions output.
   The files depend on the schema being used:
   - **spec-driven**: proposal, specs, design, tasks
   - Other schemas: follow the contextFiles from CLI output

   Do not copy `context` or `operationGuidance` verbatim into implementation
   files or planning artifacts unless the user separately asks for that content.

5. **Show current progress**

   Display:
   - Schema being used
   - Progress: "N/M tasks complete"
   - Remaining tasks overview
   - Dynamic instruction from CLI

6. **Implement tasks (loop until done or blocked)**

   For each pending task:
   - Show which task is being worked on
   - Make the code changes required
   - Keep changes minimal and focused
   - Mark task complete in the tasks file: `- [ ]` → `- [x]`
   - Continue to next task

   **Pause if:**
   - Task is unclear → ask for clarification
   - Implementation reveals a design issue → suggest updating artifacts
   - A task needs work beyond what the spec and tasks describe, or you are tempted to drop, narrow, defer, or accept exceptions to specified behavior to make it fit → surface the added scope and ask; do not absorb it silently
   - Error or blocker encountered → report and wait for guidance
   - User interrupts

7. **On completion or pause, show status**

   Display:
   - Tasks completed this session
   - Overall progress: "N/M tasks complete"
   - If all done: suggest archive
   - If paused: explain why and wait for guidance

**Output During Implementation**

```
## Implementing: <change-name> (schema: <schema-name>)

Working on task 3/7: <task description>
[...implementation happening...]
✓ Task complete

Working on task 4/7: <task description>
[...implementation happening...]
✓ Task complete
```

**Output On Completion**

```
## Implementation Complete

**Change:** <change-name>
**Schema:** <schema-name>
**Progress:** 7/7 tasks complete ✓

### Completed This Session
- [x] Task 1
- [x] Task 2
...

All tasks complete! You can archive this change with `/openspec-archive-change`.
```

**Output On Pause (Issue Encountered)**

```
## Implementation Paused

**Change:** <change-name>
**Schema:** <schema-name>
**Progress:** 4/7 tasks complete

### Issue Encountered
<description of the issue>

**Options:**
1. <option 1>
2. <option 2>
3. Other approach

What would you like to do?
```

**Guardrails**
- Keep going through tasks until done or blocked
- Always read context files before starting (from the apply instructions output)
- If task is ambiguous, pause and ask before implementing
- If implementation reveals issues, pause and suggest artifact updates
- Keep code changes minimal and scoped to each task
- Update task checkbox immediately after completing each task
- Pause on errors, blockers, or unclear requirements - don't guess
- When a task needs work beyond what the spec describes, surface the added scope and pause - never silently narrow, defer, or simplify away specified behavior
- Only mark a task `- [x]` when its specified behavior is fully implemented, not when it is partially done or deferred
- Use contextFiles from CLI output, don't assume specific file names
- Do not use context or operation guidance as proof that a task is complete
- Apply relevant project context; report conflicts with controlling workflow inputs
- Consider every guidance entry; explain any inapplicable or conflicting advice
- Do not copy runtime context or operation guidance into implementation files or planning artifacts
- Preserve CLI-controlled blocked/ready/all-done behavior and completion criteria

**Fluid Workflow Integration**

This skill supports the "actions on a change" model:

- **Can be invoked anytime**: Before all artifacts are done (if tasks exist), after partial implementation, interleaved with other actions
- **Allows artifact updates**: If implementation reveals design issues, suggest updating artifacts - not phase-locked, work fluidly
