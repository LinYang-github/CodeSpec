# CodeSpec Workflow 阶段批准门禁设计

> Status: design confirmed in chat; implementation pending.

## 1. 背景

`codespec-workflow` 当前可以在完成 DESIGN 后继续进入 PLAN，完成 PLAN 后继续进入 IMPLEMENT。现有 Core 门禁只检查产物是否完整，不记录用户是否批准设计或计划。

CodeSpec 的用户手册已经约定：实现前需要确认设计和计划。需要把这个约定落实为 Skill 指令和 Core 状态门禁，避免不同 AI 工具忽略暂停要求。

## 2. 目标

- DESIGN 完成后必须等待用户确认，确认后才能进入 PLAN。
- PLAN 完成后必须等待用户确认，确认后才能进入 IMPLEMENT。
- 用户补充内容影响目标、范围、模块、Requirement、Scenario、验收条件或 SDD 等级时，自动使原批准失效。
- Core 根据批准记录和当前产物内容哈希拒绝非法状态转换。
- 不改变 ARCHIVE 已有的交互式人工确认机制。
- 兼容没有批准记录的历史 Change，不自动把历史产物标记为已批准。

## 3. 非目标

- 不把所有 AI 对话变成 CLI 交互。
- 不增加独立的 UI 批准页面。
- 不改变 ANALYZE、VERIFY、ARCHIVE 的既有业务语义。
- 不允许批准记录替代 Requirement、Scenario、Task、测试、构建或 lint 门禁。

## 4. 总体方案

采用 Skill + Core 双层门禁：

1. 生成的 `codespec-workflow` Skill 在 DESIGN 和 PLAN 结束处明确停止，并要求用户在新的消息中确认。
2. Core 在 `metadata.yaml` 中保存批准记录。
3. Core 为批准记录保存对应的 Change revision 和产物内容哈希。
4. 状态机在 `DESIGN → PLAN` 和 `PLAN → IMPLEMENT` 时校验批准记录。
5. 产物、revision 或影响范围发生变化时，批准记录自动失效。

Skill 提供可理解的交互提示，Core 提供跨工具一致的状态约束。两者任一层缺失都不能作为绕过另一层的理由。

## 5. Metadata 数据模型

在 canonical Change 的 `metadata.yaml` 增加：

```yaml
approvals:
  schema_version: 1
  design:
    status: pending
    revision: 1
    content_hash: ""
    approved_at: null
  plan:
    status: pending
    revision: 1
    content_hash: ""
    approved_at: null
```

批准状态为：

```text
pending → approved → revoked
```

字段约束：

- `schema_version` 为正整数。
- `status` 只能是 `pending`、`approved` 或 `revoked`。
- `revision` 必须与 `change.revision` 一致。
- `content_hash` 使用 SHA-256；`pending` 状态允许为空，`approved` 必须为 64 位十六进制字符串。
- `approved_at` 在 `approved` 状态时为 ISO 8601 时间，否则为空。

## 6. 批准内容哈希

### 6.1 Design 批准哈希

Design 批准哈希覆盖以下规范化内容：

- `proposal.md`
- `design.md`
- `spec.md`
- 当前 Requirement 和 Scenario 追踪关系
- SDD 等级

任何一项发生变化，现有 Design 批准都不再有效。

### 6.2 Plan 批准哈希

Plan 批准哈希覆盖以下规范化内容：

- `design.md`
- `spec.md`
- `tasks.md`
- Requirement、Scenario、Task 追踪关系

代码实现本身不属于 Plan 批准哈希。代码修改应由 TDD、验证和归档门禁负责。

哈希计算复用现有验证模块的 SHA-256 约定，输入顺序和序列化方式必须稳定，并通过测试固定。

## 7. 状态转换规则

### 7.1 DESIGN → PLAN

转换前必须满足：

- `approvals.design.status === approved`
- `approvals.design.revision === change.revision`
- 当前 Design 批准哈希与 `approvals.design.content_hash` 相同
- DESIGN 现有退出门禁通过

否则 Core 返回明确错误，说明需要重新确认设计。

### 7.2 PLAN → IMPLEMENT

转换前必须满足：

- `approvals.plan.status === approved`
- `approvals.plan.revision === change.revision`
- 当前 Plan 批准哈希与 `approvals.plan.content_hash` 相同
- PLAN 现有退出门禁通过

否则 Core 返回明确错误，说明需要重新确认计划。

### 7.3 其他转换

