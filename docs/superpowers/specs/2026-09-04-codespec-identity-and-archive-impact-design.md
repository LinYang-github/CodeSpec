# CodeSpec 1.0 身份迁移与归档影响分析设计

> 状态：设计已在对话中确认；尚未开始实现。
>
> 本文替代 `2026-09-04-code-spec-archive-impact-analysis-design.md` 中以 OpenSpec 命名空间描述的实施方向。该旧文档保留为设计决策历史，不作为实施依据。

## 决策摘要

项目以一个全新的、破坏性不兼容的 CodeSpec 1.0 发布：只支持 `codespec` 名称、`codespec/` 工作区和 `@hrhy-ai/codespec@1.0.0`。不提供 `openspec` CLI、目录、Skill、环境变量、npm 包、兼容层或迁移逻辑。

此次迁移同时实现归档影响分析，并建立 BDD + SDD + TDD 的最小研发闭环：每个默认 `code-spec` Change 在设计阶段都必须声明是否影响既有 Current Specification；有影响时必须关联被修订或替代的 Requirement / Scenario、证明归档回归验证，并在人工归档确认前展示映射。历史 Change 不可变，Current Specification 仅通过 `codespec archive` 的事务式 delta 演进。

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
- `codespec init` 的终端欢迎动画与静态回退均展示 `HRHY` 品牌标识，不展示 OpenSpec 图形或文字。
- 清除旧公开身份：不生成、不识别、不发布 `openspec` 相关接口。
- 在默认 `code-spec` schema 中强制记录归档影响分析。
- 以 BDD Scenario 定义关键业务验收行为，以 TDD 测试证明实现满足规格。
- 按 SDD Level 调整 Change 过程的文档与验证颗粒度，而不降低最终归档质量。
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

### 初始化欢迎界面与 HRHY 品牌

`codespec init` 的欢迎界面是终端 ASCII 动画，不依赖 GIF、PNG 或网络资源。动画帧及其峰值静态帧必须表现 `HRHY` 标识；右侧欢迎标题使用 `CodeSpec`，不得出现 OpenSpec 名称、旧菱形图案或旧标语。`codespec init --no-animation` 使用同一 `HRHY` 峰值帧，保证关闭动画、终端宽度不足、非 TTY 或系统“减少动态效果”时品牌仍一致。

动画仅为交互式辅助，不影响初始化文件写入、工具选择或退出码。动画控制变量改为 `CODESPEC_NO_ANIMATION`；CLI help、错误信息、测试快照和可访问性说明同步使用 CodeSpec 名称。终端不支持颜色或 Unicode 时可以降级为 ASCII 字符，但不得降级回旧品牌图案。

## BDD + SDD + TDD 研发闭环

CodeSpec 的最小完整闭环为：

```text
Business Goal
→ Requirement
→ BDD Scenario / Acceptance Criteria
→ Spec
→ Design
→ Task
→ TDD Test
→ Verification
→ Current Specification
→ Archive
```

不创建割裂的 `bdd/`、`sdd/`、`tdd/` 目录。默认 `code-spec` 的 `spec.md` 中，Requirement 下的 GIVEN / WHEN / THEN / ERROR Scenario 同时承担 BDD 验收场景职责。每个关键 Requirement 至少有一个 Scenario；每个 Scenario 至少覆盖正常路径和失败/异常路径。涉及权限、边界、并发、恢复或兼容性时，设计必须明确该维度是否适用；适用时补充对应场景。

TDD 在任务实施时执行 Red → Green → Refactor。每个 Task 必须能回答“哪一个 Requirement / Scenario 证明该任务有必要”，每个测试必须能回答“它证明哪个 Scenario”。

## SDD 分级

`metadata.yaml` 是分级的机器权威，使用：

```yaml
change:
  sdd_level: 1 # 1 | 2 | 3

impact:
  affected_areas:
    - auth/login
```

