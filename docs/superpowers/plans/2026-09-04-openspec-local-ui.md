# OpenSpec 本地只读可视化界面实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供 `openspec ui [path]`，启动仅本机可访问的浏览器界面，以只读方式浏览并检索 `openspec/` 全部内容和 `docs/superpowers/plans/`。

**Architecture:** CLI 命令创建受限的内容索引与 Node 本地 HTTP 服务；API 只接受索引 ID，永不接受客户端任意路径。无框架静态前端随 npm 包发布，用本地 API 实现目录树、全文检索、Markdown 阅读和手动重新扫描。

**Tech Stack:** Node.js 20、TypeScript、Commander、Node `http`、Vitest、ESLint、pnpm、浏览器原生 ES modules、`markdown-it` 14.1.0。

**Spec:** [docs/superpowers/specs/2026-09-04-openspec-local-ui-design.md](/Users/wanglinan/Documents/01_工作/02_AI/01_project/CodeSpec/CodeSpec/docs/superpowers/specs/2026-09-04-openspec-local-ui-design.md)

## Global Constraints

- 命令必须为 `openspec ui [path]`，省略路径时使用当前目录。
- 服务只监听 `127.0.0.1`；不实现远程访问、认证、多用户、同步或编辑能力。
- 只索引工程根目录下 `openspec/**` 与 `docs/superpowers/plans/**`，不索引其他 `docs/` 内容。
- API 用索引 ID 读取内容；拒绝未知 ID 和任何路径穿越请求。
- 首版只支持刷新页面或显式“重新扫描”，不使用文件监听。
- 跳过二进制、超大文件及逃离白名单根目录的符号链接；UI 必须说明空状态和可见的跳过原因。
- 不修改用户工程内任何被扫描文件；npm 产物必须包含 UI 静态资源。
- 每个任务先跑列出的定向测试；最后必须运行 build、lint 和完整测试，并以实际输出报告结果。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `src/core/ui-content-index.ts` | 受限扫描、索引类型、OpenSpec 分类、Markdown 标题/YAML 元数据提取、全文搜索与重建。 |
| `src/core/ui-server.ts` | 仅本机 HTTP 服务、静态资源与只读 API、端口选择和优雅关闭。 |
| `src/core/ui-browser.ts` | 跨平台打开浏览器的可注入封装。 |
| `src/commands/ui.ts` | `openspec ui` 参数解析、启动输出、自动打开与进程生命周期。 |
| `src/cli/index.ts` | 注册 `ui [path]` Commander 命令。 |
| `src/ui/web/index.html` | UI HTML 壳与三栏可访问性语义。 |
| `src/ui/web/styles.css` | 三栏、窄屏、搜索结果、Markdown 和错误/空状态样式。 |
| `src/ui/web/app.js` | API 客户端、URL 状态、目录树、列表、阅读和重新扫描交互。 |
| `build.js` | 编译后复制静态资源和 `markdown-it` 浏览器模块到 `dist/ui/web/`。 |
| `package.json`、`pnpm-lock.yaml` | 声明精确的 Markdown 渲染依赖与发布资源。 |
| `test/core/ui-content-index.test.ts` | 索引范围、安全、分类、搜索和重建单元测试。 |
| `test/core/ui-server.test.ts` | HTTP API、静态资源、端口和关闭行为测试。 |
| `test/commands/ui.test.ts` | 命令的默认路径、启动诊断和浏览器调用测试。 |
| `test/cli-e2e/ui.test.ts` | 已编译 CLI 的真实 `openspec ui` 冒烟测试。 |

### Task 1: 建立受限内容索引与全文检索

**Files:**

- Create: `src/core/ui-content-index.ts`
- Create: `test/core/ui-content-index.test.ts`

**Interfaces:**

- Produces `export type UiSource = 'openspec' | 'superpowers-plans'`。
- Produces `export interface UiDocument { id: string; relativePath: string; source: UiSource; category: string; contentType: 'markdown' | 'yaml' | 'text'; title: string; labels: string[]; content: string; modifiedAt: string; }`。
- Produces `export interface UiIndex { documents: UiDocument[]; skipped: Array<{ relativePath: string; reason: 'binary' | 'too_large' | 'outside_root' | 'unreadable' }>; rebuiltAt: string; }`。
- Produces `buildUiIndex(projectRoot: string): Promise<UiIndex>`、`searchUiIndex(index: UiIndex, query: string, source?: UiSource): UiDocument[]`、`findUiDocument(index: UiIndex, id: string): UiDocument | undefined`。
- Consumes only a canonical, existing project root; document ID is `sha256(relativePath)` truncated to 24 hex characters, never a client-supplied path.

