---
name: openspec-bulk-archive-change
description: 批量校验并归档已完成的 Change。
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



### 不支持的 canonical 阶段：bulk-archive

此工作流不是 canonical 生命周期阶段适配器。不要从中推断规划、继续、实现、验证或归档行为。保留现有行为，或停止并要求使用明确支持的 canonical 阶段。

Archive multiple completed changes in a single operation.

This skill allows you to batch-archive changes, handling spec conflicts intelligently by checking the codebase to determine what's actually implemented.

**Store 选择：** 如果用户指定了 store（store 是本机注册的独立 OpenSpec 仓库），或当前工作位于 store 中，请运行 `openspec store list --json` 查找已注册的 store ID，然后在读写 Spec 和 Change 的命令中传入 `--store <id>`（包括 `new change`、`change new`、`status`、`instructions`、`list`、`show`、`validate`、`archive`、`doctor`、`context`、`schemas`、`view`、`rebase`、`transition`、`abandon`、`detect-stale`、`allocate-requirements`）。选择后，在本次工作流的后续步骤中持续使用 `--store <id>`。下面未带范围的命令示例都只是简写：执行前要追加该选项。例如运行 `openspec status --change "<name>" --json --store "<id>"`，不要直接运行未带选项的形式。其他命令不接受该选项。命令打印的后续提示已经带有该选项，继续使用即可。没有 store 时，命令作用于最近的本地 `openspec/` 根目录。

`<capability-path>` is the spec directory relative to `specs/` (for example, `user-auth` or `identity/user-auth`). Preserve the full path from each delta spec when resolving its main spec.

**Input**: None required (prompts for selection)

**Steps**

1. **Get active changes**

   Run `openspec list --json` to get all active changes.

   If no active changes exist, inform user and stop.

2. **Prompt for change selection**

   Ask the user to choose changes (multi-select):
   - Show each change with its schema
   - Include an option for "All changes"
   - Allow any number of selections (1+ works, 2+ is the typical use case)

   **IMPORTANT**: Do NOT auto-select. Always let the user choose.

   **Load current archive inputs once for the selected root before batch validation:**

   Choose one selected change from this root and run
   `openspec instructions archive --change "<selected-change>" --json` with the
   same selected-root flags. This lookup is advisory and optional: it only supplies
   extra prompt inputs, so it must never block the batch. If it fails or returns
   invalid JSON — for example on an older CLI that does not support this command
   yet — continue the batch with no context and no operation guidance. Do not
   report an error and do not stop.

   A valid response may omit `context` and `operationGuidance`. Treat
   `context` as a required prompt-level input across the batch: read and consider
   it, and apply relevant project facts, conventions, and constraints. Treat
   `operationGuidance` as optional additive advice: read and consider every
   entry, and follow entries that are applicable and compatible with the built-in
   batch workflow.

   Keep both fields separate from conflict analysis, explicit user choices,
   resolved paths, CLI checks, and command contracts. If context conflicts with one
   of those controlling inputs, report the conflict and preserve the controlling
   value. If guidance is inapplicable or conflicts with a controlling input, do not
   follow it and explain why. Do not infer skipped prompts, replacement paths, or
   flags from either field, and do not copy their text verbatim into specs, changes,
   or summaries. These are prompt-level behavior contracts, not enforceable checks.

3. **Batch validation - gather status for all selected changes**

   For each selected change, collect:

   a. **Artifact status** - Run `openspec status --change "<name>" --json`
      - Parse `schemaName`, `artifacts`, `planningHome`, `changeRoot`, `artifactPaths`, and `actionContext`
      - Note which artifacts are `done` vs other states

   b. **Task completion** - Read `artifactPaths.tasks.existingOutputPaths` from status JSON
      - Count `- [ ]` (incomplete) vs `- [x]` (complete)
      - If no tasks file exists, note as "No tasks"

   c. **Delta specs** - Check `artifactPaths.specs.existingOutputPaths` from status JSON
      - List which capability specs exist
      - For each, extract requirement names (lines matching `### Requirement: <name>`)
      - Treat this list as the only delta-spec source. If the `specs` entry is
        missing or the list is empty, perform no spec sync or specs-instruction
        lookup for that change; do not infer deltas from unrelated artifacts.
      - Evaluate this independently for every change, including mixed-schema
        batches where some schemas have no `specs` artifact.
4. **Detect spec conflicts**

   Build a map keyed by `<capability-path>`, the exact path relative to `specs/`:

   ```text
   identity/user-auth -> [change-a, change-b]  <- CONFLICT (2+ changes)
   billing/user-auth  -> [change-c]            <- OK (different full path)
   ```

   A conflict exists when 2+ selected changes have delta specs for the exact same `<capability-path>`.

