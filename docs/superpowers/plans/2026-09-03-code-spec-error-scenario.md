# code-spec Scenario ERROR 支持实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 canonical `code-spec` 的每个 Scenario 正式支持必需的 `ERROR` 行，并把异常处理信息从 Delta Spec 贯穿到 Current Specification、Verification、rebase 和归档门禁；允许空 `ERROR` 作为人工待补内容，但不允许它通过最终校验、Verification 或归档。

**Architecture:** `src/core/openspec-workflow/delta-parser.ts` 负责 Change Delta 的结构化 Scenario 解析；新增的 Current Specification parser 负责解析 `archive/specs/` 中的 canonical Requirement/Scenario。两套 parser 共享 `Scenario` 数据结构和 `GIVEN → WHEN → THEN → ERROR` 行规则，但不改变 `spec-driven` 的 `MarkdownParser` raw Scenario 行为。生命周期 Gate、Verification 和 archive transaction 都对解析结果执行非空 `ERROR` 门禁；归档前重新解析 Delta 与准备写入的 Current Specification，确保 Verification 之后被修改的内容不能绕过检查。

**Tech Stack:** Node.js 20、TypeScript、Zod、Vitest、pnpm、ESLint、YAML。

**Spec:** [docs/superpowers/specs/2026-09-03-code-spec-error-scenario-design.md](/Users/wanglinan/Documents/01_工作/02_AI/01_project/CodeSpec/CodeSpec/docs/superpowers/specs/2026-09-03-code-spec-error-scenario-design.md)

## Global Constraints

- 只修改 canonical `code-spec` 路径；不得把 `ERROR` 规则注入通用 `spec-driven` 的 `MarkdownParser`、`src/core/parsers/requirement-blocks.ts` 或其既有测试语义。
- 每个 Scenario 的 `ERROR` 行必须存在。`- **ERROR**` 解析为 `error: []`，仅允许继续编辑；缺少整行必须在解析阶段报错。
- `ADDED/New`、`MODIFIED/Previous`、`MODIFIED/New`、`REMOVED/Previous` 中的每个 Scenario 都执行同一规则；不能只检查当前变更的 New 分支。
- 不从 `THEN` 推断错误处理，不自动迁移历史文件，不生成默认错误文本，不提供兼容模式。
- `ERROR` 内容支持多行并保持出现顺序；渲染顺序固定为 `GIVEN`、`WHEN`、`THEN`、`ERROR`。
- 空 `ERROR` 必须由 `validate`、Verification PASS 门禁、archive preflight/prepare 门禁拒绝，并给出 Requirement ID、Scenario ID 和人工补写提示。
- Verification 证据继续只保存 Requirement ID 和 Scenario ID，不复制 `ERROR` 文本；receipt、baseline、状态和归档交互确认语义保持不变。
- 保留既有“归档必须由交互式人工确认”的行为；本计划不添加自动归档或静默确认。
- 只更新 canonical fixture；通用 `spec-driven` fixture 保持原样。`package/` 等已有无关未跟踪目录不纳入本次变更。
- 每个任务完成后先运行该任务列出的定向测试，再继续下一任务；最终必须运行 build、lint、定向回归和完整测试，并以实际输出为准报告结果。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `src/core/openspec-workflow/types.ts` | canonical `Scenario.error` 类型字段。 |
| `src/core/openspec-workflow/schemas.ts` | canonical Scenario Zod 结构校验。 |
| `src/core/openspec-workflow/delta-parser.ts` | Delta 的 `ERROR` 识别、空值表示、缺失报错和重渲染。 |
| `src/core/openspec-workflow/current-spec-parser.ts` | Current Specification 的 Requirement/Scenario 解析与 `ERROR` 规则校验。 |
| `src/core/openspec-workflow/gates.ts` | 生命周期出口门禁中的 Delta `ERROR` 完整性检查。 |
| `src/core/openspec-workflow/verification.ts` | 生成 PASS 证据前的非空 `ERROR` 检查。 |
| `src/core/openspec-workflow/archive-transaction.ts` | 归档 preflight/prepare 对 Delta 和写入后 Current Specification 的独立检查。 |
| `src/core/openspec-workflow/rebase.ts` | rebase 重渲染中保留 `ERROR`。 |
| `src/commands/validate.ts` | canonical Current Specification 校验命令路径。 |
| `src/core/templates/workflows/verify-change.ts`、`src/core/templates/workflows/openspec-workflow.ts` | Superpowers 工作流提示中对 `ERROR` 的职责、空值和最终门禁说明。 |
| `schemas/code-spec/templates/spec.md`、`schemas/code-spec/templates/verification.md`、`schemas/code-spec/schema.yaml` | canonical 工件模板和协议说明。 |
| `docs/workflows.md`、`docs/writing-specs.md`、`docs/concepts.md`、`docs/overview.md` | 用户文档中的 Scenario `ERROR` 规则和门禁说明。 |
| `test/core/openspec-workflow/delta-parser.test.ts` | Delta parser 的非空、空值、缺失、分支和重渲染测试。 |
| `test/core/openspec-workflow/current-spec-parser.test.ts` | Current Specification 解析、缺失/空值/多行 ERROR 测试。 |
| `test/core/openspec-workflow/state-machine.test.ts`、`test/core/validation.test.ts` | `validate`/状态转换对空 ERROR 的拒绝测试。 |
| `test/core/openspec-workflow/verification.test.ts` | Verification PASS 对空 ERROR 的拒绝及证据不重复文本测试。 |
| `test/core/openspec-workflow/archive-transaction.test.ts` | preflight、prepare、事务失败保护和归档后 Current Specification 保留 ERROR 测试。 |
| `test/core/openspec-workflow/stale-rebase.test.ts`、`state-machine.test.ts`、`templates.test.ts`、`traceability.test.ts` | canonical fixture、rebase、生命周期和模板回归。 |
| `test/commands/validate.test.ts`、`test/schemas/code-spec-template.test.ts` | CLI 校验输出和模板协议回归。 |

