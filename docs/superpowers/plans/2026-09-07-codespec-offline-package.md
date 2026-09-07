# CodeSpec 跨平台离线 tgz 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成同一个内置全部生产依赖的 CodeSpec tgz，使 Windows、macOS 和 Linux 可以在无网络、无 pnpm 的情况下安装和运行。

**Architecture:** 新增独立的 staging 打包器，不覆盖工作区的 `node_modules`，在临时目录安装实体化 production dependencies，生成清理过的发布 manifest 后调用 `npm pack`。安装助手只检查 Node/npm 并调用 npm 离线参数；验证脚本和 GitHub Actions 使用同一 tgz 做跨平台安装和 CLI/UI 冒烟测试。

**Tech Stack:** Node.js ESM、npm pack、pnpm、Vitest、PowerShell、POSIX shell、GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-09-07-codespec-offline-cross-platform-package-design.md`

## Global Constraints

- 保持包名 `@hrhy-ai/codespec`、CLI 名称 `codespec` 和 Node.js `>=20.19.0`。
- 同一个 `hrhy-ai-codespec-<version>.tgz` 必须支持 Windows、macOS、Linux。
- tgz 必须包含全部 `dependencies` 和传递依赖，但不包含 devDependencies、测试文件、source map、`.DS_Store` 或 npm 缓存。
- 最终依赖必须是实体文件，不得包含 pnpm store 软链接、绝对路径链接或发布机路径。
- 目标机安装不需要 pnpm、网络或重新构建；安装命令使用 `--offline --no-audit --no-fund`。
- 不修改 CodeSpec CLI 归档、校验、UI 或工作流业务逻辑。
- 保留已有用户改动：`.gitignore`、`docs/docx_file/`、`package/` 不得纳入本任务提交。

---

### Task 1: 实现临时 staging 离线打包器

**Files:**
- Create: `scripts/pack-offline.mjs`
- Modify: `package.json`（增加 `pack:offline` 脚本）
- Test: `test/core/offline-package.test.ts`

**Interfaces:**
- `packOffline({ projectRoot, outputDir, npmCommand }) => { tarballPath, packageName, version }`
- `createStagingManifest(sourcePackage, version) => object`
- `assertPortableTree(root) => void`

- [x] **Step 1: 写失败测试**

在 `test/core/offline-package.test.ts` 增加资源级测试，验证：

```ts
it('exposes an offline packaging command', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  expect(pkg.scripts['pack:offline']).toBe('node scripts/pack-offline.mjs');
});

it('keeps the offline package allowlist and removes build lifecycle scripts', async () => {
  const source = await fs.readFile(path.join(root, 'scripts/pack-offline.mjs'), 'utf8');
  expect(source).toContain('bundleDependencies');
  expect(source).toContain('prepare');
  expect(source).toContain('prepublishOnly');
  expect(source).toContain('assertPortableTree');
});
```

- [x] **Step 2: 运行测试确认失败**

运行：

```bash
pnpm vitest run test/core/offline-package.test.ts
```

预期：失败，因为脚本和 npm script 尚不存在。

- [x] **Step 3: 实现 staging 打包器**

在 `scripts/pack-offline.mjs` 中实现以下流程：

```js
const runtimeFiles = ['dist', 'bin', 'schemas', 'LICENSE', 'README.md'];
const runtimeDependencies = Object.keys(sourcePackage.dependencies ?? {});

