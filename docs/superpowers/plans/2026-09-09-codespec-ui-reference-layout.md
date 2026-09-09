# CodeSpec UI Reference Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 CodeSpec 本地 UI 改造成手绘参考图的左侧工程树 + 右侧工作区，并在变更管理中用固定表格展示全部 Change，支持查看设计相关文件和确认归档。

**Architecture:** 保留现有本地 API、索引扫描、Change 生命周期和归档事务。扩展 UI 索引以提供统一的全部 Change 投影和关联 Requirement 标识；前端新增树节点状态、模块工作区和 Change 表格，继续复用已有 Change 详情、归档预览和文档结构化渲染能力。

**Tech Stack:** TypeScript、原生 JavaScript、HTML/CSS、Node HTTP server、Vitest、pnpm。

**Spec:** `docs/superpowers/specs/2026-09-09-codespec-ui-reference-layout-design.md`

## Global Constraints

- 页面视觉结构固定为左侧工程树、右侧工作区；顶部不再显示“业务功能 / 变更管理”并列页面按钮。
- 变更管理表头固定为“变更ID、变更标题、关联模块/需求、状态、操作”。
- “查看”必须显示该 Change 的设计相关文件，优先打开 `design.md`；文件不存在时打开第一个实际存在的设计相关文件。
- “归档”必须先显示归档相关信息，用户确认后才允许调用现有归档事务。
- 已归档、未达到归档门禁或存在冲突的 Change 仍显示归档操作，但按钮必须禁用并说明原因。
- 文档 Tab 只显示索引中真实存在的文件；不得固定伪造 `api.yaml` 或 `interface.yaml`。
- 业务模块、Spec、Change 和文档保持只读；归档是 UI 唯一允许写入工程的操作。
- 搜索和重新扫描继续使用现有只读 API；重新扫描不修改工程内容。
- 不新增依赖，不引入账号、头像、权限、在线协作或文件编辑能力。

---

## File Map

### Modify

- `src/core/ui-content-index.ts` — 为 Change 增加 Requirement 投影，并提供统一的全部 Change 集合，同时保留现有归档候选计算。
- `src/ui/web/index.html` — 移除顶部业务导航，加入左侧工程树容器和底部工具区容器。
- `src/ui/web/app.js` — 实现树导航、模块工作区、全部 Change 表格、设计文件查看入口、筛选状态和归档确认后的页面刷新。
- `src/ui/web/styles.css` — 实现手绘图对应的双栏壳层、树节点、表格、Tab、操作列和窄屏抽屉布局。
- `test/core/ui-content-index.test.ts` — 覆盖 Requirement 提取、统一 Change 投影和归档状态。
- `test/core/ui-web.test.ts` — 更新 HTML/JS/CSS 静态契约测试，覆盖新布局、表头和操作流程。
- `test/core/ui-server.test.ts` — 补充归档预览信息和门禁失败契约测试。

### Do not modify unless a test exposes a contract gap

- `src/core/ui-server.ts` — 现有 `/api/index`、`/api/documents/:id`、`/api/archive/:changeId` 已足够支持本次 UI；仅在需要补充归档预览字段时修改。
- `src/core/codespec-workflow/archive-transaction.ts` — 复用现有归档事务，不在 UI 改造中重写。

## Task 1: Extend the UI index for requirements and all Change rows

**Files:**
- Modify: `src/core/ui-content-index.ts:31-80,254-345,381-455`
- Test: `test/core/ui-content-index.test.ts`

**Interfaces:**
- `UiChangeGroup` produces `requirements?: string[]` for the `关联模块/需求` table column.
- `UiIndex` produces `allChanges: UiChangeGroup[]`, containing active, archiveable, archived, and abandoned Change projections without removing the existing `changes` and `archive` fields used by archive logic.
- `getChangeMetadata(documents)` extracts Requirement IDs from canonical metadata/relations while preserving current status, module, task, verification, and archive fields.

- [ ] **Step 1: Add failing index tests for Requirement IDs and unified Change rows**

  In `test/core/ui-content-index.test.ts`, add a fixture with:

  ```yaml
  change:
    id: CHG-20260909-001
    title: 新增注册功能
    status: ARCHIVE
  modules:
    confirmed:
      - module: MOD-001
  requirements:
    added:
      - id: MOD-001-REQ-001
    modified: []
    removed: []
```

  Assert that the matching group contains `modules: ['MOD-001']` and `requirements: ['MOD-001-REQ-001']`. The parser must collect IDs from the canonical `added`, `modified`, and `removed` arrays. Add an archived fixture and assert `index.allChanges` contains both active and archived rows while `index.changes` remains the active collection.