### Task 1: 扩展 canonical Scenario 数据结构并让 Delta parser 正确解析 ERROR

**Files:**

- Modify: `src/core/openspec-workflow/types.ts`
- Modify: `src/core/openspec-workflow/schemas.ts`
- Modify: `src/core/openspec-workflow/delta-parser.ts`
- Modify: `test/core/openspec-workflow/delta-parser.test.ts`

**Interfaces:**

- `Scenario` 保留 `id`、`name`、`given`、`when`、`then`，新增 `error: string[]`。
- `scenarioSchema` 保留非空的 GIVEN/WHEN/THEN 数组，新增 `error: z.array(nonEmptyString)`；空数组合法，因为它表示 ERROR 行存在但内容尚未填写。
- `parseDeltaSpec(content)` 的 `RequirementDelta.scenarios` 每项都返回 `error` 数组。
- Delta parser 的诊断必须区分 `Scenario <SCN-ID> 缺少 ERROR 行` 和 `Scenario <SCN-ID> 的 ERROR 为空，请人工补写异常处理`；只有前者在 parser 阶段抛出，后者保留为 `error: []` 并由后续门禁处理。

- [ ] **Step 1: 先补充会失败的 parser 和数据结构测试。**

把现有 `scenario()` fixture 改为同时生成 `ERROR`，并加入以下断言：非空 ERROR 进入 `error`；`- **ERROR**` 返回 `error: []`；ERROR 出现多次按出现顺序返回；缺少 ERROR 抛出包含 Requirement ID/Scenario ID 的错误；ADDED、MODIFIED Previous/New、REMOVED Previous 各自缺失 ERROR 都失败；解析后的 `next`/`previous` 文本重新渲染出 `- **ERROR**`。

测试至少覆盖如下输入形态：

```ts
const nonEmpty = `- **ERROR** 服务不可用时记录错误并允许重试`;
const empty = `- **ERROR**`;
expect(parsed.entries[0].scenarios[0].error).toEqual([]);
expect(() => parseDeltaSpec(inputWithoutError)).toThrow(/MOD-002-REQ-006.*SCN-002.*ERROR/i);
```

- [ ] **Step 2: 运行 parser 定向测试确认 RED。**

```bash
pnpm vitest run test/core/openspec-workflow/delta-parser.test.ts
```

预期：新增断言失败，现实现会把 ERROR 判定为 `Unconsumed content`，且 `Scenario` 对象没有 `error` 字段。

- [ ] **Step 3: 实现 Scenario.error 和严格的 Delta 行解析。**

在 `delta-parser.ts` 中把 Scenario body token 识别扩展为 `GIVEN|WHEN|THEN|ERROR`，允许 `ERROR` token 后没有正文；用独立的 `hasErrorLine` 标记区分“行不存在”和“行存在但正文为空”。读取时只收集非空 ERROR 正文，保持现有 GIVEN/WHEN/THEN 的非空要求。对每个 Scenario 在返回前检查 `hasErrorLine`，缺失时抛出带 Requirement ID、Scenario ID 的明确错误。

