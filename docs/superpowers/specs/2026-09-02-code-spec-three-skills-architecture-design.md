# CodeSpec 三 Skill 单入口架构设计

> Status: design confirmed in chat; implementation not started.

## 1. 决策摘要

CodeSpec 的用户可见 OpenSpec Skill 收敛为三个：

```text
skills/
├── openspec-workflow/
│   └── SKILL.md
├── openspec-rebase-change/
│   └── SKILL.md
└── openspec-archive-change/
    └── SKILL.md
```

三个入口的职责分别是：

- `openspec-workflow`：正常开发唯一入口；
- `openspec-rebase-change`：STALE Change 和多 Change 冲突后的恢复入口；
- `openspec-archive-change`：Current Specification 更新和 Change 归档唯一入口。

其余 OpenSpec 能力不再作为独立 Skill 暴露。领域治理由 OpenSpec Core 负责，工程方法由现有 Superpowers Skill 负责。`code-spec` 是唯一默认协议，`openspec` 保留为 CLI、包和 Skill 前缀。

## 2. 背景与问题

当前 `skills/` 目录包含多个阶段 Skill，包括创建、继续、快速生成、实现、验证、同步和归档。阶段 Skill 将用户入口、领域规则和工程方法混在一起，产生以下问题：

1. 同一项开发工作存在多个入口，用户需要判断应该调用 `new`、`propose`、`continue`、`ff`、`apply` 还是 `verify`。
2. Requirement、Baseline、STALE、Conflict 和 Canonical Spec 等领域规则分散在多个提示词中，容易产生不一致。
3. `syncSpecs()`、`applyDelta()` 和归档事务存在被独立调用的风险，可能在没有完整归档门禁时修改 Current Specification。
4. `spec-driven`、slug Change、`.openspec.yaml` 和 `openspec/specs/` 等历史模型仍出现在部分 Skill 中。
5. Superpowers 方法论已经存在，OpenSpec Skill 不需要复制 brainstorming、planning、TDD、debugging 或 review 流程。

本设计将用户入口、领域治理和工程方法拆开，使每一层只有一个责任。

## 3. 目标

- 为正常开发提供一个用户可识别的入口。
- 为 STALE Change 提供一个明确的恢复入口。
- 为 Current Specification 更新提供一个唯一的归档入口。
- 将 Change、Requirement、Baseline、STALE、Conflict 和归档事务收回 OpenSpec Core。
- 将 brainstorming、writing-plans、TDD、debugging、verification 和 code review 交给现有 Superpowers Skill。
- 让所有生成的 OpenSpec Skill 只使用 canonical `code-spec` 协议。
- 保留现有 `openspec` CLI、包名、命令协议和工具集成名称。
- 让命令行 API 继续服务脚本和测试，但不再把每个 CLI 阶段命令当作独立 AI Skill 入口。

## 4. 非目标

- 本次不将 `openspec-*` 全量重命名为 `codespec-*`。
- 本次不删除 CLI 内部命令；CLI 仍是确定性 Core 能力的机器接口。
- 本次不复制 Superpowers Skill 到工程的 `skills/` 目录。
- 本次不设计完整的 SDD 分级规则；只定义其作为 Core 内部策略的边界。
- 本次不恢复旧 `spec-driven` Change、slug Change 或 `.openspec.yaml` 的读取和写入能力。

## 5. 分层架构

```text
用户请求
    │
    ▼
openspec-workflow
    │
    ├── OpenSpec Core
    │     ├── Change 解析与创建
    │     ├── Module / Requirement 分配
    │     ├── Baseline / STALE 管理
    │     ├── Canonical 验证
    │     ├── SDD 策略
    │     └── 生命周期门禁
    │
    └── Superpowers
          ├── brainstorming
          ├── writing-plans
          ├── test-driven-development
          ├── systematic-debugging
          ├── verification-before-completion
          └── code review / branch finishing

STALE 恢复请求
    │
    ▼
openspec-rebase-change
    │
    └── OpenSpec Core: semantic rebase → DESIGN

归档请求
    │
    ▼
openspec-archive-change
    │
    └── OpenSpec Core: validate → conflict check → apply delta → archive transaction
```

### 5.1 OpenSpec Skill 层

Skill 只负责理解用户请求、组织上下文、选择 Core 操作和调用 Superpowers。Skill 不实现 Requirement 解析、Delta 合并、Baseline 比较或文件事务。

### 5.2 OpenSpec Core 层

Core 是领域规则的唯一实现位置。所有 Skill 和 CLI 都通过 Core 的确定性 API 操作 canonical workspace。Core 负责状态、路径、标识符、验证和事务，不负责替代 Superpowers 的工程方法论。

### 5.3 Superpowers 层

Superpowers 负责如何分析和实施工程工作：理解问题、选择设计、编写计划、执行 TDD、调试、验证和代码审查。OpenSpec 将 canonical 上下文注入这些方法论，但不复制或改写其核心流程。

## 6. 三个 Skill 的职责

### 6.1 `openspec-workflow`

这是正常开发的唯一入口，覆盖以下用户请求：

