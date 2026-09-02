# code-spec Runtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking. Do not use subagents.

**Goal:** Make a newly initialized empty code-spec workspace fail with a clear Chinese business-modeling prerequisite, accept language-independent business table headers, and restore the migrated test and generated-Skill baseline.

**Architecture:** src/core/openspec-workflow/business-registry.ts remains the sole parser and domain-error boundary. It will recognize a Markdown header structurally rather than by translated text, ignore fenced example content, and throw a typed empty-registry error. Existing command error handling will render that error as Chinese human guidance while preserving JSON envelope fields, IDs, enums, and exit codes.

**Tech Stack:** Node.js, TypeScript, Vitest 3, Commander CLI, pnpm, ESLint.

**Spec:** docs/superpowers/specs/2026-09-02-code-spec-runtime-hardening-design.md

## Global Constraints

- Do not restore spec-driven or legacy Change compatibility.
- Preserve MOD-###, CHG-YYYYMMDD-NNN, JSON field names, protocol enum values, and existing exit-code semantics.
- All new human-readable text is Chinese; command names, paths, IDs, YAML/JSON keys, and protocol tokens remain unchanged.
- Do not inject a fake MOD-001 into an initialized project.
- Do not modify version-check product logic to accommodate sandbox 127.0.0.1 restrictions.
- Do not use subagents; execute tasks inline.
- Do not include unrelated changes in commits. The 13 generated skills/**/SKILL.md files are managed output and belong only in the Skill-parity task.

---

## File Structure

| File | Responsibility |
| --- | --- |
| src/core/openspec-workflow/business-registry.ts | Structural table parsing and typed empty-registry error. |
| src/core/openspec-workflow/default-config.ts | Chinese empty-registry template and fenced non-data example. |
| src/commands/shared-output.ts | Maps the typed error to the existing diagnostic envelope. |
| test/core/openspec-workflow/loaders.test.ts | Header, fence, invalid-row, and empty-registry unit coverage. |
| test/core/openspec-default-config.test.ts | Template content and non-fake-module coverage. |
| test/cli-e2e/code-spec-empty-workspace.test.ts | Fresh init → status/validate lifecycle and no-side-effect regression. |
| test/** failing output suites | Exact Chinese human-output and code-spec default assertions. |
| skills/**/SKILL.md | Generated skills.sh distribution. |

### Task 1: Parse business tables structurally and expose the empty-registry domain error

**Files:**

- Modify: src/core/openspec-workflow/business-registry.ts:13-81
- Modify: test/core/openspec-workflow/loaders.test.ts

**Interfaces:**

- Produces: export class EmptyBusinessRegistryError extends Error with readonly code = 'empty_business_registry' and readonly businessPath: string.
- Produces: export function isEmptyBusinessRegistryError(error: unknown): error is EmptyBusinessRegistryError.
- Preserves: loadBusinessRegistry(paths): Promise<BusinessRegistry>, duplicate-ID detection, and parseBusinessModule validation.

- [ ] **Step 1: Write failing parser tests for Chinese, English, and custom headers.**

Add a table-driven test in test/core/openspec-workflow/loaders.test.ts that writes each header variant followed by the same separator and module row, then asserts the registry contains MOD-001.

~~~ts
for (const header of [
  '| 模块 ID | 模块名称 | 描述 | 职责 | 关键词 |',
  '| Module ID | Module Name | Description | Responsibilities | Keywords |',
  '| 域 | 名称 | 说明 | 工作 | 标签 |',
]) {
  await writeBusinessFile(fixture, [
    '# Business', '', header,
    '| --- | --- | --- | --- | --- |',
    '| MOD-001 | 账户 | 账户域 | 管理账户 | 账户 |',
  ].join('\n'));
  await expect(loadBusinessRegistry(fixture.paths)).resolves.toMatchObject({
    modules: [expect.objectContaining({ id: 'MOD-001' })],
  });
}
~~~

- [ ] **Step 2: Write failing empty-table, fenced-example, and malformed-data tests.**

Assert header-only content and a fenced MOD-001 example reject with EmptyBusinessRegistryError. Add a non-header row with MOD-01 and assert it still rejects with the existing module-ID validation message. This distinguishes non-data examples from invalid data.

- [ ] **Step 3: Run the unit file to prove the new tests fail.**

Run:

~~~bash
pnpm vitest run test/core/openspec-workflow/loaders.test.ts
~~~

Expected: FAIL because the current parser recognizes only Module ID, reads fenced examples as data, and throws a generic missing-registry error.

- [ ] **Step 4: Implement structural parsing and the typed error.**

