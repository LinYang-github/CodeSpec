# Unified Archive Projections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make canonical `code-spec` archive produce one consistent module projection (`spec.md`, `interface.yaml`, `api.yaml`), refresh `business.yaml` and `configuration.yaml`, and require a fresh real-project/browser E2E run for UI Changes before committing.

**Architecture:** Build all archive projections in memory from the current canonical workspace plus the approved Change delta. Route both canonical Change shapes through the same projection builder and the same durable archive transaction; keep the legacy generic-schema archive path outside this contract. Run the UI gate during preflight, stage its fresh evidence, then commit all Current Specification, global projection, archive-history, and Change-removal changes atomically.

**Tech Stack:** TypeScript, Node.js 20.19+, Zod, YAML, Vitest, `node:child_process`, existing CodeSpec archive locks/journal, Markdown parser.

**Spec:** `docs/superpowers/specs/2026-09-09-unified-archive-projections-design.md`

## Global Constraints

- Every affected canonical module ends with `spec.md`, `interface.yaml`, and `api.yaml`.
- `spec.md` is the unique source for Requirement, Scenario, readable test cases, latest verification summary, and current engineering files; no `test-cases.md` is generated or retained.
- `interface.yaml` is the authoritative cross-module relation source; static graph files are never persisted.
- `api.yaml` contains only route path, input business-module IDs, and output business-module IDs.
- `business.yaml` remains the project-wide registry and its `inputs`, `outputs`, and `relatedModules` are regenerated from the relation graph.
- `configuration.yaml` is a CodeSpec verification connection snapshot and never a project runtime configuration source.
- A Change is a UI Change when `metadata.yaml` `impact.affected_areas` contains `ui`.
- UI archive preflight must rerun `prepare`, start the real project, wait for configured services/routes, run browser E2E, and run `cleanup`; any failure blocks archive.
- Missing `interface.yaml` for an existing module fails closed; a newly registered module with no relations may receive an empty interface document.
- All canonical projection writes, archive history, and active-Change removal share one recoverable transaction; a failed transaction leaves the active Change available.
- Legacy generic-schema and slug Change behavior remains compatibility-only and is not silently converted by this implementation.

## File Map

- Create: `src/core/codespec-workflow/archive-projection.ts` — pure projection builder and serialized module/global output types.
- Create: `src/core/codespec-workflow/ui-archive-gate.ts` — UI Change detection, process lifecycle, readiness checks, browser E2E execution, and cleanup result.
- Modify: `src/core/codespec-workflow/current-change-yaml.ts` — canonical verification-plan fields and UI-specific validation data.
- Modify: `src/core/codespec-workflow/current-archive-merge.ts` — consume the complete canonical module state and call the projection builder.
- Modify: `src/core/codespec-workflow/archive-transaction.ts` — use one archive plan/commit path for both canonical Change shapes and stage all projections/evidence.
- Modify: `src/core/codespec-workflow/transaction-journal.ts` — support the unified file set and post-commit active-Change cleanup without leaving stale journals.
- Modify: `src/core/codespec-workflow/current-spec-yaml.ts` and `src/core/codespec-workflow/current-spec-graph.ts` — enforce the final YAML contracts and deterministic projections where current behavior is too permissive.
- Modify: `src/core/codespec-workflow/verification.ts` and `src/core/codespec-workflow/current-verification-policy.ts` — expose reusable command/evidence handling and require fresh UI evidence.
- Modify: `src/core/codespec-workflow/gates.ts` and `src/core/codespec-workflow/traceability.ts` — validate design references, spec ownership, and archive-ready UI plans.
- Modify: `schemas/code-spec/templates/spec.md`, `schemas/code-spec/templates/design.md`, `schemas/code-spec/templates/tasks.yaml`, and `schemas/code-spec/templates/verification.yaml` — make generated canonical artifacts match the contract.
- Modify: `docs/README.md`, `docs/overview.md`, `docs/getting-started.md`, `docs/user-manual.md`, `docs/commands.md`, `docs/cli.md`, `skills/codespec-archive-change/SKILL.md`, and `src/core/templates/workflows/archive-change.ts` — document the final archive outputs and A strategy.
- Test: `test/core/codespec-workflow/archive-projection.test.ts`, `test/core/codespec-workflow/ui-archive-gate.test.ts`, `test/core/codespec-workflow/current-change-yaml.test.ts`, `test/core/codespec-workflow/current-spec-yaml.test.ts`, `test/core/codespec-workflow/current-spec-graph.test.ts`, `test/core/codespec-workflow/current-archive-merge.test.ts`, `test/core/codespec-workflow/archive-transaction.test.ts`, `test/core/codespec-workflow/transaction-journal.test.ts`, and the canonical CLI journey tests.

