# CodeSpec UI 归档工作台实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有“文档树 + 阅读器”UI 实现为已确认的 CodeSpec 只读观测台与 Change 归档工作台，并展示 SDD 等级及统一生命周期。

**Architecture:** 后端继续以 `buildUiIndex()` 生成只读索引；索引从 canonical `metadata.yaml` 提取 Change 摘要、门禁、验证和归档影响。前端使用单页视图切换能力地图、活动 Change、可归档 Change、归档历史和 Change 详情，所有写操作只通过后端归档预检与现有事务接口完成。

**Tech Stack:** TypeScript、Node `http`、原生 JavaScript、CSS、Vitest、现有 CodeSpec archive transaction。

**Spec:** `docs/superpowers/specs/2026-09-06-codespec-ui-archive-workbench-design.md`

## Global Constraints

- 仅支持 canonical CodeSpec，不重新引入 OpenSpec 或 legacy Change 数据。
- 业务模块、Change、Spec 和文档全部只读；只有通过归档门禁的 Change 可以执行归档。
- 所有等级共用 `ANALYZE → DESIGN → PLAN → IMPLEMENT → VERIFY → ARCHIVE → ARCHIVED` 生命周期。
- 主题支持深色、浅色和跟随系统，默认跟随系统；不新增用户、设置或独立搜索页面。
- 归档必须调用 `preflightArchive()`、`prepareArchive()` 和 `commitArchive()`，前端不得复制归档规则。
- 保留现有 `.gitignore` 和 `docs/docx_file/` 用户改动，不将其纳入本功能提交。

---

### Task 1: 扩展 UI 索引为 Change 与归档摘要

**Files:**
- Modify: `src/core/ui-content-index.ts`
- Test: `test/core/ui-content-index.test.ts`

**Interfaces:**
- Produces `UiChangeGroup` 字段：`title`、`mode`、`status`、`sddLevel`、`modules`、`taskProgress`、`verification`、`archive`、`gateReasons`。
- Produces `UiIndex.archive.candidates`，区分 `ready` 和 `blocked`，但不在索引阶段执行写入。

- [ ] **Step 1: Write the failing test**

为活动和归档 Change 写入 canonical `metadata.yaml`，断言索引返回标题、模式、状态、SDD 等级、任务进度、验证摘要、归档状态和门禁原因；同时断言没有 metadata 的 legacy 目录不会伪造等级或归档候选。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/core/ui-content-index.test.ts`

Expected: FAIL because `UiChangeGroup` 只有 `id` 和 `documents`，没有 Change 摘要与归档候选字段。

- [ ] **Step 3: Write minimal implementation**

增加一个只读 YAML 解析函数，严格读取 `change`、`impact`、`modules`、`tasks`、`verification`、`archive` 和 `gates` 的已有字段；无效或缺失字段返回空摘要，不改变文档扫描和搜索行为。`archive.candidates` 只依据已有 metadata 状态生成展示数据，最终门禁仍由归档 API 重新校验。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/core/ui-content-index.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/core/ui-content-index.ts test/core/ui-content-index.test.ts
git commit -m "feat(ui): expose Change archive summaries"
```

### Task 2: 增加归档预览与事务 API

**Files:**
- Modify: `src/core/ui-server.ts`
- Test: `test/core/ui-server.test.ts`

**Interfaces:**
- `GET /api/archive/:changeId`：调用 `preflightArchive()`，返回 SDD 等级、门禁、Spec 影响、目标路径和验证 Receipt；失败返回 409 及明确原因。
- `POST /api/archive/:changeId`：重新执行 `preflightArchive()`，再调用 `prepareArchive()` 和 `commitArchive()`；成功后刷新索引并返回归档结果。

- [ ] **Step 1: Write the failing test**

增加测试覆盖：不满足 ARCHIVE 门禁时 GET 返回 409；满足门禁时 POST 执行现有事务并重新返回 `/api/index`；非法 Change ID 和路径穿越均返回 404/400，且不能触发文件写入。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/core/ui-server.test.ts`

Expected: FAIL because the two archive routes do not exist。

- [ ] **Step 3: Write minimal implementation**

在 server 中解析并校验 `CHG-YYYYMMDD-NNN`，从当前 workspace 加载 canonical context；GET 只返回预检计划的安全摘要，POST 在请求时重新预检并使用现有 archive transaction，所有异常映射为结构化 JSON，不暴露内部绝对路径。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/core/ui-server.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/core/ui-server.ts test/core/ui-server.test.ts
git commit -m "feat(ui): expose guarded archive endpoints"
```

### Task 3: 实现全局导航、主题和只读页面框架

**Files:**
- Modify: `src/ui/web/index.html`
- Modify: `src/ui/web/app.js`
- Modify: `src/ui/web/styles.css`

