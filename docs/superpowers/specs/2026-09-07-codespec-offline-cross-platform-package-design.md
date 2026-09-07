# CodeSpec 跨平台离线 tgz 发布设计

## 背景

当前 `@hrhy-ai/codespec@1.0.0` 的 tgz 只包含 `dist`、`bin` 和 `schemas`，生产依赖仍由目标机器上的 npm 从 registry 下载。Windows 用户执行本地 tgz 安装时，如果网络、registry 或 npm 配置不可用，安装会长时间等待或失败。

本设计要求生成一个相同的、可在 Windows、macOS 和 Linux 使用的离线 tgz。目标机器只需要预装满足版本要求的 Node.js 和 npm，不需要 pnpm、网络或重新构建项目。

## 目标与非目标

### 目标

- 同一个 `hrhy-ai-codespec-<version>.tgz` 包含全部生产依赖及传递依赖。
- Windows、macOS、Linux 均可使用同一个 tgz 离线安装。
- 安装过程不依赖 pnpm，不执行目标机上的构建流程。
- 提供明确的离线安装命令和平台安装助手。
- 在三平台 CI 上使用同一个 tgz 做安装、CLI 和 UI 启动冒烟测试。
- 保持现有包名、CLI 名称、Node.js 最低版本和业务功能不变。

### 非目标

- 不生成 Windows 专用 exe，不替换 npm 分发方式。
- 不把开发依赖、测试文件、源码映射或 npm 缓存打入最终包。
- 不改变 CodeSpec CLI 的归档、校验、UI 或工作流业务逻辑。
- 不保证 Node.js 本身离线安装；Node.js 仍由用户或系统预先提供。

## 方案概览

采用“生产依赖内置型 tgz”方案：在发布机上创建干净的 staging 目录，复制可发布文件，安装生产依赖为物理目录，生成带 `bundleDependencies` 的包清单，再使用 npm pack 输出标准 tgz。

最终包结构保持 npm 标准布局：

```text
package/
  package.json
  bin/codespec.js
  dist/
  schemas/
  node_modules/              # 所有 production 依赖及传递依赖
```

依赖当前均为 JavaScript 运行时依赖，没有需要按操作系统拆分的原生模块。因此同一份依赖目录可以跨平台使用。若未来加入 native 或 optional platform package，打包检查必须阻止其未经评估地进入 universal tgz。

## 发布包与 manifest

### 包名与文件名

- npm 包名保持 `@hrhy-ai/codespec`。
- 版本继续读取根 `package.json`，当前为 `1.0.0`。
- tgz 文件名保持 npm 默认格式：`hrhy-ai-codespec-1.0.0.tgz`。

### 依赖内置规则

- 发布清单声明 `bundleDependencies: true`，保证直接依赖和传递依赖一并进入包。
- staging 中只安装 `dependencies`，不安装 `devDependencies`。
- 依赖目录必须是实体文件，不接受 pnpm store 的符号链接、绝对路径链接或指向发布机目录的链接。
- 发布清单不包含 `prepare`、`prepublishOnly` 等要求目标机执行构建的生命周期脚本；构建只在发布机 staging 阶段完成。
- 保留 `bin`、`exports`、`engines` 和运行时所需的 package metadata。

### 资源清理

打包前清理 `.DS_Store`、测试文件、source map、缓存、临时目录和开发工具配置。`dist/ui/web`、`schemas` 和运行时模板等现有资源必须保留。

## 打包流程

新增一个可重复执行的离线打包脚本，流程固定为：

1. 读取根 `package.json` 的包名和版本。
2. 创建临时 staging 目录，不在工作区直接覆盖 `node_modules`。
3. 根据发布白名单复制 `dist`、`bin`、`schemas` 和必要的 package metadata。
4. 在 staging 中用 npm 安装生产依赖，禁用 lifecycle、audit 和 fund，确保依赖落地为实体目录。
5. 写入 `bundleDependencies: true`，移除目标机不应执行的构建生命周期脚本。
6. 执行 `npm pack`，输出到项目根目录或指定发布目录。
7. 检查 tarball 内容、依赖完整性和符号链接安全性。
8. 清理 staging，不修改用户现有的工作区文件。

