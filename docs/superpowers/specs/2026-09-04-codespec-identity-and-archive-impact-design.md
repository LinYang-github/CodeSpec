# CodeSpec 1.0 身份迁移与归档影响分析设计

> 状态：设计已在对话中确认；尚未开始实现。
>
> 本文替代 `2026-09-04-code-spec-archive-impact-analysis-design.md` 中以 OpenSpec 命名空间描述的实施方向。该旧文档保留为设计决策历史，不作为实施依据。

## 决策摘要

项目以一个全新的、破坏性不兼容的 CodeSpec 1.0 发布：只支持 `codespec` 名称、`codespec/` 工作区和 `@hrhy-ai/codespec@1.0.0`。不提供 `openspec` CLI、目录、Skill、环境变量、npm 包、兼容层或迁移逻辑。

此次迁移同时实现归档影响分析：每个默认 `code-spec` Change 在设计阶段都必须声明是否影响既有 Current Specification；有影响时必须关联被修订或替代的 Requirement / Scenario、证明归档回归验证，并在人工归档确认前展示映射。历史 Change 不可变，Current Specification 仅通过 `codespec archive` 的事务式 delta 演进。

## 命名规范

| 范围 | 名称 |
| --- | --- |
| 产品、界面、文档标题 | `CodeSpec` |
| npm 包 | `@hrhy-ai/codespec` |
| 初始发布版本 | `1.0.0` |
| CLI、目录、文件名、Skill ID | `codespec` / `codespec-*` |
| 环境变量 | `CODESPEC_*` |
| TypeScript 类型、类 | `CodeSpec...` |
| TypeScript 变量、函数、内部模块 | `codeSpec...` / `codespec-...` |

## 目标

- 发布唯一的 `@hrhy-ai/codespec@1.0.0` 包及 `codespec` 可执行文件。
- 将项目工作区、Core、CLI、Skill、遥测、生成器、测试、文档和发布配置统一迁移到 CodeSpec 命名空间。
- `codespec init` 只创建并解析 `codespec/` 工作区。
- 清除旧公开身份：不生成、不识别、不发布 `openspec` 相关接口。
- 在默认 `code-spec` schema 中强制记录归档影响分析。
- 让新增需求、部分修订、完全替代和纯 bugfix 都以明确、可验证的方式演进 Current Specification。
- 保持归档事务的唯一写入边界、冲突检测、原子回滚和人工确认。

## 非目标

- 不支持或迁移现有 `openspec/` 项目。
- 不发布 `@fission-ai/openspec`，不保留 `openspec` 二进制别名。
- 不读取 `OPENSPEC_*` 环境变量、旧本地配置路径或 `.openspec.yaml`。
- 不编辑、删除或重写已归档 Change 的产物和验证证据。
- 不为非默认 schema 引入归档影响分析门禁。
- 不保留 OpenSpec 历史版本的 changelog 条目。

## 身份、发布与工作区

### 发布元数据

`package.json` 及发布工具链使用：

```text
name: @hrhy-ai/codespec
version: 1.0.0
bin: { codespec: ./bin/codespec.js }
repository: https://github.com/LinYang-github/CodeSpec
homepage: https://github.com/LinYang-github/CodeSpec
```

版本检查、打包冒烟测试、release workflow、Nix metadata、安装命令和 GitHub Release 文案全部使用上述名称。发布前检查必须从 packed tarball 安装该包，并验证 `codespec --version` 输出 `1.0.0`。

### 工作区与 Core

新项目的唯一布局为：

```text
codespec/
├── business.md
├── config.yaml
├── changes/
│   ├── index.yaml
│   └── CHG-YYYYMMDD-NNN/
├── specs/<MOD-ID>/spec.md
└── archive/
    ├── changes/CHG-YYYYMMDD-NNN/
    ├── history.yaml
    └── README.md
```

所有解析、初始化、Store、引用、遥测和生成逻辑只认该目录。Core 内部模块、公开错误信息、CLI help、测试 fixture 和生成文件中的 OpenSpec 标识都改为 CodeSpec 标识。`codespec init` 不检测、迁移或读取 `openspec/`；旧标识输入将得到明确的不支持错误，且不触发回退行为。

### Skills 与命令

仅生成三个公开 Skill：

- `codespec-workflow`：正常开发；
- `codespec-rebase-change`：STALE 与冲突恢复；
- `codespec-archive-change`：Current Specification 更新与归档。

所有生成的 AI 命令、提示、安装说明和 examples 都引用 `codespec` CLI 与 `codespec/` 路径。

## 归档影响分析

### 设计产物契约

默认 `code-spec` 的 `design.md` 必须含“归档影响分析”章节，章节紧跟一个由 Core 校验的 YAML 块：

````markdown
## 归档影响分析

```yaml
outcome: none
references: []
verification: []
```
````

若变更影响既有 Current Specification，则使用：

````markdown
## 归档影响分析

