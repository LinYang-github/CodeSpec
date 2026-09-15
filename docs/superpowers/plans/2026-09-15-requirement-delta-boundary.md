# Requirement Delta Boundary Implementation Plan

> **Superseded:** This narrow plan is replaced by `docs/superpowers/plans/2026-09-15-codespec-requirement-clarification-closed-loop.md`. The replacement also corrects the discovered canonical archive behavior: current canonical archive performs whole-module replacement, so Requirement-level merge must be implemented rather than merely preserved.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让后续 Change 只携带本次受影响的 Requirement；`Previous` 精确对应 Current Specification 中的同一 Requirement，`New` 是该 Requirement 的完整目标状态，归档时不把整个旧 Spec 或上一份 Change 累积进来。

**Architecture:** 保持现有 Requirement 级 archive merge，不引入新的历史模型。先统一 Current Requirement 快照提取逻辑，再提供按稳定 Requirement ID 读取 Current Specification 的 CLI 接口，并把现有 archive-impact 校验前移到 canonical DESIGN 及后续门禁；AI 工作流只允许从 Current Specification 获取基线，不把 archived Change 当作下一次 Change 的输入。

**Tech Stack:** TypeScript 6、Node.js 20、Commander、Vitest、Markdown canonical delta DSL、YAML

**Spec:** `docs/writing-specs.md` 的 “Pick the right kind of delta” 契约，以及本次对话确认的规则：Spec 级只记录 delta，Requirement 级使用完整替换。

## Global Constraints

- `codespec/specs/` 是当前完整事实；`codespec/archive/changes/` 只保存不可变历史。
- 活动 Change 的 `spec.md` 只列出本次受影响的 Requirement ID。
- `MODIFIED.Previous` 和 `REMOVED.Previous` 必须等于 Current Specification 中同 ID Requirement 的完整快照。
- `MODIFIED.New` 必须是同 ID Requirement 的完整目标状态；仍有效的旧 Scenario 必须保留，确实删除或替代的 Scenario 必须进入归档影响映射。
- 未受影响的 Requirement 不得进入本次 Change；`Previous`、`New` 中不得嵌入整个模块 Spec 或上一份 Change。
- Current Specification 仍然只能由 archive transaction 写入。
- 所有新增行为先写失败测试，再做最小实现。

---

## File Structure

- `src/core/codespec-workflow/current-spec-parser.ts`：统一解析、查找和规范化单个 Current Requirement 快照。
- `src/core/codespec-workflow/baseline.ts`：使用统一快照计算 Requirement baseline hash。
- `src/core/codespec-workflow/rebase.ts`：只刷新受影响 Requirement 的 `Previous`。
- `src/core/codespec-workflow/archive-transaction.ts`：继续执行 Requirement 级替换，但复用统一快照比较逻辑。
- `src/commands/show.ts`：canonical workspace 中按模块和稳定 Requirement ID 输出精确 Current 快照。
- `src/cli/index.ts`：澄清 canonical `--requirement` 参数语义。
- `src/core/codespec-workflow/archive-impact.ts`：校验 Current/Previous/New 边界和 no-op MODIFIED。
- `src/core/codespec-workflow/gates.ts`：从 DESIGN 开始对 canonical Change 执行 delta 边界校验。
- `src/core/templates/workflows/codespec-workflow.ts`：给生成的工作流写入明确的 Requirement 级 delta 规则和精确读取命令。
- `schemas/code-spec/templates/spec.md`：在作者模板中明确禁止 Spec 级复制。
- `skills/codespec-workflow/SKILL.md`、`skills/codespec-rebase-change/SKILL.md`、`skills/codespec-archive-change/SKILL.md`：由模板重新生成，不手工维护分叉内容。
- `docs/writing-specs.md`、`docs/cli.md`：解释用户可见行为和命令。
- 对应 `test/` 文件：锁定提取、读取、门禁、rebase、archive 和模板行为。

---

### Task 1: 统一单 Requirement 快照语义