### Task 1: Lock the canonical artifact and YAML contracts

**Files:**
- Modify: `src/core/codespec-workflow/current-change-yaml.ts:18-45`
- Modify: `src/core/codespec-workflow/current-spec-yaml.ts:31-180`
- Modify: `src/core/codespec-workflow/current-spec-graph.ts:68-151`
- Modify: `src/core/codespec-workflow/gates.ts` and `src/core/codespec-workflow/traceability.ts`
- Test: `test/core/codespec-workflow/current-change-yaml.test.ts`
- Test: `test/core/codespec-workflow/current-spec-yaml.test.ts`
- Test: `test/core/codespec-workflow/current-spec-graph.test.ts`

**Interfaces:**
- Consumes: existing `CurrentTasks`, `ModuleInterface`, `ModuleApi`, `BusinessRegistry`, and `ConfigurationSnapshot` schemas.
- Produces: canonical verification plans with optional `startup` and `browser` fields; UI-specific validation can require both without making non-UI plans invalid. `ModuleApi` remains restricted to `version`, `module`, and `routes[path,inputModules,outputModules]`.

- [ ] **Step 1: Write failing schema tests** for a plan that accepts `startup` and `browser`, a UI plan missing `startup`, a UI plan missing browser identity, an API document containing `method`, `request`, `response`, `errors`, or `name`, and an unsorted/duplicated route projection.
- [ ] **Step 2: Run the focused tests**

  Run: `pnpm vitest run test/core/codespec-workflow/current-change-yaml.test.ts test/core/codespec-workflow/current-spec-yaml.test.ts test/core/codespec-workflow/current-spec-graph.test.ts`

  Expected: FAIL because the new plan fields and UI/API contract checks are not implemented.
- [ ] **Step 3: Implement the smallest schema and gate changes**: add optional plan fields, preserve the normalized array form, validate API keys through the strict schema, and add explicit helpers that identify `metadata.impact.affected_areas.includes('ui')` and require UI startup/browser fields only for UI Changes.
- [ ] **Step 4: Run the focused tests again**

  Run: `pnpm vitest run test/core/codespec-workflow/current-change-yaml.test.ts test/core/codespec-workflow/current-spec-yaml.test.ts test/core/codespec-workflow/current-spec-graph.test.ts`

  Expected: PASS, including existing non-UI verification-plan fixtures.
- [ ] **Step 5: Commit**

  ```bash
  git add src/core/codespec-workflow/current-change-yaml.ts src/core/codespec-workflow/current-spec-yaml.ts src/core/codespec-workflow/current-spec-graph.ts src/core/codespec-workflow/gates.ts src/core/codespec-workflow/traceability.ts test/core/codespec-workflow/current-change-yaml.test.ts test/core/codespec-workflow/current-spec-yaml.test.ts test/core/codespec-workflow/current-spec-graph.test.ts
  git commit -m "feat: lock canonical archive artifact contracts"
  ```

### Task 2: Build deterministic module and global projections

**Files:**
- Create: `src/core/codespec-workflow/archive-projection.ts`
- Modify: `src/core/codespec-workflow/current-archive-merge.ts:8-111`
- Modify: `src/core/codespec-workflow/current-spec-graph.ts:68-151`
- Test: `test/core/codespec-workflow/archive-projection.test.ts`
- Test: `test/core/codespec-workflow/current-archive-merge.test.ts`