- `ANALYZE → DESIGN` 不需要批准记录，但生成或更新设计后，Design 批准必须为 `pending`。
- `IMPLEMENT → VERIFY` 继续使用任务完成门禁。
- `VERIFY → ARCHIVE` 继续使用验证、影响分析和归档门禁。
- `ARCHIVE → ARCHIVED` 继续使用现有终端人工确认。
- 任何进入 DESIGN 的 rebase 或语义变更都必须撤销 Design 和 Plan 批准。

## 8. 用户补充说明的处理

Skill 在收到补充说明后，先判断是否影响以下内容：

- 目标或范围
- 业务模块
- Requirement
- Scenario
- 验收条件
- SDD 等级
- Current Specification 影响

如果不影响上述内容，只更新非语义说明，不撤销批准。

如果影响上述任一内容：

1. 停止当前规划或实现动作。
2. 将相关批准状态设为 `revoked` 或 `pending`。
3. 必要时递增 Change revision。
4. 重新输出设计差异。
5. 等待新的用户确认。
6. 重新生成并确认计划后，才允许恢复实现。

如果新增内容改变了功能目标或模块范围，应先回到 ANALYZE，再重新进入 DESIGN。

## 9. CLI 批准入口

增加显式批准命令：

```bash
codespec approve --change CHG-20260907-001 --stage design
codespec approve --change CHG-20260907-001 --stage plan
```

命令职责：

1. 解析 canonical workspace 和 Change。
2. 读取当前 revision 和产物。
3. 执行对应阶段的完整门禁。
4. 计算批准内容哈希。
5. 写入批准状态、revision、hash 和时间。

批准命令不得批准过期、缺失产物或门禁失败的阶段。它不修改 Current Specification，也不替代 ARCHIVE 命令的最终确认。

## 10. Skill 指令变化

生成的 `codespec-workflow` 必须包含以下规则：

- 完成 DESIGN 后停止，不创建计划、不修改业务代码。
- 输出设计摘要、Requirement/Scenario 影响和下一步计划范围。
- 使用单独的新用户消息确认设计。
- 完成 PLAN 后停止，不执行实现任务。
- 使用单独的新用户消息确认计划。
- “确认设计”不等于“确认计划”或“确认实现”。
- 用户补充语义内容后，重新解析状态和批准记录。
- 不得直接修改 `metadata.yaml` 的批准字段绕过 `codespec approve`。

## 11. 历史 Change 兼容

- 缺少 `approvals` 的 metadata 读取时补充内存默认值，不自动写入 `approved`。
- 处于 DESIGN 或 PLAN 的历史 Change，在向前推进时要求新的批准。
- 已处于 IMPLEMENT 或 VERIFY 的历史 Change 不自动回退，但继续执行现有后续门禁。
- 旧 Change 的批准记录不得通过缺省值绕过新的状态转换校验。

## 12. 测试要求

新增或调整测试覆盖：

1. 缺少 Design 批准时，`DESIGN → PLAN` 失败。
2. 有效 Design 批准可以进入 PLAN。
3. 修改 Design 内容后，旧哈希失效。
4. revision 变化后，旧批准失效。
5. 缺少 Plan 批准时，`PLAN → IMPLEMENT` 失败。
6. 有效 Plan 批准可以进入 IMPLEMENT。
7. 批准命令拒绝门禁失败和过期产物。
8. 旧 metadata 可以解析，但不能绕过批准门禁。
9. Skill 和命令模板都包含暂停、单独确认和禁止继续执行的规则。
10. 归档现有人工确认行为保持不变。

## 13. 迁移与发布

实现完成后需要：

1. 更新 TypeScript 类型、Zod schema、Core 门禁和 CLI 命令。
2. 更新 Skill 和命令模板。
3. 更新用户手册和工作流文档。
4. 重新构建 `dist`。
5. 重新生成离线 tgz。
6. 对新项目执行 `codespec init`，对已有项目执行 `codespec update`，使批准门禁指令生效。
7. 验证旧 Change、新 Change、跨平台离线包和归档流程。

## 14. 风险与边界

- AI 工具可能仍然在对话层提前生成文本，因此 Skill 必须明确要求在批准前停止写文件和执行实现命令。
- Core 能保证状态转换不能绕过批准记录，但不能证明某条对话消息确实由人类输入。批准命令和 Skill 的独立确认约束共同降低该风险。
- 内容哈希必须使用稳定序列化，否则无语义变化的格式化也会导致重复确认。
- 批准记录不能替代验证证据，代码变化仍必须重新执行 VERIFY。