Level 2 / 3 的 `design.md`，以及 Level 1 `spec.md` 内联的设计说明，必须含“SDD 分级依据”章节，解释所选等级、影响因素和未升级到更高等级的理由。Core 根据 Change 模式、模块数、API/数据影响、迁移、安全、架构与发布风险提出最低建议等级；人工只能维持或上调，不能低于 Core 的最低建议。

| 等级 | 适用范围 | 过程产物与验证 |
| --- | --- | --- |
| Level 1 | 单模块、低风险小 bugfix 或小行为修改 | Requirement、BDD Scenario、Spec、Task、TDD 证据、Verification；设计说明可内联在 `spec.md`。 |
| Level 2 | 默认等级；普通 feature、多文件或接口/数据模型修改 | `proposal.md`、`design.md`、`spec.md`、`tasks.md`、`verification.md` 全部必需。 |
| Level 3 | 架构、安全、数据迁移、跨系统、breaking change、高可靠或高并发变更 | 在 `design.md` 中额外要求架构决策、接口/数据契约、迁移、rollback、rollout、风险与相应验证。 |

Level 只改变 Change 过程中的文档和验证颗粒度。所有 Level 最终都必须产生同样可信、可验证的 Current Specification，并接受相同的归档原子性、冲突检测和历史不可变门禁。

### Change 产物矩阵

为避免“Level 1 可以内联设计”与固定 Change 目录产生歧义，所有 Level 均必须创建 `metadata.yaml`、`proposal.md`、`spec.md`、`tasks.md` 和 `verification.md`。`proposal.md` 保留问题、目标、非目标和风险；它不是可省略的口头说明。`design.md` 在 Level 2 和 Level 3 必需；Level 1 可以不创建该文件，但 `spec.md` 必须有结构化的“设计说明”和“SDD 分级依据”章节。

| 产物 | Level 1 | Level 2 | Level 3 |
| --- | --- | --- | --- |
| `metadata.yaml`、`proposal.md`、`spec.md`、`tasks.md`、`verification.md` | 必需 | 必需 | 必需 |
| `design.md` | 可省略；内容内联到 `spec.md` | 必需 | 必需，且含增强章节 |
| 架构决策、接口/数据契约、迁移、rollback、rollout | 按适用性在内联说明中记录 | 按适用性 | 必需逐项说明是否适用及验证 |

归档时移动该 Change 实际存在的全部产物；Core 不因合法的 Level 1 缺少独立 `design.md` 而失败，也不允许其他 Level 以缺文件绕过设计门禁。

### Metadata Schema 契约

`metadata.yaml` 是 CodeSpec 1.0 的机器可读契约，根级必须声明 `schema_version: 1`。至少包含 Change ID、标题、类型（`feature`、`bugfix`、`refactor`）、状态、revision、`change.sdd_level`、`impact.affected_areas`、关联 Change 与归档影响摘要。字段的类型、枚举、默认值和必填条件由一个版本化的 Core schema 定义；`codespec validate` 对未知字段、缺失字段、非法 ID、非法状态和不匹配的 Level/产物组合失败关闭。

未来扩展必须提升 schema 版本或使用明确保留的扩展命名空间，不能通过静默忽略未知字段改变归档语义。CLI、Skill、生命周期服务和 archive transaction 必须使用同一 schema，而不是各自解析 YAML。

## 追踪、质量门禁与变更控制

### 追踪矩阵

`verification.md` 包含结构化追踪矩阵：

```text
Requirement → BDD Scenario → Task → Test → Evidence
```

关键代码路径可以作为可选字段记录文件路径或符号名；Level 3 的关键接口和实现映射为必填。Core 校验 Requirement、Scenario、Task、Test 与 Evidence 的完整关联，不依赖 AI Skill 的自然语言提示判断完成状态。

### 生命周期门禁