**Interfaces:**
- Consumes: `BusinessRegistry`, `Map<string, ModuleInterface>`, `ConfigurationSnapshot`, `Map<string, string>` of module `spec.md` contents, and optional fresh `CurrentVerification`.
- Produces:

  ```ts
  export interface ArchiveProjection {
    modules: Map<string, { spec: string; interface: string; api: string }>;
    business: string;
    configuration: string;
  }

  export function buildArchiveProjection(input: {
    specs: Map<string, string>;
    business: BusinessRegistry;
    interfaces: Map<string, ModuleInterface>;
    configuration: ConfigurationSnapshot;
    verification?: CurrentVerification;
  }): ArchiveProjection;
  ```

- [ ] **Step 1: Write failing projection tests** covering a two-module mirrored HTTP relation, an event relation, route input/output module IDs, regenerated business `inputs`/`outputs`/`relatedModules`, stable YAML ordering, and a module with no relations producing an empty interface plus an empty route projection.
- [ ] **Step 2: Run the projection tests**

  Run: `pnpm vitest run test/core/codespec-workflow/archive-projection.test.ts test/core/codespec-workflow/current-archive-merge.test.ts`

  Expected: FAIL because the projection module does not exist.
- [ ] **Step 3: Implement `buildArchiveProjection`** as a pure function: normalize and validate all input documents, call `buildCurrentSpecificationGraph`, serialize every module's `interface.yaml` and derived `api.yaml`, serialize the derived `business.yaml` and merged `configuration.yaml`, and append the latest verification summary to the target module's `spec.md` without creating `test-cases.md`.
- [ ] **Step 4: Add missing-interface policy tests and implementation**: reject an existing module directory without `interface.yaml`; allow a newly registered no-relation module to receive `{version: 1, module, relations: []}`; never infer existing relations from filenames or legacy slug directories.
- [ ] **Step 5: Run the projection tests again**

  Run: `pnpm vitest run test/core/codespec-workflow/archive-projection.test.ts test/core/codespec-workflow/current-archive-merge.test.ts test/core/codespec-workflow/current-spec-graph.test.ts`

  Expected: PASS with no static graph output created.
- [ ] **Step 6: Commit**

  ```bash
  git add src/core/codespec-workflow/archive-projection.ts src/core/codespec-workflow/current-archive-merge.ts src/core/codespec-workflow/current-spec-graph.ts test/core/codespec-workflow/archive-projection.test.ts test/core/codespec-workflow/current-archive-merge.test.ts test/core/codespec-workflow/current-spec-graph.test.ts
  git commit -m "feat: build deterministic archive projections"
  ```

### Task 3: Implement the fresh UI archive gate

**Files:**
- Create: `src/core/codespec-workflow/ui-archive-gate.ts`
- Modify: `src/core/codespec-workflow/verification.ts:1-125,350-470`
- Modify: `src/core/codespec-workflow/current-verification-policy.ts`
- Modify: `src/core/codespec-workflow/current-change-yaml.ts`
- Test: `test/core/codespec-workflow/ui-archive-gate.test.ts`
- Test: `test/core/codespec-workflow/current-verification-policy.test.ts`

**Interfaces:**
- Consumes: `WorkspaceContext`, `ChangeArtifacts`, parsed `CurrentTasks`, `ConfigurationSnapshot`, and the UI Change metadata flag.
- Produces:

  ```ts
  export interface UiArchiveGateResult {
    passed: true;
    verification: CurrentVerification;
    outputSummary: string;
  }

  export async function runUiArchiveGate(
    workspace: WorkspaceContext,
    artifacts: ChangeArtifacts,
  ): Promise<UiArchiveGateResult>;
  ```

