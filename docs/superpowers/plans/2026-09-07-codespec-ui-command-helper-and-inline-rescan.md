# CodeSpec UI 业务分组、命令助手与就地扫描实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不引入命令执行权限的前提下，完成 CodeSpec UI 的业务模块化展示、紧凑布局、Spec 返回路径、命令展示复制和就地重新扫描。

**Architecture:** 继续使用现有单页 Web UI，不增加后端执行命令接口。通过前端路由状态记录当前列表、Change 详情或文档详情；重新扫描后根据当前路由刷新同一页面。命令助手使用前端白名单模板生成只读展示文本，剪贴板只复制命令，不执行本地进程。

**Tech Stack:** 原生 JavaScript、HTML、CSS、Vitest、现有 CodeSpec UI API（`/api/index`、`/api/rebuild`、`/api/documents/:id`）。

**Spec:** 本次对话中已确认的 CodeSpec UI 设计：删除“只读观测”显示、主题图标化、能力地图改为业务功能、三类 Change 按业务模块分组、Spec 详情返回、命令展示复制、重新扫描就地刷新。

## Global Constraints

- 只读行为保持不变；删除“只读观测”仅删除视觉徽标。
- 命令助手只展示和复制命令，不执行命令、不打开本地终端、不新增 Shell bridge。
- 页面本身保持 `overflow: hidden`，长列表和文档内容只能在内部滚动区域滚动。
- 活动 Change、可归档 Change、归档历史必须按业务模块分组并显示模块计数。
- 可归档 Change 仍只能对通过既有归档门禁的 Change 显示归档操作。
- 保留当前工作区已有未提交的用户修改；不要修改无关的 `.gitignore` 和 `docs/docx_file/`。

## 文件边界

- Modify: `src/ui/web/index.html` — 顶部工具栏、导航名称、命令助手入口和语义标签。
- Modify: `src/ui/web/app.js` — UI 路由状态、业务模块渲染、命令模板、剪贴板复制、Spec 返回、就地重新扫描。
- Modify: `src/ui/web/styles.css` — 图标按钮、紧凑业务卡片、分组列表、命令抽屉、返回按钮和内部滚动布局。
- Modify: `test/core/ui-web.test.ts` — HTML、主题、命令助手和扫描行为的静态契约测试。
- Modify: `test/core/ui-web-assets.test.ts` — CodeSpec 文案、分组、滚动和详情结构的资源契约测试。

---

### Task 1: 固定页面路由状态并改造顶部导航

**Files:**
- Modify: `src/ui/web/index.html`
- Modify: `src/ui/web/app.js`
- Modify: `src/ui/web/styles.css`
- Test: `test/core/ui-web.test.ts`

**Interfaces:**
- Produces `currentScreen: { type: 'view'|'change'|'document'|'preview', view?: string, change?: object, options?: object, doc?: object, returnScreen?: object }`。
- Produces `renderCurrentScreen()` 和 `refreshCurrentScreen()`，后续命令助手、文档返回和重新扫描都通过这两个入口工作。

- [x] **Step 1: 写失败测试**

在 `test/core/ui-web.test.ts` 增加以下契约：

```ts
it('uses the compact CodeSpec toolbar and business-function navigation', async () => {
  const html = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');

  expect(html).toContain('业务功能');
  expect(html).toContain('theme-toggle');
  expect(html).not.toContain('只读观测');
  expect(html).toContain('command-helper');
});
```

- [x] **Step 2: 运行失败测试**

运行：

```bash
pnpm vitest run test/core/ui-web.test.ts
```

预期：失败，因为当前 HTML 仍包含 `只读观测`、`select#theme` 和“能力地图”。

- [x] **Step 3: 实现最小导航变更**

在 `index.html` 中：

- 删除 `.readonly-badge`。
- 将主题 `select` 替换为 `<button id="theme-toggle" class="icon-button" type="button" aria-label="切换主题" title="切换主题"></button>`。
- 增加 `<button id="command-helper" class="icon-button" type="button" aria-label="打开命令助手" title="命令助手">⌘</button>`。
- 将导航文案改为“业务功能”。

在 `app.js` 中将主题控制改为 `setThemeIcon(value)` 和 `cycleTheme()`；仍保留 `system/light/dark` 的 localStorage 值。`renderCurrentScreen()` 根据 `currentScreen` 分发到已有 `renderCapabilities`、`renderChangeDetail`、`openDocument` 或 `renderArchivePreview`。

- [x] **Step 4: 运行测试并检查现有主题契约**

运行：

```bash
pnpm vitest run test/core/ui-web.test.ts test/core/ui-web-assets.test.ts
```

