# CodeSpec Requirement Clarification Closed-Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 canonical `code-spec` 增加可审批、可追踪、可回退的需求澄清闭环，并把活动 `spec.md` 与归档统一为 Requirement 级增量语义，彻底消除同一业务需求后续变更携带整份旧 Spec 的问题。

**Architecture:** 新增 `analysis.yaml` 作为用户意图唯一权威，增加 `analyze` 审批并把状态门禁改为内容计算；用同一套 rich Requirement AST 支撑 Current 精确读取、delta 校验、baseline、rebase 与 archive。canonical archive 不再把活动 `spec.md` 当成完整模块发布，而是只合并显式 `ADDED`、`MODIFIED`、`REMOVED` Requirement 和工程文件增量。`metadata.yaml` 中的模块与 Requirement 列表仅作为派生查询投影。

**Tech Stack:** TypeScript 6、Node.js 20、Commander、Zod、YAML、markdown-it、Vitest、现有事务日志与模板生成器。

**Design:** `docs/superpowers/specs/2026-09-15-codespec-requirement-clarification-closed-loop-design.md`

## Invariants

- `analysis.yaml` 是问题、目标、非目标、范围、约束、假设、待决问题和验收标准的唯一权威。
- `codespec/specs/<module>/spec.md` 是完整当前事实；活动 `spec.md` 只保存本次受影响 Requirement 的行为增量。
- `MODIFIED.Previous` 与 `REMOVED.Previous` 必须语义等于 Current 中同 ID Requirement 的完整快照。
- `MODIFIED.New` 必须是同 ID Requirement 的完整目标状态，仍有效的 Scenario 必须保留。
- `ADDED` 不得已存在；`MODIFIED`/`REMOVED` 必须已存在；无实际变化的 `MODIFIED` 被拒绝。
- 未出现在 delta 中的 Requirement 不得被 archive 改写；archive history 不得成为新 Change 的行为基线。
- 新 Change 使用六件套；历史归档保持只读，五件套活动 Change 必须显式迁移后才能继续。
- 用户审批保持三阶段：`analyze`、`design`、`plan`。不新增第四个公开 Skill，继续使用 `codespec-workflow`、`codespec-rebase-change`、`codespec-archive-change`。
- 所有语义变更先写失败测试；每个任务通过聚焦测试后再提交。

## Delivery Order

```text
analysis contract
  -> six-artifact loading/scaffolding
  -> computed ANALYZE gate + approval
  -> semantic revision
  -> rich Requirement delta + exact Current read
  -> Requirement-level archive merge
  -> acceptance traceability
  -> rebase routing
  -> active-change migration
  -> CLI/Skills/docs/E2E
```

---

### Task 1: 建立 `analysis.yaml` 领域模型与稳定语义投影

**Files:**

- Create: `src/core/codespec-workflow/analysis.ts`
- Test: `test/core/codespec-workflow/analysis.test.ts`

**Produces:**

```ts
export type AnalysisDocument = z.infer<typeof analysisDocumentSchema>;
export type AnalysisCompletenessResult = { ok: boolean; errors: string[] };

export function parseAnalysisDocument(value: unknown): AnalysisDocument;
export function renderInitialAnalysis(input: {
  changeId: string;
  revision: number;
  problem: string;
}): string;
export function projectAnalysisForApproval(document: AnalysisDocument): unknown;
export function validateAnalysisCompleteness(
  document: AnalysisDocument,
): AnalysisCompletenessResult;
```

`analysisDocumentSchema` 严格实现设计稿字段。为支持确定性 rebase，`assumptions[]` 增加可选 `requirements: RequirementId[]`，未声明时解析为空数组。

- [ ] **Step 1: 写 schema 与初始模板失败测试**

覆盖合法完整文档、未知字段、重复 Goal/AC/Requirement ID、change/revision 必填，以及初始模板可以被自己的 parser 读取。

```ts
it('renders a parseable draft analysis document', () => {
  const text = renderInitialAnalysis({
    changeId: 'CHG-20260915-001',
    revision: 1,
    problem: '在用户列表中显示详情',
  });
  expect(parseAnalysisDocument(parseYaml(text))).toMatchObject({
    change: 'CHG-20260915-001',
    revision: 1,
  });
});
```

- [ ] **Step 2: 写完整性失败测试**

分别断言空 goals、空 nonGoals、缺 scope.in/out、PROPOSED assumption、OPEN question、空 acceptance criteria、MUST AC 未映射 Requirement、未确认模块、无 affected Requirement 均返回含字段路径的错误。REJECTED assumption 与 RESOLVED question 不阻塞。

Run: `pnpm exec vitest run test/core/codespec-workflow/analysis.test.ts`

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现严格 Zod schema、模板和确定性投影**

审批投影排序集合型字段并忽略 YAML 排版差异，但保留用户语义、状态、Requirement action、AC priority 与引用。workspace 存在性留给 Task 3。

- [ ] **Step 4: 运行测试**

Run: `pnpm exec vitest run test/core/codespec-workflow/analysis.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/core/codespec-workflow/analysis.ts test/core/codespec-workflow/analysis.test.ts
git commit -m "feat: add requirement analysis contract"
```

---

### Task 2: 把 canonical Change 扩展为六件套并兼容历史读取

**Files:**