在渲染函数中把所有 `item.error` 行追加在 THEN 之后；对空数组仍输出一行 `- **ERROR**`，确保 parse → render 不丢失“行存在但为空”的状态。同步让 `parseRequirement()` 的 ADDED/New、MODIFIED 两个分支和 REMOVED/Previous 使用同一个 Scenario 解析函数。

- [ ] **Step 4: 运行 parser、类型和 lint 检查。**

```bash
pnpm vitest run test/core/openspec-workflow/delta-parser.test.ts
pnpm exec tsc --noEmit
pnpm lint
```

预期：parser 测试、类型检查和 lint 均退出 0；现有 GWT fixture 若未带 ERROR，必须在本任务或 Task 6 的 canonical fixture 清理中统一补齐，不能通过放宽 parser 规则解决。

### Task 2: 增加 Current Specification parser，并把 ERROR 纳入 canonical 校验

**Files:**

- Create: `src/core/openspec-workflow/current-spec-parser.ts`
- Modify: `src/core/openspec-workflow/archive-transaction.ts`
- Modify: `src/commands/validate.ts`
- Modify: `test/core/openspec-workflow/current-spec-parser.test.ts`
- Modify: `test/core/openspec-workflow/archive-transaction.test.ts`
- Modify: `test/commands/validate.test.ts`

**Interfaces:**

- 新增 `parseCurrentSpec(content: string): ParsedCurrentSpec`，扫描 canonical `### MOD-###-REQ-###` Requirement block 和其中的非 fenced `#### Scenario:` block，返回 Requirement ID、原始 block 和 `Scenario[]`。
- 新增 `validateCurrentSpec(content: string, moduleId?: string): string[]`，校验 Requirement ID、Scenario 的 GIVEN/WHEN/THEN、ERROR 行存在；空 ERROR 返回带路径/ID 的错误字符串。
- Current Specification parser 使用与 Delta parser 相同的 Scenario token 规则和 `Scenario.error` 结构；不得修改通用 `MarkdownParser` 的 `{ rawText: string }` Scenario 类型。
- `prepareArchive()` 只能返回经过 Current Specification 校验的 prepared specs；`validate` 对 canonical `archive/specs` 走该 parser，对 `spec-driven` 继续走原 Validator。

- [ ] **Step 1: 写 Current Specification parser 的 RED 测试。**

新增测试覆盖：完整 Current Specification 返回 `error`；空 ERROR 返回 `error: []` 但 `validateCurrentSpec` 返回错误；缺少 ERROR 报格式错误；ERROR 多行保序；fenced 示例中的 `#### Scenario`/`ERROR` 不被误识别；跨模块 Requirement 仍由 archive 的 module 检查处理。

使用 canonical 当前规格形态，例如：

```md
### MOD-002-REQ-006 用户详情
系统 MUST 展示用户详情。
#### Scenario: SCN-001 查询失败
- **GIVEN** 用户详情服务不可用
- **WHEN** 管理员打开详情
- **THEN** 系统显示失败提示
- **ERROR** 系统记录错误上下文
```

- [ ] **Step 2: 运行新 parser 测试确认 RED。**

```bash
pnpm vitest run test/core/openspec-workflow/current-spec-parser.test.ts
```

预期：模块尚不存在，测试失败。

- [ ] **Step 3: 实现 fence-aware Current Specification parser 和校验。**

按 canonical Requirement ID 划分 block，按非 fenced `####` header 划分 Scenario。Scenario body 只接受 GIVEN/WHEN/THEN/ERROR token，记录 `hasErrorLine`；缺少行报格式错误，空行保留为空并由 `validateCurrentSpec` 生成最终错误。错误文本固定包含 `Requirement <REQ-ID>`、`Scenario <SCN-ID>`、`ERROR` 和“请人工补写”提示，避免把空值解释为无异常。

- [ ] **Step 4: 接入 canonical Spec 校验和 archive prepared output 校验。**

在 `validate.ts` 的 canonical workspace 分支中，枚举 `workspace.paths.currentSpecs` 下的 spec 文件并调用 `validateCurrentSpec`；`openspec validate --specs`、`--all` 和直接 Spec 校验都要报告缺失/空 ERROR。保留 spec-driven 的 `Validator.validateSpec()` 路径。