预期：新增导航测试通过，既有浅色、深色和系统主题测试继续通过。

- [ ] **Step 5: 提交**

```bash
git add src/ui/web/index.html src/ui/web/app.js src/ui/web/styles.css test/core/ui-web.test.ts
git commit -m "feat(ui): compact CodeSpec toolbar and screen state"
```

### Task 2: 统一业务模块卡片和三类 Change 分组密度

**Files:**
- Modify: `src/ui/web/app.js`
- Modify: `src/ui/web/styles.css`
- Test: `test/core/ui-web-assets.test.ts`

**Interfaces:**
- Consumes `index.businessModules`、`index.changes`、`index.archive.candidates` 和 `index.archive.historyChanges`。
- Produces module group DOM with `.change-module-group`、`.archive-module-group`、`.change-module-heading` 和 `.module-count`。

- [x] **Step 1: 写失败测试**

在资源测试中增加：

```ts
expect(app).toContain("'BUSINESS FEATURES'");
expect(app).toContain("'业务功能'");
expect(app).toContain('change-module-heading');
expect(app).toContain('module-count');
expect(app).toContain('module-spec-action');
expect(styles).toContain('.capability-grid');
expect(styles).toContain('.change-row');
expect(styles).toContain('.archive-module-groups-scroll');
```

- [x] **Step 2: 运行失败测试**

运行：

```bash
pnpm vitest run test/core/ui-web-assets.test.ts
```

预期：失败，因为当前页面仍使用 `CAPABILITY MAP`、`能力地图`，且 Spec 按钮在卡片底部。

- [x] **Step 3: 实现业务功能卡片和紧凑分组**

修改 `renderCapabilities()`：

- 标题改为 `BUSINESS FEATURES` / `业务功能`。
- 每张卡片使用 `capability-heading` 的右侧操作区显示 `查看 Spec`，增加 `module-spec-action` 类。
- 指标压缩为一行，显示活动 Change、可归档 Change 和当前 Spec 状态。
- 桌面端使用两列卡片，窄屏使用一列。

修改 `renderChangeList()`、`renderArchiveableChanges()` 和 `renderArchiveHistory()`：

- 继续调用 `groupChangesByModule()`，确保三类页面均按业务模块分组。
- 模块标题显示模块名称和 Change 数量。
- Change 使用紧凑行布局，状态、SDD 等级、业务模块标签在同一行。
- 可归档页面在模块内部保留“可归档 / 暂不可归档”小节。
- 保留现有内部滚动容器，并为列表底部保留 32px 安全边距。

- [x] **Step 4: 运行测试并检查 DOM 契约**

运行：

```bash
pnpm vitest run test/core/ui-web-assets.test.ts
```

预期：通过，且既有 `archive-summary`、`archive-list-scroll`、`archive-history-list` 契约不回归。

- [ ] **Step 5: 提交**

```bash
git add src/ui/web/app.js src/ui/web/styles.css test/core/ui-web-assets.test.ts
git commit -m "feat(ui): group changes by business module"
```

### Task 3: 统一所有次级页面返回并保持上下文

**Files:**
- Modify: `src/ui/web/app.js`
- Modify: `src/ui/web/styles.css`
- Test: `test/core/ui-web.test.ts`
- Test: `test/core/ui-web-assets.test.ts`

**Interfaces:**
- `backButton(label, handler)` 生成所有次级页面共用的返回按钮。
- `openDocument(doc, returnScreen = currentScreen)` 保存来源上下文。
- `goBackFromDocument()` 恢复 `returnScreen`；无来源时回退到 `{ type: 'view', view: 'capabilities' }`。
- `goBackFromScreen()` 处理 Change 详情、归档预览、文档详情和搜索结果详情的统一返回。

- [x] **Step 1: 写失败测试**

增加：

```ts
expect(script).toContain('goBackFromDocument');
expect(script).toContain('backButton');
expect(script).toContain('goBackFromScreen');
expect(script).toContain('returnScreen');
expect(script).toContain('返回业务功能');
expect(script).toContain('返回活动 Change');
expect(script).toContain('返回可归档 Change');
expect(script).toContain('返回归档历史');
expect(styles).toContain('.document-back-button');
```

- [x] **Step 2: 运行失败测试**

```bash
pnpm vitest run test/core/ui-web.test.ts test/core/ui-web-assets.test.ts
```

预期：失败，因为当前 `openDocument()` 没有返回状态，也没有返回按钮。

- [x] **Step 3: 实现返回逻辑**

修改 `openDocument()` 和所有次级页面渲染函数：