**Files:**
- Modify: `src/core/codespec-workflow/current-spec-parser.ts`
- Modify: `src/core/codespec-workflow/baseline.ts`
- Modify: `src/core/codespec-workflow/rebase.ts`
- Modify: `src/core/codespec-workflow/archive-transaction.ts`
- Test: `test/core/codespec-workflow/current-spec-parser.test.ts`
- Test: `test/core/codespec-workflow/stale-rebase.test.ts`
- Test: `test/core/codespec-workflow/archive-transaction.test.ts`

**Interfaces:**
- Produces: `findCurrentRequirement(content: string, requirementId: RequirementId): CurrentSpecificationRequirement | undefined`
- Produces: `normalizeRequirementSnapshot(content: string): string`
- Produces: `stripRequirementHeading(content: string): string`
- Consumers: baseline hashing、semantic rebase、archive conflict detection、Task 2 的 canonical show、Task 3 的 delta 校验。

- [ ] **Step 1: 为单 Requirement 提取写失败测试**

```ts
it('returns only the requested Requirement block', () => {
  const content = `# Current\n\n### MOD-002-REQ-001 A\nA rule\n\n### MOD-002-REQ-002 B\nB rule\n`;
  expect(findCurrentRequirement(content, 'MOD-002-REQ-002')).toMatchObject({
    id: 'MOD-002-REQ-002',
    raw: '### MOD-002-REQ-002 B\nB rule',
  });
});

it('normalizes only transport whitespace for snapshot comparison', () => {
  expect(normalizeRequirementSnapshot('\ufeff### MOD-002-REQ-001 A\r\nRule\r\n'))
    .toBe('### MOD-002-REQ-001 A\nRule');
});
```

- [ ] **Step 2: 运行测试并确认新接口尚不存在**

Run: `pnpm exec vitest run test/core/codespec-workflow/current-spec-parser.test.ts`

Expected: FAIL，提示 `findCurrentRequirement` 或 `normalizeRequirementSnapshot` 未导出。

- [ ] **Step 3: 在 Current Spec parser 中实现唯一快照接口**

```ts
export function findCurrentRequirement(
  content: string,
  requirementId: RequirementId,
): CurrentSpecificationRequirement | undefined {
  return parseCurrentSpec(content).requirements.find((item) => item.id === requirementId);
}

export function normalizeRequirementSnapshot(content: string): string {
  return content.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').trim();
}

