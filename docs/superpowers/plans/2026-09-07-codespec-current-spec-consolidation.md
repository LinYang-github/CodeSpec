# CodeSpec Current Specification Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace archived Change copies with validated current module specifications, structured YAML relationships, current runtime configuration snapshots, and recoverable archival transactions.

**Architecture:** `spec.md` remains the readable behavior source and all other durable relationship artifacts use strict YAML schemas. Active Changes carry approved `moduleDeltas`; archive validates them, rebuilds derived `api.yaml` and `business.yaml`, and installs all files through a journaled transaction. UI layout is out of scope, but its content index exposes the new data model.

**Tech Stack:** TypeScript, Node.js `fs/promises`, Zod, `yaml`, Commander, Vitest, existing CodeSpec local UI.

**Spec:** `docs/superpowers/specs/2026-09-07-codespec-current-spec-consolidation-design.md`

## Global Constraints

- Keep only `spec.md`, `interface.yaml`, and `api.yaml` under each current module.
- Keep `business.yaml` and `configuration.yaml` at the CodeSpec root. Never write project runtime configuration.
- Keep Requirement, Scenario, UI action steps, and test cases in Markdown. Parse them through an AST, not regular expressions.
- Require separate design and task approvals. Internal `PLAN` remains compatibility-only; public text says “任务”.
- Do not create new archive Change copies or history records. Never automatically delete pre-existing history directories.
- Reject unsafe paths, unresolved references, unapproved deltas, incomplete tasks, skipped UI tests, and stale runtime configuration.

---

## File Structure

- `src/core/codespec-workflow/current-spec-model.ts`: typed current-spec AST, Markdown parser, renderer, and trace references.
- `src/core/codespec-workflow/current-spec-yaml.ts`: Zod schemas and loaders for interfaces, APIs, business registry, configuration, tasks, and verification.
- `src/core/codespec-workflow/current-spec-graph.ts`: relation/API/business projection and bidirectional graph queries.
- `src/core/codespec-workflow/transaction-journal.ts`: durable archive journal creation, recovery, and cleanup.
- `src/core/codespec-workflow/migration.ts`: legacy workspace and active-Change conversion.
- Existing `artifacts.ts`, `change-manager.ts`, `approvals.ts`, `gates.ts`, `verification.ts`, `archive-transaction.ts`, `default-config.ts`, `paths.ts`, `loaders.ts`, `business-registry.ts`, CLI, templates, skills, UI index/server: switch to the new contract.
- Create focused Vitest suites beside the existing `test/core/codespec-workflow/` and `test/cli-e2e/` suites.

### Task 1: Define the v1 data contract — completed

**Files:** Create `current-spec-yaml.ts`; modify `types.ts`, `schemas.ts`, `paths.ts`, `default-config.ts`; test `current-spec-yaml.test.ts`, `default-config.test.ts`.

- [x] Write failing schema tests for duplicate IDs, unknown properties, unsafe paths, HTTP/event field exclusivity, duplicate `profile/service`, and invalid endpoint unions.
- [x] Add exported contracts such as:

```ts
export type Relation = HttpRelation | EventRelation;
export function parseModuleInterface(value: unknown): ModuleInterface;
export function parseTasksDocument(value: unknown): TasksDocument;
export function parseRuntimeConfiguration(value: unknown): RuntimeConfiguration;
```

- [x] Implement strict Zod schemas for all YAML roots and nested objects, including global IDs and `moduleDeltas` cascade rules.
- [x] Change default paths to `business.yaml`, `configuration.yaml`, `interface.yaml`, and `api.yaml`; remove future-use `archived_changes` paths while retaining legacy discovery paths only in migration.
- [x] Run `pnpm vitest run test/core/codespec-workflow/current-spec-yaml.test.ts test/core/codespec-workflow/default-config.test.ts`.
- [ ] Commit `feat: add current specification yaml contract`.

### Task 2: Parse and render readable current specs — completed

**Files:** Create `current-spec-model.ts`; modify `types.ts`; test `current-spec-model.test.ts`.

- [x] Write failing tests for module headers, global Scenario/Test Case IDs, test metadata, verification summaries, and backtick-delimited engineering-file references.
- [x] Implement:

```ts
export function parseCurrentSpecification(markdown: string): CurrentSpecification;
export function renderCurrentSpecification(spec: CurrentSpecification): string;
export function validateCurrentSpecification(spec: CurrentSpecification): string[];
```

- [x] Use a Markdown AST library already available in the dependency tree, preserving fixed headings and tables without regex extraction.
- [x] Run the focused suite and add a malformed-table regression fixture.
- [ ] Commit `feat: parse v1 readable current specifications`.

### Task 3: Build the relation and traceability graph — completed

**Files:** Create `current-spec-graph.ts`; replace `business-registry.ts`, `relations.ts`, `traceability.ts`; test `current-spec-graph.test.ts`, `traceability.test.ts`.

- [x] Write tests for mirrored endpoint relations, same-path multi-method API aggregation, event `triggeredBy`, shared files, retired modules, and forward/reverse lookups.
- [x] Implement:

```ts
export function buildCurrentSpecGraph(input: CurrentSpecGraphInput): CurrentSpecGraph;
export function projectApi(moduleId: BusinessModuleId, graph: CurrentSpecGraph): ModuleApi;
export function projectBusiness(graph: CurrentSpecGraph): BusinessRegistryDocument;
```

- [x] Enforce the documented business projection: relation input feeds source output and target input; relation output feeds target output.
- [x] Run focused graph and traceability tests.
- [ ] Commit `feat: derive business and api projections from relations`.

