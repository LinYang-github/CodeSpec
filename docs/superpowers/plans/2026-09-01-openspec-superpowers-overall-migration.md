# OpenSpec + Superpowers Overall Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current slug-based code-spec Change workflow with the multi-Change OpenSpec + Superpowers protocol, including stable Requirement identity, lifecycle gates, fresh verification, STALE/Rebase, and transactional archive.

**Architecture:** Add a focused `src/core/openspec-workflow/` domain layer that owns the new YAML/Markdown contracts and lifecycle operations. Existing generic artifact-graph infrastructure remains available for non-code-spec schemas, while the code-spec commands and generated skills route through the new domain layer and reject legacy `.openspec.yaml` Changes. Archive uses a read/validate/prepare/stage/commit pipeline so no current specification is changed until every delta and gate passes.

**Tech Stack:** TypeScript ESM, Node.js >=20.19.0, Zod, YAML, Commander.js, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-01-openspec-superpowers-overall-migration-design.md`

## Global Constraints

- This is an intentional breaking migration: old slug-based Changes and `.openspec.yaml` metadata are unsupported by the new code-spec workflow.
- `openspec/business.md` is the stable module registry; `openspec/archive/specs` is the current specification; `openspec/archive/changes` is immutable Change history.
- `changes/index.yaml` is navigation only; `changes/<CHG-ID>/metadata.yaml` is the status authority.
- Change IDs use `CHG-YYYYMMDD-NNN`; Requirement IDs use `MOD-###-REQ-###`; IDs are never renumbered or version-suffixed.
- Lifecycle states are `ANALYZE`, `DESIGN`, `PLAN`, `IMPLEMENT`, `VERIFY`, `ARCHIVE`, `ARCHIVED`, and `ABANDONED`.
- Change modes are `feature`, `bugfix`, and `refactor`; module outcomes are `OWNED`, `DEPENDENCY`, and `IRRELEVANT`.
- Delta tokens are `ADDED`, `MODIFIED`, `REMOVED`, `Previous`, `New`, `Reason`, `GIVEN`, `WHEN`, and `THEN`.
- `R(metadata) = R(design) = R(spec)` and `R(spec) ⊆ R(tasks)` must hold before PLAN or ARCHIVE.
- ADDED requires an unused Requirement ID; MODIFIED and REMOVED require `Current == Previous`.
- Archive must validate all inputs before writing any current spec, index, or history file.
- Every path is built with Node's `path` module and every filesystem test uses platform-safe path construction.
- Superpowers methodology is reused through context injection and artifact routing; no replacement TDD, debugging, verification, review, or branch-finishing method is implemented.
- Do not stage or overwrite unrelated pre-existing worktree changes.

## File Map

Create the new domain layer in `src/core/openspec-workflow/` with one responsibility per file: contracts, loaders, Change management, state gates, Requirement parsing, traceability, verification, stale detection, rebase, and archive transaction. Add focused tests in `test/core/openspec-workflow/`. Update `src/commands/workflow/*`, `src/cli/index.ts`, `schemas/code-spec/*`, generated `skills/openspec-*/SKILL.md`, and user documentation only where the new code-spec workflow requires it. Keep the generic `src/core/artifact-graph/*` implementation unchanged unless a code-spec adapter explicitly needs a small shared hook.

---

### Task 1: Define the canonical code-spec contracts

**Files:**
- Create: `src/core/openspec-workflow/types.ts`
- Create: `src/core/openspec-workflow/schemas.ts`
- Create: `src/core/openspec-workflow/paths.ts`
- Create: `test/helpers/openspec-workflow.ts`
- Test: `test/core/openspec-workflow/contracts.test.ts`

**Interfaces:**
- `WorkspaceConfig`, `BusinessModule`, `ChangeMetadata`, `ChangeIndexEntry`, `RequirementRef`, `RequirementDelta`, `Scenario`, and `ArchivePlan` are exported from `types.ts`.
- `parseWorkspaceConfig`, `parseBusinessModule`, `parseChangeMetadata`, `parseChangeIndexEntry`, and `parseRequirementDelta` are exported from `schemas.ts`.
- `getWorkspacePaths(openspecDir, config)` returns absolute paths for `business`, `changes`, `changeIndex`, `archive`, `currentSpecs`, and `archivedChanges`.
- `createWorkflowFixture()` in `test/helpers/openspec-workflow.ts` returns `{ tempDir, openspecDir, paths, workspace, changeId, latestSpecs, metadataAt, cleanup }`; `writeBusinessFile`, `writeCurrentRequirement`, `writeActiveReservation`, `writeDelta`, and `readCurrentRequirement` are exported helpers, and each test registers `cleanup` with `afterEach`.