- [ ] **Step 1: 写索引与搜索的失败测试。**

在临时工程创建 `openspec/business.md`、活动/归档 Change、`openspec/archive/specs/` 和 `docs/superpowers/plans/plan.md`，以及 `docs/other.md`。断言前述允许文件均出现、`docs/other.md` 不出现，标题采用首个 ATX 标题，中文和英文正文都能命中；标题命中排在正文命中之前。

```ts
const index = await buildUiIndex(root);
expect(index.documents.map((item) => item.relativePath)).toContain('openspec/business.md');
expect(index.documents.map((item) => item.relativePath)).toContain('docs/superpowers/plans/plan.md');
expect(index.documents.map((item) => item.relativePath)).not.toContain('docs/other.md');
expect(searchUiIndex(index, '发布')[0]?.title).toBe('发布计划');
```

另建 1 MiB + 1 byte 的 `.md`、含 `\0` 的文件，以及指向允许根目录外文件的符号链接。断言它们未进入 `documents`，而 `skipped` 中出现相应原因。为 Windows 路径断言使用 `path.join()` 和 `path.relative()`。

- [ ] **Step 2: 运行定向测试确认 RED。**

```bash
pnpm exec vitest run test/core/ui-content-index.test.ts
```

预期：失败，原因是模块和导出尚不存在。

- [ ] **Step 3: 实现白名单扫描和确定性索引。**

用 `fs.promises.realpath()` 规范化工程根和每个候选文件；只有真实路径仍以各自允许根加 `path.sep` 开头时才读取。递归时跳过目录符号链接，接受扩展名 `.md`、`.mdx`、`.yaml`、`.yml`、`.json`、`.txt`，单文件上限固定为 `1_048_576` bytes；读取前检查大小，读取后检查 `content.includes('\0')`。

将路径按 POSIX 形式存入 `relativePath`，按字典序排序。分类规则必须为：`openspec/business.md` 是 `业务说明`；`openspec/changes/<id>/...` 是 `活动 Change`；`openspec/specs/...` 是 `当前 Spec`；`openspec/archive/changes/...` 是 `归档 Change`；`openspec/archive/specs/...` 是 `归档 Spec`；其余 OpenSpec 文件是 `其他 OpenSpec 文件`；计划根下内容是 `Superpowers Plans`。将 `.md`/`.mdx` 标为 `markdown`，`.yaml`/`.yml` 标为 `yaml`，其余允许文件为 `text`。标题使用 Markdown 的第一条 `/^#\s+(.+)$/m`，无标题时用 `path.basename()`；YAML 用安全解析取得顶层 `id`、`status`、`updated_at`、`created_at` 中的标量值作为 `labels`，解析失败时返回空标签并保留原始内容。

搜索将查询按 Unicode 小写和空白折叠；对每个文档计算 title、relativePath、content 的首次位置，按 `title`、`relativePath`、`content` 三档命中，再以 `modifiedAt` 降序和路径升序排序；空查询返回全部文档。

- [ ] **Step 4: 运行索引测试、类型检查和 lint。**

```bash
pnpm exec vitest run test/core/ui-content-index.test.ts
pnpm exec tsc --noEmit
pnpm lint
```

预期：全部退出 0，索引不会读取白名单外内容且排序稳定。

- [ ] **Step 5: 提交索引功能。**

```bash
git add src/core/ui-content-index.ts test/core/ui-content-index.test.ts
git commit -m "feat: add constrained UI content index"
```

### Task 2: 实现本机 HTTP API、静态服务和浏览器打开器

**Files:**

- Create: `src/core/ui-server.ts`
- Create: `src/core/ui-browser.ts`
- Create: `test/core/ui-server.test.ts`

**Interfaces:**