- [ ] **Step 2: Run the focused test to verify it fails**

  Run: `pnpm exec vitest run test/core/ui-content-index.test.ts`

  Expected: FAIL because `requirements` and `allChanges` are not yet exposed.

- [ ] **Step 3: Implement the minimum index projection**

  Extend the public types:

  ```ts
  export interface UiChangeGroup {
    requirements?: string[];
    // existing fields remain unchanged
  }

  export interface UiIndex {
    allChanges: UiChangeGroup[];
    // existing fields remain unchanged
  }
  ```

  Parse Requirement IDs from the canonical metadata structure: `requirements.added`, `requirements.modified`, and `requirements.removed`, where each entry has an `id` field. Ignore malformed entries. Build `allChanges` by merging active `changes` with `archive.historyChanges`, deduplicating by Change ID and sorting deterministically by ID. Keep `archive.candidates` derived from active Change groups only.

- [ ] **Step 4: Run the focused test to verify it passes**

  Run: `pnpm exec vitest run test/core/ui-content-index.test.ts`

  Expected: PASS, including existing archive grouping and SDD-level tests.

- [ ] **Step 5: Commit the data contract**

  ```bash
  git add src/core/ui-content-index.ts test/core/ui-content-index.test.ts
  git commit -m "feat(ui): expose requirements and all change projections"
  ```

## Task 2: Replace the page shell with the reference tree layout

**Files:**
- Modify: `src/ui/web/index.html:10-31`
- Modify: `src/ui/web/styles.css:65-90,560-end`
- Modify: `src/ui/web/app.js:1-14,881-916,944-966`
- Test: `test/core/ui-web.test.ts`

**Interfaces:**
- `renderSidebar()` produces the fixed semantic tree with project name, business module nodes, the single Change management node, theme button, and command helper button.
- `UiScreen` uses `{ type: 'module', moduleId, activeDocumentId? }`, `{ type: 'changes', changeId?, filters? }`, `{ type: 'change', changeId, activeDocumentId? }`, and `{ type: 'search', query }`.
- Existing `#search`, `#rebuild`, `#theme-toggle`, `#command-helper`, `#page`, and local API contracts remain available.

- [ ] **Step 1: Update the web shell contract tests**

  Replace assertions that require top-bar `primary-navigation`, `data-view="capabilities"`, and `data-view="changes"` with assertions that require:

  ```text
  id="sidebar"
  id="project-tree"
  id="primary-navigation" is absent from the topbar
  data-node="change-management"
  theme-toggle and command-helper inside the sidebar
  global-search and rebuild inside the workspace header
  ```

  Keep assertions that no edit/exec endpoint is exposed and that the UI contains no standalone “只读观测” page.

- [ ] **Step 2: Run the shell test to verify it fails**

  Run: `pnpm exec vitest run test/core/ui-web.test.ts`

  Expected: FAIL because the HTML still renders the old top-bar navigation.

- [ ] **Step 3: Implement the two-column shell**

  In `index.html`, move navigation out of the topbar and add:

  ```html
  <aside id="sidebar" class="sidebar">
    <div id="project-tree" class="project-tree"></div>
    <div class="sidebar-tools">
      <button id="theme-toggle" ...></button>
      <button id="command-helper" ...></button>
    </div>
  </aside>
  ```

  Keep project name inside the sidebar header. Keep the workspace top area limited to search and `重新扫描`.

  In `styles.css`, set `.app-shell` to a sidebar/workspace grid, give the sidebar a fixed desktop width, keep the workspace scrollable, and add the narrow-screen drawer behavior from the spec. Preserve the existing light/dark variables.

- [ ] **Step 4: Implement semantic tree rendering and state navigation**

  Replace top-nav event delegation with tree event delegation. Render modules from `index.businessModules`, render one Change management node, and update active highlighting from `currentScreen`.

  Remove the old `currentView`/`navigate(view, changeTab)` contract. Add a navigation helper that updates `currentScreen`, renders the current screen, and preserves the active document ID when returning from a detail view.