Add this public contract:

~~~ts
export class EmptyBusinessRegistryError extends Error {
  readonly code = 'empty_business_registry';
  constructor(readonly businessPath: string) {
    super('尚未定义业务模块。请先在 ' + businessPath + ' 中至少添加一条以 MOD-### 开头的模块记录。');
    this.name = 'EmptyBusinessRegistryError';
  }
}

export function isEmptyBusinessRegistryError(error: unknown): error is EmptyBusinessRegistryError {
  return error instanceof EmptyBusinessRegistryError;
}
~~~

Split the document into lines, track fences beginning with three or more backticks, and skip all fenced content. Recognize a header only when a five-column row is immediately followed by a five-column Markdown separator row. Skip that pair regardless of its text. Parse every remaining five-column table row with parseBusinessModule, preserving strict diagnostics for malformed non-header data. Throw new EmptyBusinessRegistryError(paths.business) when no parsed modules remain.

- [ ] **Step 5: Verify the parser and commit.**

Run:

~~~bash
pnpm vitest run test/core/openspec-workflow/loaders.test.ts
pnpm exec tsc --noEmit
git add src/core/openspec-workflow/business-registry.ts test/core/openspec-workflow/loaders.test.ts
git commit -m "fix: parse code-spec business headers structurally"
~~~

Expected: both checks exit 0 before committing.

### Task 2: Make the empty-workspace prerequisite actionable from init and CLI commands

**Files:**

- Modify: src/core/openspec-workflow/default-config.ts:41-50
- Modify: src/commands/shared-output.ts:1-52
- Modify: test/core/openspec-default-config.test.ts
- Create: test/cli-e2e/code-spec-empty-workspace.test.ts

**Interfaces:**

- Consumes: EmptyBusinessRegistryError and isEmptyBusinessRegistryError from business-registry.ts.
- Produces: existing diagnostic envelopes with unchanged severity, fallback code, and JSON fields; only message and fix are Chinese and actionable.
- Preserves: failWithError payloads for status --all --json and validate --all --json.

- [ ] **Step 1: Write failing template and fresh-CLI lifecycle tests.**

In test/core/openspec-default-config.test.ts, assert renderBusinessTemplate() contains a Chinese prerequisite and fenced example, but no parseable module row outside the fence.

Create test/cli-e2e/code-spec-empty-workspace.test.ts. Initialize a temporary directory with init . --tools none --force --no-animation. Assert status --all and validate --all --strict --no-interactive exit 1, mention 尚未定义业务模块, openspec/business.md, and MOD-001, and leave changes/index.yaml as the sole change entry. Append one real module row and assert status --all --json plus validate --all --strict --no-interactive exit 0.

~~~ts
expect(status.exitCode).toBe(1);
expect(getOutput(status)).toContain('尚未定义业务模块');
expect(getOutput(status)).toContain('openspec/business.md');
expect(getOutput(status)).toContain('MOD-001');
expect(await fs.readdir(path.join(tempDir, 'openspec', 'changes'))).toEqual(['index.yaml']);
~~~

- [ ] **Step 2: Run the new tests to verify initial failure.**

~~~bash
pnpm vitest run test/core/openspec-default-config.test.ts test/cli-e2e/code-spec-empty-workspace.test.ts
~~~

Expected: FAIL because the template has no actionable example and the CLI only exposes generic or misclassified registry failure.

- [ ] **Step 3: Add Chinese prerequisite copy and diagnostic mapping.**

Update renderBusinessTemplate() with:

~~~md
在创建 Change 或执行状态、校验前，请先添加至少一个真实业务模块。

示例：
~~~markdown
| MOD-001 | 用户管理 | 管理用户账户 | 管理账户；认证 | 用户；账户 |
~~~
~~~

In src/commands/shared-output.ts, detect isEmptyBusinessRegistryError(error) before generic formatting. Keep the original fallback code and payload shape, but return a Chinese message and fix containing businessPath and the MOD-001 row. Do not change JSON field names or root/batch payload constants.

- [ ] **Step 4: Run regression and smoke the built CLI.**

~~~bash
pnpm run build
pnpm vitest run test/core/openspec-default-config.test.ts test/cli-e2e/code-spec-empty-workspace.test.ts test/commands/artifact-workflow.test.ts
~~~

In a disposable directory run init, status --all --json, and validate --all --strict --no-interactive. Expected: empty workspace fails nonzero with guidance and creates no Change; adding a module lets both commands exit 0.

- [ ] **Step 5: Commit the template and CLI change.**