- Consumes `buildUiIndex`、`searchUiIndex`、`findUiDocument` from Task 1.
- Produces `startUiServer(options: { projectRoot: string; assetsDir: string; port?: number }): Promise<{ url: string; close(): Promise<void>; rebuild(): Promise<UiIndex> }>`.
- Serves `GET /api/index` as `{ documents, skipped, rebuiltAt }`; `GET /api/documents/:id` as one `UiDocument`; `GET /api/search?q=<text>&source=<UiSource>`; `POST /api/rebuild` as rebuilt index; `POST /api/reveal/:id` opens the indexed file in the local file manager when the platform supports it.
- Produces `openBrowser(url: string, options?: { platform?: NodeJS.Platform; spawn?: SpawnLike }): Promise<void>`; it uses `open` on macOS, `cmd /c start "" <url>` on Windows, and `xdg-open` on Linux.

- [ ] **Step 1: 写 HTTP API 和关闭行为的失败测试。**

用 Task 1 的临时工程和临时 assets 目录启动服务，使用 Node `fetch()` 测试树索引、按 ID 取文档、中文搜索、筛选 `source=superpowers-plans`、重建后加入的新文件；请求未知 ID 时应得到 JSON `404`。请求 `/api/documents/../../etc/passwd` 和 `POST /api/reveal/../../etc/passwd` 必须是 `404`，且不泄露主机文件。为 `reveal` 注入 fake spawn，断言它只得到索引文件的真实路径。

```ts
const server = await startUiServer({ projectRoot: root, assetsDir, port: 0 });
const item = index.documents[0];
expect((await fetch(`${server.url}/api/documents/${item.id}`)).status).toBe(200);
expect((await fetch(`${server.url}/api/documents/../../etc/passwd`)).status).toBe(404);
await server.close();
```

再占用一个本机端口后传入该端口，断言服务退回任意可用端口；关闭后向 URL 发请求必须失败。为 `openBrowser` 传入 fake spawn，断言 macOS、Windows、Linux 的命令参数，并让 spawn 触发 error，断言函数解析而只返回可诊断错误。

- [ ] **Step 2: 运行服务测试确认 RED。**

```bash
pnpm exec vitest run test/core/ui-server.test.ts
```

预期：失败，模块尚不存在。

- [ ] **Step 3: 实现固定回环地址服务与 API 路由。**

使用 `node:http` 的 `createServer`，只调用 `server.listen(port, '127.0.0.1')`；`port` 缺省和 `0` 均交由系统选择。所有 API 响应使用 UTF-8 JSON、`Cache-Control: no-store` 和正确状态码。`/api/documents/:id` 与 `POST /api/reveal/:id` 都只调用 `findUiDocument`，从不把 URL 片段交给文件系统。reveal 将受索引约束的真实路径交给平台启动器：macOS `open -R <path>`、Windows `explorer /select,<path>`、Linux `xdg-open <dirname>`；启动失败返回 JSON `502`，不关闭服务。`POST /api/rebuild` 重新调用 `buildUiIndex` 并原子替换闭包中的索引。

对非 API `GET`，只从 `assetsDir` 提供 `index.html`、`app.js`、`styles.css` 和 `vendor/markdown-it.mjs`；先用 `path.resolve()` 和 `path.relative()` 验证目标留在 assets 根下。对前端路由返回 `index.html`，对不存在静态文件返回 `404`。启动后用 `server.address()` 形成 `http://127.0.0.1:<port>`；`close()` 必须等待 `server.close()` 完成。

`openBrowser` 用 `node:child_process.spawn`、`detached: true`、`stdio: 'ignore'`；子进程 `unref()`。无法打开浏览器不终止服务，调用方可打印 URL。

- [ ] **Step 4: 运行服务、索引测试和静态类型检查。**

```bash
pnpm exec vitest run test/core/ui-server.test.ts test/core/ui-content-index.test.ts
pnpm exec tsc --noEmit
```

预期：端口、API、路径防护和优雅关闭测试均通过。

- [ ] **Step 5: 提交本机服务功能。**

```bash
git add src/core/ui-server.ts src/core/ui-browser.ts test/core/ui-server.test.ts
git commit -m "feat: serve OpenSpec UI locally"
```

### Task 3: 加入静态三栏界面并接入构建产物

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `build.js`
- Create: `src/ui/web/index.html`
- Create: `src/ui/web/styles.css`
- Create: `src/ui/web/app.js`

**Interfaces:**

- Consumes Task 2 的 `/api/index`、`/api/search`、`/api/documents/:id`、`/api/rebuild`。
- Produces `dist/ui/web/index.html`、`dist/ui/web/app.js`、`dist/ui/web/styles.css`、`dist/ui/web/vendor/markdown-it.mjs`。
- Query state contract: `?file=<document-id>&q=<encoded query>&source=<UiSource>`.