- Modify: `src/core/codespec-workflow/types.ts`
- Modify: `src/core/codespec-workflow/schemas.ts`
- Modify: `src/core/codespec-workflow/current-change-layout.ts`
- Modify: `src/core/codespec-workflow/artifacts.ts`
- Modify: `src/core/codespec-workflow/change-manager.ts`
- Modify: `test/core/codespec-workflow/contracts.test.ts`
- Modify: `test/core/codespec-workflow/change-manager.test.ts`
- Modify: `test/core/codespec-workflow/loaders.test.ts`

**Contract:**

```ts
export interface CurrentChangeArtifactPaths {
  analysis: string;
  metadata: string;
  design: string;
  spec: string;
  tasks: string;
  verification: string;
}

export interface ChangeArtifacts {
  // existing fields
  analysis: string | null;
}
```

`ChangeMetadata.artifacts.analysis?: string` 只为读取历史五件套 optional；新建 canonical Change 必须声明 `analysis: analysis.yaml`。

- [ ] **Step 1: 写六件套创建失败测试**

断言 `createChange()` 原子创建恰好六个声明文件，analysis 的 change/revision/problem 正确；重复创建和中途失败不留半成品。

- [ ] **Step 2: 写兼容读取失败测试**

新六件套返回非空 analysis；活动五件套返回 null 供迁移门禁；历史 archive 五件套可读且不改写。metadata 已声明 analysis 但文件缺失必须报错，不能降级为 null。

Run: `pnpm exec vitest run test/core/codespec-workflow/contracts.test.ts test/core/codespec-workflow/change-manager.test.ts test/core/codespec-workflow/loaders.test.ts`

Expected: FAIL。

- [ ] **Step 3: 修改 schema、layout、loader 和创建事务**

schema transform 不为历史 metadata 伪造路径。`change-manager.ts` 用用户标题/摘要生成 draft problem，调用 Task 1 模板；rollback 列表加入 analysis。

- [ ] **Step 4: 运行测试与类型检查**

Run: `pnpm exec vitest run test/core/codespec-workflow/contracts.test.ts test/core/codespec-workflow/change-manager.test.ts test/core/codespec-workflow/loaders.test.ts && pnpm typecheck`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/core/codespec-workflow/types.ts src/core/codespec-workflow/schemas.ts src/core/codespec-workflow/current-change-layout.ts src/core/codespec-workflow/artifacts.ts src/core/codespec-workflow/change-manager.ts test/core/codespec-workflow/contracts.test.ts test/core/codespec-workflow/change-manager.test.ts test/core/codespec-workflow/loaders.test.ts
git commit -m "feat: scaffold six-artifact changes"
```

---

### Task 3: 用内容计算替代可变 ANALYZE gate，并校验派生投影

**Files:**

- Create: `src/core/codespec-workflow/analysis-consistency.ts`
- Modify: `src/core/codespec-workflow/gates.ts`
- Test: `test/core/codespec-workflow/analysis-consistency.test.ts`
- Modify: `test/core/codespec-workflow/state-machine.test.ts`

**Produces:**

```ts
export type AnalysisProjection = {
  modules: ChangeMetadata['modules'];
  requirements: ChangeMetadata['requirements'];
};

export function projectAnalysisMetadata(document: AnalysisDocument): AnalysisProjection;
export async function validateAnalysisAgainstWorkspace(
  workspace: WorkspaceContext,
  artifacts: ChangeArtifacts,
): Promise<string[]>;
```

- [ ] **Step 1: 写 workspace 一致性失败测试**

覆盖 ADDED 已存在、MODIFIED/REMOVED 不存在、Requirement 不属于 OWNED module、module 未注册、metadata projection 不一致、analysis change/revision 不一致、活动五件套需迁移。

- [ ] **Step 2: 写 computed gate 失败测试**

`metadata.gates.analyze.satisfied=true` 不得绕过空 scope 或 OPEN question；完整 analysis 不再由旧 boolean 决定。gate 字段只作展示快照。

Run: `pnpm exec vitest run test/core/codespec-workflow/analysis-consistency.test.ts test/core/codespec-workflow/state-machine.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现投影、Current 存在性校验和 ANALYZE gate**

Requirement 只从 `workspace.paths.currentSpecs/<module>/spec.md` 读取，禁止搜索 archive。验证顺序：artifact → schema → completeness → revision identity → workspace ownership/existence → metadata projection equality。

- [ ] **Step 4: 运行测试**

Run: `pnpm exec vitest run test/core/codespec-workflow/analysis-consistency.test.ts test/core/codespec-workflow/state-machine.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/core/codespec-workflow/analysis-consistency.ts src/core/codespec-workflow/gates.ts test/core/codespec-workflow/analysis-consistency.test.ts test/core/codespec-workflow/state-machine.test.ts
git commit -m "feat: compute analyze gate from approved intent"
```

---

### Task 4: 增加 analyze 审批并锁定三段状态迁移

**Files:**

- Modify: `src/core/codespec-workflow/types.ts`
- Modify: `src/core/codespec-workflow/schemas.ts`
- Modify: `src/core/codespec-workflow/approvals.ts`
- Modify: `src/core/codespec-workflow/state-machine.ts`
- Modify: `src/cli/index.ts`
- Modify: `test/core/codespec-workflow/approvals.test.ts`
- Modify: `test/core/codespec-workflow/state-machine.test.ts`
- Modify: `test/commands/artifact-workflow.test.ts`

**API:**

```ts
export type ApprovalStage = 'analyze' | 'design' | 'plan';
export function approvalContentHash(
  stage: ApprovalStage,
  artifacts: ChangeArtifacts,
): string;
```

Approval payload：analyze = semantic analysis；design = approved analysis + design + rich delta；plan = design payload + immutable task definitions。目标映射：DESIGN→analyze、PLAN→design、IMPLEMENT→plan。