- [ ] **Step 1: Write failing gate tests** for successful prepare/startup/readiness/browser E2E/cleanup, startup failure, readiness timeout, browser command failure, missing browser field, missing startup field, and cleanup failure. Use injected command/process hooks so tests never start a real server.
- [ ] **Step 2: Run the focused gate tests**

  Run: `pnpm vitest run test/core/codespec-workflow/ui-archive-gate.test.ts test/core/codespec-workflow/current-verification-policy.test.ts`

  Expected: FAIL because the gate and lifecycle hooks are not implemented.
- [ ] **Step 3: Implement the process lifecycle**: run `prepare`; spawn `startup` in the repository root; poll the configured service endpoint/route until ready with a bounded timeout; execute the browser runner command; always run `cleanup`; terminate the started process group on both success and failure.
- [ ] **Step 4: Refactor evidence recording** so the fresh UI run produces a current-revision `CurrentVerification` record in memory, including test case, browser, command, exit code, execution time, tree fingerprint, and cleanup result. Do not write Current Specification during the gate.
- [ ] **Step 5: Enforce the gate only for `affected_areas: [ui]`** and retain existing non-UI verification behavior.
- [ ] **Step 6: Run the focused gate tests again**

  Run: `pnpm vitest run test/core/codespec-workflow/ui-archive-gate.test.ts test/core/codespec-workflow/current-verification-policy.test.ts test/core/codespec-workflow/current-change-yaml.test.ts`

  Expected: PASS, including cleanup assertions after every failure mode.
- [ ] **Step 7: Commit**

  ```bash
  git add src/core/codespec-workflow/ui-archive-gate.ts src/core/codespec-workflow/verification.ts src/core/codespec-workflow/current-verification-policy.ts src/core/codespec-workflow/current-change-yaml.ts test/core/codespec-workflow/ui-archive-gate.test.ts test/core/codespec-workflow/current-verification-policy.test.ts
  git commit -m "feat: require fresh UI E2E before archive"
  ```

### Task 4: Unify canonical preflight and archive commit

**Files:**
- Modify: `src/core/codespec-workflow/archive-transaction.ts:1-494`
- Modify: `src/core/codespec-workflow/transaction-journal.ts:1-141`
- Test: `test/core/codespec-workflow/archive-transaction.test.ts`
- Test: `test/core/codespec-workflow/transaction-journal.test.ts`
- Test: `test/cli-e2e/codespec-workflow-journeys.test.ts`
- Test: `test/cli-e2e/current-spec-consolidation.test.ts`

**Interfaces:**
- Consumes: `ArchiveProjection`, optional `UiArchiveGateResult`, current Change artifacts, current module files, `business.yaml`, and `configuration.yaml`.
- Produces: one `ArchivePlan` and `PreparedArchive` for both canonical Change shapes; commit targets include all projected files, `archive/changes/<CHG-ID>/`, `archive/README.md`, `archive/history.yaml`, `changes/index.yaml`, and active Change cleanup.

- [ ] **Step 1: Write failing transaction tests** asserting that both proposal and current-spec canonical Changes produce the same three-file module contract, update both root YAML projections, create the archived Change copy with `metadata.yaml` status `ARCHIVED`, append history, and remove the active Change only after commit.
- [ ] **Step 2: Run the archive transaction tests**

  Run: `pnpm vitest run test/core/codespec-workflow/archive-transaction.test.ts test/core/codespec-workflow/transaction-journal.test.ts test/cli-e2e/codespec-workflow-journeys.test.ts test/cli-e2e/current-spec-consolidation.test.ts`

  Expected: FAIL for proposal Changes because the existing path only stages `spec.md` and does not install the global projections.