Each test snippet that uses `fixture`, `paths`, or `workspace` begins with `const fixture = await createWorkflowFixture(); const { paths, workspace } = fixture;` and registers `afterEach(fixture.cleanup)`.

- [ ] **Step 1: Write failing contract tests**

```ts
it('accepts the canonical workspace config and resolves configured paths', () => {
  const config = parseWorkspaceConfig({
    version: 1,
    project: { name: 'demo' },
    paths: { business: 'business.md', changes: 'changes', change_index: 'changes/index.yaml', archive: 'archive', specs: 'archive/specs', archived_changes: 'archive/changes' },
    workflow: { multiple_active_changes: true },
    requirements: { id_format: '{module}-REQ-{sequence:03d}' },
    changes: { id_format: 'CHG-{date}-{sequence:03d}' },
    archive: { update_index: true, require_verification: true, conflict_strategy: 'optimistic' },
  });
  expect(getWorkspacePaths('/tmp/project/openspec', config).currentSpecs).toBe(
    path.join('/tmp/project/openspec', 'archive', 'specs')
  );
});

it('rejects a legacy .openspec.yaml-shaped metadata object', () => {
  expect(() => parseChangeMetadata({ schema: 'code-spec' })).toThrow(/change\.id|metadata/i);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run test/core/openspec-workflow/contracts.test.ts`

Expected: FAIL because the new domain modules do not exist.

- [ ] **Step 3: Implement the minimal schemas and path resolver**

Use Zod object schemas with strict enum validation for state, mode, relation arrays, task statuses, and archive flags. `getWorkspacePaths` must resolve every configured relative path under `openspecDir` and reject absolute paths, `..`, and null bytes.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm exec vitest run test/core/openspec-workflow/contracts.test.ts`

Expected: PASS with no warnings.

- [ ] **Step 5: Commit only Task 1 files**

```bash
git add src/core/openspec-workflow/types.ts src/core/openspec-workflow/schemas.ts src/core/openspec-workflow/paths.ts test/core/openspec-workflow/contracts.test.ts
git commit -m "feat: define openspec workflow contracts"
```

### Task 2: Load the workspace, module registry, Change index, and artifacts

**Files:**
- Create: `src/core/openspec-workflow/loaders.ts`
- Create: `src/core/openspec-workflow/business-registry.ts`
- Create: `src/core/openspec-workflow/change-index.ts`
- Create: `src/core/openspec-workflow/artifacts.ts`
- Modify: `src/core/project-config.ts`
- Modify: `src/core/init.ts`
- Test: `test/core/openspec-workflow/loaders.test.ts`
- Test: `test/core/init.test.ts`

**Interfaces:**
- `loadWorkspace(openspecDir): Promise<WorkspaceContext>` reads config first and then resolves all configured paths.
- `loadBusinessRegistry(paths): Promise<BusinessRegistry>` parses stable `MOD-###` rows, responsibilities, and keywords.
- `loadChangeIndex(paths): Promise<ChangeIndex>` reads navigation entries but never treats the index as status authority.
- `loadChangeArtifacts(paths, changeId): Promise<ChangeArtifacts>` reads metadata, proposal, design, spec, tasks, and verification for one canonical Change.
- `initializeCodeSpecWorkspace(projectRoot): Promise<void>` creates the canonical directories and default files without deleting legacy files.

- [ ] **Step 1: Write failing loader tests**

```ts
it('loads configured paths before reading business and change data', async () => {
  const workspace = await loadWorkspace(openspecDir);
  expect(workspace.paths.changeIndex).toBe(path.join(openspecDir, 'changes', 'index.yaml'));
  expect(workspace.registry.modules.map(module => module.id)).toEqual(['MOD-001']);
});

it('rejects duplicate or unstable module IDs', async () => {
  await writeBusinessFile('| MOD-001 | 用户管理 |\n| MOD-001 | 订单管理 |\n');
  await expect(loadBusinessRegistry(paths)).rejects.toThrow(/duplicate.*MOD-001/i);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm exec vitest run test/core/openspec-workflow/loaders.test.ts test/core/init.test.ts -t "canonical|module|duplicate"`