- [ ] **Step 1: 写三审批默认状态与旧 metadata transform 测试**

新 metadata 三项 pending。读取旧两审批 metadata 时只在内存补 pending analyze；持久化升级留给 Task 10。

- [ ] **Step 2: 写 hash 与 invalidation 失败测试**

YAML 排版不改 hash；analysis 语义变更使三项失效；design/spec 改变使 design/plan 失效；task status 不影响 plan；task definition 改变使 plan 失效。

- [ ] **Step 3: 写 CLI/transition 失败测试**

`approve --stage analyze` 只在 ANALYZE 且完整性通过时成功；无审批或 stale hash 的 ANALYZE→DESIGN 失败；未知 stage 被拒绝。

Run: `pnpm exec vitest run test/core/codespec-workflow/approvals.test.ts test/core/codespec-workflow/state-machine.test.ts test/commands/artifact-workflow.test.ts`

Expected: FAIL。

- [ ] **Step 4: 实现 receipt、公开 semantic hash 与 target mapping**

receipt 绑定 revision、approved_at、hash；审批前调用对应 gate。`metadata.gates.*.satisfied` 不能代替 receipt。

- [ ] **Step 5: 更新 CLI 并运行测试**

```bash
codespec approve --change CHG-... --stage analyze
codespec approve --change CHG-... --stage design
codespec approve --change CHG-... --stage plan
```

Run: `pnpm exec vitest run test/core/codespec-workflow/approvals.test.ts test/core/codespec-workflow/state-machine.test.ts test/commands/artifact-workflow.test.ts && pnpm typecheck`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/core/codespec-workflow/types.ts src/core/codespec-workflow/schemas.ts src/core/codespec-workflow/approvals.ts src/core/codespec-workflow/state-machine.ts src/cli/index.ts test/core/codespec-workflow/approvals.test.ts test/core/codespec-workflow/state-machine.test.ts test/commands/artifact-workflow.test.ts
git commit -m "feat: add analyze approval gate"
```

---

### Task 5: 实现语义 revision 事务和确定性回退矩阵

**Files:**

- Create: `src/core/codespec-workflow/revision.ts`
- Modify: `src/core/codespec-workflow/approvals.ts`
- Modify: `src/core/codespec-workflow/state-machine.ts`
- Modify: `src/core/codespec-workflow/current-change-yaml.ts`
- Modify: `src/cli/index.ts`
- Test: `test/core/codespec-workflow/revision.test.ts`
- Modify: `test/commands/artifact-workflow.test.ts`

**Produces:**

```ts
export type RevisionRoute = 'ANALYZE' | 'DESIGN' | 'PLAN';
export type RevisionResult = {
  changeId: string;
  previousRevision: number;
  revision: number;
  route: RevisionRoute;
  invalidatedApprovals: ApprovalStage[];
};

export async function reviseChange(
  workspace: WorkspaceContext,
  changeId: string,
  reason: string,
): Promise<RevisionResult>;
```

- [ ] **Step 1: 写 authority 分类失败测试**

analysis changed→ANALYZE；design/spec changed→DESIGN；task definition changed→PLAN；只有 task status、verification evidence、locator 变化不创建 semantic revision，并返回 no-op 错误。

- [ ] **Step 2: 写原子 invalidation 失败测试**

revision N→N+1 同时更新 metadata、analysis revision、tasks changeRevision、index；按路由 revoke 审批；清空 verification receipt/evidence；任一步失败全部 rollback。

- [ ] **Step 3: 写 CLI 失败测试**

```bash
codespec revise --change CHG-20260915-001 --reason "scope changed"
```

缺 change、空 reason、无 semantic change 均非零退出；JSON 输出 `RevisionResult`。

Run: `pnpm exec vitest run test/core/codespec-workflow/revision.test.ts test/commands/artifact-workflow.test.ts`

Expected: FAIL。

- [ ] **Step 4: 实现 revision 分类与事务**

复用现有原子写/rollback 工具；CLI 不直接写文件。`state-machine.incrementRevision()` 改为内部纯函数或由 revision transaction 调用，避免双套 invalidation。

- [ ] **Step 5: 扩展 tasks revision contract**

六件套 tasks 的 `changeRevision` 必须等于 metadata revision；历史解析可接受缺失，但 PLAN gate 和迁移后文件必须存在。

- [ ] **Step 6: 运行测试并提交**

Run: `pnpm exec vitest run test/core/codespec-workflow/revision.test.ts test/core/codespec-workflow/approvals.test.ts test/core/codespec-workflow/state-machine.test.ts test/commands/artifact-workflow.test.ts`

Expected: PASS。

```bash
git add src/core/codespec-workflow/revision.ts src/core/codespec-workflow/approvals.ts src/core/codespec-workflow/state-machine.ts src/core/codespec-workflow/current-change-yaml.ts src/cli/index.ts test/core/codespec-workflow/revision.test.ts test/core/codespec-workflow/approvals.test.ts test/core/codespec-workflow/state-machine.test.ts test/commands/artifact-workflow.test.ts
git commit -m "feat: add semantic change revision transaction"
```

---

### Task 6: 建立 canonical rich Requirement delta AST 与精确 Current 读取

**Files:**

- Modify: `src/core/codespec-workflow/current-spec-model.ts`
- Create: `src/core/codespec-workflow/current-spec-delta.ts`
- Modify: `src/core/codespec-workflow/current-change-yaml.ts`
- Modify: `src/core/codespec-workflow/baseline.ts`
- Modify: `src/commands/show.ts`
- Modify: `src/cli/index.ts`
- Modify: `schemas/code-spec/templates/spec.md`
- Modify: `test/core/codespec-workflow/current-spec-model.test.ts`
- Create: `test/core/codespec-workflow/current-spec-delta.test.ts`
- Modify: `test/commands/show.test.ts`

**Model:**

```ts
export interface CurrentRequirementDelta {
  action: 'ADDED' | 'MODIFIED' | 'REMOVED';
  module: string;
  id: string;
  previous?: CurrentSpecRequirement;
  next?: CurrentSpecRequirement;
  reason: string;
}