- 新增通用 `backButton(label, handler)`，统一生成左上角返回按钮。
- 接收 `returnScreen` 参数并写入 `currentScreen`。
- 文档页标题前增加 `.document-back-button`，文案按来源显示“返回业务功能”“返回搜索结果”或“返回 Change 文档”。
- Change 详情根据来源显示“返回活动 Change”“返回可归档 Change”或“返回归档历史”。
- 归档预览左上角显示“返回可归档 Change”；移除底部的返回按钮，底部只保留归档确认操作。
- 搜索结果详情显示“返回搜索结果”。
- 点击按钮调用 `goBackFromScreen()`，不重新请求入口页面。
- 保留 `.standalone-document` 内部滚动。
- 返回时恢复来源页面的模块分组、当前文档 Tab、筛选状态和滚动位置。
- 顶层导航页面不显示返回按钮；只有由列表、卡片或搜索结果进入的次级页面显示返回按钮。

修改业务功能卡片和搜索结果的调用点，分别传入当前业务功能页和搜索页作为来源。

- [x] **Step 4: 运行测试**

```bash
pnpm vitest run test/core/ui-web.test.ts test/core/ui-web-assets.test.ts
```

预期：通过。

- [ ] **Step 5: 提交**

```bash
git add src/ui/web/app.js src/ui/web/styles.css test/core/ui-web.test.ts test/core/ui-web-assets.test.ts
git commit -m "feat(ui): unify secondary-screen back navigation"
```

### Task 4: 增加只展示和复制的命令助手

**Files:**
- Modify: `src/ui/web/index.html`
- Modify: `src/ui/web/app.js`
- Modify: `src/ui/web/styles.css`
- Test: `test/core/ui-web.test.ts`
- Test: `test/core/ui-web-assets.test.ts`

**Interfaces:**
- `commandDefinitions(context)` 返回 `{ label, description, command }[]`。
- `renderCommandHelper(context)` 打开/关闭命令抽屉。
- `copyCommand(command)` 只调用 `navigator.clipboard.writeText(command)`，不调用执行 API。

命令模板只使用现有 CLI 已注册的命令：

```js
const commandDefinitions = (context) => {
  const commands = [
    { label: '列出活动 Change', command: 'codespec list --changes' },
    { label: '列出 Spec', command: 'codespec list --specs' },
    { label: '校验全部条目', command: 'codespec validate --all' },
  ];
  if (context.changeId) {
    commands.push(
      { label: '查看 Change', command: `codespec show ${context.changeId} --type change` },
      { label: '校验 Change', command: `codespec validate ${context.changeId} --type change` },
    );
    if (context.archiveable) commands.push({ label: '归档 Change', command: `codespec archive ${context.changeId}` });
  }
  return commands;
};
```

- [x] **Step 1: 写失败测试**

增加：

```ts
expect(script).toContain('commandDefinitions');
expect(script).toContain('navigator.clipboard.writeText');
expect(script).not.toContain('child_process');
expect(script).not.toContain('/api/exec');
expect(html).toContain('command-helper');
expect(styles).toContain('.command-helper-drawer');
```

- [x] **Step 2: 运行失败测试**

```bash
pnpm vitest run test/core/ui-web.test.ts test/core/ui-web-assets.test.ts
```

预期：失败，因为当前 UI 没有命令抽屉和剪贴板逻辑。

- [x] **Step 3: 实现命令展示和复制**

在 `app.js` 中：

- 顶部终端图标打开右侧抽屉，不改变当前页面布局。
- 根据当前 `currentScreen`、选中的 Change 和归档候选状态生成命令。
- 每条命令显示用途、代码块和“复制命令”按钮。
- 使用 `navigator.clipboard.writeText()`；失败时显示“请手动复制”并保留文本选择能力。
- 复制成功显示短暂提示。
- 不增加任何命令执行按钮或执行 API 调用。

在 `styles.css` 中：

- 抽屉使用固定定位和内部滚动。
- 命令代码块使用等宽字体和横向滚动。
- 不挤压主页面，不引起页面级滚动。

- [x] **Step 4: 运行测试**

```bash
pnpm vitest run test/core/ui-web.test.ts test/core/ui-web-assets.test.ts
```

预期：通过，并确认命令助手没有任何本地执行桥接。

- [ ] **Step 5: 提交**

```bash
git add src/ui/web/index.html src/ui/web/app.js src/ui/web/styles.css test/core/ui-web.test.ts test/core/ui-web-assets.test.ts
git commit -m "feat(ui): add contextual command copy assistant"
```

### Task 5: 让重新扫描在当前页面就地刷新