- 新建或恢复 Change；
- 分析需求和影响模块；
- 生成或修订规划产物；
- 执行实现任务；
- 验证实现结果；
- 查询当前状态和下一步。

它的基本流程是：

```text
解析用户意图
    ↓
resolveChange / createChange
    ↓
加载 canonical 上下文和 metadata.yaml
    ↓
按 mode 选择 Superpowers 方法
    ↓
调用 Core 完成模块、Requirement、Baseline 和状态门禁
    ↓
回写 metadata.yaml、tasks.md、verification.md
    ↓
检查 STALE、阻塞项和下一个可执行动作
```

根据 Change mode 选择方法论：

- feature：brainstorming → writing-plans → TDD；
- bugfix：systematic-debugging → spec-impact decision → TDD；
- refactor：design-impact → writing-plans → TDD。

`openspec-workflow` 不直接修改 Current Specification，也不绕过 archive 入口。

### 6.2 `openspec-rebase-change`

这是异常恢复入口，不是第二个正常开发入口。只有 Change 的 `baseline.stale` 为 `true`，或用户明确请求 semantic rebase 时使用。

流程：

```text
解析 Change
    ↓
确认 baseline.stale === true
    ↓
调用 rebaseChange()
    ↓
重新比较 Current Specification
    ↓
更新 baseline 和 revision
    ↓
使失效的实现 / 验证结论重新进入规划状态
    ↓
路由回 DESIGN
```

Rebase 后不得自动重新实现、自动验证或自动归档。用户需要通过 `openspec-workflow` 继续处理。

### 6.3 `openspec-archive-change`

这是 Current Specification 的唯一更新入口，也是 Change 的唯一归档入口。

流程：

```text
加载 Change 和 verification.md
    ↓
执行 canonical 验证和归档门禁
    ↓
检查 Requirement / Delta / Baseline / Conflict
    ↓
在事务内 applyDelta 和 syncSpecs
    ↓
写入 Current Specification
    ↓
写入 immutable archive/changes
    ↓
标记相关活动 Change 为 STALE
    ↓
返回归档结果和后续恢复提示
```

`syncSpecs()`、`applyDelta()`、`detectArchiveConflict()` 只能作为归档事务内部能力使用。归档 Skill 不应把这些函数暴露成独立用户操作。

## 7. OpenSpec Core 内部能力

### 7.1 Change 和标识符

```text
createChange()
resolveChange()
allocateChangeId()
resolveModules()
allocateRequirementId()
```

这些函数负责 canonical Change 的创建、解析和标识符分配。它们必须使用：

- `openspec/config.yaml`；
- `openspec/business.md`；
- `openspec/changes/index.yaml`；
- `openspec/changes/CHG-YYYYMMDD-NNN/metadata.yaml`。

不得回退到 slug Change 或旧 `.openspec.yaml`。

### 7.2 Baseline 和 STALE

```text
captureBaseline()
detectStale()
```

Baseline 在 Change 创建或需要重新建立基线时捕获。归档后只将 Requirement 有重叠的活动 Change 标记为 STALE。无关 Change 不受影响。

### 7.3 Canonical 验证

```text
validateRequirementDelta()
validateTraceability()
validateCanonicalSpec()
```

验证对象包括：

- Requirement ID 的唯一性和合法性；
- metadata、design、spec、tasks 之间的追踪一致性；
- Scenario 的 GIVEN / WHEN / THEN 结构；
- Delta 的 ADDED、MODIFIED、REMOVED 语义；
- `verification.md` 的 Requirement、test、build、lint 证据；
- Current Specification 的 canonical 结构。

### 7.4 归档事务

```text
syncSpecs()
applyDelta()
detectArchiveConflict()
archiveTransaction()
```

`archiveTransaction()` 是唯一公开的归档服务。内部顺序必须满足：

1. 读取并验证所有输入；
2. 检查 Baseline 和归档冲突；
3. 计算 Delta 应用计划；
4. 以事务方式写入 Current Specification 和归档历史；
5. 更新 Change 状态和相关 STALE 状态；
6. 在失败时保留原始文件和原始状态。

任何一步失败，都不能留下 Current Specification 已更新但 Change 未归档的半完成状态。

### 7.5 SDD 内部策略

```text
assessSddLevel()
resolveSddProfile()
escalateSddLevel()
```

SDD 策略用于决定需要调用哪些 Superpowers 方法论，不作为用户 Skill 暴露。它不能绕过用户确认、Change 状态门禁、TDD 或验证要求。

当当前工程没有足够信息判断 SDD 级别时，Core 应选择较低风险的保守路径或返回需要用户确认的诊断，不应静默扩大工作范围。

## 8. Canonical 数据流和状态边界

```text
ANALYZE
  ↓
DESIGN
  ↓
PLAN
  ↓
IMPLEMENT
  ↓
VERIFY
  ↓
ARCHIVE
  ↓
ARCHIVED
```

异常分支：

```text
任何需要实现或归档的阶段 + baseline.stale
    ↓
阻塞当前动作
    ↓
openspec-rebase-change
    ↓
DESIGN
```