- [ ] **Step 5: Run the shell tests to verify it passes**

  Run: `pnpm exec vitest run test/core/ui-web.test.ts`

  Expected: PASS for the updated shell contract and existing document/theme safety assertions.

- [ ] **Step 6: Commit the shell change**

  ```bash
  git add src/ui/web/index.html src/ui/web/styles.css src/ui/web/app.js test/core/ui-web.test.ts
  git commit -m "feat(ui): adopt project tree workspace shell"
  ```

## Task 3: Implement module workspace and the all-Change table

**Files:**
- Modify: `src/ui/web/app.js:224-493,554-621,867-909`
- Modify: `src/ui/web/styles.css:97-180,196-215`
- Test: `test/core/ui-web.test.ts`

**Interfaces:**
- `renderModuleWorkspace(moduleId)` renders the selected module summary and dynamic document/Change content.
- `renderAllChangesWorkspace()` renders the exact table columns `变更ID`, `变更标题`, `关联模块/需求`, `状态`, `操作` from `index.allChanges`.
- `renderChangeRow(change)` renders `查看` and `归档` controls without making the entire row an implicit archive action.
- `renderChangeDetail(change)` remains the detail renderer and accepts an initial document selection.

- [ ] **Step 1: Add failing static UI assertions for the table and module workspace**

  Extend `test/core/ui-web.test.ts` to assert that `app.js` contains the exact table labels, `renderModuleWorkspace`, `renderAllChangesWorkspace`, the `查看` action, the `归档` action, `design.md` default selection, and `index.allChanges`.

  Assert the stylesheet contains table/workspace selectors and the HTML test fixture has no archive-history navigation node.

- [ ] **Step 2: Run the focused UI test to verify it fails**

  Run: `pnpm exec vitest run test/core/ui-web.test.ts`

  Expected: FAIL because the current UI still renders cards and separate active/history tabs.

- [ ] **Step 3: Implement module workspace rendering**

  Resolve the selected module from `index.businessModules`. Render:

  ```text
  模块 ID / 名称
  工程 / 业务管理 / 模块名称
  当前 Spec
  关联 Change
  依赖关系
  ```

  Use actual `index.archive.currentSpecs`, `index.allChanges`, and `index.currentSpecGraph` records. Show explicit empty states for missing Spec, Change, or relations. Do not add a filesystem tree or hardcoded API files.

- [ ] **Step 4: Implement the fixed Change table**

  Render a semantic `<table>` with the five fixed headers. For each `index.allChanges` row:

  - show `change.id`;
  - show `change.title`;
  - combine `change.modules` and `change.requirements` using visible tags;
  - show lifecycle status and archive readiness;
  - render `查看` and `归档` buttons in the operation cell.

  Add status, mode, module, and updated-time filters without changing the five headers. Archived rows remain in the same table. For rows without an eligible archive candidate, disable the archive button and expose the first gate reason through text/ARIA.

- [ ] **Step 5: Implement design-file selection for “查看”**

  Add a helper that orders the actual Change documents with `design.md` first, then `proposal.md`, `spec.md`, `tasks.md`, `verification.md`, `metadata.yaml`, followed by remaining files. Pass the first document ID into `renderChangeDetail()` and keep the existing dynamic Tab behavior.

- [ ] **Step 6: Add table styling and responsive behavior**

  Add styles for table header, row separators, status pills, module/requirement tags, operation buttons, disabled archive reasons, and horizontal overflow on narrow screens. Keep the reference layout’s restrained border/card treatment and do not reintroduce large dashboard cards as the primary Change presentation.

- [ ] **Step 7: Run the focused UI test to verify it passes**

  Run: `pnpm exec vitest run test/core/ui-web.test.ts`

  Expected: PASS for table labels, module workspace, dynamic document selection, archive-history removal, and existing structured-document safety checks.

- [ ] **Step 8: Commit the list/workspace change**

  ```bash
  git add src/ui/web/app.js src/ui/web/styles.css test/core/ui-web.test.ts
  git commit -m "feat(ui): render module and change management workspaces"
  ```

## Task 4: Connect archive confirmation to the table operation

**Files:**
- Modify: `src/ui/web/app.js:261-300,818-865`
- Modify: `src/ui/web/styles.css:archive-confirmation selectors`
- Modify: `src/core/ui-server.ts:archivePreview` only if a missing preview field is found
- Test: `test/core/ui-server.test.ts`
- Test: `test/core/ui-web.test.ts`