**Files:**
- Modify: `src/ui/web/app.js`
- Modify: `src/ui/web/styles.css`
- Test: `test/core/ui-web.test.ts`
- Test: `test/core/ui-web-assets.test.ts`

**Interfaces:**
- `refreshCurrentScreen()` 先请求 `POST /api/rebuild`，更新 `index`，再调用 `renderCurrentScreen()`。
- `openDocument()` 和 `renderChangeDetail()` 必须把当前对象和来源写入 `currentScreen`，使扫描后可以恢复同一文件或同一 Change。

- [x] **Step 1: 写失败测试**

增加：

```ts
expect(script).toContain('refreshCurrentScreen');
expect(script).toContain('currentScreen.type');
expect(script).toContain("rebuild.disabled = true");
expect(script).toContain('renderCurrentScreen()');
```

- [x] **Step 2: 运行失败测试**

```bash
pnpm vitest run test/core/ui-web.test.ts
```

预期：失败，因为当前 `rebuild.onclick` 只调用 `renderView()`，详情页扫描后会跳回列表。

- [x] **Step 3: 实现就地刷新**

将 `rebuild.onclick` 改为：

```js
rebuild.onclick = async () => {
  rebuild.disabled = true;
  rebuild.dataset.loading = 'true';
  try {
    index = await api('/api/rebuild', { method: 'POST' });
    renderCurrentScreen();
  } catch (error) {
    showInlineError(error);
  } finally {
    rebuild.disabled = false;
    delete rebuild.dataset.loading;
  }
};
```

实现要求：

- 当前列表页只刷新列表数据；
- 当前 Change 详情保持 Change 和当前文档 Tab；
- 当前 Spec 文档重新请求同一 `doc.id` 并保持文档页；
- 成功后刷新状态徽标、生命周期、业务模块信息和命令助手上下文；
- 保留滚动位置；
- 失败时不清空原页面，显示页面内错误提示；
- 只有当前文件不存在或已移动时，才提示用户返回 Change 文档列表。

- [x] **Step 4: 运行测试**

```bash
pnpm vitest run test/core/ui-web.test.ts test/core/ui-web-assets.test.ts
```

预期：通过。

- [ ] **Step 5: 提交**

```bash
git add src/ui/web/app.js src/ui/web/styles.css test/core/ui-web.test.ts test/core/ui-web-assets.test.ts
git commit -m "fix(ui): refresh current document in place"
```

### Task 6: 全量验证和浏览器验收

**Files:**
- Test: `test/core/ui-web.test.ts`
- Test: `test/core/ui-web-assets.test.ts`
- Verify: `src/ui/web/index.html`, `src/ui/web/app.js`, `src/ui/web/styles.css`

- [x] **Step 1: 运行类型检查、构建和 lint**

```bash
pnpm run typecheck
pnpm build
pnpm run lint
git diff --check
```

- [x] **Step 2: 运行全量测试**

```bash
pnpm test -- --reporter=dot
```

预期：所有测试通过。

- [x] **Step 3: 浏览器验收主页面**

依次检查：

1. 顶部没有“只读观测”，主题控制为图标，导航显示“业务功能”。
2. 业务功能卡片使用两列紧凑布局，“查看 Spec”位于卡片标题右侧。
3. 活动 Change、可归档 Change、归档历史均按业务模块分组，模块计数正确。
4. 可归档页仍区分“可归档”和“暂不可归档”。
5. 命令助手只显示和复制命令，不出现执行按钮。
6. Change 详情、归档预览、Spec 文档详情和搜索结果详情均有统一的左上角返回按钮，并回到正确来源。
7. 在列表、Change 详情和 Spec 文档详情点击重新扫描，页面不跳转；当前文件内容和状态就地更新。
8. 页面本身不产生滚动条，只有列表、抽屉和文档内容区域滚动。

- [ ] **Step 4: 做最终回归提交**

```bash
git status --short
git log --oneline -6
```

确认只提交本计划涉及的 UI 和测试文件，不包含 `.gitignore`、`docs/docx_file/` 等无关改动。

## 验收标准

- 顶部工具栏更紧凑，主题仍支持系统、浅色和深色三种模式。
- “能力地图”全部替换为“业务功能”，不再出现旧文案。
- 三类 Change 页面均能按业务模块区分，并在有限高度内显示更多条目。
- Spec 详情可以返回来源页面，不需要重新进入 Change。
- 命令助手只负责生成、展示和复制合法 CodeSpec CLI 命令。
- 重新扫描不会把用户从当前文件或当前 Change 详情带回列表。
- 全量测试、类型检查、构建、lint 和页面滚动验收均通过。