export interface CurrentSpecDeltaDocument {
  title: string;
  module: string;
  version: 1;
  requirements: CurrentRequirementDelta[];
  engineeringFiles: CurrentSpecEngineeringFile[];
}

export function parseCurrentSpecDelta(content: string): CurrentSpecDeltaDocument;
export function renderCurrentSpecDelta(document: CurrentSpecDeltaDocument): string;
export function projectCurrentSpecDelta(document: CurrentSpecDeltaDocument): unknown;
export function validateCurrentSpecDelta(document: CurrentSpecDeltaDocument): string[];
```

`current-spec-model.ts` 新增：

```ts
export function findCurrentRequirement(
  specification: CurrentSpecification,
  requirementId: string,
): CurrentSpecRequirement | undefined;
export function parseRequirementSnapshot(
  markdown: string,
  headingLevel?: 2 | 3,
): CurrentSpecRequirement;
export function renderRequirementSnapshot(
  requirement: CurrentSpecRequirement,
  headingLevel?: 2 | 3,
): string;
export function hashRequirementSnapshot(requirement: CurrentSpecRequirement): string;
```

**Grammar:** H2 是 ADDED/MODIFIED/REMOVED；H3 是 Requirement；独立粗体段落 Previous/New/Reason 分隔完整 snapshot；Scenario 使用完整稳定 ID；末尾 `## 工程文件增量` 表按 path 描述新增/修改/删除。用 markdown-it token/AST，不复用 legacy short-ID `delta-parser.ts`。

- [ ] **Step 1: 写 snapshot round-trip 失败测试**

从完整 Current 提取一个 Requirement，H2/H3 渲染均可 round-trip，Scenario、测试用例、异常、追踪保持；semantic hash 不受换行和表格空白影响。

- [ ] **Step 2: 写 rich delta parser/renderer 失败测试**

覆盖三种 action、重复 ID、跨模块、缺 Previous/New/Reason、Previous=New、whole Spec 嵌入、重复工程文件、legacy `SCN-001` 短 ID。

- [ ] **Step 3: 写精确 Current show 失败测试**

```bash
codespec show MOD-002 --type spec --requirement MOD-002-REQ-006
codespec show MOD-002 --type spec --requirement MOD-002-REQ-006 --json
```

文本只输出该 Requirement；JSON 返回结构对象；拒绝数字索引、module/Requirement 不匹配和不存在 ID。不带 requirement 时保留整份 Current 查看。

Run: `pnpm exec vitest run test/core/codespec-workflow/current-spec-model.test.ts test/core/codespec-workflow/current-spec-delta.test.ts test/commands/show.test.ts`

Expected: FAIL。

- [ ] **Step 4: 实现共享 snapshot 和 rich delta**

先用共享 API 重写 Current 内部 Requirement 处理，再构建 delta parser。`projectCurrentSpecForDesignApproval()` 和 plan projection 改用 rich delta projection。

- [ ] **Step 5: baseline 改为 Requirement semantic hash**

停止使用旧 `###` heading regex block。baseline 只 hash analysis 声明的 Requirements；ADDED 使用 absence marker，不 hash 整模块或 archive。

- [ ] **Step 6: 实现 show 和模板，运行测试**

模板只给单 Requirement 示例，并明确禁止复制完整 Current/历史 Change。

Run: `pnpm exec vitest run test/core/codespec-workflow/current-spec-model.test.ts test/core/codespec-workflow/current-spec-delta.test.ts test/commands/show.test.ts && pnpm typecheck`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/core/codespec-workflow/current-spec-model.ts src/core/codespec-workflow/current-spec-delta.ts src/core/codespec-workflow/current-change-yaml.ts src/core/codespec-workflow/baseline.ts src/commands/show.ts src/cli/index.ts schemas/code-spec/templates/spec.md test/core/codespec-workflow/current-spec-model.test.ts test/core/codespec-workflow/current-spec-delta.test.ts test/commands/show.test.ts
git commit -m "feat: define rich requirement delta contract"
```

---

### Task 7: 把 canonical archive 从整模块替换改为 Requirement 级合并

**Files:**

- Modify: `src/core/codespec-workflow/current-spec-delta.ts`
- Modify: `src/core/codespec-workflow/current-archive-merge.ts`
- Modify: `src/core/codespec-workflow/current-archive-preflight.ts`
- Modify: `src/core/codespec-workflow/archive-projection.ts`
- Modify: `src/core/codespec-workflow/archive-transaction.ts`
- Modify: `src/core/codespec-workflow/archive-impact.ts`
- Modify: `src/core/codespec-workflow/gates.ts`
- Modify: `test/core/codespec-workflow/current-archive-merge.test.ts`
- Modify: `test/core/codespec-workflow/current-archive-preflight.test.ts`
- Modify: `test/core/codespec-workflow/archive-projection.test.ts`
- Modify: `test/core/codespec-workflow/archive-impact-integrity.test.ts`
- Modify: `test/core/codespec-workflow/archive-transaction.test.ts`
- Modify: `test/core/codespec-workflow/transaction-journal.test.ts`

**Produces:**

```ts
export type ApplyCurrentSpecDeltaResult = {
  specification: CurrentSpecification;
  added: string[];
  modified: string[];
  removed: string[];
  engineeringFiles: {
    added: string[];
    modified: string[];
    removed: string[];
  };
};