```yaml
outcome: affected
references:
  - current_requirement: MOD-001-REQ-010
    current_scenario: SCN-010
    disposition: modified
    replacement_requirement: MOD-001-REQ-010
    replacement_scenario: SCN-021
  - current_requirement: MOD-001-REQ-011
    current_scenario: SCN-011
    disposition: superseded
    replacement_requirement: MOD-001-REQ-012
    replacement_scenario: SCN-022
verification:
  - archive-regression
```
````

`outcome: none` 必须有空的 `references` 和 `verification`。`outcome: affected` 必须包含至少一条映射与 `archive-regression` 验证声明。Core 拒绝未知字段、无效 ID、重复映射和缺失章节。

### 既有需求处置

设计阶段仅查询相关模块的 `codespec/specs/<MOD-ID>/spec.md`，不将扫描历史 archive 作为日常 workflow 门禁。Core 验证映射的当前 Requirement / Scenario 确实存在，并与 Change delta 对齐：

| 情况 | 对 Current Specification 的 delta | 历史 Change |
| --- | --- | --- |
| 新增且兼容 | `ADDED` 新 Requirement / Scenario | 不变 |
| 部分失效 / 范围收窄 | `MODIFIED` 既有 Requirement，必要时 `ADDED` 新 Requirement | 不变 |
| 完全替代 | `REMOVED` 旧 Requirement 与 `ADDED` 替代 Requirement | 不变 |
| 纯 bugfix，需求意图不变 | 无 Requirement 语义 delta；记录修复与普通验证 | 不变 |
| bugfix 暴露需求错误 | 升级为 `MODIFIED` 或 `REMOVED` + `ADDED` | 不变 |

`modified` 映射要求 `MODIFIED` 当前 Requirement；`superseded` 映射要求 `REMOVED` 当前 Requirement 和 `ADDED` 替代 Requirement。`MODIFIED` / `REMOVED` 必须提供与当前 Requirement 块完全匹配的 `Previous` 内容，否则归档产生 `ARCHIVE CONFLICT`，不写任何文件。

### 门禁与证据

生命周期、`codespec validate`、`codespec status` 和 archive preflight 共享同一个异步归档影响校验器。它在适用状态读取 relevant Current Specification、验证映射、检查受影响 Requirement / Scenario 已出现在任务追踪中。

对 `outcome: affected`，fresh verification 必须包含一条成功的 `archive` 类别命令，覆盖映射中的旧和新 Requirement / Scenario。没有该证据，或证据签名、revision、baseline 不匹配时，不能进入或完成归档。

### 归档结果

`codespec archive` 在现有人工确认前展示受影响映射和 archive-regression 证据。确认后，archive transaction 读取当前模块 spec、应用 `ADDED` / `MODIFIED` / `REMOVED` delta，并原子安装新的 `codespec/specs/<MOD-ID>/spec.md`。

归档结果的文本和 JSON 都包含映射。完全替代示例：

```text
MOD-001-REQ-011/SCN-011 → MOD-001-REQ-012/SCN-022 (superseded)
```

该操作更新 Current Specification，但不会修改 `codespec/archive/changes/<旧 CHG-ID>/`；归档历史保留每版 Requirement 的理由、实现和验证证据。

## 错误处理

- 旧 CLI、目录、包、Skill、环境变量或配置键：明确报错，不提供回退和别名。
- `codespec/` 已存在：沿用当前初始化的安全检查，避免覆盖。
- 设计章节或 YAML 不完整：阻止 DESIGN / PLAN 继续。
- 映射引用的 Requirement / Scenario 不存在，或 delta 与处置不匹配：阻止设计、验证和归档。
- 缺失 archive-regression 证据：拒绝归档，并保留活动 Change。
- 预检、冲突或提交失败：沿用事务回滚，Current Specification、archive history 与 Change 路径均维持原状。

## 测试与验收

- 运行时、包内容、生成 Skill/命令和文档中没有遗留可执行 `openspec` 标识；仅允许受控的“不支持旧标识”错误断言。
- `codespec init`、`codespec status`、`codespec validate`、`codespec archive` 与 Store/引用场景只使用 `codespec/`。
- packed `@hrhy-ai/codespec@1.0.0` 安装后 `codespec --version` 成功，`openspec` 不作为 package bin 出现。
- 归档影响 YAML 的有效、缺失、模糊、重复及非法映射均有 parser 和 lifecycle 测试。
- 覆盖兼容新增、部分修订、完全替代、纯 bugfix、需求语义错误 bugfix、缺 archive evidence 及 `Previous` 冲突。
- 归档失败时断言 Current Specification、archive history 和历史 Change 均未变化。
- `CHANGELOG.md` 从 CodeSpec 1.0.0 开始；当前用户文档、发布 workflow 与 Nix metadata 仅描述 CodeSpec。

## 实施范围

- package、CLI bin、entry points、Core workflow directory、所有代码和测试 imports。
- workspace path resolver、初始化、Store、references、telemetry、templates、Skill generator 和 tool integrations。
- schemas、docs、examples、assets alt text、install prompt、release scripts/workflows、Nix and CI metadata。
- archive-impact parser、lifecycle gates、verification evidence、archive preflight/result 与回归测试。
