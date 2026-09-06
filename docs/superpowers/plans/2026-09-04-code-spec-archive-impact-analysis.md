# CodeSpec Archive Impact Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the default `code-spec` workflow require a traceable archive-impact decision, so changes that alter current requirements prove how they preserve, revise, or supersede existing behavior before they can be archived.

**Architecture:** Add one strict, machine-readable YAML block under `design.md`'s human-readable archive-impact section, parse it in a new focused Core module, and validate it against the Change delta and current module specs. Lifecycle, CLI validation, and archive preflight consume the same validator; only impact-bearing Changes require an `archive` regression command in fresh verification evidence. The archive transaction remains the sole writer of Current Specification and continues applying only `ADDED`, `MODIFIED`, and `REMOVED` deltas atomically.

**Tech Stack:** TypeScript, Node.js `fs/promises`, `yaml`, Vitest, pnpm, existing OpenSpec canonical workflow.

**Spec:** [`docs/superpowers/specs/2026-09-04-code-spec-archive-impact-analysis-design.md`](../specs/2026-09-04-code-spec-archive-impact-analysis-design.md)

## Global Constraints

- Apply this feature only when `WorkspaceConfig.schema === 'code-spec'`; `spec-driven` and custom schemas retain their current behavior.
- Never mutate `openspec/archive/changes/<CHG-ID>/`; new Changes evolve only `openspec/specs/<MOD-ID>/spec.md` through the archive transaction.
- An `ADDED` delta appends a new current Requirement; `MODIFIED` replaces a matching current Requirement block; `REMOVED` removes a matching current Requirement block.
- A `MODIFIED` or `REMOVED` delta whose `Previous` block differs from the current Requirement must fail with `ARCHIVE CONFLICT` before any write.
- Current Scenario ERROR validation, optimistic conflict detection, transaction rollback, and interactive archive confirmation remain mandatory.
- Preserve Chinese user-facing prose and English stable IDs / protocol tokens.

---

## File Structure

- Create: `src/core/openspec-workflow/archive-impact.ts` — parses the `design.md` YAML block and validates impact mappings against delta entries, current specs, tasks, and verification evidence.
- Create: `test/core/openspec-workflow/archive-impact.test.ts` — unit tests for the parser and the non-mutating mapping validator.
- Modify: `schemas/code-spec/templates/design.md` — supplies the required human-readable section and exact YAML contract.
- Modify: `src/core/openspec-workflow/gates.ts` — makes canonical gate validation asynchronous and invokes archive-impact validation at DESIGN, PLAN, VERIFY, and ARCHIVE boundaries.
- Modify: `src/core/openspec-workflow/state-machine.ts` — awaits the asynchronous entry gate before persisting a transition.
- Modify: `src/commands/validate.ts` and `src/commands/workflow/status.ts` — await the asynchronous gate so CLI `validate` and `status` report the new failures.
- Modify: `src/core/openspec-workflow/verification.ts` — adds `archive` as a verification command kind and requires a passing one for `outcome: affected`.
- Modify: `src/core/openspec-workflow/archive-transaction.ts` — runs the shared archive-impact/evidence validator during preflight and returns the approved mappings in `ArchiveResult`.
- Modify: `src/cli/index.ts` — prints the mappings in the non-JSON archive completion summary while preserving the complete JSON result.
- Modify: `src/core/templates/workflows/openspec-workflow.ts`, `src/core/templates/workflows/rebase-change.ts`, `src/core/templates/workflows/archive-change.ts`, `skills/openspec-workflow/SKILL.md`, `skills/openspec-rebase-change/SKILL.md`, and `skills/openspec-archive-change/SKILL.md` — tell agents when to inspect current requirements, refresh the block after rebase, add the archive regression command, and display mappings before confirmation.
- Modify: `test/core/openspec-workflow/state-machine.test.ts`, `test/core/openspec-workflow/archive-transaction.test.ts`, `test/core/openspec-workflow/templates.test.ts`, `test/core/templates/openspec-workflow.test.ts`, plus focused CLI/verification tests — cover the public workflow behavior.

## Archive-impact data contract

The required `design.md` section uses this exact fenced YAML payload. The prose before and after it remains for human explanation; Core reads only this block.

````markdown
## 归档影响分析

```yaml
outcome: none
references: []
verification: []
```
````

An affected Change uses explicit current-to-next mappings:

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