在 `archive-transaction.ts` 的 `preflightArchive()` 中对参与事务的现有 Current Specification 先运行格式检查；在 `prepareArchive()` 应用所有 Delta 后，对每个准备写入的完整 Current Specification 再运行 `validateCurrentSpec`，使未被本次 Change 修改的历史 Scenario 也不能继续带缺失 ERROR 的 Current Specification。

- [ ] **Step 5: 运行 Current Spec、archive 和 CLI 定向测试。**

```bash
pnpm vitest run \
  test/core/openspec-workflow/current-spec-parser.test.ts \
  test/core/openspec-workflow/archive-transaction.test.ts \
  test/commands/validate.test.ts
pnpm exec tsc --noEmit
```

预期：非空 ERROR 的 Current Specification 可以通过；缺少或空 ERROR 在 `validate` 和 archive prepare 阶段失败，且失败前不写入 Current Specification。

### Task 3: 将 ERROR 接入生命周期 Gate、canonical validate、Verification 和 archive gate

**Files:**

- Modify: `src/core/openspec-workflow/gates.ts`
- Modify: `src/core/validation/validator.ts`
- Modify: `src/core/openspec-workflow/verification.ts`
- Modify: `src/core/openspec-workflow/archive-transaction.ts`
- Modify: `test/core/openspec-workflow/verification.test.ts`
- Modify: `test/core/openspec-workflow/archive-transaction.test.ts`
- Modify: lifecycle/validation tests covering `validateExitGate` and `validateCanonicalDelta`

**Interfaces:**

- 增加可复用的 canonical Scenario ERROR 完整性检查结果，至少区分 `missing` 和 `empty`，供 Gate、Verification、archive 使用；错误消息包含 Change、Requirement ID、Scenario ID。
- `validateCanonicalDelta()` 解析成功后仍检查 ADDED/MODIFIED Scenario 数量，并新增所有分支的非空 ERROR 失败项。
- `recordFreshVerification()` 在创建 PASS 证据前检查所有解析 Scenario 的 `error.length > 0`；失败时不发布 PASS metadata/evidence。
- `ensureArchiveGates()` 重新解析 artifacts.spec 并检查非空 ERROR；不能只相信 `metadata.verification` 或旧 verification receipt。
- `validateChangeTraceability()` 继续只建立 Scenario ID 链路，不把 ERROR 文本加入 traceability 或 evidence。

- [ ] **Step 1: 写 Gate/Verification/archive 的失败测试。**

在现有 canonical fixture 中分别构造：缺少 ERROR（应在 parser 失败）、空 ERROR（parser 成功但 Gate/Verification/archive 失败）、所有 ERROR 非空（流程通过）。断言空 ERROR 的失败消息至少匹配 `MOD-002-REQ-006`、`SCN-002`、`ERROR` 和人工补写提示。

对 Verification 还要断言：失败不会发布 `status: PASS`，不会把 `metadata.verification.verified_at` 置为新的成功时间，不会把 ERROR 文本写入 `scenario_ids` 或 Markdown evidence 表。

- [ ] **Step 2: 运行定向测试确认 RED。**

```bash
pnpm vitest run \
  test/core/openspec-workflow/verification.test.ts \
  test/core/openspec-workflow/archive-transaction.test.ts \
  test/core/openspec-workflow/state-machine.test.ts \
  test/core/validation.test.ts
```

预期：当前实现会接受空 ERROR，新增断言失败。

- [ ] **Step 3: 实现 canonical Delta ERROR Gate。**

让 `gates.ts` 在 VERIFY/ARCHIVE 出口或其共享的 Delta 检查入口解析 `artifacts.spec`，逐项检查 `entry.scenarios`。缺失 ERROR 由 parser 错误直接转为 Gate error；空 ERROR 生成明确的 Requirement/Scenario 补写错误。`Validator.validateCanonicalDelta()` 复用同一规则，确保直接校验与生命周期状态校验不会出现一边通过、一边失败的差异。

- [ ] **Step 4: 实现 Verification PASS 和 archive 独立复核。**

在 `recordFreshVerification()` 解析 Delta 后、执行并发布证据前检查每个 Scenario 的 `error`；若为空，直接抛出失败，不运行会产生可满足归档的 PASS 发布路径。保留已有命令执行和 FAIL 证据行为。