- [ ] **Step 1: 添加浏览器 Markdown 依赖与可复制资源。**

运行下列命令，将 `markdown-it` 固定为 `14.1.0`，随后确认 lockfile 中解析到相同版本；不要引入 React、Vite、Express 或任何 UI 框架。

```bash
pnpm add markdown-it@14.1.0
pnpm why markdown-it
```

预期：`package.json` 的 `dependencies` 含 `markdown-it: "14.1.0"`，lockfile 可复现该版本。

- [ ] **Step 2: 更新 build 的资源复制并用构建验证。**

在 `build.js` 的 TypeScript 编译成功后，使用 `cpSync`/`mkdirSync` 将 `src/ui/web/` 复制到 `dist/ui/web/`，并将 `node_modules/markdown-it/dist/markdown-it.mjs` 复制为 `dist/ui/web/vendor/markdown-it.mjs`。复制缺失时让 build 抛错并非静默发布。

```bash
pnpm run build
test -f dist/ui/web/index.html
test -f dist/ui/web/vendor/markdown-it.mjs
```

预期：构建退出 0，四个前端资源均存在于 `dist/ui/web/`。

- [ ] **Step 3: 创建可访问的三栏 HTML 与 CSS。**

`index.html` 使用一个全局 `<input type="search">`、来源筛选 `<select>`、默认选中的“内容文档”切换项、重新扫描 `<button>`，以及带 `aria-label` 的 `nav`（目录树）、`section`（结果列表）和 `article`（阅读器）。YAML 仅在用户启用可折叠的“配置与元数据”分组后显示；初始状态分别写明“正在扫描 OpenSpec 和 Superpowers Plans…”与空内容提示。

`styles.css` 在宽度至少 960px 时使用 `grid-template-columns: 260px minmax(260px, 360px) minmax(0, 1fr)`；小于 960px 时变为单列。定义选中项、搜索命中、错误、空状态、代码块、表格和任务清单样式，保持足够文本对比度。不得依赖远程字体、CDN 或在线资源。

- [ ] **Step 4: 实现 API 驱动的浏览与 URL 状态。**

`app.js` 从 `URLSearchParams` 读取 `file`、`q`、`source`、`metadata`；加载 `/api/index` 后在左栏按 `source` 和 `category` 构造树，默认只列出 `contentType === 'markdown'` 的内容，并将 YAML 集中在折叠的“配置与元数据”分组。中栏显示当前分组或 `/api/search` 结果，YAML 项展示索引提供的 `labels`。搜索输入采用 200ms 防抖；每次选中文档、更新查询或切换元数据分组调用 `history.replaceState` 更新同一套参数。

读取 `/api/documents/:id` 后，`contentType === 'markdown'` 使用本地 `markdown-it.mjs` 渲染内容；配置 `html: false`、`linkify: true`、`typographer: false`，保证 Markdown 中的 HTML 不被执行。`contentType === 'yaml'` 或 `text` 用 `<pre><code>` 的文本节点显示原始内容，避免改写原文件语义。渲染前用文本节点显示完整相对路径，复制按钮使用 `navigator.clipboard.writeText(relativePath)` 并在失败时显示“无法复制路径”；“在文件管理器中打开”按钮调用 `POST /api/reveal/:id`，并把 502 或不支持平台的错误显示在阅读区。重新扫描调用 `POST /api/rebuild`，完成后重新加载索引并保留仍存在的文件/查询，否则显示空阅读状态。

- [ ] **Step 5: 构建并进行浏览器资源冒烟检查。**

```bash
pnpm run build
node -e "for (const file of ['dist/ui/web/index.html','dist/ui/web/app.js','dist/ui/web/styles.css','dist/ui/web/vendor/markdown-it.mjs']) { require('node:fs').accessSync(file) }"
pnpm lint
```

预期：构建和 lint 退出 0，发布目录内不存在对本机 `src/` 或远程 CDN 的引用。

- [ ] **Step 6: 提交 UI 资源和构建接入。**

```bash
git add package.json pnpm-lock.yaml build.js src/ui/web
git commit -m "feat: add OpenSpec UI web assets"
```

### Task 4: 注册 CLI 命令并完成端到端验证

**Files:**