### Task 4: Switch Change artifacts and approval fingerprints — completed

**Files:** Modify `artifacts.ts`, `change-manager.ts`, `types.ts`, `schemas.ts`, `approvals.ts`, `state-machine.ts`, `gates.ts`; test `change-manager.test.ts`, `approvals.test.ts`, `state-machine.test.ts`, `contracts.test.ts`.

- [x] Write failing tests for five-file active Changes, absent proposal artifacts, task YAML loading, semantic-plan changes revoking approvals, and locator-only changes preserving approvals.
- [x] Replace artifact paths with `design.md`, `spec.md`, `tasks.yaml`, and `verification.yaml`; add baseline commit and working-tree fingerprint fields.
- [x] Implement a field-level fingerprint function:

```ts
export function classifyArtifactChange(before: ChangeContent, after: ChangeContent): ApprovalImpact;
```

- [x] Make approval hashes include only approved design or plan fields, never task progress or verification execution fields.
- [x] Run approval, state, and contract suites.
- [ ] Commit `feat: gate workflow on approved yaml task plans`.

### Task 5: Execute and validate structured verification — completed

**Files:** Modify `verification.ts`, `verification-policy.ts`, `traceability.ts`; test `verification.test.ts`, `verification-policy.test.ts`.

- [x] Write failing tests for skipped target tests, nonzero exits, profile mismatch, missing cleanup, source fingerprint mismatch, and sensitive endpoint redaction.
- [x] Replace Markdown verification parsing with `verification.yaml` parsing and validate each `verificationPlan` entry against a matching executed test case.
- [x] Implement configuration resolution for dotenv, JSON, and YAML repository files; reject interpolation and unsupported sources.
- [x] Persist only the latest verification summary into the prepared `spec.md` output.
- [x] Run focused verification suites.
- [ ] Commit `feat: validate runtime-aware structured verification`.

### Task 6: Implement recoverable archive transactions — completed

**Files:** Create `transaction-journal.ts`, `migration.ts`; rewrite `archive-transaction.ts`; modify `loaders.ts`; test `archive-transaction.test.ts`, `transaction-journal.test.ts`, `migration.test.ts`.

- [x] Write failing interruption tests at every install step and assert recovery produces either all-before or all-after files.
- [x] Implement journal APIs:

```ts
export async function recoverPendingTransactions(paths: WorkspacePaths): Promise<void>;
export async function createArchiveJournal(input: JournalInput): Promise<ArchiveJournal>;
```

- [x] Stage merged `spec.md`, mirrored `interface.yaml`, derived `api.yaml`, `business.yaml`, and `configuration.yaml`; write checksums and a commit marker before deleting the active Change.
- [x] Implement legacy conversion: convert old business registry, mark untouched specs `legacy`, require first-touch v1 upgrades, and force old active Changes through conversion plus reapproval.
- [x] Run transaction, migration, and stale/rebase suites.
- [ ] Commit `feat: archive current specifications with recovery journal`.

### Task 7: Update CLI, generated skills, templates, and UI data — completed

**Files:** Modify `src/cli/index.ts`, `src/core/completions/command-registry.ts`, workflow templates, `skills/codespec-workflow/SKILL.md`, `skills/codespec-rebase-change/SKILL.md`, `skills/codespec-archive-change/SKILL.md`, `ui-content-index.ts`, `ui-server.ts`; test CLI journeys, template tests, and UI index tests.

- [x] Write failing CLI tests for `approve --stage design|plan`, journal recovery before commands, and archive refusal messages for unresolved YAML/configuration failures.
- [x] Update generated instructions to produce only the five active artifacts and to stop for the two independent confirmations.
- [x] Index YAML module documents and expose graph/query data to the existing UI API; do not implement an unapproved visual layout.
- [x] Run `pnpm vitest run test/core/templates test/cli-e2e/codespec-workflow-journeys.test.ts test/core/ui-content-index.test.ts`.
- [ ] Commit `feat: expose current specification workflow surfaces`.

### Task 8: Run migration and end-to-end regression coverage — completed

**Files:** Modify workspace fixtures under `test/helpers/`; create `test/cli-e2e/current-spec-consolidation.test.ts`; update affected CLI/template tests.

- [x] Build fixtures for v1 workspaces, legacy workspaces, retired modules, shared source files, a configuration mismatch, and interrupted journals.
- [x] Add an end-to-end journey that creates a Change, records both approvals, completes a precise UI verification, archives, verifies no archived Change copy exists, and queries the resulting graph.
- [x] Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, and the full relevant Vitest suite.
- [ ] Commit `test: cover current specification consolidation journeys`.

## Self-Review

- The eight tasks cover storage schemas, readable specs, bidirectional graphing, approval semantics, verification, recoverable archive, migration, and all public surfaces.
- UI visual layout is excluded because the design explicitly leaves it unconfirmed.
- Every task has focused test coverage; Tasks 2–5 retain their earlier commits, while the continuation changes remain uncommitted in the working tree for review.

## Implementation status

The implementation is present in the current worktree. The relevant regression suite passes (50 files, 472 tests), and `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `git diff --check` pass. A full Vitest run still encounters two sandbox-only listener failures (`listen EPERM` on `127.0.0.1`) in the UI-server/version-check tests; those failures are environmental and do not affect the implementation or the relevant consolidation coverage.

The per-task `Commit ...` checklist lines remain unchecked because this continuation deliberately leaves the user's working tree uncommitted.