- **Requirement Gate：**目标、非目标、可验证 Requirement、关键 Scenario、风险、affected area 和并行 Change 冲突均已明确。
- **Design Gate：**SDD Level 和分级依据已确认；设计覆盖关键路径；Task、归档影响分析与适用的 API、数据、迁移、兼容性风险已完成。
- **Verification Gate：**Requirement 与关键 Scenario 均有测试和证据；test、build、lint、typecheck 和必要回归检查通过。
- **Archive Gate：**追踪矩阵完整，Current Specification delta 可安全应用；归档影响映射及 `archive-regression` 证据齐全。

`codespec validate`、`codespec status`、生命周期转换与 archive preflight 使用同一套 Core 校验。归档仍是单一原子事务：Current Specification 与 archive history 同时提交或同时保持旧状态，而不是拆成两个可部分失败的写入步骤。

### 生命周期状态与 Rebase

唯一合法状态序列为 `ANALYZE → DESIGN → PLAN → IMPLEMENT → VERIFY → ARCHIVE → ARCHIVED`；`ABANDONED` 是任何未归档活动状态可进入的终态。状态只能由 Core 生命周期命令转换，Skill 与人工不得直接改写 metadata 绕过门禁。

若 Rebase、Current Specification revision 漂移或并行 Change 裁决使 Requirement、Scenario、affected area 或 archive-impact 映射变化，Change 回到 `DESIGN`：旧设计影响分析、Task、测试关联和 Verification Evidence 均被标为过期，必须重审后才能重新进入 `PLAN`。仅重排文字且不影响上述输入时，Core 可以保留已完成阶段，但必须记录判定理由和 revision。`ARCHIVED` 的 Change 不可 Rebase 或回退；后续修订只能创建新的 Change。

### Bugfix、重构与范围变化

bugfix 必须先有稳定复现目标行为的失败测试；如果修复改变既有 Requirement 语义，必须升级为 `MODIFIED` 或 `REMOVED` + `ADDED` 的需求演进，不得以“修复”绕过规格更新。

纯 refactor 必须声明行为不变并通过既有回归；若行为变化，按业务 Change 处理。开发中发现新增范围时，若仍属于原目标，必须同步更新 Requirement、Scenario、Spec、Design、Task 和 Verification；若可独立交付，必须创建新的 Change 并声明依赖关系。

每个 Change 记录 `impact.affected_areas`。多 Change 并行时，Core 结合 Requirement 重叠和 affected area 将关系判断为 independent、dependent 或 conflicting；未裁决冲突不能归档。

### 非功能需求与分级 CI

性能、安全、可靠性、可观测性、合规与可访问性以普通 Requirement 记录，并映射到 benchmark、scan、演练或人工证据。只有 Change 声明相关约束时才增加对应检查。

CI 执行与风险相称的门禁：

- **Level 1：**修复一个单模块小 bug 时，运行关联单元测试、完整测试、build、typecheck、lint 和最小追踪检查；不强制性能压测或数据迁移验证。
- **Level 2：**例如新增“连续输错五次后锁定账号”，除 Level 1 外，运行 BDD/acceptance 场景与相关回归，证明新增行为不会破坏已有登录行为。
- **Level 3：**例如迁移至第三方统一认证并搬迁用户数据，除 Level 2 外，按适用性执行数据迁移一致性、接口兼容、安全扫描、性能指标、rollback、灰度发布和监控告警验证。

CI 命令由 CodeSpec 配置中的受控命令类别声明：`typecheck`、`unit`、`bdd`、`integration`、`archive-regression`、`security`、`performance` 和 `migration`。Core 只执行当前 Level 和适用 NFR 要求的类别，并把实际命令、退出码、执行时间、代码 revision 和产物路径写入 Evidence；不存在的类别必须明确标为“不适用”并给出理由，不能假定项目一定存在某个脚本。

### 追踪格式与安全边界

