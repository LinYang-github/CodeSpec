# CodeSpec 工作流

`code-spec` 把一次开发拆成两条协作线：OpenSpec Core 管理 Change、Requirement、Baseline、状态和归档事务，Superpowers 管理工程方法。正常开发只从 `workflow` 进入。

```text
workflow ──► 分析/规划 ──► 实现 ──► 验证 ──► 人工确认归档
   │              │           │         │
   └── STALE 或冲突 ──────────┴─────────┴──► rebase ──► workflow
```

## 三个公开入口

| 入口 | 使用时机 | 主要负责方 |
|---|---|---|
| `openspec-workflow` | 所有正常开发请求，或继续一个已有 Change | OpenSpec Core + Superpowers |
| `openspec-rebase-change` | Core 报告 `STALE`、Baseline 漂移或多 Change 冲突 | OpenSpec Core |
| `openspec-archive-change` | 实现和验证完成后提交 Change | OpenSpec Core，归档前必须人工确认 |

在 AI 对话中使用工具生成的调用形式。例如：

```text
/opsx:workflow add-rate-limit
/opsx:rebase
/opsx:archive
```

## CodeSpec 产物顺序

`code-spec` 默认 Change 使用 `CHG-YYYYMMDD-NNN` ID，目录为 `openspec/changes/<CHG-ID>/`。Core 按依赖顺序管理以下产物：

```text
metadata.yaml
    ├── proposal.md
    │       ├── design.md
    │       └── spec.md
    │               └── tasks.md
    │                       └── verification.md
    └── 状态、基线、Requirement、Task 和验证证据
```

- `metadata.yaml`：状态权威，记录 Change、模式、Baseline、模块、Requirement、Task、验证和归档门禁。
- `proposal.md`：说明为什么改、改哪些模块以及影响范围。
- `design.md`：说明实现方案、边界和技术决策。
- `spec.md`：记录 Requirement 和 Scenario。每个 Scenario 必须使用 `GIVEN`、`WHEN`、`THEN` 和 `ERROR`；`ERROR` 可以在分析阶段暂时为空，但必须由人工补写异常发生时的系统处理方式。
- `tasks.md`：只保留 `SP-##` 的简洁任务投影，不复制 Superpowers 的详细执行计划。
- `verification.md`：记录 Requirement、Scenario、测试、构建、lint、Baseline 和 fresh verification 证据。

## 一次正常开发如何运行

### 1. 进入唯一开发入口

运行 `workflow` 后，Core 先解析当前上下文：

- 读取 `openspec context --json` 和 `openspec status --change "<CHG-ID>" --json`。
- 创建或解析唯一的 `CHG-YYYYMMDD-NNN` Change。
- 解析模块并分配稳定的 Requirement ID，例如 `MOD-001-REQ-001`。
- 捕获 Baseline，检查是否存在 `STALE`、多个 Change 或未裁决冲突。

上下文缺失、Change 不明确或 Baseline 不安全时，流程停止并要求处理，不猜测目标 Change。

### 2. 分析需求：Superpowers brainstorming

`superpowers:brainstorming` 负责把用户的自然语言请求变成可审阅的目标：

1. 阅读相关代码、现有 Spec 和约束。
2. 澄清目标、范围、边界条件和不做什么。
3. 比较可行方案及其取舍。
4. 将确认后的方向交给 CodeSpec 产物和后续规划。

这一步解决“要做什么、为什么这样做”。它不负责分配 Requirement ID，也不负责修改 Current Specification。

### 3. 形成方案：Superpowers writing-plans

`superpowers:writing-plans` 把已确认的方向拆成可以逐项执行的计划：

- 指出要修改的文件、模块和关键接口。
- 按依赖关系排列实施步骤。
- 为每一步指定验证方式和预期结果。
- 将可追踪的实施项投影为 `tasks.md` 中的 `SP-##`。

CodeSpec 同时保存 `proposal.md`、`design.md` 和 `spec.md`。Superpowers 的详细计划不重复塞进 `tasks.md`。

### 4. 编写需求和异常场景

`spec.md` 是行为契约，不是实现笔记。每个 Requirement 至少应说明正常场景和必要的异常场景：

```markdown
#### Scenario: 查询失败
- **GIVEN** 用户详情服务不可用
- **WHEN** 管理员打开用户详情
- **THEN** 系统显示可理解的失败提示
- **ERROR** 系统记录错误上下文，保留当前页面状态，并允许用户重试
```

Core 负责校验 Requirement、Scenario、ID、Traceability 和 canonical Spec 结构。解析阶段缺少 `ERROR` 行会失败；显式空的 `ERROR` 只表示待补写，进入 VERIFY 或 archive 时仍会失败。Core 不从 `THEN` 或上下文推断异常处理，必须由人工补写。Superpowers 负责帮助判断场景是否覆盖真实使用和失败路径，并把异常处理落实为可验证的行为。

