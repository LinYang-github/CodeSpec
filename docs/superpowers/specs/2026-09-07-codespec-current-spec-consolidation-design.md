# CodeSpec Current Specification Consolidation Design

## Goal

Make the current `codespec/specs/` tree the sole durable representation of
implemented business behavior.  A completed Change must merge its content into
the current module specifications, refresh the global business relationship
summary, and then be deleted.  Archived Change directories and separate
history copies are not retained.

This design also makes test cases directly readable by other platforms while
requiring UI-facing test steps to be verified against the actual application.

## Decisions

1. Design approval and task approval are separate, user-originated gates.
2. Every module has exactly three durable specification files:

   ```text
   codespec/specs/<module>/
   ├── spec.md
   ├── interface.md
   └── api.md
   ```

3. `spec.md` contains Requirements, Scenarios, and their readable test cases.
   There is no durable or temporary `test-cases.md`.
4. `interface.md` is the canonical source for cross-boundary module
   relationships.  The global flow graph is dynamically derived from every
   current module's `interface.md`; no graph file is stored.
5. `api.md` contains only the module's de-duplicated, actual route paths.  It
   does not describe HTTP methods, inputs, outputs, callers, or errors.
6. `business.md` is retained as the global module registry and receives
   generated Input, Output, and Related Modules summary columns.  It is a
   current-state projection, not a Change archive.
7. UI Changes need a real runnable browser E2E environment.  Without one they
   cannot be archived.

## Non-goals

- Do not preserve new `archive/changes/` directories, Change snapshots, or a
  separate graph artifact after successful archive.
- Do not allow workflow or the UI to edit Current Specification files directly.
  Only the archive transaction writes them.
- Do not define the final CodeSpec UI layout in this design.  The required data
  for a future overview graph is defined here; its visual design requires a
  separate approval.
- Do not automatically delete already-existing archive directories during
  migration.  That is a separate destructive action requiring explicit user
  approval.

## Lifecycle and approvals

```text
ANALYZE
  -> DESIGN -- independent user approval --> TASKS
  -> TASKS  -- independent user approval --> IMPLEMENT
  -> VERIFY -> ARCHIVE -> delete Change
```

The public term is **TASKS**.  An internal compatibility state may continue to
be named `PLAN`, but all user-facing commands and messages say `tasks`.

Each approval is stored with the Change revision, a content fingerprint, and
time.  It is valid only for that exact content:

- **Design approval** fingerprints `design.md` and the Requirement/Scenario
  sections of `spec.md`.
- **Task approval** fingerprints `tasks.md`, the test-case sections of
  `spec.md`, and the verification plan.

The workflow stops after creating Design and after creating Tasks.  Each next
stage requires a new user message and an explicit approval command; one answer
cannot approve both stages.  A semantic design change, task/test-case change,
rebase, or conflict resolution increases the revision and revokes the affected
approval.  Factual UI locator updates do not revoke approval only when the
user-visible flow, input, and expected result are unchanged.

## Active Change artifacts

Changes are temporary workspaces and contain only:

```text
codespec/changes/<change-id>/
├── metadata.yaml
├── design.md
├── spec.md
├── tasks.md
└── verification.md
```

`design.md` contains goals, scope, module impact, route and interface deltas,
and UI source discovery.  `spec.md` contains the Requirement/Scenario delta and
the test cases that belong to those Scenarios.  `tasks.md` maps implementation
tasks to Requirement, Scenario, and test-case IDs.  `verification.md` contains
the executed evidence.

There are no `proposal.md`, `contracts.md`, or `test-cases.md` artifacts.

## Current module specifications

### spec.md

`spec.md` is readable Markdown and the direct portable input for other
platforms.  Test cases are nested under their owning Scenario so that the
association does not require duplicate files or repeated fields.

```md
## MOD-USER-REQ-004: 管理员新增用户

#### Scenario: SCN-001 新增有效用户
- GIVEN 管理员已登录，用户名未被使用
- WHEN 管理员提交合法用户信息
- THEN 用户列表出现新用户
- ERROR 参数不合法时不创建用户并提示错误

### Test Cases

#### TC-SCN-001-UI-01: 管理员新增有效用户

- **类型：** UI E2E
- **自动化测试：** `e2e/user-management/add-user.spec.ts`
- **工程定位：** `/users`；`UserManagementPage.tsx`；按钮“新增用户”

| 步骤 | 用户操作 | 预期结果 |
|---|---|---|
| 1 | 进入“用户管理”界面 | 显示标题和“新增用户”按钮 |
| 2 | 点击“新增用户” | 显示新增用户表单 |
| 3 | 输入合法信息并确认 | 用户列表出现新用户 |
```