`modified` requires a `MODIFIED` delta for `current_requirement`; `superseded` requires a `REMOVED` delta for `current_requirement` plus an `ADDED` delta for `replacement_requirement`. Both IDs must exist in the referenced Current Specification or delta as appropriate. Every referenced current Requirement and Scenario must appear in `tasks.md`; `outcome: affected` requires one successful `archive` verification command. `outcome: none` requires empty `references` and `verification` arrays.

### Task 1: Define and parse the archive-impact contract

**Files:**
- Create: `src/core/openspec-workflow/archive-impact.ts`
- Create: `test/core/openspec-workflow/archive-impact.test.ts`
- Modify: `schemas/code-spec/templates/design.md`
- Modify: `test/core/openspec-workflow/templates.test.ts`

**Interfaces:**
- Produces: `parseArchiveImpact(design: string): ArchiveImpact`.
- Produces: `validateArchiveImpactShape(impact: ArchiveImpact, deltas: RequirementDelta[]): string[]`.
- Consumes later: `ArchiveImpact`, `ArchiveImpactReference`, `ArchiveImpactDisposition`, and the parser error messages.

- [ ] **Step 1: Write failing parser and template tests**

```ts
it('parses an affected mapping from the required design section', () => {
  const impact = parseArchiveImpact(designWithAffectedMapping);
  expect(impact).toEqual({
    outcome: 'affected',
    references: [{
      currentRequirement: 'MOD-001-REQ-010',
      currentScenario: 'SCN-010',
      disposition: 'modified',
      replacementRequirement: 'MOD-001-REQ-010',
      replacementScenario: 'SCN-021',
    }],
    verification: ['archive-regression'],
  });
});

it.each([
  ['missing section', '# Design\n'],
  ['missing YAML fence', '## 归档影响分析\n无影响'],
  ['none with references', impactYaml({ outcome: 'none', references: [reference], verification: [] })],
  ['affected without verification', impactYaml({ outcome: 'affected', references: [reference], verification: [] })],
])('rejects %s', (_label, design) => {
  expect(() => parseArchiveImpact(design)).toThrow(/归档影响分析/i);
});
```

Add a template assertion that `schemas/code-spec/templates/design.md` contains `## 归档影响分析`, `outcome: none`, `references: []`, and `verification: []`.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `pnpm exec vitest run test/core/openspec-workflow/archive-impact.test.ts test/core/openspec-workflow/templates.test.ts`

Expected: FAIL because `archive-impact.ts` and the required template section do not yet exist.

- [ ] **Step 3: Implement the strict parser and shape validator**

```ts
export type ArchiveImpactOutcome = 'none' | 'affected';
export type ArchiveImpactDisposition = 'modified' | 'superseded';

export interface ArchiveImpactReference {
  currentRequirement: RequirementId;
  currentScenario: ScenarioId;
  disposition: ArchiveImpactDisposition;
  replacementRequirement: RequirementId;
  replacementScenario: ScenarioId;
}

export interface ArchiveImpact {
  outcome: ArchiveImpactOutcome;
  references: ArchiveImpactReference[];
  verification: ['archive-regression'] | [];
}
```

Extract exactly one YAML fence immediately following the level-two `归档影响分析` heading. Parse it with `yaml.parse`, reject unknown keys and malformed IDs, and normalize no fields silently. `validateArchiveImpactShape` must require the delta action combinations stated in the data contract and reject duplicate current Requirement/Scenario pairs.

Replace `schemas/code-spec/templates/design.md` with the human-readable explanation plus the `outcome: none` block from the contract. Keep the existing Requirement mapping table and all protocol tokens intact.

- [ ] **Step 4: Run focused tests and type checking**

Run: `pnpm exec vitest run test/core/openspec-workflow/archive-impact.test.ts test/core/openspec-workflow/templates.test.ts && pnpm build`