**Interfaces:**
- Consumes `/api/index`、`/api/search` 和 Task 1 的摘要字段。
- Produces view keys：`capabilities`、`active-changes`、`archiveable-changes`、`archive-history`、`change-detail`。

- [ ] **Step 1: Write the failing test**

为前端增加静态 DOM smoke 检查（使用现有 Node 运行方式加载 `index.html` 的关键 id/class 文本），断言存在四个业务导航、主题选择器、只读提示和详情容器。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/core/ui-web.test.ts`

Expected: FAIL because当前 HTML 只有搜索、重新扫描、文档树和阅读器。

- [ ] **Step 3: Write minimal implementation**

重写页面壳层：左侧业务导航，顶部品牌/搜索/主题，主区按 view 渲染。主题使用 `data-theme` 与 `matchMedia('(prefers-color-scheme: dark)')`，偏好保存到 `localStorage`；不新增账户、设置和独立搜索页。所有文档继续使用 textContent 或 Markdown 渲染，避免把工程内容当 HTML 执行。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/core/ui-web.test.ts && node --check src/ui/web/app.js`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/ui/web/index.html src/ui/web/app.js src/ui/web/styles.css test/core/ui-web.test.ts
git commit -m "feat(ui): add CodeSpec workbench shell"
```

### Task 4: 实现能力地图、Change 详情和归档历史视图

**Files:**
- Modify: `src/ui/web/app.js`
- Modify: `src/ui/web/styles.css`
- Test: `test/core/ui-web.test.ts`

**Interfaces:**
- Consumes Task 1 的业务模块、Change 摘要、归档历史和文档列表。
- Produces只读卡片、生命周期 stepper、SDD 等级门禁面板和详情文档 Tab。

- [ ] **Step 1: Write the failing test**

增加页面渲染 smoke 用例，验证能力地图显示业务模块与关联 Change，活动 Change 显示状态/SDD/任务/验证摘要，详情显示统一生命周期和 `proposal.md`、`design.md`、`spec.md`、`tasks.md`、`verification.md` Tab，历史显示归档路径与 Receipt。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/core/ui-web.test.ts`

Expected: FAIL because旧页面没有这些 view 和摘要区域。

- [ ] **Step 3: Write minimal implementation**

实现卡片渲染和 view 切换；Level 1/2/3 只显示等级徽章与要求摘要，不改变生命周期；活动 Change 和归档历史复用同一个详情 Tab 组件；能力地图不显示健康评分或主观百分比。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/core/ui-web.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/ui/web/app.js src/ui/web/styles.css test/core/ui-web.test.ts
git commit -m "feat(ui): add Change and archive views"
```

### Task 5: 接入可归档工作台并完成验证

**Files:**
- Modify: `src/ui/web/app.js`
- Modify: `src/ui/web/styles.css`
- Modify: `docs/superpowers/specs/2026-09-06-codespec-ui-archive-workbench-design.md` only if implementation clarifies an existing contract
- Test: `test/core/ui-web.test.ts`, `test/core/ui-server.test.ts`

**Interfaces:**
- Consumes Task 2 的 `/api/archive/:changeId` GET/POST。
- Produces归档候选卡片、归档预览、二次确认、成功刷新和失败回滚提示。

- [ ] **Step 1: Write the failing test**

增加 UI server/client contract tests，验证按钮只对预检成功的 Change 可用；预检失败展示原因；确认归档后调用 POST、刷新索引；POST 失败时显示事务回滚提示且不自动重试。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/core/ui-server.test.ts test/core/ui-web.test.ts`

Expected: FAIL because前端尚未消费归档预览和归档结果。

- [ ] **Step 3: Write minimal implementation**

在可归档视图中展示 SDD 等级、门禁摘要、Spec 影响、目标路径和 Receipt；归档按钮仅在 GET 预检成功时启用。点击后显示二次确认，POST 成功后刷新索引，失败时保留页面状态并展示错误。

- [ ] **Step 4: Run full verification**

Run: `pnpm exec vitest run test/core/ui-content-index.test.ts test/core/ui-server.test.ts test/core/ui-web.test.ts && pnpm run typecheck && pnpm run lint && node --check src/ui/web/app.js && git diff --check`

Expected: all targeted tests pass, typecheck/lint/JS syntax/diff checks exit 0。全量 Vitest 如再次因环境禁止 `127.0.0.1` 监听失败，应记录该环境限制，不把它误判为 UI 逻辑失败。

- [ ] **Step 5: Commit**

```bash
git add src/core/ui-content-index.ts src/core/ui-server.ts src/ui/web/index.html src/ui/web/app.js src/ui/web/styles.css test/core/ui-content-index.test.ts test/core/ui-server.test.ts test/core/ui-web.test.ts
git commit -m "feat(ui): implement archive workbench"
```