打包脚本必须支持显式输出路径，并在任一步失败时以非零状态退出，不生成看似可用的不完整 tgz。

## 用户安装体验

### 保证离线的标准命令

Windows PowerShell：

```powershell
npm install -g .\hrhy-ai-codespec-1.0.0.tgz --offline --no-audit --no-fund
codespec --version
```

macOS/Linux：

```bash
npm install -g ./hrhy-ai-codespec-1.0.0.tgz --offline --no-audit --no-fund
codespec --version
```

`--offline` 是网络禁用保证；`--no-audit` 和 `--no-fund` 防止 npm 在安装后发起额外网络请求。由于依赖已内置，命令不会从 registry 下载依赖。

### 安装助手

提供两个薄封装脚本，脚本只负责检查 Node/npm 版本、定位旁边的 tgz 并调用上述 npm 命令：

- `install-codespec.ps1`：适用于 Windows PowerShell。
- `install-codespec.sh`：适用于 macOS/Linux。

助手不执行任何业务命令，不修改项目文件；安装失败时显示 npm 原始错误和下一步建议。标准 npm 命令仍作为公开、可复制的备用方式保留。

## 跨平台兼容约束

- Node.js 版本要求保持 `>=20.19.0`。
- CLI 使用现有的 Windows 分支处理路径、`cmd.exe`、PowerShell 和浏览器打开逻辑。
- 打包内容不能依赖 Unix 权限位、软链接、`/bin/sh` 或 macOS 专属路径。
- 完成、失败和取消时都清理临时 staging 目录。
- CLI 的 shell 补全按运行平台选择；同一个包可以生成 bash、zsh、fish 和 PowerShell 补全，不在打包阶段硬编码某个平台。
- 若依赖树出现 native addon 或平台专属 optional dependency，打包脚本必须报告并阻止 universal tgz 发布，直到明确采用跨平台或分平台包策略。

## 离线验收与 CI

新增发布验证命令，至少检查：

1. tarball 中存在所有直接依赖和传递依赖。
2. tarball 中没有符号链接、开发依赖、source map、测试文件或 `.DS_Store`。
3. 在全新临时目录使用 `npm install --offline --no-audit --no-fund` 安装成功。
4. 执行 `codespec --version`，版本与 package manifest 一致。
5. 执行 `codespec init`，能创建最小 CodeSpec 结构。
6. 启动 UI 服务并确认本地 HTTP 响应；不要求打开真实浏览器。
7. 安装失败时能返回明确的非零状态。

GitHub Actions 使用同一个 tgz 运行 Node.js 20.19+ 的 Windows、macOS、Ubuntu 矩阵。测试阶段将 npm 置为 offline，并关闭 audit/fund，验证目标机不需要访问 registry。

## 测试策略

- 单元测试：发布 manifest 清理、依赖白名单、符号链接检测、平台脚本参数。
- 打包集成测试：从干净 staging 生成 tgz，并检查 tarball 文件列表和依赖树。
- 离线安装测试：三平台临时 prefix 安装同一 tgz，执行版本、init 和 UI 服务冒烟。
- 回归测试：现有 TypeScript、lint、全量 Vitest 和 CLI e2e 测试保持通过。

## 错误处理

- 依赖安装失败：报告依赖名、npm 输出和 staging 路径（若仍存在），退出非零。
- 发现软链接或平台专属 native 依赖：阻止打包并列出具体路径。
- 离线安装缺少 Node.js 或 Node 版本过低：安装助手在调用 npm 前给出明确提示。
- tgz 不完整或版本不匹配：`codespec --version` 验证失败，CI 阻止发布。

## 验收标准

- 同一个 `hrhy-ai-codespec-1.0.0.tgz` 可在 Windows、macOS、Linux 使用 `npm install --offline` 安装。
- 安装过程中不需要访问 npm registry，不需要 pnpm，不需要重新构建。
- `codespec --version` 返回 `1.0.0`，`codespec init` 和 UI 服务启动成功。
- 安装助手可用，且不会执行任何超出安装范围的命令。
- 现有 CLI 和 UI 功能回归测试通过。