Expected: FAIL because canonical loaders and initialization do not exist.

- [ ] **Step 3: Implement loaders and canonical initialization**

Read `config.yaml` before resolving any configured path. Parse `business.md` with explicit module-row lookup, preserve IDs on display-name changes, reject duplicate IDs/names, and emit a clear missing-registry error. Reject a directory containing only legacy `.openspec.yaml` Changes as unsupported when loading code-spec Changes.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm exec vitest run test/core/openspec-workflow/loaders.test.ts test/core/init.test.ts -t "canonical|module|duplicate"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/openspec-workflow/loaders.ts src/core/openspec-workflow/business-registry.ts src/core/openspec-workflow/change-index.ts src/core/openspec-workflow/artifacts.ts src/core/project-config.ts src/core/init.ts test/core/openspec-workflow/loaders.test.ts test/core/init.test.ts
git commit -m "feat: load canonical openspec workspace"
```

### Task 3: Implement Change IDs, creation, deterministic resolution, and resume

**Files:**
- Create: `src/core/openspec-workflow/change-manager.ts`
- Create: `src/core/openspec-workflow/change-resolver.ts`
- Modify: `src/commands/workflow/new-change.ts`
- Modify: `src/commands/workflow/shared.ts`
- Modify: `src/cli/index.ts`
- Test: `test/core/openspec-workflow/change-manager.test.ts`
- Test: `test/commands/artifact-workflow.test.ts`

**Interfaces:**
- `allocateChangeId(paths, date)` scans active and archived Change directories and returns the next globally unique `CHG-YYYYMMDD-NNN`.
- `createCanonicalChange(workspace, input)` creates `metadata.yaml`, `proposal.md`, `design.md`, `spec.md`, `tasks.md`, and `verification.md` with status `ANALYZE`.
- `resolveChange(workspace, selector)` applies explicit ID, bound context, unique semantic match, sole active Change, then explicit ambiguity error.
- `resumeChange(workspace, selector)` reloads metadata and returns a `STALE` diagnostic before any IMPLEMENT or ARCHIVE action.

- [ ] **Step 1: Write failing ID and resolver tests**

```ts
it('allocates the next Change sequence across active and archived Changes', async () => {
  const fixture = await createWorkflowFixture();
  const { paths } = fixture;
  await fs.mkdir(path.join(paths.changes, 'CHG-20260901-001'), { recursive: true });
  await fs.mkdir(path.join(paths.archivedChanges, 'CHG-20260901-002'), { recursive: true });
  await expect(allocateChangeId(paths, '20260901')).resolves.toBe('CHG-20260901-003');
});