export function stripRequirementHeading(content: string): string {
  return content
    .replace(/^###[ \t]+MOD-\d{3}-REQ-\d{3}(?:[ \t]+[^\n]*)?\n?/u, '')
    .trim();
}
```

- [ ] **Step 4: 删除三个消费者中的私有 `blockFor` / `requirementBlock` / `withoutHeading`，改用统一接口**

`baseline.ts` 对 `findCurrentRequirement(content, id)?.raw ?? ''` 计算 hash；`rebase.ts` 只把同 ID 的 `raw` 写入该 delta 的 `Previous`；`archive-transaction.ts` 用 `normalizeRequirementSnapshot(current.raw)` 与 `normalizeRequirementSnapshot(delta.previous)` 比较后，只替换 `current.raw`。

- [ ] **Step 5: 运行提取、rebase 和 archive 测试**

Run: `pnpm exec vitest run test/core/codespec-workflow/current-spec-parser.test.ts test/core/codespec-workflow/stale-rebase.test.ts test/core/codespec-workflow/archive-transaction.test.ts`

Expected: PASS；现有 conflict、rebase、事务回滚测试不变。

- [ ] **Step 6: 提交共享快照实现**

```bash
git add src/core/codespec-workflow/current-spec-parser.ts src/core/codespec-workflow/baseline.ts src/core/codespec-workflow/rebase.ts src/core/codespec-workflow/archive-transaction.ts test/core/codespec-workflow/current-spec-parser.test.ts test/core/codespec-workflow/stale-rebase.test.ts test/core/codespec-workflow/archive-transaction.test.ts
git commit -m "refactor: unify current requirement snapshots"
```

### Task 2: 提供稳定 Requirement ID 的精确读取命令

**Files:**
- Modify: `src/commands/show.ts`
- Modify: `src/cli/index.ts`
- Test: `test/commands/show.test.ts`

**Interfaces:**
- Consumes: `findCurrentRequirement()` from Task 1。
- Produces: `codespec show MOD-002 --type spec --requirement MOD-002-REQ-006 --json`。
- JSON result: `{ type: "spec", module: "MOD-002", requirement: { id, title, raw, scenarios }, root }`。

- [ ] **Step 1: 写 canonical Current Requirement CLI 失败测试**

创建 canonical fixture，其中 `MOD-002/spec.md` 同时包含 `REQ-001` 和 `REQ-006`，然后断言：

```ts
const result = runCLI([
  'show', 'MOD-002', '--type', 'spec',
  '--requirement', 'MOD-002-REQ-006', '--json',
], { cwd: fixture.root });
expect(result.status).toBe(0);
const output = JSON.parse(result.stdout);
expect(output.requirement.id).toBe('MOD-002-REQ-006');
expect(output.requirement.raw).toContain('REQ-006');
expect(output.requirement.raw).not.toContain('REQ-001');
```

另加三条失败断言：Requirement 不属于指定模块、Requirement 不存在、`--requirement 2` 在 canonical workspace 中不是合法稳定 ID。

- [ ] **Step 2: 运行 show 测试并确认当前 canonical 分支拒绝 Spec**

Run: `pnpm exec vitest run test/commands/show.test.ts`

Expected: FAIL，输出当前错误 `canonical code-spec show 要求 Change ID`。

- [ ] **Step 3: 在 `ShowCommand.showCanonical()` 中区分 Change 与 Current Spec**

```ts
if (typeOverride === 'spec') {
  await this.showCanonicalSpec(selected, options, root, workspace);
  return;
}
```

`showCanonicalSpec()` 必须校验模块 ID 为 `MOD-###`、Requirement ID 为 `MOD-###-REQ-###`、两者归属一致，并只从 `workspace.paths.currentSpecs/<module>/spec.md` 读取。带 `--requirement` 时文本模式只打印 `raw`，JSON 模式只返回单个 Requirement；不带该选项时保持“显示整个 Current Spec”的显式人工查询能力。

- [ ] **Step 4: 修正 CLI 帮助文案**

把 `src/cli/index.ts` 的说明改为：`按 Requirement 标识筛选；canonical 使用稳定 ID，legacy JSON 保留 1-based index`，不破坏 legacy 数字索引兼容性。

- [ ] **Step 5: 运行 show 命令测试**

Run: `pnpm exec vitest run test/commands/show.test.ts test/commands/spec.test.ts`

Expected: PASS；legacy `show auth --json --requirement 1` 继续有效。

- [ ] **Step 6: 提交精确读取接口**

```bash
git add src/commands/show.ts src/cli/index.ts test/commands/show.test.ts test/commands/spec.test.ts
git commit -m "feat: show canonical requirement snapshots"
```

### Task 3: 把 delta 边界校验前移到 DESIGN 门禁

**Files:**
- Modify: `src/core/codespec-workflow/archive-impact.ts`
- Modify: `src/core/codespec-workflow/gates.ts`
- Test: `test/core/codespec-workflow/archive-impact-integrity.test.ts`
- Test: `test/core/codespec-workflow/state-machine.test.ts`

**Interfaces:**
- Consumes: `validateArchiveImpactDeltas()` 和 Task 1 的快照规范化。
- Produces: canonical DESIGN 及后续状态统一执行 Current/Previous/New 边界校验。

- [ ] **Step 1: 写 no-op 和整份 Spec 携带的失败测试**

```ts
it('rejects a no-op MODIFIED Requirement', () => {
  const current = new Map([['MOD-001', old]]);
  const noOp = modified.replace('New rule', 'Old rule').replace('SCN-002', 'SCN-001');
  expect(validateArchiveImpactDeltas(affected(), parseDeltaSpec(noOp).entries, current).join('\n'))
    .toMatch(/没有实际变化|no-op/i);
});
```

再构造一个 Change：metadata 只声明 `REQ-001`，`spec.md` 却携带 `REQ-002`；DESIGN gate 必须因 metadata/spec 集合不一致或 no-op delta 失败，而不是拖到 archive 才发现。

- [ ] **Step 2: 运行边界和状态机测试并观察失败**

Run: `pnpm exec vitest run test/core/codespec-workflow/archive-impact-integrity.test.ts test/core/codespec-workflow/state-machine.test.ts`

Expected: FAIL；canonical DESIGN 当前没有调用 archive-impact/delta 集合校验。

- [ ] **Step 3: 扩展 `validateArchiveImpactDeltas()`**

对每个 delta 执行以下检查：

```ts
if (delta.action === 'ADDED' && currentRequirement) {
  errors.push(`ARCHIVE CONFLICT: ${delta.id} already exists in Current`);
}
if (delta.action !== 'ADDED' && !currentRequirement) {
  errors.push(`ARCHIVE CONFLICT: missing ${delta.id}`);
}
if (delta.action !== 'ADDED' &&
    normalizeRequirementSnapshot(currentRequirement.raw) !== normalizeRequirementSnapshot(delta.previous ?? '')) {
  errors.push(`ARCHIVE CONFLICT: ${delta.id} Current does not match Previous`);
}
if (delta.action === 'MODIFIED' &&
    normalizeRequirementSnapshot(delta.previous ?? '') === normalizeRequirementSnapshot(delta.next ?? '')) {
  errors.push(`${delta.id} MODIFIED 没有实际变化；未受影响的 Requirement 不得进入 Change`);
}
```

保留现有 Scenario 规则：旧 Scenario 如果继续有效，必须原样出现在 `New`；如果删除或替代，必须有 `归档影响分析.references` 映射。

- [ ] **Step 4: canonical DESIGN 及后续状态调用同一校验**

在 `gates.ts` 中移除“只有 legacy Change 才调用 `validateChangeArchiveImpact()`”的条件。DESIGN 只检查 delta、Current、metadata 和归档影响；PLAN 以后再检查任务追踪。解析 canonical `tasks.yaml` 时使用 `parseCurrentTasks()` 的 `requirements`、`scenarios`，不要继续依赖 `/SP-\d+/` 文本匹配。

- [ ] **Step 5: 运行门禁与归档影响测试**

Run: `pnpm exec vitest run test/core/codespec-workflow/archive-impact-integrity.test.ts test/core/codespec-workflow/state-machine.test.ts test/core/codespec-workflow/current-verification-policy.test.ts`

Expected: PASS；错误必须在 DESIGN/PLAN 阶段明确指出具体 Requirement ID。

- [ ] **Step 6: 提交提前校验**

```bash
git add src/core/codespec-workflow/archive-impact.ts src/core/codespec-workflow/gates.ts test/core/codespec-workflow/archive-impact-integrity.test.ts test/core/codespec-workflow/state-machine.test.ts test/core/codespec-workflow/current-verification-policy.test.ts
git commit -m "fix: enforce requirement delta boundaries at design"
```

### Task 4: 锁定连续变更与归档不扩散行为

**Files:**
- Modify: `test/core/codespec-workflow/archive-transaction.test.ts`
- Modify: `test/core/codespec-workflow/stale-rebase.test.ts`

**Interfaces:**
- Consumes: 现有 `archiveChange()`、`rebaseChange()`。
- Produces: 针对“同一 Requirement 连续变更”的端到端回归保障。

- [ ] **Step 1: 写连续归档回归测试**

测试基线包含：`REQ-001 = A + B`、`REQ-002 = D`。第二个 Change 只修改 `REQ-001`：`Previous = A + B`、`New = A + B + C`。归档后断言：

```ts
const current = await readCurrentSpec(fixture, 'MOD-002');
expect(findCurrentRequirement(current, 'MOD-002-REQ-001')?.raw).toContain('C');
expect(findCurrentRequirement(current, 'MOD-002-REQ-001')?.raw).toContain('A');
expect(findCurrentRequirement(current, 'MOD-002-REQ-001')?.raw).toContain('B');
expect(findCurrentRequirement(current, 'MOD-002-REQ-002')?.raw).toBe(originalReq002);

const archivedDelta = await fs.readFile(path.join(archivedPath, 'spec.md'), 'utf8');
expect(archivedDelta).toContain('MOD-002-REQ-001');
expect(archivedDelta).not.toContain('MOD-002-REQ-002');
expect(archivedDelta).not.toContain(previousChangeId);
```

- [ ] **Step 2: 写 rebase 范围回归测试**

当 Current 中只有 `REQ-001` 在其他 Change 后更新时，`rebaseChange()` 只能刷新活动 Change 中 `REQ-001.Previous`；不得把同模块 `REQ-002` 或历史 Change 内容写入活动 `spec.md`，并保留用户已写的 `REQ-001.New`。

- [ ] **Step 3: 运行测试并确认现有实现是否满足边界**

Run: `pnpm exec vitest run test/core/codespec-workflow/archive-transaction.test.ts test/core/codespec-workflow/stale-rebase.test.ts`

Expected: PASS。如果失败，只修改 Requirement 提取/替换代码，不改成整份模块覆盖。

- [ ] **Step 4: 提交回归测试**

```bash
git add test/core/codespec-workflow/archive-transaction.test.ts test/core/codespec-workflow/stale-rebase.test.ts
git commit -m "test: lock sequential requirement delta scope"
```

### Task 5: 修正 AI 工作流和 Spec 模板的作者指令

**Files:**
- Modify: `src/core/templates/workflows/codespec-workflow.ts`
- Modify: `schemas/code-spec/templates/spec.md`
- Regenerate: `skills/codespec-workflow/SKILL.md`
- Regenerate: `skills/codespec-rebase-change/SKILL.md`
- Regenerate: `skills/codespec-archive-change/SKILL.md`
- Modify: `test/core/templates/codespec-workflow.test.ts`
- Modify: `test/core/templates/skill-templates-parity.test.ts` only through the repository parity-hash generator when its golden hashes change

**Interfaces:**
- Produces: `REQUIREMENT_DELTA_BOUNDARY_GUIDANCE`，供三个 canonical Skill 共享。
- Consumes: Task 2 的精确读取命令。

- [ ] **Step 1: 写模板失败测试**

```ts
expect(content).toContain('Requirement 级完整替换');
expect(content).toContain('Spec 级只记录本次 delta');
expect(content).toContain('codespec show "<MOD-ID>" --type spec --requirement "<REQ-ID>" --json');
expect(content).toContain('不得把 archived Change 作为 Previous');
expect(content).toContain('未受影响的 Requirement 不得进入本次 Change');
```

- [ ] **Step 2: 运行模板测试并确认规则缺失**

Run: `pnpm exec vitest run test/core/templates/codespec-workflow.test.ts`

Expected: FAIL，缺少新的边界文案。

- [ ] **Step 3: 写入共享工作流规则**

在 `CODESPEC_WORKFLOW_GUIDANCE` 中加入固定步骤：

1. 先根据用户目标确认受影响 Requirement ID 集合。
2. 对每个既有 Requirement 运行 `codespec show "<MOD-ID>" --type spec --requirement "<REQ-ID>" --json`。
3. `Previous` 直接使用该 Current Requirement 快照；不得读取上一份 archived Change 作为基线。
4. `New` 只表达同一 Requirement 的完整目标状态，保留仍有效 Scenario。
5. 活动 `spec.md` 只列受影响 Requirement；不得复制整个模块 Spec。
6. 生成后运行 `codespec status --change "<CHG-ID>" --json`，由 Core 在 DESIGN gate 校验边界。

- [ ] **Step 4: 收紧 schema 模板注释**

把 MODIFIED/REMOVED 的注释写成：

```md
<!-- 仅粘贴 Current Specification 中同 ID Requirement 的完整快照；禁止粘贴整个模块 Spec 或历史 Change。 -->
```

并在 `**New**` 前注明：同一 Requirement 的完整目标状态，保留仍有效的旧 Scenario。

- [ ] **Step 5: 重新生成提交到仓库的 Skills 并刷新 parity hash**

Run: `pnpm build`

Run: `pnpm generate:skills`

Run: `pnpm regen:parity-hashes`

- [ ] **Step 6: 验证模板与生成结果一致**

Run: `pnpm exec vitest run test/core/templates/codespec-workflow.test.ts test/core/templates/skill-templates-parity.test.ts test/core/templates/skillssh-parity.test.ts`

Expected: PASS；三个生成 Skill 包含同一份 delta 边界规则。

- [ ] **Step 7: 提交模板与生成产物**

```bash
git add src/core/templates/workflows/codespec-workflow.ts schemas/code-spec/templates/spec.md skills/codespec-workflow/SKILL.md skills/codespec-rebase-change/SKILL.md skills/codespec-archive-change/SKILL.md test/core/templates/codespec-workflow.test.ts test/core/templates/skill-templates-parity.test.ts
git commit -m "docs: define requirement delta authoring boundary"
```

### Task 6: 更新用户文档

**Files:**
- Modify: `docs/writing-specs.md`
- Modify: `docs/cli.md`

**Interfaces:**
- Documents: Task 2 的精确读取命令和最终 delta/归档语义。

- [ ] **Step 1: 使用 `write-codespec-docs` 技能修订写作指南**

在 `docs/writing-specs.md` 的 delta 章节加入一个连续变更示例：Current `R1=A+B`，新 Change 增加 `C`，其 `Previous=A+B`、`New=A+B+C`；`R2` 未受影响，因此不出现在 Change 中。

- [ ] **Step 2: 修订 CLI 文档**

在 `docs/cli.md` 的 `codespec show` 章节增加：

```bash
codespec show MOD-002 --type spec --requirement MOD-002-REQ-006 --json
```

说明 canonical 使用稳定 ID，legacy JSON 查询仍使用 1-based index。

- [ ] **Step 3: 检查文档不再把 Current Specification 与 archived Change 混为同一输入**

Run: `rg -n "Previous|New|--requirement|archived Change|Current Specification" docs/writing-specs.md docs/cli.md`

Expected: 两页都明确 Current 是基线、archive 是历史、Change 是本次 delta。

- [ ] **Step 4: 提交用户文档**

```bash
git add docs/writing-specs.md docs/cli.md
git commit -m "docs: explain requirement scoped changes"
```

### Task 7: 完整验证与人工验收

**Files:**
- Verify only: all modified source, tests, templates, generated skills, and docs

**Interfaces:**
- Produces: 可复核的测试与 CLI 输出证据。

- [ ] **Step 1: 运行相关测试集**

Run:

```bash
pnpm exec vitest run \
  test/core/codespec-workflow/current-spec-parser.test.ts \
  test/commands/show.test.ts \
  test/commands/spec.test.ts \
  test/core/codespec-workflow/archive-impact-integrity.test.ts \
  test/core/codespec-workflow/state-machine.test.ts \
  test/core/codespec-workflow/current-verification-policy.test.ts \
  test/core/codespec-workflow/archive-transaction.test.ts \
  test/core/codespec-workflow/stale-rebase.test.ts \
  test/core/templates/codespec-workflow.test.ts \
  test/core/templates/skill-templates-parity.test.ts \
  test/core/templates/skillssh-parity.test.ts
```

Expected: PASS。

- [ ] **Step 2: 运行静态验证**

Run: `pnpm typecheck`

Run: `pnpm lint`

Run: `pnpm build`

Expected: 三条命令全部以 exit code 0 完成。

- [ ] **Step 3: 运行完整测试集**

Run: `pnpm test`

Expected: 本次相关测试全部通过且不新增失败；若工作区仍存在已知的 loopback sandbox `EPERM` 或仓库根 `codespec/config.yaml` 缺失失败，逐项与修改前基线对照并单独报告，不把它们误报为本次成功。

- [ ] **Step 4: 在临时 canonical fixture 做 CLI 验收**

依次验证：

```bash
codespec show MOD-002 --type spec --requirement MOD-002-REQ-006 --json
codespec status --change CHG-YYYYMMDD-NNN --json
```

验收结果必须满足：第一条只返回一个 Requirement；Change `spec.md` 不含同模块其他 Requirement；no-op MODIFIED 在 DESIGN gate 失败；合法 delta 归档后只替换目标 Requirement。

- [ ] **Step 5: 检查工作树范围并提交最终修正**

Run: `git status --short`

Run: `git diff --check`

Expected: 没有空白错误，且没有覆盖用户原有的无关改动。