在 `ensureArchiveGates()` 中先解析并检查 Delta，再校验 evidence 覆盖；在 `prepareArchive()` 依赖 Task 2 的 Current Specification 校验。将错误与现有状态、baseline、receipt、traceability 门禁合并，保证 Delta 在 Verification 后被改为空 ERROR 时 archive 仍失败。

- [ ] **Step 5: 运行定向测试并检查事务快照。**

```bash
pnpm vitest run \
  test/core/openspec-workflow/verification.test.ts \
  test/core/openspec-workflow/archive-transaction.test.ts \
  test/core/openspec-workflow/state-machine.test.ts \
  test/core/validation.test.ts
pnpm exec tsc --noEmit
```

预期：非空 ERROR 的 Change 可生成 PASS 并进入 archive preflight；空/缺失 ERROR 不能生成可归档证据；归档失败时 metadata、verification、Current Specification 和 Change 目录保持原状。

### Task 4: 保证 rebase、Delta 重渲染和归档结果完整保留 ERROR

**Files:**

- Modify: `src/core/openspec-workflow/rebase.ts`
- Modify: `src/core/openspec-workflow/archive-transaction.ts`
- Modify: `src/core/openspec-workflow/delta-parser.ts`
- Modify: `test/core/openspec-workflow/stale-rebase.test.ts`
- Modify: `test/core/openspec-workflow/archive-transaction.test.ts`
- Modify: `test/core/openspec-workflow/traceability.test.ts`

**Interfaces:**

- rebase 重新生成 `Previous`/`New` 时保留每个 Scenario 的 `ERROR` 行和多行顺序；不得因为只复制 GWT 而丢失异常处理。
- archive 的 `applyDelta()` 继续以已解析并校验的 raw block 写入，但 prepared Current Specification 必须能被 `parseCurrentSpec()` 完整读回。
- traceability 只验证 ID 集合，`ERROR` 内容不改变 Scenario-to-Task 的边关系。

- [ ] **Step 1: 增加 round-trip 和归档保留测试。**

在 stale rebase fixture 中加入非空、多行 ERROR，断言 rebase 后的 `spec.md` 同时保留 `- **ERROR** first`、`- **ERROR** second`。在 archive transaction 测试中断言归档完成后的 `archive/specs/<module>/spec.md` 包含原始 ERROR 行，并用 `parseCurrentSpec()` 读回相同 `error` 数组。

- [ ] **Step 2: 检查所有 canonical renderer 并补齐 ERROR。**

运行：

```bash
rg -n "given|when|then|Scenario|GIVEN|WHEN|THEN" src/core/openspec-workflow src/core/templates
```

对结果逐一确认：凡是构造 canonical `Scenario` 或输出 canonical `spec.md` 的路径都输出 ERROR；只处理 canonical workflow renderer，不修改 generic `spec-driven` 文档示例和 raw parser。

- [ ] **Step 3: 实现 rebase/render 保留并运行回归。**

让 rebase 的 Scenario 渲染统一使用 `GIVEN → WHEN → THEN → ERROR`；若输入是空 ERROR，保留空行供人工编辑，但后续 Gate 仍拒绝。确保 parse → render → parse 后 `id/name/given/when/then/error` 一致。

```bash
pnpm vitest run \
  test/core/openspec-workflow/stale-rebase.test.ts \
  test/core/openspec-workflow/archive-transaction.test.ts \
  test/core/openspec-workflow/traceability.test.ts
```

### Task 5: 更新 Superpowers 工作流提示、schema/template 和用户文档

**Files:**

- Modify: `src/core/templates/workflows/openspec-workflow.ts`
- Modify: `src/core/templates/workflows/verify-change.ts`
- Modify: `schemas/code-spec/schema.yaml`
- Modify: `schemas/code-spec/templates/spec.md`
- Modify: `schemas/code-spec/templates/verification.md`
- Modify: `docs/workflows.md`
- Modify: `docs/writing-specs.md`
- Modify: `docs/concepts.md`
- Modify: `docs/overview.md`
- Modify: `test/core/openspec-workflow/templates.test.ts`
- Modify: `test/schemas/code-spec-template.test.ts`
- Modify: `test/core/openspec-workflow/templates.test.ts`

**Interfaces:**