it('does not guess when semantic resolution has multiple candidates', async () => {
  const fixture = await createWorkflowFixture();
  const { workspace } = fixture;
  await expect(resolveChange(workspace, { text: '继续订单' })).rejects.toThrow(/multiple.*Change|选择/i);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm exec vitest run test/core/openspec-workflow/change-manager.test.ts test/commands/artifact-workflow.test.ts -t "allocates|guess|Change"`

Expected: FAIL because the canonical ID and resolver are absent.

- [ ] **Step 3: Implement canonical Change management**

Use the local timezone date formatter already used by the CLI. Reject user-supplied slug IDs for code-spec creation, update `changes/index.yaml` as navigation, and write `metadata.yaml` as the only status authority. Replace `--schema` and `.openspec.yaml` creation in the code-spec path; do not add a legacy fallback.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm exec vitest run test/core/openspec-workflow/change-manager.test.ts test/commands/artifact-workflow.test.ts -t "allocates|guess|Change"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/openspec-workflow/change-manager.ts src/core/openspec-workflow/change-resolver.ts src/commands/workflow/new-change.ts src/commands/workflow/shared.ts src/cli/index.ts test/core/openspec-workflow/change-manager.test.ts test/commands/artifact-workflow.test.ts
git commit -m "feat: migrate code-spec changes to canonical IDs"
```

### Task 4: Add lifecycle state machine, gates, revisions, and relations

**Files:**
- Create: `src/core/openspec-workflow/state-machine.ts`
- Create: `src/core/openspec-workflow/gates.ts`
- Create: `src/core/openspec-workflow/relations.ts`
- Modify: `src/commands/workflow/status.ts`
- Modify: `src/commands/workflow/instructions.ts`
- Test: `test/core/openspec-workflow/state-machine.test.ts`
- Test: `test/commands/artifact-workflow.test.ts`

**Interfaces:**
- `canTransition(from, to): boolean` implements the exact lifecycle graph.
- `transitionChange(metadata, target, reason): ChangeMetadata` updates state and timestamp only when the edge and entry gate are valid.
- `incrementRevision(metadata, reason): ChangeMetadata` increments only for approved semantic Requirement/Scope changes or VERIFY → DESIGN.
- `validateEntryGate(workspace, artifacts, target): GateResult` and `validateExitGate(workspace, artifacts, target): GateResult` return structured blocking diagnostics.
- `validateRelations(workspace, metadata): Promise<void>` rejects cycles, unmet archive dependencies, and invalid relation IDs.

- [ ] **Step 1: Write failing state tests**

```ts
it('allows VERIFY to return to IMPLEMENT for an implementation failure', () => {
  expect(canTransition('VERIFY', 'IMPLEMENT')).toBe(true);
});

it('rejects VERIFY to IMPLEMENT when the supplied reason is a spec/design error', async () => {
  const fixture = await createWorkflowFixture();
  expect(() => transitionChange(fixture.metadataAt('VERIFY'), 'IMPLEMENT', 'spec error')).toThrow(/DESIGN/i);
});
```

The shared fixture's `metadataAt(status)` returns a complete valid `ChangeMetadata` object with empty relations, modules, Requirements, Tasks, Verification, and Archive sections, so the test exercises the state machine rather than YAML parsing.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run test/core/openspec-workflow/state-machine.test.ts`

Expected: FAIL because the new lifecycle module is absent.

- [ ] **Step 3: Implement state, gates, revisions, and relations**

Require proposal summary/goals/scope/modules before ANALYZE exit, confirmed module and Requirement consistency before DESIGN exit, concrete task graph before PLAN exit, all tasks DONE before IMPLEMENT exit, and fresh Requirement/test/build/lint evidence before VERIFY exit. Preserve Revision IDs across a Change and do not create a new Change for a same-goal revision.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm exec vitest run test/core/openspec-workflow/state-machine.test.ts test/commands/artifact-workflow.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/openspec-workflow/state-machine.ts src/core/openspec-workflow/gates.ts src/core/openspec-workflow/relations.ts src/commands/workflow/status.ts src/commands/workflow/instructions.ts test/core/openspec-workflow/state-machine.test.ts test/commands/artifact-workflow.test.ts
git commit -m "feat: enforce openspec change lifecycle gates"
```

### Task 5: Parse modules, Requirement deltas, scenarios, and traceability

**Files:**
- Create: `src/core/openspec-workflow/module-resolver.ts`
- Create: `src/core/openspec-workflow/requirement-allocator.ts`
- Create: `src/core/openspec-workflow/delta-parser.ts`
- Create: `src/core/openspec-workflow/traceability.ts`
- Modify: `src/core/validation/validator.ts`
- Test: `test/core/openspec-workflow/module-resolver.test.ts`
- Test: `test/core/openspec-workflow/delta-parser.test.ts`
- Test: `test/core/openspec-workflow/traceability.test.ts`

**Interfaces:**
- `resolveModuleOwnership(registry, candidates, specs): ModuleResolution` classifies every candidate as `OWNED`, `DEPENDENCY`, or `IRRELEVANT`.
- `allocateRequirementIds(workspace, moduleId, count): string[]` considers current specs and all active reservations before allocating.
- `parseDeltaSpec(content): ParsedDeltaSpec` returns ADDED/MODIFIED/REMOVED entries with IDs, Previous/New/Reason, and GIVEN/WHEN/THEN scenarios.
- `validateTraceability(artifacts): TraceabilityResult` enforces metadata/design/spec equality and spec-to-task coverage.

- [ ] **Step 1: Write failing parser and reservation tests**

```ts
it('allocates a new Requirement after active reservations', async () => {
  await writeCurrentRequirement('MOD-002-REQ-016');
  await writeActiveReservation('MOD-002-REQ-017');
  await expect(allocateRequirementIds(workspace, 'MOD-002', 1)).resolves.toEqual(['MOD-002-REQ-018']);
});

it('requires Previous for MODIFIED and REMOVED entries', () => {
  expect(() => parseDeltaSpec('## MODIFIED\n### MOD-002-REQ-006 订单取消\n**New**\n...')).toThrow(/Previous/i);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run test/core/openspec-workflow/module-resolver.test.ts test/core/openspec-workflow/delta-parser.test.ts test/core/openspec-workflow/traceability.test.ts`

Expected: FAIL because the parser, allocator, and traceability validator are absent.

- [ ] **Step 3: Implement the Requirement pipeline**

Parse only the canonical DSL. Preserve full Previous blocks for MODIFIED and REMOVED. Match Requirements by stable ID, not display name. Allocate IDs in the fixed order `Requirement Impact → Module Ownership → Allocate IDs → metadata.yaml → design.md → spec.md`, and reject changed Requirements without at least one Task.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm exec vitest run test/core/openspec-workflow/module-resolver.test.ts test/core/openspec-workflow/delta-parser.test.ts test/core/openspec-workflow/traceability.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/openspec-workflow/module-resolver.ts src/core/openspec-workflow/requirement-allocator.ts src/core/openspec-workflow/delta-parser.ts src/core/openspec-workflow/traceability.ts src/core/validation/validator.ts test/core/openspec-workflow/module-resolver.test.ts test/core/openspec-workflow/delta-parser.test.ts test/core/openspec-workflow/traceability.test.ts
git commit -m "feat: add requirement allocation and traceability"
```

### Task 6: Implement fresh verification, baseline capture, STALE detection, and semantic Rebase

**Files:**
- Create: `src/core/openspec-workflow/verification.ts`
- Create: `src/core/openspec-workflow/baseline.ts`
- Create: `src/core/openspec-workflow/stale.ts`
- Create: `src/core/openspec-workflow/rebase.ts`
- Modify: `src/commands/workflow/instructions.ts`
- Modify: `src/cli/index.ts`
- Test: `test/core/openspec-workflow/verification.test.ts`
- Test: `test/core/openspec-workflow/stale-rebase.test.ts`

**Interfaces:**
- `recordFreshVerification(workspace, changeId, commands): Promise<VerificationEvidence>` stores exit status, output summary, timestamp, and covered Requirement/Scenario IDs.
- `captureBaseline(workspace, metadata): Promise<Baseline>` records current Change references for confirmed modules and affected Requirements.
- `detectStaleChanges(workspace, archivedRequirementIds): Promise<string[]>` marks only overlapping active Changes stale.
- `rebaseChange(workspace, changeId, currentSpecs): Promise<ChangeMetadata>` semantically re-evaluates the original goal, increments revision, refreshes artifacts/baseline, and returns status `DESIGN`.

- [ ] **Step 1: Write failing verification and stale/rebase tests**

```ts
it('marks only a Requirement-overlapping Change stale after archive', async () => {
  const fixture = await createWorkflowFixture();
  const { workspace } = fixture;
  const affected = await detectStaleChanges(workspace, ['MOD-002-REQ-006']);
  expect(affected).toEqual(['CHG-20260901-002']);
});

it('increments revision and returns a stale Change to DESIGN after semantic rebase', async () => {
  const fixture = await createWorkflowFixture();
  const { workspace } = fixture;
  const result = await rebaseChange(workspace, 'CHG-20260901-002', fixture.latestSpecs);
  expect(result.change.revision).toBe(2);
  expect(result.change.status).toBe('DESIGN');
  expect(result.baseline.stale).toBe(false);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run test/core/openspec-workflow/verification.test.ts test/core/openspec-workflow/stale-rebase.test.ts`

Expected: FAIL because fresh evidence, stale detection, and Rebase are absent.

- [ ] **Step 3: Implement evidence and baseline behavior**

Run required commands from the current implementation, reject pre-change or missing evidence, and serialize evidence in `verification.md`. Compare Requirement IDs and baseline references, not module names alone. Rebase must reload Current Specifications and rewrite affected artifacts through the existing authoring path rather than string-replacing Previous values.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm exec vitest run test/core/openspec-workflow/verification.test.ts test/core/openspec-workflow/stale-rebase.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/openspec-workflow/verification.ts src/core/openspec-workflow/baseline.ts src/core/openspec-workflow/stale.ts src/core/openspec-workflow/rebase.ts src/commands/workflow/instructions.ts src/cli/index.ts test/core/openspec-workflow/verification.test.ts test/core/openspec-workflow/stale-rebase.test.ts
git commit -m "feat: add fresh verification and stale rebase flow"
```

### Task 7: Replace code-spec archive with optimistic, transactional Delta Apply

**Files:**
- Create: `src/core/openspec-workflow/archive-transaction.ts`
- Modify: `src/core/archive.ts`
- Modify: `src/cli/index.ts`
- Modify: `src/core/business-archive.ts`
- Test: `test/core/openspec-workflow/archive-transaction.test.ts`
- Test: `test/core/archive.test.ts`

**Interfaces:**
- `preflightArchive(workspace, changeId): Promise<ArchivePlan>` checks state, ready flag, Requirements, Tasks, fresh Verification, dependencies, baseline, and parsability without writing.
- `prepareArchive(plan): Promise<PreparedArchive>` applies ADDED/MODIFIED/REMOVED to in-memory current specs and validates the result.
- `commitArchive(prepared): Promise<ArchiveResult>` stages every file, atomically swaps current specs/index/history, and runs post-archive stale detection.
- `archiveChange(workspace, changeId): Promise<ArchiveResult>` composes preflight, prepare, and commit.

- [ ] **Step 1: Write failing transaction and conflict tests**

```ts
it('rejects a MODIFIED delta when Current differs from Previous without changing files', async () => {
  await writeCurrentRequirement('MOD-002-REQ-006', 'B');
  await writeDelta('MOD-002-REQ-006', { previous: 'A', next: 'C' });
  await expect(archiveChange(workspace, changeId)).rejects.toThrow(/ARCHIVE CONFLICT/i);
  await expect(readCurrentRequirement('MOD-002-REQ-006')).resolves.toContain('B');
});

it('does not leave a partial archive when a second module fails validation', async () => {
  await expect(archiveChange(workspace, changeId)).rejects.toThrow(/conflict|rollback/i);
  await expect(fs.access(path.join(paths.currentSpecs, 'MOD-001', 'spec.md'))).resolves.not.toThrow();
  await expect(fs.access(path.join(paths.currentSpecs, 'MOD-002', 'spec.md'))).resolves.not.toThrow();
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run test/core/openspec-workflow/archive-transaction.test.ts`

Expected: FAIL because the new archive transaction is absent.

- [ ] **Step 3: Implement read/validate/prepare/stage/commit**

Resolve all Current Specifications and delta entries first. For ADDED require an absent stable ID; for MODIFIED/REMOVED compare the complete normalized Previous block with Current. Write prepared specs to a temporary sibling directory, validate them, back up destinations, commit all swaps, copy immutable history with `ARCHIVED` metadata, remove the active index entry, then scan active Changes for STALE. On any failure before completion restore backups and retain recovery paths in the error.

- [ ] **Step 4: Run focused archive tests and verify GREEN**

Run: `pnpm exec vitest run test/core/openspec-workflow/archive-transaction.test.ts test/core/archive.test.ts`

Expected: PASS, including conflict, dependency, rollback, history, and stale-marking cases.

- [ ] **Step 5: Commit**

```bash
git add src/core/openspec-workflow/archive-transaction.ts src/core/archive.ts src/cli/index.ts src/core/business-archive.ts test/core/openspec-workflow/archive-transaction.test.ts test/core/archive.test.ts
git commit -m "feat: archive changes transactionally"
```

### Task 8: Route CLI actions and generated skills through openspec-workflow

**Files:**
- Create: `src/core/templates/workflows/openspec-workflow.ts`
- Modify: `src/core/templates/workflows/new-change.ts`
- Modify: `src/core/templates/workflows/continue-change.ts`
- Modify: `src/core/templates/workflows/propose.ts`
- Modify: `src/core/templates/workflows/apply-change.ts`
- Modify: `src/core/templates/workflows/verify-change.ts`
- Modify: `src/core/templates/workflows/archive-change.ts`
- Modify: `src/core/templates/workflows/ff-change.ts`
- Modify: `src/core/templates/workflows/superpowers-integration.ts`
- Modify: `src/core/config.ts`
- Modify: `src/core/templates/skill-templates.ts`
- Modify: `src/commands/workflow/instructions.ts`
- Test: `test/core/templates/openspec-workflow.test.ts`
- Test: `test/core/shared/skill-content-equivalence.test.ts`
- Generate: `skills/openspec-workflow/SKILL.md` through `pnpm generate:skills`

**Interfaces:**
- The generated workflow guidance names `openspec-workflow` as the adapter and routes artifacts to the bound `CHG-*` directory.
- Every planning/implementation/verification/archive template injects Change ID, Requirement IDs, Scenarios, Task IDs, baseline, and required commands.
- `tasks.md` remains a concise `SP-##` status projection; the detailed Superpowers plan is not duplicated.

- [ ] **Step 1: Write failing generated-content tests**

```ts
it('routes OpenSpec code-spec work through openspec-workflow', () => {
  const content = getOpsxProposeSkillTemplate().instructions;
  expect(content).toContain('openspec-workflow');
  expect(content).toContain('CHG-');
  expect(content).toContain('metadata.yaml');
  expect(content).not.toContain('docs/superpowers/specs/');
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `pnpm exec vitest run test/core/templates/openspec-workflow.test.ts`

Expected: FAIL because the current templates still describe the old artifact graph.

- [ ] **Step 3: Implement the adapter guidance and skill**

Keep Superpowers skill names and rules intact. Add only routing/context instructions for `brainstorming`, `writing-plans`, TDD, debugging, fresh verification, review, and branch finishing. Add the new skill to the generator's canonical list and ensure the generated distribution is the only source of committed `skills/openspec-*/SKILL.md` content.

- [ ] **Step 4: Generate skills and verify parity**

Run: `pnpm build && pnpm generate:skills && pnpm run regen:parity-hashes && pnpm exec vitest run test/core/templates/openspec-workflow.test.ts test/core/shared/skill-content-equivalence.test.ts`

Expected: PASS; generated skills and parity hashes reflect only the new workflow contract.

- [ ] **Step 5: Commit**

```bash
git add skills src/core/templates src/core/config.ts src/commands/workflow/instructions.ts test/core/templates/openspec-workflow.test.ts test/core/shared/skill-content-equivalence.test.ts
git commit -m "feat: route generated skills through openspec workflow"
```

### Task 9: Rewrite the code-spec schema, templates, and documentation for the new protocol

**Files:**
- Modify: `schemas/code-spec/schema.yaml`
- Modify: `schemas/code-spec/templates/proposal.md`
- Modify: `schemas/code-spec/templates/design.md`
- Modify: `schemas/code-spec/templates/spec.md`
- Modify: `schemas/code-spec/templates/tasks.md`
- Create: `schemas/code-spec/templates/verification.md`
- Modify: `openspec/config.yaml`
- Create: `openspec/business.md`
- Create: `openspec/changes/index.yaml`
- Create: `openspec/archive/README.md`
- Modify: `docs/overview.md`
- Modify: `docs/workflows.md`
- Modify: `docs/concepts.md`
- Modify: `docs/cli.md`
- Test: `test/core/openspec-workflow/templates.test.ts`

**Interfaces:**
- `code-spec` declares the canonical artifact files and no `.openspec.yaml`, `skip_specs`, `spec-driven`, `openspec/specs`, or `changes/archive` fallback.
- Templates use Chinese natural-language content and English protocol tokens/IDs exactly as specified.
- The default workspace files document multiple active Changes, Requirement ID reservation, fresh verification, and explicit archive.

- [ ] **Step 1: Write failing schema/template tests**

```ts
it('declares canonical code-spec artifacts and protocol tokens', () => {
  const schema = readFileSync('schemas/code-spec/schema.yaml', 'utf8');
  expect(schema).toContain('metadata.yaml');
  expect(schema).toContain('verification.md');
  expect(schema).toContain('MODIFIED');
  expect(schema).not.toContain('skip_specs');
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `pnpm exec vitest run test/core/openspec-workflow/templates.test.ts`

Expected: FAIL because the built-in schema still describes the old artifact graph.

- [ ] **Step 3: Rewrite schema and templates**

Make the canonical files and lifecycle gates explicit. Include the Module Mapping section, full Previous blocks, Scenario `GIVEN/WHEN/THEN`, `SP-##` task projection, and `verification.md` evidence table. Keep business prose in Chinese and machine protocol tokens in English.

- [ ] **Step 4: Run focused tests and schema validation**

Run: `pnpm exec vitest run test/core/openspec-workflow/templates.test.ts test/core/artifact-graph/schema.test.ts test/commands/schema.test.ts`

Expected: PASS with no legacy code-spec artifact assumptions.

- [ ] **Step 5: Commit**

```bash
git add schemas/code-spec openspec/config.yaml openspec/business.md openspec/changes/index.yaml openspec/archive/README.md docs/overview.md docs/workflows.md docs/concepts.md docs/cli.md test/core/openspec-workflow/templates.test.ts
git commit -m "feat: migrate code-spec documents to openspec protocol"
```

### Task 10: Add end-to-end coverage and remove unsupported legacy code paths

**Files:**
- Modify: `src/utils/change-metadata.ts`
- Modify: `src/utils/change-utils.ts`
- Modify: `src/core/change-status-policy.ts`
- Modify: `src/core/openspec-root.ts`
- Modify: `src/core/artifact-graph/instruction-loader.ts`
- Modify: `src/core/artifact-graph/state.ts`
- Modify: `src/core/shared/tool-detection.ts`
- Test: `test/cli-e2e/openspec-workflow-journeys.test.ts`
- Test: `test/core/openspec-workflow/legacy-rejection.test.ts`
- Modify: related existing tests under `test/core`, `test/commands`, and `test/cli-e2e`

**Interfaces:**
- Code-spec command resolution accepts only canonical `CHG-*` directories and `metadata.yaml`.
- Legacy `.openspec.yaml` or slug Changes fail with a diagnostic naming the canonical replacement command.
- E2E fixtures can create isolated canonical workspaces and run the full lifecycle without depending on the repository's dirty working tree.

- [ ] **Step 1: Write failing end-to-end journeys**

Cover these exact sequences: ordinary Feature through ARCHIVED; same-goal revision; three independent active Changes; same-module different Requirement; same-Requirement archive conflict; STALE then semantic Rebase; parallel Requirement allocation; VERIFY → IMPLEMENT and VERIFY → DESIGN; bugfix routing; dependency blocking; supersede/ABANDONED; and interrupted resume.

- [ ] **Step 2: Run the new journeys and verify RED**

Run: `pnpm exec vitest run test/cli-e2e/openspec-workflow-journeys.test.ts test/core/openspec-workflow/legacy-rejection.test.ts`

Expected: FAIL against the old slug-based CLI behavior.

- [ ] **Step 3: Remove code-spec legacy fallbacks and update fixtures**

Delete `.openspec.yaml` resolution from code-spec paths, remove old `spec-driven` defaulting and `skip_specs` behavior from the canonical path, and update tests to create `metadata.yaml`/`CHG-*` workspaces. Leave generic non-code-spec schema support only where its tests explicitly require it.

- [ ] **Step 4: Run focused and full verification**

Run: `pnpm lint && pnpm exec vitest run test/core/openspec-workflow test/cli-e2e/openspec-workflow-journeys.test.ts test/commands/artifact-workflow.test.ts`

Expected: exit code 0 with all new lifecycle, transaction, and legacy-rejection tests passing.

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "test: verify complete openspec workflow migration"
```

### Task 11: Final fresh verification and migration handoff

**Files:**
- Test: complete repository test suite
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **Step 1: Run the complete verification command**

Run: `pnpm lint && pnpm build && pnpm test && git diff --check`

Expected: all commands exit 0; Vitest reports zero failures; `git diff --check` reports no whitespace errors.

- [ ] **Step 2: Inspect the final migration surface**

Run: `git status --short` and `git diff --stat HEAD~1`

Confirm that only the requested migration commits and pre-existing user changes are present; no legacy Change files were deleted by command execution.

- [ ] **Step 3: Document the breaking boundary**

Record the new canonical directory layout, `CHG-*` creation command, explicit archive requirement, and the unsupported `.openspec.yaml` behavior in `README.md` and `CHANGELOG.md`.

- [ ] **Step 4: Re-run fresh verification after documentation changes**

Run: `pnpm lint && pnpm build && pnpm test && git diff --check`

Expected: exit code 0 with the final implementation and documentation state verified.

- [ ] **Step 5: Commit the release-facing documentation**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document openspec workflow migration"
```