Expected: PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add schemas/code-spec/templates/design.md src/core/openspec-workflow/archive-impact.ts test/core/openspec-workflow/archive-impact.test.ts test/core/openspec-workflow/templates.test.ts
git commit -m "feat: define archive impact contract"
```

### Task 2: Validate mappings against current specs and lifecycle transitions

**Files:**
- Modify: `src/core/openspec-workflow/archive-impact.ts`
- Modify: `src/core/openspec-workflow/gates.ts`
- Modify: `src/core/openspec-workflow/state-machine.ts`
- Modify: `src/commands/validate.ts`
- Modify: `src/commands/workflow/status.ts`
- Modify: `test/core/openspec-workflow/archive-impact.test.ts`
- Modify: `test/core/openspec-workflow/state-machine.test.ts`

**Interfaces:**
- Consumes: `validateArchiveImpactShape()` from Task 1, `parseDeltaSpec()`, and `parseCurrentSpec()`.
- Produces: `validateArchiveImpact(workspace: WorkspaceContext, artifacts: ChangeArtifacts): Promise<string[]>`.
- Changes: `validateExitGate()` and `validateEntryGate()` return `Promise<GateResult>`; all callers await them.

- [ ] **Step 1: Write failing lifecycle tests**

```ts
it('blocks DESIGN to PLAN when an affected mapping names a missing current scenario', async () => {
  await writeChangeArtifacts(fixture, {
    metadata: designMetadata,
    design: affectedDesign('MOD-001-REQ-010', 'SCN-999'),
    spec: modifiedDelta('MOD-001-REQ-010'),
  });
  await writeCurrentSpec(fixture, 'MOD-001', currentRequirement('MOD-001-REQ-010', 'SCN-010'));

  await expect(transitionChange(workspace, artifacts, 'PLAN', 'design complete'))
    .rejects.toThrow(/SCN-999.*Current Specification/i);
});

it('blocks a supersede mapping unless REMOVED old and ADDED replacement deltas are present', async () => {
  const errors = await validateArchiveImpact(workspace, artifactsWithSupersedeButNoRemoval);
  expect(errors.join('\n')).toMatch(/REMOVED.*MOD-001-REQ-010/i);
});

it('reports archive-impact errors through canonical validate and status', async () => {
  await expect(runCLI(['validate', fixture.changeId], { cwd: fixture.root })).resolves.toMatchObject({ exitCode: 1 });
  await expect(runCLI(['status', '--change', fixture.changeId, '--json'], { cwd: fixture.root }))
    .resolves.toHaveProperty('stdout', expect.stringContaining('归档影响分析'));
});
```

- [ ] **Step 2: Run the lifecycle tests and verify failure**

Run: `pnpm exec vitest run test/core/openspec-workflow/archive-impact.test.ts test/core/openspec-workflow/state-machine.test.ts`

Expected: FAIL because lifecycle gates neither read current specs nor validate the design mapping.

- [ ] **Step 3: Implement current-spec resolution and async gates**

In `validateArchiveImpact`, read only the confirmed modules' `workspace.paths.currentSpecs/<module>/spec.md`; treat a missing file, Requirement, or Scenario referenced by an affected mapping as an error. Use `parseCurrentSpec()` rather than regex extraction. Verify that every impacted current ID appears in `artifacts.tasks`, and verify `modified` / `superseded` delta alignment with `parseDeltaSpec()`.

Convert `validateState`, `validateExitGate`, and `validateEntryGate` to `async`. Run the archive-impact validator when the current schema is `code-spec` and the current or requested state is `DESIGN`, `PLAN`, `VERIFY`, or `ARCHIVE`; leave all legacy-schema code paths untouched. Await the new gate functions in `transitionChange`, the canonical `validate` single/bulk paths, and canonical `workflow status`.

- [ ] **Step 4: Run focused lifecycle and command tests**

Run: `pnpm exec vitest run test/core/openspec-workflow/archive-impact.test.ts test/core/openspec-workflow/state-machine.test.ts test/commands/validate-code-spec.test.ts test/commands/status-all.test.ts`

Expected: PASS, including a `DESIGN -> PLAN` rejection for missing current requirements or scenarios.

- [ ] **Step 5: Commit lifecycle enforcement**

```bash
git add src/core/openspec-workflow/archive-impact.ts src/core/openspec-workflow/gates.ts src/core/openspec-workflow/state-machine.ts src/commands/validate.ts src/commands/workflow/status.ts test/core/openspec-workflow/archive-impact.test.ts test/core/openspec-workflow/state-machine.test.ts test/commands/validate-code-spec.test.ts test/commands/status-all.test.ts
git commit -m "feat: enforce archive impact lifecycle checks"
```

### Task 3: Require archive regression evidence and enforce it in preflight

**Files:**
- Modify: `src/core/openspec-workflow/archive-impact.ts`
- Modify: `src/core/openspec-workflow/verification.ts`
- Modify: `src/core/openspec-workflow/archive-transaction.ts`
- Modify: `src/cli/index.ts`
- Modify: `test/core/openspec-workflow/archive-impact.test.ts`
- Modify: `test/core/openspec-workflow/archive-transaction.test.ts`
- Modify: `test/core/openspec-workflow/verification.test.ts`

**Interfaces:**
- Changes: `VerificationKind` includes `'archive'`.
- Produces: `validateArchiveImpactEvidence(impact, evidence): string[]`.
- Changes: `ArchiveResult` adds `archiveImpact: ArchiveImpactReference[]`.

- [ ] **Step 1: Write failing verification and archive-preflight tests**

```ts
it('rejects affected Change verification without a passing archive command', async () => {
  await expect(recordFreshVerification(workspace, changeId, standardCommands))
    .rejects.toThrow(/archive.*archive-regression/i);
});