export function applyCurrentSpecDelta(
  current: CurrentSpecification,
  delta: CurrentSpecDeltaDocument,
): ApplyCurrentSpecDeltaResult;
export function validateCurrentSpecDeltaAgainstCurrent(
  current: CurrentSpecification,
  delta: CurrentSpecDeltaDocument,
): string[];
```

- [ ] **Step 1: 写 action/冲突失败测试**

覆盖 ADDED 已存在、MODIFIED/REMOVED 不存在、Previous 与 Current hash 不同、Previous=New、New 改 ID、工程文件新增已存在和修改/删除不存在。错误以 `ARCHIVE CONFLICT` 开头并含稳定 ID/path。

- [ ] **Step 2: 写连续同 Requirement 变更回归测试**

Current 含 `REQ-001=A+B` 和 `REQ-002=D`。Change 1 将 REQ-001 变为 A+B+C；Change 2 的 spec 只含 REQ-001，Previous=A+B+C，New=A+B+C+E。最终断言 REQ-002 与原始 semantic object 相等，Change 2 不包含 REQ-002 和 Change 1 文本。

- [ ] **Step 3: 写 canonical archive 分支失败测试**

用六件套 fixture 证明当前 `!artifacts.metadata.artifacts.proposal` 路径会整模块替换。新期望是 parse Current → parse rich delta → preflight → apply listed Requirements/files → append verification summary。

- [ ] **Step 4: 写事务回滚失败测试**

在 Current 写入后、archive 移动前注入失败；Current、active Change、index、journal 全恢复，`analysis.yaml` 也恢复。

Run: `pnpm exec vitest run test/core/codespec-workflow/current-archive-merge.test.ts test/core/codespec-workflow/current-archive-preflight.test.ts test/core/codespec-workflow/archive-projection.test.ts test/core/codespec-workflow/archive-impact-integrity.test.ts test/core/codespec-workflow/archive-transaction.test.ts test/core/codespec-workflow/transaction-journal.test.ts`

Expected: FAIL；当前 canonical 把 active spec 当完整 Current。

- [ ] **Step 5: 实现 Requirement/工程文件合并**

未受影响 Requirement 保持原顺序和语义；MODIFIED 原位替换，REMOVED 删除，ADDED 按 delta 顺序追加。工程文件按 path 合并。比较全部使用 Task 6 semantic hash，任何冲突发生在写入前。

- [ ] **Step 6: 统一 canonical preflight/projection/archive**

删除 canonical whole-module 假设。proposal-bearing legacy 分支继续用旧 parser 兼容历史；六件套只走 rich delta。不得按内容猜格式，按 artifact contract 分流。

- [ ] **Step 7: 把 delta boundary 前移到 DESIGN gate**

六件套 DESIGN 及以后调用 Current delta validation；analysis/metadata/spec Requirement 集合必须相等，每个 delta 至少被一个 AC 引用。

- [ ] **Step 8: 运行测试并提交**

Run: `pnpm exec vitest run test/core/codespec-workflow/current-spec-delta.test.ts test/core/codespec-workflow/current-archive-merge.test.ts test/core/codespec-workflow/current-archive-preflight.test.ts test/core/codespec-workflow/archive-projection.test.ts test/core/codespec-workflow/archive-impact-integrity.test.ts test/core/codespec-workflow/archive-transaction.test.ts test/core/codespec-workflow/transaction-journal.test.ts test/core/codespec-workflow/state-machine.test.ts`

Expected: PASS；连续两次变更只触达 REQ-001。

```bash
git add src/core/codespec-workflow/current-spec-delta.ts src/core/codespec-workflow/current-archive-merge.ts src/core/codespec-workflow/current-archive-preflight.ts src/core/codespec-workflow/archive-projection.ts src/core/codespec-workflow/archive-transaction.ts src/core/codespec-workflow/archive-impact.ts src/core/codespec-workflow/gates.ts test/core/codespec-workflow/current-archive-merge.test.ts test/core/codespec-workflow/current-archive-preflight.test.ts test/core/codespec-workflow/archive-projection.test.ts test/core/codespec-workflow/archive-impact-integrity.test.ts test/core/codespec-workflow/archive-transaction.test.ts test/core/codespec-workflow/transaction-journal.test.ts test/core/codespec-workflow/state-machine.test.ts
git commit -m "fix: archive canonical changes by requirement"
```

---

### Task 8: 打通 Acceptance Criterion 到验证证据的追踪链

**Files:**

- Modify: `src/core/codespec-workflow/current-change-layout.ts`
- Modify: `src/core/codespec-workflow/current-change-yaml.ts`
- Modify: `src/core/codespec-workflow/traceability.ts`
- Modify: `src/core/codespec-workflow/current-verification-policy.ts`
- Modify: `src/core/codespec-workflow/verification.ts`
- Modify: `src/core/codespec-workflow/gates.ts`
- Modify: `test/core/codespec-workflow/current-change-yaml.test.ts`
- Modify: `test/core/codespec-workflow/traceability.test.ts`
- Modify: `test/core/codespec-workflow/current-verification-policy.test.ts`
- Modify: `test/core/codespec-workflow/verification.test.ts`
- Create: `test/core/codespec-workflow/gates.test.ts`

**Schema:** each task 与 verification test case 增加 `acceptanceCriteria: string[]`；`TraceRow` 增加 `acceptance_id`。

```ts
export interface TraceRow {
  acceptance_id: string;
  requirement_id: string;
  scenario_id: string;
  task_id: string;
  test_id: string;
  evidence_id: string;
  result: 'PASS' | 'FAIL' | 'BLOCKED';
  code_reference?: string;
}
```

- [ ] **Step 1: 写 task/verification schema 失败测试**

六件套 tasks 必须带 changeRevision，每个 task 至少关联 AC/Requirement/Scenario/Test；verification revision 一致，每条证据声明 AC。重复或未知 ID 被拒绝。

- [ ] **Step 2: 写完整链路失败测试**

依次覆盖 MUST AC 无 Requirement、Requirement 无 Scenario、Scenario 无 Task、Task 无 Test、Test 无 evidence、FAIL/BLOCKED、revision/identity stale。SHOULD/COULD 缺证据只 warning；MUST 阻塞 VERIFY/archive。

- [ ] **Step 3: 写 verification identity 失败测试**

identity 纳入 analysis semantic projection、design、delta spec、task definitions 和 revision；task status/时间戳不改变 identity。

Run: `pnpm exec vitest run test/core/codespec-workflow/current-change-yaml.test.ts test/core/codespec-workflow/traceability.test.ts test/core/codespec-workflow/current-verification-policy.test.ts test/core/codespec-workflow/verification.test.ts`

Expected: FAIL。

- [ ] **Step 4: 实现 schema、链路图和门禁**

完整边为 Goal→AC→Requirement→Scenario→Task→Test→Evidence→CurrentSpec→Archive。保留 legacy 校验，但六件套不再对 spec 调 legacy `parseDeltaSpec()`。PLAN 检查到 Test；VERIFY/archive 检查 passing evidence。证据 Markdown 表增加 AC 列。

- [ ] **Step 5: 运行测试并提交**

Run: `pnpm exec vitest run test/core/codespec-workflow/current-change-yaml.test.ts test/core/codespec-workflow/traceability.test.ts test/core/codespec-workflow/current-verification-policy.test.ts test/core/codespec-workflow/verification.test.ts test/core/codespec-workflow/gates.test.ts`

Expected: PASS。

```bash
git add src/core/codespec-workflow/current-change-layout.ts src/core/codespec-workflow/current-change-yaml.ts src/core/codespec-workflow/traceability.ts src/core/codespec-workflow/current-verification-policy.ts src/core/codespec-workflow/verification.ts src/core/codespec-workflow/gates.ts test/core/codespec-workflow/current-change-yaml.test.ts test/core/codespec-workflow/traceability.test.ts test/core/codespec-workflow/current-verification-policy.test.ts test/core/codespec-workflow/verification.test.ts test/core/codespec-workflow/gates.test.ts
git commit -m "feat: trace acceptance criteria to evidence"
```

---

### Task 9: 让 rebase 只刷新受影响 Requirement，并回到最早失效阶段

**Files:**

- Modify: `src/core/codespec-workflow/rebase.ts`
- Modify: `src/core/codespec-workflow/baseline.ts`
- Modify: `src/core/codespec-workflow/approvals.ts`
- Modify: `test/core/codespec-workflow/stale-rebase.test.ts`
- Create: `test/core/codespec-workflow/baseline.test.ts`
- Modify: `test/core/codespec-workflow/approvals.test.ts`

**Result:**

```ts
export interface RebaseDecision {
  strategy: 'semantic-rebase';
  route: 'ANALYZE' | 'DESIGN';
  reason: string;
  current_specs: string[];
  decisions: Array<{
    requirement_id: string;
    action: 'ADDED' | 'MODIFIED' | 'REMOVED';
    previous_hash: string | null;
    current_hash: string | null;
    outcome: 'REFRESHED' | 'ANALYSIS_CONFLICT';
  }>;
}
```

- [ ] **Step 1: 写 scoped refresh 失败测试**

Current 含两个 Requirements、delta 只含 REQ-001。rebase 只更新 REQ-001.Previous，保留其 New/Reason/action，永不引入 REQ-002 或 archive 文本。

- [ ] **Step 2: 写 ANALYZE/DESIGN 路由失败测试**

OWNED module 变化、ADDED 现已存在、MODIFIED/REMOVED 消失、Current 变化触达 confirmed assumption 的 requirement 引用、AC/disposition 不成立 → ANALYZE。只有 snapshot 漂移且意图仍成立 → DESIGN。

- [ ] **Step 3: 写 invalidation/rollback 失败测试**

两种 route 均增加 revision 并清 verification；ANALYZE revoke 全部，DESIGN 保留 hash-valid analyze、revoke design/plan；失败不产生半更新。

Run: `pnpm exec vitest run test/core/codespec-workflow/stale-rebase.test.ts test/core/codespec-workflow/baseline.test.ts test/core/codespec-workflow/approvals.test.ts`

Expected: FAIL；现有 rebase 使用 legacy delta 且固定 DESIGN。

- [ ] **Step 4: 实现 rich semantic rebase**

先完整计算 decision，再以一个事务更新 Previous、baseline、revision、analysis/tasks revision、metadata/index/approvals/verification。输入只来自 approved analysis + Current。

- [ ] **Step 5: 运行测试并提交**

Run: `pnpm exec vitest run test/core/codespec-workflow/stale-rebase.test.ts test/core/codespec-workflow/baseline.test.ts test/core/codespec-workflow/approvals.test.ts test/core/codespec-workflow/revision.test.ts`

Expected: PASS。

```bash
git add src/core/codespec-workflow/rebase.ts src/core/codespec-workflow/baseline.ts src/core/codespec-workflow/approvals.ts test/core/codespec-workflow/stale-rebase.test.ts test/core/codespec-workflow/baseline.test.ts test/core/codespec-workflow/approvals.test.ts test/core/codespec-workflow/revision.test.ts
git commit -m "feat: route semantic rebase by invalidated intent"
```

---

### Task 10: 提供活动五件套 Change 的显式、可回滚迁移

**Files:**

- Create: `src/core/codespec-workflow/change-migration.ts`
- Modify: `src/cli/index.ts`
- Modify: `src/commands/workflow/status.ts`
- Test: `test/core/codespec-workflow/change-migration.test.ts`
- Modify: `test/commands/artifact-workflow.test.ts`
- Create: `test/commands/workflow-status.test.ts`

**Produces:**

```ts
export type ChangeMigrationResult = {
  changeId: string;
  fromArtifacts: 5;
  toArtifacts: 6;
  route: 'ANALYZE';
  unresolvedQuestionId: 'Q-MIGRATION-001';
};