- canonical spec template 的每个 Scenario 都明确包含 `- **ERROR**`，并说明它可暂时为空但必须由人工补写。
- `openspec-workflow` 的 Superpowers 路由说明 `brainstorming`、`writing-plans`、TDD、systematic debugging、verification、code review 的职责，同时明确：Superpowers 负责工程方法，OpenSpec Core 负责 Scenario ERROR 结构校验、Verification 和 archive 门禁。
- `verify-change` 的 Scenario Coverage 检查包含 ERROR 完整性；Verification 表仍只列 Scenario ID，不重复 ERROR 文本。
- 文档明确缺失 ERROR 是格式错误，空 ERROR 是待补内容但不能 validate/Verification/archive；并保留 archive 需要交互式人工确认的规则。

- [ ] **Step 1: 先补模板和文档测试断言。**

扩展模板测试，断言 code-spec spec 模板的 ADDED/New、MODIFIED/Previous/New、REMOVED/Previous 示例都含 ERROR；断言 workflow/verify 文本同时提到 `ERROR`、人工补写、Verification/archive 门禁和 Superpowers 方法路由；断言 verification 模板不出现 ERROR 文本表格字段。

- [ ] **Step 2: 更新 canonical 模板与 Superpowers 拆解说明。**

在 `spec.md` 中将每个示例的 ERROR 行写成协议 token，并在注释/说明中写明“如果暂时分析不出异常处理，可保留空 `- **ERROR**`，但提交前必须由人工补写”。在 workflow 模板中拆解：Core 解析/分配 ID/校验/门禁/事务，Superpowers brainstorming/writing-plans/TDD/systematic-debugging/verification/code-review 各自负责什么，且不得让 Superpowers 直接写 Current Specification。

- [ ] **Step 3: 更新文档并运行模板回归。**

```bash
pnpm vitest run \
  test/core/openspec-workflow/templates.test.ts \
  test/schemas/code-spec-template.test.ts \
  test/core/templates/archive-change.test.ts
```

### Task 6: 清理 canonical fixture、执行完整验证并审查变更边界

**Files:**

- Modify only canonical fixtures in `test/core/openspec-workflow/{archive-transaction,delta-parser,stale-rebase,state-machine,traceability,verification,templates}.test.ts` and `test/helpers/openspec-workflow.ts`.
- Modify canonical CLI assertions in `test/cli-e2e/openspec-workflow-journeys.test.ts` and `test/cli-e2e/basic.test.ts` only when their fixture is canonical.
- Do not modify `test/core/parsers/markdown-parser.test.ts`, generic `test/core/parsers/requirement-blocks.test.ts`, or other `spec-driven` fixtures merely to add ERROR.

- [ ] **Step 1: 用搜索找出遗漏的 canonical GWT fixture。**

```bash
rg -n --glob '*.ts' --glob '*.md' \
  '#### Scenario|\*\*GIVEN\*\*|\*\*WHEN\*\*|\*\*THEN\*\*' \
  src test schemas docs
```

逐个判断 schema 归属。所有 canonical `openspec-workflow` fixture 必须加入 ERROR；generic `spec-driven` fixture 不添加，以证明边界未被破坏。

- [ ] **Step 2: 运行定向完整回归。**

```bash
pnpm vitest run \
  test/core/openspec-workflow \
  test/core/validation.test.ts \
  test/core/validation.scenario-loss.test.ts \
  test/commands/validate.test.ts \
  test/cli-e2e/openspec-workflow-journeys.test.ts \
  test/schemas/code-spec-template.test.ts
pnpm build
pnpm lint
git diff --check
```

预期：canonical ERROR 全链路测试通过，spec-driven 原有测试保持通过，build/lint/diff check 均退出 0。

- [ ] **Step 3: 运行全量测试并分类已有基线失败。**

```bash
VITEST_MAX_WORKERS=1 pnpm test
```

将失败分为本次 ERROR 回归、既有 archive-confirmation 修改回归、或明确无关基线失败；只有本次变更引入的失败才修复。不得通过放宽 ERROR 门禁或修改无关的 `package/`、旧 Schema 代码来消除失败。

- [ ] **Step 4: 做最终 diff 和协议审查。**

```bash
git status --short
git diff --stat
git diff -- src/core/openspec-workflow src/core/validation src/commands/validate.ts schemas/code-spec docs test/core/openspec-workflow test/schemas
```

确认：`Scenario.error` 在所有 canonical 构造路径存在；缺 ERROR 与空 ERROR 行为不同；Current Specification 读回保留 ERROR；Verification 不复制 ERROR 文本；archive 仍必须交互式人工确认；没有自动迁移、THEN 推断或 silent archive。