**Interfaces:**
- `openArchiveConfirmation(candidate)` remains the only UI write path.
- `archivePreview(preflight)` returns Change ID, title, SDD level, status, requirements, modules, target, Verification Receipt, and archive impact.
- The table archive button calls `openArchiveConfirmation(candidate)` only; it never calls the commit endpoint directly.

- [ ] **Step 1: Add failing archive-preview assertions**

  Extend `test/core/ui-server.test.ts` with a canonical Change fixture that returns a preview containing `changeId`, `title`, `modules`, `requirements`, `archiveTarget`, `verificationReceipt`, and `archiveImpact`. Assert that an ineligible Change returns `409` and no commit occurs.

  Extend `test/core/ui-web.test.ts` to assert the table action calls `openArchiveConfirmation`, renders `确认归档`, and does not use `window.confirm` or an execution endpoint.

- [ ] **Step 2: Run focused archive/UI tests to verify the new assertions**

  Run: `pnpm exec vitest run test/core/ui-server.test.ts test/core/ui-web.test.ts`

  Expected: FAIL only for any preview field or table-action contract not yet exposed.

- [ ] **Step 3: Implement the archive table flow**

  Keep the existing `GET /api/archive/:changeId` preflight request and confirmation dialog. Ensure the dialog visibly groups:

  ```text
  Change 信息
  关联模块/需求
  SDD 等级与状态
  门禁结果
  Spec 影响
  归档目标
  Verification Receipt
  ```

  Require the explicit impact confirmation before enabling the final `确认归档` button. After a successful POST, rebuild the index and return to the all-Change table, preserving the selected table/filter context when possible. On failure, keep the dialog open and show the server error without retrying automatically.

- [ ] **Step 4: Run focused archive/UI tests to verify the flow**

  Run: `pnpm exec vitest run test/core/ui-server.test.ts test/core/ui-web.test.ts`

  Expected: PASS, including canonical ID validation, archive preflight failure, confirmation-only write behavior, and no partial UI-side write path.

- [ ] **Step 5: Commit the archive action change**

  ```bash
  git add src/ui/web/app.js src/ui/web/styles.css src/core/ui-server.ts test/core/ui-server.test.ts test/core/ui-web.test.ts
  git commit -m "feat(ui): add table archive confirmation flow"
  ```

## Task 5: Full verification and browser acceptance

**Files:**
- Modify: only files required by failing verification; do not broaden scope.
- Test: `test/core/ui-content-index.test.ts`, `test/core/ui-server.test.ts`, `test/core/ui-web.test.ts`

- [ ] **Step 1: Run the complete focused UI suite**

  Run: `pnpm exec vitest run test/core/ui-content-index.test.ts test/core/ui-server.test.ts test/core/ui-web.test.ts`

  Expected: PASS.

- [ ] **Step 2: Run type checking and lint**

  Run: `pnpm run typecheck`

  Expected: PASS with no TypeScript errors.

  Run: `pnpm run lint`

  Expected: PASS with no new lint errors.

- [ ] **Step 3: Build the distributable UI assets**

  Run: `pnpm run build`

  Expected: PASS and the generated distribution includes the updated `index.html`, `app.js`, and `styles.css` assets.

- [ ] **Step 4: Run a manual browser acceptance pass**

  Run: `pnpm run build` followed by the project’s existing UI launch command (`codespec ui` from a fixture/project directory).

  Verify in order:

  1. Left tree shows project name, business management, modules, Change management, and bottom theme/command tools.
  2. Top workspace shows only global search and `重新扫描`.
  3. Module click opens the module workspace and real document tabs.
  4. Change management shows a table with exactly the five required headers.
  5. `查看` opens `design.md` first when present and shows other actual Change files as tabs.
  6. `归档` opens related information, requires confirmation, and refreshes the unified table after success.
  7. Archived Change remains in the same table; there is no separate archive-history navigation node.
  8. Search, rescan, light/dark theme, empty states, and narrow layout remain usable.

- [ ] **Step 5: Review the final diff and commit verification corrections**

  Run: `git diff HEAD~1 --check` and `git status --short`.

  If verification requires corrections, make one focused follow-up commit containing only the exact files reported by `git status --short`.

  Expected: clean diff check and no unrelated files changed.