- Create: `src/commands/ui.ts`
- Modify: `src/cli/index.ts`
- Create: `test/commands/ui.test.ts`
- Create: `test/cli-e2e/ui.test.ts`

**Interfaces:**

- Produces `UiCommand.execute(targetPath?: string): Promise<void>`.
- Consumes `startUiServer` from Task 2 and `openBrowser` from Task 2.
- Registers `program.command('ui [path]')` with description `在浏览器中只读浏览和检索 OpenSpec 内容`.
- The command prints `OpenSpec UI: <url>` before attempting browser open, and remains alive until `SIGINT`/`SIGTERM`.

- [ ] **Step 1: 写命令单元与已编译 CLI 的失败测试。**

在 `UiCommand` 注入 `startServer` 和 `openBrowser` 测试桩，断言：未传路径时传 `process.cwd()`；有路径时先 `path.resolve()`；服务 URL 总被输出；浏览器打开错误只打印“无法自动打开浏览器，请访问 <url>”而不关闭服务；接收 `SIGINT` 时调用一次 `close()` 并将退出码设为 0。

端到端测试建立临时工程，spawn `node dist/cli/index.js ui <root>`，等待 stdout 的 `OpenSpec UI: http://127.0.0.1:`，请求 `/api/index` 并断言得到两个来源；发送 `SIGTERM`，断言子进程在 5 秒内退出。测试必须在 `afterEach` 终止残留子进程，沿用 `test/helpers/run-cli.ts` 的进程树清理方式。

```ts
expect(output).toMatch(/OpenSpec UI: http:\/\/127\.0\.0\.1:\d+/);
expect((await fetch(`${url}/api/index`)).status).toBe(200);
child.kill('SIGTERM');
```

- [ ] **Step 2: 运行命令测试确认 RED。**

```bash
pnpm exec vitest run test/commands/ui.test.ts test/cli-e2e/ui.test.ts
```

预期：失败，原因是 `UiCommand` 与 `ui` 子命令尚未注册。

- [ ] **Step 3: 实现 `UiCommand` 与 Commander 注册。**

`UiCommand` 将传入路径规范化，并以 `fileURLToPath(import.meta.url)` 定位已发布的 `dist/ui/web`；源代码直接运行时从模块相对路径定位 `src/ui/web`，使单元测试不依赖 npm 安装。启动服务后立刻打印 URL，再调用 `openBrowser`；后者报错只写 stderr。注册一次 `SIGINT` 和一次 `SIGTERM` handler，handler 移除自身、await `close()`、再令进程退出；不要使用 `process.exit()` 绕过关闭。

在 `src/cli/index.ts` 导入 `UiCommand` 并注册独立的 `ui [path]`，不要复用 `view` 或 `resolveRootForCommand`：UI 需允许一个来源目录缺失并在页面呈现空状态。

- [ ] **Step 4: 运行定向、构建、lint 和完整测试。**

```bash
pnpm exec vitest run test/core/ui-content-index.test.ts test/core/ui-server.test.ts test/commands/ui.test.ts test/cli-e2e/ui.test.ts
pnpm run build
pnpm lint
pnpm test
```

预期：全部退出 0。手动运行 `node dist/cli/index.js ui .` 时自动打开本机页面，能在左栏见到 OpenSpec/Plans，搜索 `设计` 后阅读区可显示匹配 Markdown；按 Ctrl-C 后端口释放。

- [ ] **Step 5: 提交 CLI 与测试。**

```bash
git add src/commands/ui.ts src/cli/index.ts test/commands/ui.test.ts test/cli-e2e/ui.test.ts
git commit -m "feat: add openspec ui command"
```

## 自检结果

- Spec 覆盖：Task 1 覆盖扫描边界、分类、全文检索和文件安全；Task 2 覆盖本机服务、API、端口、文件管理器打开与关闭；Task 3 覆盖三栏阅读、URL 状态、Markdown 渲染、重新扫描和 npm 资源发布；Task 4 覆盖命令入口、浏览器自动打开、诊断与端到端运行。
- 无占位符：计划未包含 TBD、TODO 或“后续实现”等未定义工作；每项代码步骤都指定了接口、算法或命令。
- 类型一致性：Task 1 的 `UiIndex`/`UiDocument` 是 Task 2 的唯一内容来源；Task 2 的 API 是 Task 3 的唯一数据协议；Task 2 的 `startUiServer` 与 `openBrowser` 是 Task 4 的唯一服务接口。