5. **Resolve conflicts agentically**

   **For each conflict**, investigate the codebase:

   a. **Read the delta specs** from each conflicting change to understand what each claims to add/modify

   b. **Search the codebase** for implementation evidence:
      - Look for code implementing requirements from each delta spec
      - Check for related files, functions, or tests

   c. **Determine resolution**:
      - If only one change is actually implemented -> sync that one's specs
      - If both implemented -> apply in chronological order (older first, newer overwrites)
      - If neither implemented -> skip spec sync, warn user

   d. **Record resolution** for each conflict:
      - An inclusion or exclusion decision for every delta spec, keyed by change and `<capability-path>`
      - Which included delta specs to apply and in what order
      - Which delta specs to exclude from sync because their implementation is missing
      - Rationale (what was found in codebase)

6. **Show consolidated status table**

   Display a table summarizing all changes:

   ```markdown
   | Change              | Artifacts | Tasks | Specs   | Conflicts | Status |
   |---------------------|-----------|-------|---------|-----------|--------|
   | schema-management   | Done      | 5/5   | 2 delta | None      | Ready  |
   | project-config      | Done      | 3/3   | 1 delta | None      | Ready  |
   | add-oauth           | Done      | 4/4   | 1 delta | identity/user-auth (!) | Ready* |
   | add-verify-skill    | 1 left    | 2/5   | None    | None      | Warn   |
   ```

   For conflicts, show the resolution:
   ```text
   * Conflict resolution:
     - identity/user-auth spec: Will apply add-oauth then add-jwt (both implemented, chronological order)
   ```

   For incomplete changes, show warnings:
   ```text
   Warnings:
   - add-verify-skill: 1 incomplete artifact, 3 incomplete tasks
   ```

7. **Confirm batch operation**

   Ask the user a single confirmation question:

   - "Archive N changes?" with options based on status
   - Options might include:
     - "Archive all N changes"
     - "Archive only N ready changes (skip incomplete)"
     - "Cancel"

   If there are incomplete changes, make clear they'll be archived with warnings.

   Route on the answer by intent, not by exact label — you wrote these labels,
   so match what the user picked rather than the wording above:
   - "Cancel" — stop, do not archive. Report that nothing was archived and skip the remaining steps.
   - The archive-everything option — proceed with every selected change
   - The ready-only option — proceed with only the changes the step 6 table marks `Ready` or `Ready*`, and record the rest as Skipped in step 8d. If a `Ready*` change's conflict partner is skipped, re-derive that conflict's resolution using only the changes being archived.
   - Anything else — ask again rather than archiving

   Before step 8 writes the first main spec or moves any change, fetch every
   required specs-rule snapshot for the confirmed batch. For each change that will
   sync concrete `artifactPaths.specs.existingOutputPaths`, run
   `openspec instructions specs --change "<name>" --json` exactly once with the
   same selected-root flags. Obtain all snapshots before the first write or move.
   If any lookup exits non-zero or returns invalid artifact-instruction JSON,
   identify the affected change, report the error, and stop the whole batch before
   any main-spec write or change move. Do not treat lookup failure as omitted
   rules. A valid response without `rules` is the no-rules case.

8. **Execute archive for each confirmed change**

   Before processing, carry the recorded decisions from step 5 (after any step 7 re-derivation) into two per-delta sets:
   - `includedDeltas`: all non-conflicting delta specs from confirmed changes plus conflict deltas selected for sync
   - `excludedDeltas`: conflict deltas from confirmed changes excluded because their implementation is missing
   - A single change can have both included and excluded delta specs. Keep the decision per delta; do not collapse it into a per-change sync flag.

   Process changes in the determined order (respecting conflict resolution):

   a. **Sync included delta specs**:
      - Run the `openspec-sync-specs` workflow inline (agent-driven intelligent merge) only for changes with entries in `includedDeltas`, passing only the included delta paths and explicitly instructing it to ignore that change's `excludedDeltas`. Wait for it to finish.
      - For conflicts, apply in resolved order.
      - Pass that change's fetched specs-rule snapshot into inline sync; inline
        sync must reuse it without fetching instructions again
      - Apply artifact rules only to main specs produced by that change. They do
        not change conflict resolution, archive behavior, or CLI contracts, and
        their text is not copied into an output file
      - Do not delegate to a background task — step 8c would move `changeRoot` out from under a sync that is still reading it.
      - If a change has no included delta specs, do not run the sync workflow for it.

   b. **Verify included delta specs before moving changeRoot**:
      - Re-run the comparison only for delta specs in `includedDeltas` against main spec at `<planningHome.root>/openspec/specs/<capability-path>/spec.md` (use the store-aware `planningHome.root` from step 3 status JSON, not a hardcoded repo path).
      - Verify that main specs are updated:
        - ADDED requirements present
        - MODIFIED requirements carrying scenario and description changes named in the delta, with their other scenarios intact
        - REMOVED requirements gone — and where this sync retired a capability (removed its last requirement, leaving `## Requirements` empty), its main spec deleted rather than left empty; a spec the sync deliberately kept and reported is also a match
        - RENAMED requirements present under the new name and absent under the old one
      - Do not verify delta specs in `excludedDeltas`; they are intentionally left unsynced.
      - If sync failed or any capability does not match verification, report what differs and fail/skip moving that change's `changeRoot` — do not archive that change. `changeRoot` remains intact.

   c. **Perform the archive**:

      Target name: use the change name as-is when it already starts with a `YYYY-MM-DD-` prefix; otherwise prepend the current date as `YYYY-MM-DD-<name>` (same rule as `openspec archive`).

      ```bash
      mkdir -p "<planningHome.changesDir>/archive"
      mv "<changeRoot>" "<planningHome.changesDir>/archive/<target-name>"
      ```

   d. **Track outcome** for each change:
      - Success: archived successfully
      - Failed: error during archive or spec verification (record error)
      - Skipped: user chose not to archive (if applicable)
      - Sync skipped: for every delta in `excludedDeltas`, report `sync skipped` with the change, `<capability-path>`, and recorded reason. This is distinct from skipping the archive.

