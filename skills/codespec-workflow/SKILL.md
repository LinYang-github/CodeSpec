---
name: codespec-workflow
description: 将 CodeSpec code-spec 工作流路由到 canonical Change 流程。
allowed-tools: Bash(codespec:*)
license: MIT
compatibility: Requires codespec CLI.
metadata:
  author: codespec
  version: "1.0"
---

## 中文用户体验约定

所有面向用户的解释、提问、进度、总结和生成产物正文使用中文。命令名、选项名、路径、YAML/JSON key、schema 名称、稳定 ID、状态枚举和 DSL Token 保持英文，确保协议可以执行和解析。状态展示使用中文标签并在括号中保留英文协议值，例如“状态：分析（ANALYZE）”。


## Canonical CodeSpec 工作流

将 code-spec 工作通过 `codespec-workflow` 适配器路由。解析或创建匹配 `CHG-YYYYMMDD-NNN` 的 canonical Change ID；不要使用 slug Change 或旧版 `.codespec.yaml` 元数据。Change 目录为 `codespec/changes/<CHG-ID>/`，状态以 `metadata.yaml` 为准。

在每次提示和命令中传递 Change ID、生命周期 status、baseline、Requirement ID（`MOD-###-REQ-###`）、Scenario、Task ID（`CHG-YYYYMMDD-NNN-TASK-##`）和元数据产物路径。活动 Change 只生成五个 canonical 文件：`metadata.yaml`、`design.md`、`spec.md`、`tasks.yaml`、`verification.yaml`；PLAN 仅作为兼容旧状态的内部状态，不创建额外文件。在验证产物中记录必需的 Requirement/test/build/lint 命令及证据。

### 执行前解析并注入上下文

运行 `codespec context --json` 解析 canonical workspace。通过明确的 `CHG-YYYYMMDD-NNN` ID 或绑定上下文解析 Change，然后运行 `codespec status --change "<CHG-ID>" --json` 并加载 `codespec/changes/<CHG-ID>/metadata.yaml` 及其声明的产物路径。将实际 Change ID、status、baseline、受影响 Requirement ID 和 Scenario ID、Task ID、已有证据以及 canonical metadata/design/spec/tasks/verification 路径注入每个 Superpowers 提示。上下文缺失、元数据缺失或解析有歧义时，明确失败并停止；不要猜测，也不要回退到 slug/旧版元数据。

在规划、实现、验证或归档前，重新解析 status 和产物，并将结果上下文传给对应的 Superpowers skill。每次有实质动作后刷新状态，并将追踪关系/证据写回 canonical 产物。必需命令必须从解析出的 workspace 执行，并逐字记录命令及结果。

原样复用 Superpowers 方法论：brainstorming、writing-plans、TDD RED → GREEN、systematic debugging、fresh verification、code review 和 branch finishing。baseline 过期时，继续之前先通过 semantic rebase。

### Scenario 的 ERROR 规则

canonical spec.md 和 Current Specification 的每个 Scenario 都必须包含 ERROR 行；一个 Scenario 可以有多条 ERROR，按原顺序保留。分析阶段如果暂时无法确定异常处理，可以保留空的 - **ERROR** 行，表示待人工补写，不得从 THEN 或上下文自动推断。进入 VERIFY 前，Core 必须检查 Delta 和 Current Specification 中的所有 Scenario：ERROR 缺失或为空都必须失败，并要求人工补写；在此之前 Verification 不得通过，Change 不得归档。Verification 证据记录 Requirement/Scenario ID 和命令结果，不替代 ERROR 正文。



## 唯一开发入口

所有正常开发请求都从这里进入。先解析当前 canonical workspace 和 Change；不存在 Change 时由 CodeSpec Core 内部执行 createChange() 与 allocateChangeId()，存在 Change 时执行 resolveChange()，不得让用户在多个阶段 Skill 之间选择。

### 领域治理由 CodeSpec Core 负责

Core 内部负责模块解析、Requirement/Scenario ID 分配、captureBaseline()、detectStale()、状态迁移、Traceability、Canonical Spec 校验、delta 应用和事务边界。assessSddLevel()、resolveSddProfile() 与 escalateSddLevel() 也属于 Core 策略；入口只读取其结果，不复制判断规则。

### 工程方法由 Superpowers 负责

- 需求不清或涉及新功能：调用 superpowers:brainstorming。
- 需要多步实现：调用 superpowers:writing-plans，随后按计划串行执行。
- 实现和修复：遵循 superpowers:test-driven-development 的 RED → GREEN → REFACTOR。
- 遇到失败或异常行为：调用 superpowers:systematic-debugging。
- 完成前：调用 superpowers:verification-before-completion；需要审查时使用 code review 技能。

### 路由门禁

1. 运行 codespec context --json，再运行 codespec status --change "<CHG-ID>" --json，读取 metadata、design、spec、tasks 和 verification 的实际路径。
2. 先由 Core 检查 Change、模块、Requirement、baseline 和 status。若 baseline 为 STALE、存在多 Change 冲突或需要重建基线，立即转交 codespec-rebase-change。
3. 规划阶段只写 canonical Change 规划产物；实现阶段只按 tasks 和 Superpowers 计划修改代码；验证阶段记录 Requirement、Scenario、Task 与命令证据。
4. 完成后刷新 status。只有所有必要验证通过且 Core 报告可归档时，才转交 codespec-archive-change。
5. 任何阶段都不得直接修改 Current Specification；Current Specification 只能由 archive 事务写入。

### 人工批准门禁

DESIGN 完成后必须停止：展示设计摘要、Requirement/Scenario 影响和计划范围；不得创建计划、执行任务或修改业务代码。明确要求用户在独立的新用户消息中确认设计。收到该独立确认后，先运行 `codespec approve --change "<CHG-ID>" --stage design`，成功后才可转换到 PLAN。

PLAN 完成后必须停止：展示任务、验证范围和实施影响；不得执行实现任务或修改业务代码。明确要求用户在独立的新用户消息中确认计划。收到该独立确认后，先运行 `codespec approve --change "<CHG-ID>" --stage plan`，成功后才可转换到 IMPLEMENT。

确认设计不等于确认计划或确认实现。用户补充内容如影响目标、范围、模块、Requirement、Scenario、验收条件、SDD 等级或 Current Specification 影响，必须停止并重新解析 Change；旧确认可能已经失效，不得直接修改 `metadata.yaml` 的 `approvals` 字段绕过 `codespec approve`。

**Store 选择：** 如果用户指定了 store（store 是本机注册的独立 CodeSpec 仓库），或当前工作位于 store 中，请运行 `codespec store list --json` 查找已注册的 store ID，然后在读写 Spec 和 Change 的命令中传入 `--store <id>`（包括 `new change`、`change new`、`status`、`instructions`、`list`、`show`、`validate`、`archive`、`doctor`、`context`、`schemas`、`view`、`rebase`、`transition`、`approve`、`abandon`、`detect-stale`、`allocate-requirements`）。选择后，在本次工作流的后续步骤中持续使用 `--store <id>`。下面未带范围的命令示例都只是简写：执行前要追加该选项。例如运行 `codespec status --change "<name>" --json --store "<id>"`，不要直接运行未带选项的形式。其他命令不接受该选项。命令打印的后续提示已经带有该选项，继续使用即可。没有 store 时，命令作用于最近的本地 `codespec/` 根目录。