### 5. 实现：Superpowers TDD

`superpowers:test-driven-development` 按 `RED → GREEN → REFACTOR` 推进每个 `SP-##`：

1. **RED**：先写一个能表达 Requirement 或 Scenario 的失败测试。
2. **GREEN**：用最小实现使测试通过。
3. **REFACTOR**：在测试保护下整理结构，不改变已确认行为。

每个任务完成后刷新 `status`，并记录 Requirement、Scenario、Task 与测试的对应关系。代码实现遵循 `tasks.md` 和已确认的 Superpowers 计划，不自行扩展范围。

### 6. 遇到失败：Superpowers systematic-debugging

测试失败、构建失败或出现异常行为时，使用 `superpowers:systematic-debugging`，不要直接猜测修复：

1. 保留并复现失败。
2. 收集错误信息、调用路径和最小复现条件。
3. 缩小范围，区分代码缺陷、测试问题、环境问题和需求变化。
4. 修复根因并补充回归测试。
5. 重新执行受影响的验证命令。

如果失败意味着需求或设计发生变化，应回到 `brainstorming` 或 `writing-plans`，更新 Change 产物后再实现。

### 7. 完成前验证和审查

`superpowers:verification-before-completion` 要求使用新鲜证据确认结果：

- 重新运行必需的测试命令。
- 重新运行构建和 lint。
- 检查 Requirement 和 Scenario 覆盖。
- 确认没有把旧的测试输出当作当前结果。
- 将命令、退出码、摘要和时间写入 `verification.md`。

需要协作审查时，再使用 `superpowers:requesting-code-review`。需要结束开发分支时，使用 `superpowers:finishing-a-development-branch`。这些技能负责工程协作，不替代 Core 的状态和归档门禁。

## 按 Change 类型选择 Superpowers 方法

| Change 类型 | 方法顺序 | 重点 |
|---|---|---|
| `feature` | `brainstorming` → `writing-plans` → TDD | 先确认新行为和边界，再实现 |
| `bugfix` | `systematic-debugging` → Spec 影响判断 → TDD | 先定位根因，再决定是否需要更新需求 |
| `refactor` | 设计影响分析 → `writing-plans` → TDD | 保持行为不变，验证结构调整没有回归 |

Change 类型和门禁由 Core 读取和管理。Superpowers 只负责按类型采用合适的工程方法。

## Core 和 Superpowers 的边界

### OpenSpec Core 负责什么

- 创建、解析和选择 Change。
- 解析模块，分配 Requirement 和 Scenario 关联信息。
- 捕获 Baseline，检测 `STALE`，管理生命周期状态。
- 校验 Requirement Delta、Traceability 和 canonical Spec。
- 处理 Spec Delta、冲突检测和归档事务。
- 判断是否满足验证和归档门禁。

### Superpowers 负责什么

- 理解问题和澄清需求。
- 比较方案并编写实施计划。
- 用 TDD 驱动实现。
- 系统化定位测试和运行时失败。
- 进行 fresh verification、代码审查和分支收尾。

Superpowers 不实现 `createChange()`、`detectStale()`、`applyDelta()` 或 `archiveTransaction()`。这些是 Core 的内部能力，不是额外的公开 Skill。

## STALE 和冲突恢复

只有 Core 报告以下情况时才使用 `rebase`：

- Baseline 已漂移，状态为 `STALE`。
- 多个 Change 修改了同一范围，存在未裁决冲突。
- 继续工作前必须重建 Baseline。

`rebase` 会展示目标 Change、Baseline 和冲突集合。冲突不明确时停止并请求用户决定。成功后回到 `workflow`，重新注入上下文并继续 Superpowers 方法。

## 归档和人工确认

实现、验证和 Core 门禁全部通过后，才进入 `archive`：

1. Core 执行 `preflightArchive()`，检查任务、验证证据、Delta、Traceability、canonical Spec 和冲突。
2. Core 执行 `prepareArchive()`，准备 Delta 和可恢复写入集，并确认 Delta 与 Current Specification 的每个 Scenario 都有非空 `ERROR`。
3. 只有用户在交互式终端中明确确认后，Core 才执行 `commitArchive()` 和 `archiveTransaction()`。
4. 事务将 Delta 应用到 Current Specification，并把 Change 移入 `openspec/changes/archive/`。

归档规则：

- 不得由 AI 工作流自行调用归档完成动作。
- `--yes` 不能绕过首次人工确认，只能影响后续警告确认。
- `--json`、无 TTY 和其他自动化方式不能归档。
- 任一 Scenario 的 `ERROR` 缺失或为空时，必须人工补写，Verification 不得通过，也不得归档。
- 用户取消确认后，不写入 Current Specification，也不移动 Change。

只有归档事务可以写入 Current Specification。Superpowers 可以分析和验证结果，但不能直接提交 Current Specification。