The Markdown profile is deliberately constrained: fixed heading levels, fixed
field labels, and a fixed three-column step table.  Core parses Markdown AST,
not regular expressions.  This keeps the document readable and portable while
allowing deterministic validation and optional JSON/CSV adapters later.

### interface.md

`interface.md` holds the full relationship contract.  Its fixed fields are:

- stable relationship ID;
- consumer module and provider module;
- actual route or event name;
- input, output, and error semantics;
- linked Requirement and Scenario IDs.

The provider's relationship view and the consumer's relationship view share
the same relationship ID.  Core rejects mismatched mirrors.  HTTP method can
be recorded here when a call needs it, but never in `api.md`.

### api.md

`api.md` is a route set owned by the provider module:

```md
# 用户管理路由

- /api/users/add
- /api/users/{id}
```

The canonical route key is the normalized route path.  Reusing the same route
adds no duplicate row.  Incompatible ownership, removal, replacement, or a
relation contract conflict requires human resolution during archive.

## Global business relationship projection

At archive, Core parses every current `interface.md`, builds the directed
module graph, and rewrites only the generated summary columns in `business.md`:

```md
| 模块 | 输入 | 输出 | 关联模块 |
|---|---|---|---|
| MOD-WEB-USER | 用户新增操作 | `/api/users/add` | → MOD-USER |
| MOD-USER | `/api/users/add` | 用户创建结果 | ← MOD-WEB-USER；→ MOD-NOTIFY |
```

The underlying detailed data remains in `interface.md`; `business.md` is a
human-readable projection.  A UI overview graph consumes the same parsed
relationships, so it cannot diverge from the documentation.

## UI test-case conformance

For every `UI E2E` test case, the workflow performs two distinct checks:

1. During Design/Tasks, inspect the engineering source to discover the page
   route, page heading, component, and semantic controls.
2. During Verify, run the test against the real application in a browser and
   prove that the documented steps, visible labels, and expected result execute
   successfully.

Tests use semantic roles and accessible names instead of CSS selectors, DOM
depth, or pixels.  Each Scenario has at least one test case.  Every test case
has an automation mapping and current verification evidence.  A UI Change
without a configured, runnable E2E environment cannot pass verification or
archive.  Non-UI behavior may use unit or integration test cases but remains
subject to the same Requirement -> Scenario -> Test Case -> Evidence chain.

## Archive transaction

1. Read the active Change, all affected current module specs, and all current
   interfaces needed to compute the complete business graph.
2. Validate both approvals, Requirement/Scenario/test-case links, task links,
   route uniqueness, relationship mirrors, source anchors, and current E2E
   evidence.
3. Prepare merged `spec.md`, `interface.md`, and `api.md` for affected modules;
   rebuild the generated relationship columns in `business.md`.
4. If a route or relationship cannot be safely merged, stop before any write
   and ask the user to retain, replace, or coexist.  Persist the decision in
   the merged current specs; do not retain a Change archive merely for it.
5. Atomically install all prepared module files and `business.md`, then delete
   the active Change directory and remove its index entry.
6. On any failure, restore all previous module files and `business.md`; leave
   the Change untouched for correction and retry.

## Compatibility and migration

Existing modules initially have only `spec.md`.  Migration adds empty,
canonical `interface.md` and `api.md` documents for modules without relations
or routes, then validates the three-file module layout.  New behavior applies
to future archives.  Existing archived Change directories are neither read for
the current graph nor automatically removed.

## Acceptance checks

- A workflow cannot reach Tasks without a fresh design approval, nor
  Implementation without a fresh task approval.
- A successful archive leaves no active or archived Change copy, but updates
  all affected three-file module specs and `business.md` atomically.
- Duplicate routes do not duplicate `api.md`; conflicting routes or relations
  cannot archive without a human decision.
- `business.md` and the graph parsed from `interface.md` describe the same
  directed module relationships.
- Every Scenario resolves to at least one readable Markdown test case and PASS
  evidence.
- UI test cases fail verification if their actual page, control, or interaction
  cannot be executed in the browser.