- [ ] **Step 3: Refactor `preflightArchive` and `prepareArchive`** to load all module IDs from the business registry, validate existing interface files, merge approved deltas, run `runUiArchiveGate` for UI Changes, and stage the fresh verification result before projection building.
- [ ] **Step 4: Refactor `commitArchive`** to install every `ArchiveProjection` module directory, root `business.yaml`, root `configuration.yaml`, index, archive copy, README, and history from one staged plan. Keep archive history content-hashed to the final `spec.md` and evidence receipt.
- [ ] **Step 5: Make transaction recovery cover the unified targets**: snapshot files before installation, mark commit durably, remove the active Change only after the marker, remove journals after recovery, and preserve recovery stage/backup if rollback cannot complete.
- [ ] **Step 6: Add optimistic-concurrency checks** for every input used by the projection, including all affected module directories, Change artifacts, business/configuration snapshots, and index; a mismatch must abort before installation.
- [ ] **Step 7: Run the transaction and CLI tests again**

  Run: `pnpm vitest run test/core/codespec-workflow/archive-transaction.test.ts test/core/codespec-workflow/transaction-journal.test.ts test/cli-e2e/codespec-workflow-journeys.test.ts test/cli-e2e/current-spec-consolidation.test.ts`

  Expected: PASS for success, rollback, crash recovery, missing-interface rejection, archive collision, and concurrent-edit cases.
- [ ] **Step 8: Commit**

  ```bash
  git add src/core/codespec-workflow/archive-transaction.ts src/core/codespec-workflow/transaction-journal.ts test/core/codespec-workflow/archive-transaction.test.ts test/core/codespec-workflow/transaction-journal.test.ts test/cli-e2e/codespec-workflow-journeys.test.ts test/cli-e2e/current-spec-consolidation.test.ts
  git commit -m "feat: unify canonical archive transaction"
  ```

### Task 5: Enforce design/spec ownership and archive traceability

**Files:**
- Modify: `src/core/codespec-workflow/gates.ts`
- Modify: `src/core/codespec-workflow/traceability.ts`
- Modify: `src/core/codespec-workflow/current-spec-model.ts`
- Modify: `src/core/codespec-workflow/verification.ts`
- Test: `test/core/codespec-workflow/current-spec-model.test.ts`
- Test: `test/core/codespec-workflow/archive-impact.test.ts`
- Test: `test/core/codespec-workflow/archive-impact-integrity.test.ts`
- Test: `test/core/codespec-workflow/archive-transaction.test.ts`

**Interfaces:**
- Consumes: `design.md`, canonical `spec.md`, `tasks.yaml`, `verification.yaml`, and `ChangeMetadata`.
- Produces: archive preflight diagnostics that identify missing/unknown Requirement, Scenario, Task, Test Case, evidence, forbidden test-case files, duplicated behavior sections in design, and stale verification.

- [ ] **Step 1: Write failing traceability tests** for a design that references a missing ID, a design that repeats a scenario body instead of referencing it, a `spec.md` with an empty/missing `ERROR`, and verification evidence that does not cover the final task/spec revision.
- [ ] **Step 2: Run the focused traceability tests**

  Run: `pnpm vitest run test/core/codespec-workflow/current-spec-model.test.ts test/core/codespec-workflow/archive-impact.test.ts test/core/codespec-workflow/archive-impact-integrity.test.ts test/core/codespec-workflow/archive-transaction.test.ts`

  Expected: FAIL for the new ownership and duplicate-content cases.
- [ ] **Step 3: Implement fail-closed validation**: require design IDs to resolve into `spec.md`, reject behavior tables or scenario bodies duplicated in `design.md`, reject independent `test-cases.md`, and bind fresh verification evidence to the exact current Change revision and working-tree fingerprint.
- [ ] **Step 4: Verify that diagnostics stop before writes** by asserting Current Specification, global YAML, archive history, and active Change are byte-for-byte unchanged after each failure.
- [ ] **Step 5: Run the focused tests again**

  Run: `pnpm vitest run test/core/codespec-workflow/current-spec-model.test.ts test/core/codespec-workflow/archive-impact.test.ts test/core/codespec-workflow/archive-impact-integrity.test.ts test/core/codespec-workflow/archive-transaction.test.ts`

  Expected: PASS.
- [ ] **Step 6: Commit**

  ```bash
  git add src/core/codespec-workflow/gates.ts src/core/codespec-workflow/traceability.ts src/core/codespec-workflow/current-spec-model.ts src/core/codespec-workflow/verification.ts test/core/codespec-workflow/current-spec-model.test.ts test/core/codespec-workflow/archive-impact.test.ts test/core/codespec-workflow/archive-impact-integrity.test.ts test/core/codespec-workflow/archive-transaction.test.ts
  git commit -m "feat: enforce archive spec ownership and traceability"
  ```