`verification.md` 的追踪矩阵采用固定表头或等价 YAML 结构，最小字段为 `requirement_id`、`scenario_id`、`task_id`、`test_id`、`evidence_id`、`result`。证据必须能定位到受控命令输出或已保存产物；Level 3 的 `code_reference` 必须为仓库内相对路径，可选地附带符号名。Core 验证引用存在、关系完整和 Evidence 对应当前 Change revision。

所有 YAML、模块 ID、Requirement ID、证据路径和归档输入均按不可信输入处理：拒绝路径穿越、工作区外路径、软链接逃逸和未知影响字段；验证命令不得泄露环境中的敏感值。archive lock 的取得、超时和崩溃恢复规则必须可重试且不破坏原子性。

## 归档影响分析

### 设计产物契约

Level 2 / 3 的 `design.md`，以及 Level 1 `spec.md` 的内联设计说明，必须含“归档影响分析”章节，章节紧跟一个由 Core 校验的 YAML 块：

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

每一个 `MODIFIED` 或 `REMOVED` delta 都必须恰好由一条归档影响映射覆盖；每条 `affected` 映射都必须指向对应 delta。映射还必须记录处置理由、兼容性策略和生效语义。Scenario 若语义不变可保留 ID；若验收行为变化，必须新建替代 Scenario，并在映射中写明旧/新 ID，不能复用 ID 隐藏行为变更。

### 门禁与证据

生命周期、`codespec validate`、`codespec status` 和 archive preflight 共享同一个异步归档影响校验器。它在适用状态读取 relevant Current Specification、验证映射、检查受影响 Requirement / Scenario 已出现在任务追踪中。

对 `outcome: affected`，fresh verification 必须包含一条成功的 `archive` 类别命令，覆盖映射中的旧和新 Requirement / Scenario。没有该证据，或证据签名、revision、baseline 不匹配时，不能进入或完成归档。

### 归档结果

`codespec archive` 在现有人工确认前展示受影响映射和 archive-regression 证据。确认后，archive transaction 读取当前模块 spec、应用 `ADDED` / `MODIFIED` / `REMOVED` delta，并原子安装新的 `codespec/specs/<MOD-ID>/spec.md`。

同一事务在 `codespec/archive/history.yaml` 写入审计记录：Change ID、归档时间、输入 Change revision、影响映射摘要、归档后每个 Current Specification 的模块 ID、内容哈希与 revision、验证 Evidence ID。历史 Change 只保存当时的 delta 与证据；哈希将该 delta 与归档后有效 Current Specification 绑定，以便日后审计而无需修改任何旧 Change。

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
- 交互式 `codespec init`、`codespec init --no-animation`、减少动态效果和 ASCII 降级路径均只展示 `HRHY` / `CodeSpec` 品牌，不含旧动画或 OpenSpec 文案。
- 归档影响 YAML 的有效、缺失、模糊、重复及非法映射均有 parser 和 lifecycle 测试。
- 覆盖兼容新增、部分修订、完全替代、纯 bugfix、需求语义错误 bugfix、缺 archive evidence 及 `Previous` 冲突。
- 归档失败时断言 Current Specification、archive history 和历史 Change 均未变化。
- `CHANGELOG.md` 从 CodeSpec 1.0.0 开始；当前用户文档、发布 workflow 与 Nix metadata 仅描述 CodeSpec。
- 发布工作流明确 npm access、`latest` / `beta` dist-tag、Git tag、GitHub Release 与 provenance 的对应关系；包内容检查验证上述身份和唯一 bin。

## 实施范围

- package、CLI bin、entry points、Core workflow directory、所有代码和测试 imports。
- workspace path resolver、初始化、Store、references、telemetry、templates、Skill generator 和 tool integrations。
- schemas、docs、examples、assets alt text、install prompt、release scripts/workflows、Nix and CI metadata。
- archive-impact parser、lifecycle gates、verification evidence、archive preflight/result 与回归测试。