it('archives an affected Change only when archive evidence and mappings are present', async () => {
  const result = await archiveChange(workspace, changeId);
  expect(result.archiveImpact).toEqual([expectedSupersedeReference]);
  await expect(readCurrentSpec('MOD-001')).resolves.not.toContain('MOD-001-REQ-010');
  await expect(readCurrentSpec('MOD-001')).resolves.toContain('MOD-001-REQ-012');
  await expect(readArchivedChange(oldChangeId)).resolves.toContain('MOD-001-REQ-010');
});

it('leaves current specs and archived changes untouched after failed impact preflight', async () => {
  await expect(archiveChange(workspace, changeId)).rejects.toThrow(/archive-regression/i);
  await expect(readCurrentSpec('MOD-001')).resolves.toBe(beforeCurrent);
  await expect(pathExists(oldArchivedChange)).resolves.toBe(true);
});
```

- [ ] **Step 2: Run the archive tests and verify failure**

Run: `pnpm exec vitest run test/core/openspec-workflow/verification.test.ts test/core/openspec-workflow/archive-transaction.test.ts test/core/openspec-workflow/archive-impact.test.ts`

Expected: FAIL because verification has no `archive` kind and preflight does not inspect impact evidence.

- [ ] **Step 3: Implement evidence and preflight enforcement**

Extend `VerificationKind` with `archive`; keep its Markdown rendering and signed YAML receipt behavior unchanged. Before publishing PASS evidence, parse the impact block and require exactly one passing command where `kind === 'archive'` when `outcome === 'affected'`; require that command to list the mapping's current and replacement Requirement/Scenario IDs in its supplied coverage arrays.

Make `ensureArchiveGates` asynchronous, parse the signed verification document, invoke `validateArchiveImpactEvidence`, and invoke `validateArchiveImpact` before `preflightArchive` creates its snapshot. Add the parsed mappings to `ArchivePlan` and return them in `ArchiveResult`. In `src/cli/index.ts`, print one indented line per mapping after `已归档`, for example `MOD-001-REQ-010/SCN-010 → MOD-001-REQ-012/SCN-022 (superseded)`; retain raw `ArchiveResult` for `--json`.

- [ ] **Step 4: Run focused archive tests**

Run: `pnpm exec vitest run test/core/openspec-workflow/verification.test.ts test/core/openspec-workflow/archive-transaction.test.ts test/core/openspec-workflow/archive-impact.test.ts`

Expected: PASS. Confirm failed preflight makes no Current Specification or archive-history write.

- [ ] **Step 5: Commit archive evidence enforcement**

```bash
git add src/core/openspec-workflow/archive-impact.ts src/core/openspec-workflow/verification.ts src/core/openspec-workflow/archive-transaction.ts src/cli/index.ts test/core/openspec-workflow/archive-impact.test.ts test/core/openspec-workflow/archive-transaction.test.ts test/core/openspec-workflow/verification.test.ts
git commit -m "feat: require archive impact regression evidence"
```

### Task 4: Teach the three public workflow surfaces and regenerate skills

**Files:**
- Modify: `src/core/templates/workflows/openspec-workflow.ts`
- Modify: `src/core/templates/workflows/rebase-change.ts`
- Modify: `src/core/templates/workflows/archive-change.ts`
- Modify: `skills/openspec-workflow/SKILL.md`
- Modify: `skills/openspec-rebase-change/SKILL.md`
- Modify: `skills/openspec-archive-change/SKILL.md`
- Modify: `docs/opsx.md`
- Modify: `docs/reviewing-changes.md`
- Modify: `test/core/openspec-workflow/templates.test.ts`
- Modify: `test/core/templates/openspec-workflow.test.ts`

**Interfaces:**
- Consumes: the exact section heading `归档影响分析`, outcome tokens `none` / `affected`, and command kind `archive` from earlier tasks.
- Produces: generated skills and commands that direct the agent to query existing Current Specification only while designing an affected change, refresh that assessment after semantic rebase, and display mappings before human archive confirmation.

- [ ] **Step 1: Write failing generated-guidance tests**

```ts
it('teaches code-spec workflow to analyze archive impact before PLAN', () => {
  const instructions = getOpenSpecWorkflowSkillTemplate().instructions;
  expect(instructions).toContain('归档影响分析');
  expect(instructions).toContain('Current Specification');
  expect(instructions).toContain('archive-regression');
});