### Task 6: Update templates, generated instructions, and user documentation

**Files:**
- Modify: `schemas/code-spec/templates/spec.md`
- Modify: `schemas/code-spec/templates/design.md`
- Modify: `schemas/code-spec/templates/tasks.yaml`
- Modify: `schemas/code-spec/templates/verification.yaml`
- Modify: `docs/README.md`, `docs/overview.md`, `docs/getting-started.md`, `docs/user-manual.md`, `docs/commands.md`, `docs/cli.md`
- Modify: `skills/codespec-archive-change/SKILL.md`
- Modify: `src/core/templates/workflows/archive-change.ts`
- Test: `test/core/templates/archive-change.test.ts`

**Interfaces:**
- Consumes: the approved archive design and the final CLI behavior from Tasks 1–5.
- Produces: canonical templates that mention only `spec.md`, `interface.yaml`, `api.yaml`, `business.yaml`, `configuration.yaml`, fresh UI A-gate execution, and the archived Change copy/history behavior.

- [ ] **Step 1: Write failing documentation/template assertions** for the `startup` and `browser` verification-plan fields, the three-file module directory, no `test-cases.md`, dynamic graph behavior, and the statement that canonical archive creates an immutable archived Change copy/history.
- [ ] **Step 2: Run the focused template tests**

  Run: `pnpm vitest run test/core/templates/archive-change.test.ts`

  Expected: FAIL while templates still describe the old no-copy or incomplete projection behavior.
- [ ] **Step 3: Update the templates and docs** without changing legacy generic-schema guidance except to label its compatibility boundary. Remove contradictory claims that canonical archive does not create a history/archive copy.
- [ ] **Step 4: Regenerate generated skill/command parity artifacts**

  Run: `pnpm generate:skills`

  Expected: generated files reflect the updated archive contract; inspect the diff and remove any unrelated generated changes before committing.
- [ ] **Step 5: Run the template tests again**

  Run: `pnpm vitest run test/core/templates/archive-change.test.ts`

  Expected: PASS.
- [ ] **Step 6: Commit**

  ```bash
  git add schemas/code-spec/templates/spec.md schemas/code-spec/templates/design.md schemas/code-spec/templates/tasks.yaml schemas/code-spec/templates/verification.yaml docs/README.md docs/overview.md docs/getting-started.md docs/user-manual.md docs/commands.md docs/cli.md skills/codespec-archive-change/SKILL.md src/core/templates/workflows/archive-change.ts test/core/templates
  git commit -m "docs: document canonical archive projections"
  ```

### Task 7: Run full verification and inspect the final diff

**Files:**
- Test: repository-wide test suite and CLI/UI archive journeys
- Verify: `docs/superpowers/specs/2026-09-09-unified-archive-projections-design.md`
- Verify: all files changed by Tasks 1–6

**Interfaces:**
- Consumes: all implementation outputs from Tasks 1–6.
- Produces: verified implementation evidence and a clean, scoped diff ready for review.

- [ ] **Step 1: Run type checking**

  Run: `pnpm typecheck`

  Expected: PASS with no TypeScript errors.
- [ ] **Step 2: Run lint**

  Run: `pnpm lint`

  Expected: PASS with no new lint errors.
- [ ] **Step 3: Run the full test suite**

  Run: `pnpm test`

  Expected: PASS, including all archive, graph, verification, template, and CLI journey tests.
- [ ] **Step 4: Run the production build**

  Run: `pnpm build`

  Expected: PASS and generated output contains no test-only files or static graph artifacts.
- [ ] **Step 5: Inspect the final diff and repository status**

  Run: `git diff --check && git status --short`

  Expected: no whitespace errors; only intended implementation/docs/test files are changed in addition to pre-existing user changes, which must remain untouched.
