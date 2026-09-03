# CodeSpec Scenario ERROR 支持设计

## 1. 目标

为 `code-spec` 的 Scenario 正式支持 `ERROR`，用于记录异常条件和系统处理方式，并保证该信息从 Delta Spec 一直保留到 Current Specification、Verification 和归档结果。

本设计只改变 canonical `code-spec` 工作流。`spec-driven` 等旧 Schema 不在本次范围内。

## 2. 已确认规则

### 2.1 语法规则

每个 Scenario 必须出现 `ERROR` 行：

```markdown
#### Scenario: SCN-001 查询失败
- **GIVEN** 用户详情服务不可用
- **WHEN** 管理员打开用户详情
- **THEN** 系统显示失败提示
- **ERROR** 系统记录错误上下文并允许用户重试
```

`ERROR` 行可以暂时为空：

```markdown
- **ERROR**
```

空值表示异常处理尚未由人工补写。它可以通过解析和继续编辑，但不能通过最终校验、Verification 或归档门禁。

### 2.2 Delta 分支规则

- `ADDED` 的 `New` 中每个 Scenario 必须出现 `ERROR`。
- `MODIFIED` 的 `Previous` 和 `New` 中每个 Scenario 都必须出现 `ERROR`。
- `REMOVED` 的 `Previous` 中每个 Scenario 必须出现 `ERROR`。
- `ERROR` 的内容按出现顺序保存，支持多行。
- 缺少 `ERROR` 行是格式错误，不能兼容历史格式。

## 3. 数据模型

canonical Scenario 从：

```ts
{
  id,
  name,
  given: string[],
  when: string[],
  then: string[],
}
```

扩展为：

```ts
{
  id,
  name,
  given: string[],
  when: string[],
  then: string[],
  error: string[],
}
```

`error: []` 表示 `ERROR` 行存在但暂时为空。解析结果不使用自动生成的默认文本，也不从 `THEN` 推断异常行为。

需要同步更新：

- `src/core/openspec-workflow/types.ts` 的 Scenario 类型。
- `src/core/openspec-workflow/schemas.ts` 的 canonical Scenario Schema。
- 所有创建、复制、比较和渲染 Scenario 的代码路径。

## 4. 解析规则

### 4.1 Delta parser

`src/core/openspec-workflow/delta-parser.ts` 当前只接受 `GIVEN/WHEN/THEN`。本次将 `ERROR` 加入 Scenario 行解析：

1. 识别 `- **ERROR** <text>` 和 `- **ERROR**`。
2. 收集所有非空 `ERROR` 内容到 `error` 数组。
3. 只有完全没有 `ERROR` 行时才抛出格式错误。
4. 保持现有的 `GIVEN`、`WHEN`、`THEN` 必填规则。

错误信息必须包含 Requirement ID 和 Scenario ID，明确区分“缺少 `ERROR` 行”和“`ERROR` 为空”。

### 4.2 Current Specification parser

归档后的 `Current Specification` 使用与 canonical Scenario 相同的 `error` 语义：

- 解析 Scenario 时识别 `ERROR` 行。
- `ERROR` 行缺失时报告格式错误。
- `ERROR` 行为空时保留为空，并由最终校验报告未完成。
- 重渲染或归档应用时按 `GIVEN → WHEN → THEN → ERROR` 顺序输出。

通用 `spec-driven` 的 raw Scenario 解析不改变；`code-spec` 的校验入口必须显式启用上述严格规则。

## 5. 校验和门禁

### 5.1 解析门禁

缺少 `ERROR` 行的 Delta 或 Current Specification 不能进入 canonical 的 Delta、Verification、rebase 或 archive 解析流程。

### 5.2 最终校验

存在 `ERROR` 行但内容为空时：

- `openspec validate` 返回失败。
- 诊断包含 `Change`、Requirement ID、Scenario ID 和补写提示。
- 不自动填入内容，不把空值当成“无异常”。

### 5.3 Verification

Verification 继续以 Scenario ID 记录覆盖关系，不重复存储 `ERROR` 文本。生成 `PASS` 证据前，Verification 必须确认每个 Scenario 的 `error` 数组非空。

Verification 失败时不得更新为 `PASS`，也不得生成可满足归档门禁的最新证据。

### 5.4 Archive

`preflightArchive()` 必须重新检查所有 Scenario 的 `ERROR`：

- 缺少行：解析失败。
- 行存在但为空：归档门禁失败。
- 内容非空：允许继续执行事务。

该检查不能只依赖旧的 `verification.md`，因为 Delta 或 Current Specification 可能在 Verification 后发生变化。

## 6. 重渲染和归档数据流

```text
Delta Spec
  ↓ parseDeltaSpec()
Scenario.error
  ↓ validate / Verification
Scenario.error
  ↓ Delta render / archive transaction
Current Specification
  ↓ parse and validate
保留完整 ERROR
```

重渲染函数必须输出：

```markdown
- **GIVEN** ...
- **WHEN** ...
- **THEN** ...
- **ERROR** ...
```

空值只允许作为编辑过程中的占位输出，不能成为通过最终门禁的 Current Specification。

## 7. 测试策略

### 7.1 Parser 测试

- 非空 `ERROR` 可以解析。
- 空 `ERROR` 可以解析为 `error: []`。
- 缺少 `ERROR` 失败。
- `MODIFIED` 的 `Previous/New` 分别检查 `ERROR`。
- `REMOVED` 的 `Previous` 检查 `ERROR`。
- 多个 `ERROR` 行保持顺序。
- `ERROR` 不会被误识别为普通未消费文本。

### 7.2 Schema、校验和事务测试

- Scenario Schema 接受 `error: string[]`。
- 空 `ERROR` 被 `validate` 拒绝。
- 空 `ERROR` 不能生成 `PASS` Verification。
- 空 `ERROR` 不能通过 `preflightArchive()`。
- 非空 `ERROR` 通过验证并在归档后 Current Specification 中保留。
- 归档重渲染不会丢失 `ERROR`，也不会改变其他 Scenario。

### 7.3 夹具和模板测试

- `schemas/code-spec/templates/spec.md` 的每个 Scenario 都包含 `ERROR`。
- 所有 canonical 测试夹具补齐 `ERROR`。
- `verification.md` 的模板和验证测试继续使用 Scenario ID，并覆盖 ERROR 必填门禁。
- 增加缺少 `ERROR` 和空 `ERROR` 的错误消息断言。

## 8. 非目标

- 不从 `THEN` 自动生成 `ERROR`。
- 不把 `ERROR` 作为独立 Requirement 或独立 Scenario。
- 不改变 `spec-driven` 的旧解析契约。
- 不增加自动迁移命令。
- 不改变归档的人工确认规则；归档仍必须由交互式人工确认。