export async function migrateActiveChangeAnalysis(
  workspace: WorkspaceContext,
  changeId: string,
): Promise<ChangeMigrationResult>;
```

- [ ] **Step 1: 写 deterministic scaffold 失败测试**

只复制明确事实：problem 来自 impact summary，modules/Requirement action 来自 metadata projection；goals/nonGoals/scope/AC 不从 design/spec/code/archive 推断。新增 OPEN 的 `Q-MIGRATION-001` 要求用户核对。

- [ ] **Step 2: 写状态/审批迁移失败测试**

迁移增加 revision、route ANALYZE、三审批 pending/revoked，并按 Task 5 清理 stale verification/update revisions。metadata 声明 analysis path。archive、已六件套、legacy proposal Change 拒绝迁移且不写。

- [ ] **Step 3: 写 rollback/CLI 失败测试**

中途失败恢复文件和 index。CLI：

```bash
codespec migrate --change CHG-20260915-001
```

status 对未迁移活动 Change 返回阻塞原因和这个 exact next command。

Run: `pnpm exec vitest run test/core/codespec-workflow/change-migration.test.ts test/commands/artifact-workflow.test.ts test/commands/workflow-status.test.ts`

Expected: FAIL。

- [ ] **Step 4: 实现单 Change migration transaction**

不要扩张 workspace-level `migration.ts`；复用 artifact/path validation 与原子写工具。

- [ ] **Step 5: 运行测试并提交**

Run: `pnpm exec vitest run test/core/codespec-workflow/change-migration.test.ts test/commands/artifact-workflow.test.ts test/commands/workflow-status.test.ts`

Expected: PASS。

```bash
git add src/core/codespec-workflow/change-migration.ts src/cli/index.ts src/commands/workflow/status.ts test/core/codespec-workflow/change-migration.test.ts test/commands/artifact-workflow.test.ts test/commands/workflow-status.test.ts
git commit -m "feat: migrate active changes to analysis artifact"
```

---

### Task 11: 闭合 status/instructions、生成 Skills 和用户文档

**Files:**

- Modify: `src/commands/workflow/status.ts`
- Modify: `src/commands/workflow/instructions.ts`
- Modify: `src/core/templates/workflows/codespec-workflow.ts`
- Modify: `src/core/shared/skill-generation.ts`
- Regenerate: `skills/codespec-workflow/SKILL.md`
- Regenerate: `skills/codespec-rebase-change/SKILL.md`
- Regenerate: `skills/codespec-archive-change/SKILL.md`
- Modify: `docs/concepts.md`
- Modify: `docs/workflows.md`
- Modify: `docs/writing-specs.md`
- Modify: `docs/editing-changes.md`
- Modify: `docs/cli.md`
- Modify: `test/commands/workflow-status.test.ts`
- Modify: `test/commands/workflow-instructions-skipped.test.ts`
- Modify: `test/core/templates/codespec-workflow.test.ts`
- Modify: `test/core/templates/skill-templates-parity.test.ts`
- Modify: `test/core/templates/parity-hash-shared.test.ts`

**Skill requirement:** 修改 CodeSpec 用户文档前使用 `write-codespec-docs`。不创建新的公开 Skill。

- [ ] **Step 1: 写 status/instructions 失败测试**

ANALYZE JSON 返回 `analysisSummary`、`openQuestions`、`assumptions`、`gateErrors`、`nextCommand`。完整未审批时 next 是 analyze approval；审批后是 DESIGN transition。DESIGN 提示精确 show 和 delta boundary；PLAN/VERIFY 显示 AC trace 缺口。

- [ ] **Step 2: 写模板/Skill parity 失败测试**

三个 Skill 都说明六件套、analyze approval、Current 唯一 baseline、活动 spec 只含 affected Requirements、Requirement merge、rebase route。公开 Skill 名称集合仍恰好三个，无 `codespec-analyze`。

Run: `pnpm exec vitest run test/commands/workflow-status.test.ts test/commands/workflow-instructions-skipped.test.ts test/core/templates/codespec-workflow.test.ts test/core/templates/skill-templates-parity.test.ts test/core/templates/parity-hash-shared.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现状态与阶段指引**