~~~bash
git add src/core/openspec-workflow/default-config.ts src/commands/shared-output.ts test/core/openspec-default-config.test.ts test/cli-e2e/code-spec-empty-workspace.test.ts
git commit -m "fix: explain empty code-spec business registry"
~~~

### Task 3: Migrate the test baseline to Chinese human output and code-spec

**Files:**

- Modify: failing suites under test/cli-e2e/, test/commands/, and test/core/ reported by pnpm test.
- Modify: test/core/user-facing-messages.test.ts when a dedicated empty-registry formatter is introduced.

**Interfaces:**

- Produces: exact Chinese human-output assertions and code-spec default assertions.
- Preserves: JSON property names, IDs, command names, and enum values.

- [ ] **Step 1: Capture and group the post-Task-2 failures.**

~~~bash
VITEST_MAX_WORKERS=1 pnpm test
~~~

Group each failure as English human text, spec-driven default assumption, obsolete artifact/workflow name, generated Skill parity, version-check loopback listener, or a new functional defect. Do not edit test/core/version-check.test.ts.

- [ ] **Step 2: Update exact localized-output assertions.**

Replace every localization-only English assertion with the exact current Chinese output:

~~~ts
expect(output).toContain('OpenSpec 设置完成');
expect(output).toContain("未知条目 'does-not-exist'");
expect(output).toContain('健康检查');
expect(output).toContain('可用 Schema：');
~~~

Do not weaken assertions with toBeTruthy(), broad regexes, bilingual alternatives, or English fallbacks.

- [ ] **Step 3: Update default-schema and workflow-graph assertions.**

Change assertions expecting spec-driven, specs aliases, or obsolete default planning artifacts to canonical code-spec and proposal/design/spec/tasks. Leave explicitly selected custom-schema tests unchanged.

- [ ] **Step 4: Iterate affected suites, then verify every non-loopback test.**

~~~bash
VITEST_MAX_WORKERS=1 pnpm vitest run --exclude test/core/version-check.test.ts
~~~

Expected: exit 0. If a failure is not localization, canonical-default migration, generated-Skill parity, or loopback permission, stop and diagnose it before changing assertions.

- [ ] **Step 5: Commit the test baseline.**

~~~bash
git add test
git diff --cached --name-only
git commit -m "test: align assertions with Chinese code-spec UX"
~~~

Before committing, unstage any file unrelated to assertions or the new empty-workspace regression.

### Task 4: Regenerate the managed Skill distribution

**Files:**

- Modify: generator-owned skills/**/SKILL.md files.
- Test: test/core/templates/skillssh-parity.test.ts

**Interfaces:**

- Produces: committed skills.sh output exactly matching generateSkillContent().

- [ ] **Step 1: Prove parity detects drift, regenerate, and inspect ownership.**

~~~bash
pnpm vitest run test/core/templates/skillssh-parity.test.ts
pnpm run generate:skills
git status --short skills
git diff --check -- skills
~~~

Expected: the first command fails before generation if committed output is stale; generation changes only the 13 owned SKILL.md files; whitespace check is empty.

- [ ] **Step 2: Re-run parity and commit only generated output.**

~~~bash
pnpm vitest run test/core/templates/skillssh-parity.test.ts
git add skills
git commit -m "chore: regenerate localized OpenSpec skills"
~~~

Expected: parity exits 0 and the commit contains only skills/**/SKILL.md files.

### Task 5: Final verification and environment-separated reporting

**Files:** No production code changes expected.

- [ ] **Step 1: Run static, build, focused integration, and non-loopback full tests.**

~~~bash
pnpm exec tsc --noEmit
pnpm run lint
pnpm run build
pnpm vitest run test/core/openspec-workflow/loaders.test.ts test/core/openspec-default-config.test.ts test/cli-e2e/code-spec-empty-workspace.test.ts test/core/templates/skillssh-parity.test.ts
VITEST_MAX_WORKERS=1 pnpm vitest run --exclude test/core/version-check.test.ts
git diff --check
git status --short
~~~

Expected: every command exits 0; whitespace check is empty; status is empty after intended commits.

- [ ] **Step 2: Verify version checks where loopback listeners are allowed.**

Run outside the restricted sandbox:

~~~bash
VITEST_MAX_WORKERS=1 pnpm vitest run test/core/version-check.test.ts
~~~

Expected: exit 0 with no listen EPERM unhandled errors. Any product assertion failure is a new defect, not an environment exemption.

- [ ] **Step 3: Report evidence without release actions.**

Report commit IDs, exact command results, the loopback-environment result, and blockers. Do not push, publish, tag, or release.