it('teaches archive confirmation to show supersede mappings without editing history', () => {
  const instructions = getArchiveChangeSkillTemplate().instructions;
  expect(instructions).toContain('superseded');
  expect(instructions).toContain('不可变历史');
  expect(instructions).toContain('人工确认');
});
```

- [ ] **Step 2: Run guidance tests and verify failure**

Run: `pnpm exec vitest run test/core/openspec-workflow/templates.test.ts test/core/templates/openspec-workflow.test.ts`

Expected: FAIL because public instructions do not mention the archive-impact contract.

- [ ] **Step 3: Update instructions, docs, and generated skill files**

Add design-stage guidance that a Change affecting current requirements must inspect only the relevant `openspec/specs/<MOD-ID>/spec.md`, write the YAML block, and choose `none`, `modified`, or `superseded`. State explicitly that historical Changes under `openspec/archive/changes/` are never edited. Add archive-stage guidance to show the mappings and archive-regression evidence before the existing interactive confirmation.

Add rebase guidance stating that semantic rebase returns a Change to DESIGN and invalidates its earlier archive-impact conclusion; the resumed `openspec-workflow` pass must refresh the YAML block against the newly captured Current Specification before it can transition to PLAN.

Update `docs/opsx.md` and `docs/reviewing-changes.md` with the three user cases: compatible new requirement, partial revision, and complete replacement. Run `pnpm run generate:skills`; inspect the generated `skills/` diffs and retain only the two public Skill changes driven by the updated templates.

- [ ] **Step 4: Run guidance tests and generation parity checks**

Run: `pnpm exec vitest run test/core/openspec-workflow/templates.test.ts test/core/templates/openspec-workflow.test.ts && pnpm run generate:skills && git diff --check`

Expected: PASS; generated skill text matches the updated source templates and contains no duplicate Store guidance.

- [ ] **Step 5: Commit workflow guidance**

```bash
git add src/core/templates/workflows/openspec-workflow.ts src/core/templates/workflows/rebase-change.ts src/core/templates/workflows/archive-change.ts skills/openspec-workflow/SKILL.md skills/openspec-rebase-change/SKILL.md skills/openspec-archive-change/SKILL.md docs/opsx.md docs/reviewing-changes.md test/core/openspec-workflow/templates.test.ts test/core/templates/openspec-workflow.test.ts
git commit -m "docs: guide archive impact analysis workflow"
```

### Task 5: Run full verification and review the change boundary

**Files:**
- No planned source edits; this task validates Tasks 1–4 without staging unrelated worktree changes.

**Interfaces:**
- Consumes: all completed implementation tasks.
- Produces: verified build, lint, focused behavior coverage, and an unchanged legacy-schema behavior check.

- [ ] **Step 1: Run the complete test suite**

Run: `pnpm test`

Expected: PASS with all existing tests and the new archive-impact coverage.

- [ ] **Step 2: Run static validation**

Run: `pnpm run lint && pnpm build && git diff --check`

Expected: all commands exit 0 and TypeScript emits `dist/` without errors.

- [ ] **Step 3: Verify legacy schema isolation**

Run: `pnpm exec vitest run test/commands/artifact-workflow.test.ts test/core/artifact-graph/workflow.integration.test.ts`

Expected: PASS; `spec-driven` fixtures are not required to contain the `归档影响分析` section.

- [ ] **Step 4: Inspect the implementation diff**

Run: `git diff --check HEAD~4..HEAD && git status --short`

Expected: no whitespace errors; only intended source, schema/template, generated skill, documentation, and test changes are present.