所有 nextCommand 可直接执行：五件套→migrate；OPEN question→编辑 analysis；完成分析→approve；stale delta→rebase。

- [ ] **Step 4: 更新模板并重新生成 Skill**

Run:

```bash
pnpm build
pnpm generate:skills
pnpm regen:parity-hashes
```

Expected: 只生成现有三个 Skill 并更新 parity hashes。

- [ ] **Step 5: 更新用户文档**

回答：需求澄清属于哪里；六 artifact 职责；三审批；如何写 Requirement delta；为何不能复制整 Spec；如何 revise/rebase/migrate；archive 如何保持 Current 完整事实。CLI 文档给 exact commands。

- [ ] **Step 6: 运行测试和生成稳定性检查**

Run: `pnpm exec vitest run test/commands/workflow-status.test.ts test/commands/workflow-instructions-skipped.test.ts test/core/templates/codespec-workflow.test.ts test/core/templates/skill-templates-parity.test.ts test/core/templates/parity-hash-shared.test.ts && pnpm generate:skills && pnpm regen:parity-hashes && git diff --check`

Expected: PASS；第二次生成无新差异；没有第四个 Skill。

- [ ] **Step 7: 提交**

```bash
git add src/commands/workflow/status.ts src/commands/workflow/instructions.ts src/core/templates/workflows/codespec-workflow.ts src/core/shared/skill-generation.ts skills/codespec-workflow/SKILL.md skills/codespec-rebase-change/SKILL.md skills/codespec-archive-change/SKILL.md docs/concepts.md docs/workflows.md docs/writing-specs.md docs/editing-changes.md docs/cli.md test/commands/workflow-status.test.ts test/commands/workflow-instructions-skipped.test.ts test/core/templates/codespec-workflow.test.ts test/core/templates/skill-templates-parity.test.ts test/core/templates/parity-hash-shared.test.ts
git commit -m "docs: close requirement clarification workflow"
```