9. **Display summary**

   Show final results:

   ```markdown
   ## Bulk Archive Complete

   Archived 3 changes:
   - schema-management-cli -> archive/2026-01-19-schema-management-cli/
   - project-config -> archive/2026-01-19-project-config/
   - add-oauth -> archive/2026-01-19-add-oauth/

   Skipped 1 change:
   - add-verify-skill (user chose not to archive incomplete)

   Spec sync summary:
   - 4 delta specs synced to main specs
   - 1 delta spec sync skipped (add-jwt, identity/user-auth: implementation not found)
   - 1 conflict resolved (identity/user-auth: synced add-oauth, skipped add-jwt)
   ```

   If any failures:
   ```text
   Failed 1 change:
   - some-change: Archive directory already exists
   ```

**Conflict Resolution Examples**

Example 1: Only one implemented
```text
Conflict: <planningHome.root>/openspec/specs/auth/spec.md touched by [add-oauth, add-jwt]

Checking add-oauth:
- Delta adds "OAuth Provider Integration" requirement
- Searching codebase... found src/auth/oauth.ts implementing OAuth flow

Checking add-jwt:
- Delta adds "JWT Token Handling" requirement
- Searching codebase... no JWT implementation found

Resolution: Only add-oauth is implemented. Will sync add-oauth specs only.
```

Example 2: Both implemented
```text
Conflict: <planningHome.root>/openspec/specs/api/spec.md touched by [add-rest-api, add-graphql]

Checking add-rest-api (created 2026-01-10):
- Delta adds "REST Endpoints" requirement
- Searching codebase... found src/api/rest.ts

Checking add-graphql (created 2026-01-15):
- Delta adds "GraphQL Schema" requirement
- Searching codebase... found src/api/graphql.ts

Resolution: Both implemented. Will apply add-rest-api specs first,
then add-graphql specs (chronological order, newer takes precedence).
```

**Output On Success**

```markdown
## Bulk Archive Complete

Archived N changes:
- <change-1> -> archive/<target-name-1>/
- <change-2> -> archive/<target-name-2>/

Spec sync summary:
- N delta specs synced to main specs
- No conflicts (or: M conflicts resolved)
```

**Output On Partial Success**

```markdown
## Bulk Archive Complete (partial)

Archived N changes:
- <change-1> -> archive/<target-name-1>/

Skipped M changes:
- <change-2> (user chose not to archive incomplete)

Failed K changes:
- <change-3>: Archive directory already exists
```

**Output When No Changes**

```markdown
## No Changes to Archive

No active changes found. Create a new change to get started.
```

**Guardrails**
- Allow any number of changes (1+ is fine, 2+ is the typical use case)
- Always prompt for selection, never auto-select
- Detect spec conflicts early and resolve by checking codebase
- When both changes are implemented, apply specs in chronological order
- Skip spec sync only when implementation is missing (warn user)
- Show clear per-change status before confirming
- Use single confirmation for entire batch
- Never archive after the user cancels the confirmation — a cancelled batch archives nothing
- Track and report all outcomes (success/skip/fail)
- Preserve .openspec.yaml when moving to archive
- Archive directory target uses current date: YYYY-MM-DD-<name>; a name that already starts with a `YYYY-MM-DD-` prefix is used as-is (never stack a second date)
- If archive target exists, fail that change but continue with others
- If sync is requested, run the `openspec-sync-specs` workflow inline (agent-driven) for each change with included delta specs
- Carry the per-delta `includedDeltas` and `excludedDeltas` decisions into execution; sync and verify only included deltas
- Report every excluded delta as `sync skipped` without treating the archive itself as skipped
- Never archive a change while a spec sync is still in flight — run the sync inline and verify main specs at `<planningHome.root>/openspec/specs/<capability-path>/spec.md` before moving `changeRoot`
- Fetch archive inputs once per selected root before spec inspection or moves
- Fetch all required specs-rule snapshots before the batch's first main-spec write or move
- A failed archive-inputs lookup never blocks the batch; it proceeds with no context or guidance
- A failed specs instruction lookup stops the whole batch atomically
- Changes without concrete `artifactPaths.specs.existingOutputPaths` continue without spec sync
- Apply relevant runtime context across the batch and report conflicts
- Operation guidance remains advisory; consider every entry and explain rejected advice
- Keep runtime inputs, conflict analysis, CLI-derived values, and artifact rules separate
- Artifact rules constrain only written specs
- Never copy runtime input or artifact-rule text verbatim into output files