async function packOffline({ projectRoot = process.cwd(), outputDir = projectRoot } = {}) {
  const sourcePackage = readJson(join(projectRoot, 'package.json'));
  const staging = await mkdtemp(join(tmpdir(), 'codespec-offline-'));
  try {
    await copyRuntimeFiles(projectRoot, staging, runtimeFiles);
    const manifest = createStagingManifest(sourcePackage, sourcePackage.version);
    writeJson(join(staging, 'package.json'), manifest);
    await runNpm(staging, ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
    assertPortableTree(join(staging, 'node_modules'));
    const tarball = await runNpmPack(staging, outputDir);
    await verifyTarballContents(tarball, runtimeDependencies);
    return { tarballPath: tarball, packageName: manifest.name, version: manifest.version };
  } finally {
    await remove(staging);
  }
}
```

`createStagingManifest` 必须保留 `name`、`version`、`description`、`license`、`type`、`exports`、`bin`、`engines` 和 `dependencies`，设置 `bundleDependencies: true`，并删除 `prepare`、`prepublishOnly`、devDependencies、packageManager 和发布脚本。`assertPortableTree` 遇到符号链接、绝对链接或 `.DS_Store` 时抛出带具体路径的错误。

脚本支持 `--output <dir>`，默认输出到项目根目录；命令行入口失败时返回非零状态，且 staging 清理不覆盖原始工作区。

- [x] **Step 4: 运行打包器测试和本地打包**

运行：

```bash
pnpm vitest run test/core/offline-package.test.ts
pnpm pack:offline -- --output /tmp/codespec-offline-output
```

预期：测试通过，输出 `hrhy-ai-codespec-1.0.0.tgz`，且原工作区 `node_modules` 不发生变化。

- [ ] **Step 5: 提交**

```bash
git add package.json scripts/pack-offline.mjs test/core/offline-package.test.ts
git commit -m "feat(packaging): add dependency-bundled offline tgz packer"
```

### Task 2: 增加 tgz 内容与离线安装验证器

**Files:**
- Create: `scripts/verify-offline-package.mjs`
- Modify: `package.json`（增加 `verify:offline` 脚本）
- Modify: `scripts/pack-version-check.mjs`
- Test: `test/core/offline-package.test.ts`

**Interfaces:**
- `inspectTarball(tgzPath) => { manifest, entries, bundledDependencies }`
- `verifyOfflineInstall(tgzPath, { npmCommand, nodeCommand, tempRoot }) => { version, initPath }`
- `runOfflineVerification(tgzPath) => void`

- [x] **Step 1: 写失败测试**

增加以下契约测试：

```ts
it('exposes offline verification and uses npm offline flags', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  expect(pkg.scripts['verify:offline']).toBe('node scripts/verify-offline-package.mjs');
  const source = await fs.readFile(path.join(root, 'scripts/verify-offline-package.mjs'), 'utf8');
  expect(source).toContain('--offline');
  expect(source).toContain('--no-audit');
  expect(source).toContain('--no-fund');
  expect(source).toContain('codespec --version');
});
```

- [x] **Step 2: 运行测试确认失败**

```bash
pnpm vitest run test/core/offline-package.test.ts
```

预期：失败，因为离线验证脚本和 npm script 尚不存在。

- [x] **Step 3: 实现 tarball 检查和隔离安装**

`inspectTarball` 使用 `tar -tzf` 或 Node 内置解包逻辑检查：

- `package/package.json`、`package/bin/codespec.js`、`package/dist`、`package/schemas` 存在。
- `package/node_modules` 中存在每个 direct dependency 和传递依赖。
- 不存在 `package/node_modules/**` 符号链接、`*.map`、测试目录、`.DS_Store`。
- manifest 的 `bundleDependencies` 为 `true`，版本与根 package.json 一致。

`verifyOfflineInstall` 创建隔离 prefix，运行：

```text
npm install --prefix <prefix> <tgz> --offline --no-audit --no-fund
node <prefix>/node_modules/@hrhy-ai/codespec/bin/codespec.js --version
node <prefix>/node_modules/@hrhy-ai/codespec/bin/codespec.js init <temp-project>
```

随后启动 UI 子进程，轮询本地 HTTP 地址，收到成功响应后终止进程并清理临时目录。所有子进程退出码、stderr 和临时路径在失败信息中保留。

更新 `scripts/pack-version-check.mjs`，让版本检查优先调用离线打包器和验证器，而不是使用不含 bundled dependencies 的普通 `npm pack`。

- [x] **Step 4: 运行离线验证**

```bash
pnpm run pack:offline -- --output /tmp/codespec-offline-output
pnpm run verify:offline -- /tmp/codespec-offline-output/hrhy-ai-codespec-1.0.0.tgz
```

预期：在关闭 registry 访问的情况下安装、版本检查、init 和 UI HTTP 冒烟全部成功。

- [ ] **Step 5: 提交**

```bash
git add package.json scripts/verify-offline-package.mjs scripts/pack-version-check.mjs test/core/offline-package.test.ts
git commit -m "test(packaging): verify bundled tgz offline"
```

### Task 3: 提供跨平台安装助手和安装文档

**Files:**
- Create: `scripts/install-codespec.ps1`
- Create: `scripts/install-codespec.sh`
- Modify: `install.md`
- Test: `test/core/offline-package.test.ts`

**Interfaces:**
- PowerShell accepts optional `-PackagePath` and defaults to a tgz next to the script.
- POSIX script accepts optional first positional package path and defaults to a tgz next to the script.
- Both scripts check Node.js `>=20.19.0`, resolve npm, run the same offline flags, and return npm's non-zero exit code.

- [x] **Step 1: 写失败测试**

增加静态契约：

```ts
it('ships platform installers with the same offline npm contract', async () => {
  const powershell = await fs.readFile(path.join(root, 'scripts/install-codespec.ps1'), 'utf8');
  const posix = await fs.readFile(path.join(root, 'scripts/install-codespec.sh'), 'utf8');
  for (const source of [powershell, posix]) {
    expect(source).toContain('--offline');
    expect(source).toContain('--no-audit');
    expect(source).toContain('--no-fund');
    expect(source).toContain('20.19.0');
  }
});
```

- [x] **Step 2: 运行测试确认失败**

```bash
pnpm vitest run test/core/offline-package.test.ts
```

- [x] **Step 3: 实现安装助手**

PowerShell 脚本必须使用 `$PSScriptRoot` 定位默认 tgz，解析 `node --version` 的 major/minor/patch，调用：

```powershell
& npm install -g $PackagePath --offline --no-audit --no-fund
exit $LASTEXITCODE
```

POSIX 脚本必须使用 `SCRIPT_DIR`, `set -eu`, `node --version` 检查和：

```bash
npm install -g "$PACKAGE_PATH" --offline --no-audit --no-fund
```

两者都只安装包，不运行 `codespec init`、不修改 shell profile、不修改项目文件。

更新 `install.md`：加入 Windows、macOS/Linux 的离线命令、助手用法、Node 版本要求、`npm ERR! code ENOTCACHED` 的处理说明，并移除过时的包名或在线安装示例。

- [x] **Step 4: 运行脚本检查**

```bash
pnpm vitest run test/core/offline-package.test.ts
bash -n scripts/install-codespec.sh
pwsh -NoProfile -File scripts/install-codespec.ps1 -?  # Windows CI 执行
```

- [ ] **Step 5: 提交**

```bash
git add scripts/install-codespec.ps1 scripts/install-codespec.sh install.md test/core/offline-package.test.ts
git commit -m "docs(install): add cross-platform offline package helpers"
```

### Task 4: 加入三平台使用同一 tgz 的 CI 验证

**Files:**
- Create: `.github/workflows/offline-package.yml`

**Interfaces:**
- Job `build-offline-package` uploads exactly one tgz artifact.
- Matrix job `verify-offline-package` downloads that same artifact on `ubuntu-latest`, `macos-latest`, `windows-latest`.

- [x] **Step 1: 写 CI 配置契约测试**

在 `test/core/offline-package.test.ts` 读取 workflow，验证包含：

```ts
expect(workflow).toContain('ubuntu-latest');
expect(workflow).toContain('macos-latest');
expect(workflow).toContain('windows-latest');
expect(workflow).toContain('--offline');
expect(workflow).toContain('upload-artifact');
expect(workflow).toContain('download-artifact');
```

- [x] **Step 2: 运行测试确认失败**

```bash
pnpm vitest run test/core/offline-package.test.ts
```

- [x] **Step 3: 实现 workflow**

`build-offline-package` 在 Ubuntu 使用 Node 20.19+、pnpm frozen lockfile、`pnpm build` 和 `pnpm run pack:offline`，上传唯一 tgz。

`verify-offline-package` 使用同一个 artifact，在三个 runner 中：

1. 只安装 Node.js，不安装 pnpm。
2. 将 npm 配为 offline、关闭 audit/fund。
3. 使用 `npm install --prefix <temp-prefix> <tgz> --offline --no-audit --no-fund`。
4. 运行包内 CLI 的 `--version`、`init` 和 UI HTTP smoke。
5. Windows 使用 PowerShell，Unix 使用 bash，输出 platform、arch、Node 和 npm 版本。

workflow 只在打包脚本、依赖、发布 manifest、安装助手或 workflow 改动时运行，并保留手动触发入口。

- [x] **Step 4: 运行本地静态检查**

```bash
pnpm vitest run test/core/offline-package.test.ts
git diff --check
```

远程 Windows/macOS/Linux job 由 GitHub Actions 运行，失败时保留 npm verbose 日志和 tgz 元数据。

- [ ] **Step 5: 提交**

```bash
git add .github/workflows/offline-package.yml test/core/offline-package.test.ts
git commit -m "ci: verify offline tgz on three platforms"
```

### Task 5: 全量回归与发布前检查

**Files:**
- Test: `test/core/offline-package.test.ts`
- Verify: `scripts/pack-offline.mjs`, `scripts/verify-offline-package.mjs`, `scripts/install-codespec.ps1`, `scripts/install-codespec.sh`, `.github/workflows/offline-package.yml`

- [x] **Step 1: 运行类型检查、lint 和构建**

```bash
pnpm run typecheck
pnpm run lint
pnpm build
git diff --check
```

- [x] **Step 2: 运行离线打包与验证**

```bash
pnpm run pack:offline -- --output /tmp/codespec-offline-output
pnpm run verify:offline -- /tmp/codespec-offline-output/hrhy-ai-codespec-1.0.0.tgz
```

确认同一 tarball 的版本、依赖清单、CLI、init 和 UI HTTP smoke 均通过。

- [x] **Step 3: 运行全量测试**

```bash
pnpm test -- --reporter=dot
```

预期：既有测试与新增离线包测试全部通过。

- [x] **Step 4: 检查提交边界**

```bash
git status --short
git diff HEAD~5 --stat
```

确认没有提交 `.gitignore`、`docs/docx_file/`、`package/` 或生成的临时目录。

- [ ] **Step 5: 提交最终变更**

```bash
git add scripts package.json install.md .github/workflows/offline-package.yml test/core/offline-package.test.ts
git commit -m "feat(release): support cross-platform offline CodeSpec tgz"
```

## 验收标准

- 同一个 `hrhy-ai-codespec-1.0.0.tgz` 在 Windows、macOS、Linux 使用 npm offline 安装成功。
- 安装过程不需要网络、pnpm 或目标机重新构建。
- CLI 版本、`codespec init` 和 UI HTTP smoke 成功。
- 安装助手统一使用 `--offline --no-audit --no-fund`，不执行项目初始化或 shell profile 修改。
- 包内无软链接、开发依赖、source map、测试文件和 `.DS_Store`。
- 既有全量测试、类型检查、lint 和构建保持通过。