---

### Task 12: 运行真实 canonical 闭环与全量回归

**Files:**

- Create: `test/fixtures/codespec-workflow/clarification-closed-loop/README.md`
- Modify: `test/commands/artifact-workflow.test.ts`
- Modify: `test/core/codespec-workflow/archive-transaction.test.ts`
- Modify: `test/core/templates/skill-templates-parity.test.ts`

- [ ] **Step 1: 增加单进程端到端测试**

在临时 workspace 执行：new → 填 analysis → approve analyze → DESIGN → 精确读 Current Requirement → 写 rich delta → approve design → PLAN → 写带 AC tasks → approve plan → IMPLEMENT → VERIFY → 写 passing evidence → ARCHIVE。断言六 artifact 入 history、Current 只改显式 Requirement、index 一致。

- [ ] **Step 2: 增加连续第二 Change 测试**

同一 Requirement 再走一次闭环。第二个 active/archive spec 不得出现未受影响 Requirement 或第一个 Change 文本；Previous 等于第一次 archive 后的 Current Requirement。

- [ ] **Step 3: 运行构建和聚焦回归**

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm exec vitest run test/core/codespec-workflow test/commands/artifact-workflow.test.ts test/commands/show.test.ts test/commands/workflow-status.test.ts test/commands/workflow-instructions-skipped.test.ts test/core/templates/codespec-workflow.test.ts test/core/templates/skill-templates-parity.test.ts test/core/templates/parity-hash-shared.test.ts
```

Expected: PASS。

- [ ] **Step 4: 检查生成稳定性和 worktree**

```bash
pnpm generate:skills
pnpm regen:parity-hashes
git diff --check
git status --short
```

Expected: 生成命令无未预期变化；只出现计划内文件和用户原有 dirty work。

- [ ] **Step 5: 运行全量测试并区分既有基线失败**

Run: `pnpm test`

Expected: 逻辑测试通过。若仍有已知 sandbox loopback EPERM 或仓库 fixture 缺失，只记录为既有环境/基线失败；必须证明无新增失败并附聚焦测试通过输出。

- [ ] **Step 6: 使用 verification-before-completion 逐条复核验收条件**

保存命令、退出码、关键输出；特别证明 canonical archive 不再进入 whole-module replacement 路径。

- [ ] **Step 7: 提交最终回归**

```bash
git add test/fixtures/codespec-workflow/clarification-closed-loop/README.md test/commands/artifact-workflow.test.ts test/core/codespec-workflow/archive-transaction.test.ts test/core/templates/skill-templates-parity.test.ts test/core/templates/parity-hash-shared.test.ts
git commit -m "test: verify clarification workflow end to end"
```

---

## Review Checkpoints

1. **After Task 4:** 新 Change 可完成需求澄清与 analyze 审批。
2. **After Task 7:** 演示连续两次同 Requirement 变更，且无关 Requirement 未进入活动 spec、未被 archive 改写。
3. **After Task 9:** 确认 revise/rebase 的 ANALYZE 与 DESIGN 回退符合意图。
4. **After Task 11:** 用户仅凭 status/instructions 和现有三个 Skills 可完成流程。
5. **After Task 12:** 只有聚焦测试、构建、类型、lint、生成 parity、E2E 均通过后才宣称完成。

## Explicitly Deferred

- 不新增独立需求澄清 Skill。
- 不自动替用户确认 assumption、解决 open question 或执行审批。
- 不把 archive 内容自动摘要进新 Change。
- 不重写 legacy proposal-bearing 历史格式，只维持兼容读取/归档。
- 不扩展验证 runner 类型，只扩展追踪身份和证据关联。