`openspec-workflow` 负责正常状态推进，`openspec-rebase-change` 负责 STALE 恢复，`openspec-archive-change` 负责最终状态提交。Skill 不得直接修改状态字段绕过 Core。

## 9. 生成和兼容策略

### 9.1 源模板优先

`skills/*/SKILL.md` 是生成产物，不直接编辑。实现时应修改：

```text
src/core/templates/workflows/openspec-workflow.ts
src/core/templates/workflows/rebase-change.ts
src/core/templates/workflows/archive-change.ts
src/core/shared/skill-generation.ts
src/core/templates/skill-templates.ts
```

`openspec-rebase-change` 需要新增对应模板、生成注册和必要的 parity 测试。

### 9.2 生成集合

`getSkillTemplates()` 最终只生成三个 OpenSpec Skill。旧的 `new`、`propose`、`continue`、`ff`、`apply`、`verify`、`onboard`、`update`、`sync` 和 `bulk-archive` 不再作为独立 Skill 输出。

如果命令文件仍然向用户暴露这些阶段入口，命令生成逻辑也必须收敛，否则用户仍会看到多个开发入口。CLI 命令可以继续作为 Core 的机器接口保留。

### 9.3 兼容边界

- `openspec` CLI 名称不变；
- 包名和外部工具集成名称不变；
- `openspec-*` Skill 前缀不变；
- canonical Change 和 Core JSON 契约保持稳定；
- 旧 Skill 文件不再由新生成流程创建；
- 旧 Change 文件不删除，但不参与 canonical 解析。

## 10. 错误处理和安全边界

- 找不到唯一 Change 时，`openspec-workflow` 必须要求用户选择，不得猜测。
- 找到 STALE Change 时，正常开发动作必须停止并指向 rebase。
- Rebase 只更新 Change 的基线和规划状态，不自动执行实现。
- 归档前缺少验证证据时，归档必须停止。
- 归档冲突时，必须返回冲突 Requirement、Change 和解决建议。
- 归档事务失败时，Current Specification、archive history 和 Change 状态都保持原状。
- Skill 不能直接修改 `metadata.yaml` 中的生命周期状态，必须通过 Core 状态机。
- 不得复制运行时上下文、规则或操作指导文本到用户产物。

## 11. 测试策略

### 11.1 Skill 生成测试

- 生成集合只有三个 OpenSpec Skill；
- 生成结果与模板保持 parity；
- 旧 Skill 目录不会残留；
- 保留的 Skill 不含 `spec-driven`、slug、`.openspec.yaml` 或旧 `openspec/specs/` 引用。

### 11.2 Core 单元测试

- Change 创建、解析和 ID 分配；
- Module 和 Requirement 分配；
- Baseline 捕获和 STALE 检测；
- Requirement Delta、Traceability 和 Canonical Spec 验证；
- Semantic Rebase 后 revision、baseline 和状态正确；
- 归档冲突检测；
- Delta 应用和 Current Specification 更新；
- 归档事务失败时的原子性。

### 11.3 端到端测试

至少覆盖以下旅程：

1. 通过 `openspec-workflow` 创建并完成一个 Change；
2. 两个 Change 互不影响时正常归档；
3. 归档后相关 Change 被标记 STALE；
4. 通过 `openspec-rebase-change` 恢复 STALE Change；
5. 通过 `openspec-archive-change` 更新 Current Specification 并完成归档；
6. 归档冲突或验证失败时没有部分写入；
7. 旧 Skill 不再成为新安装的用户入口。

验证命令：

```bash
pnpm build
pnpm lint
pnpm test
git diff --check
```

## 12. 实施顺序

1. 将 `openspec-workflow.ts` 定义为三 Skill 共用的 canonical 协议和上下文契约。
2. 在 Core 中确认 Change、Baseline、Validation、Rebase 和 Archive 的服务边界。
3. 新增 `rebase-change` Skill 模板和生成入口。
4. 将 `openspec-workflow` 扩展为创建、规划、实现和验证的完整编排入口。
5. 将归档相关的 Delta、冲突和 Current Specification 写入收敛到 `archiveTransaction()`。
6. 从 Skill 生成集合中移除旧阶段 Skill。
7. 同步收敛命令生成，避免旧命令继续形成多个 AI 入口。
8. 重新生成 `skills/`，执行 parity、单元和端到端测试。
9. 更新用户文档，说明三个 Skill 的职责和 STALE 恢复流程。

## 13. 验收标准

设计实现完成后，应满足：

- `skills/` 只包含 `openspec-workflow`、`openspec-rebase-change` 和 `openspec-archive-change`；
- 正常开发不需要用户选择 `new`、`propose`、`continue`、`ff`、`apply` 或 `verify`；
- Current Specification 只有 archive 入口可以修改；
- STALE Change 不能绕过 rebase 直接实现或归档；
- Core 是 Requirement、Baseline、Conflict 和 Canonical Spec 的唯一规则来源；
- Superpowers 是 brainstorming、planning、TDD、debugging、verification 和 review 的唯一方法论来源；
- 新生成 Skill 完全使用 canonical `code-spec`；
- CLI 的确定性机器接口和外部集成保持兼容；
- 全量构建、lint、测试和生成 parity 检查通过。
