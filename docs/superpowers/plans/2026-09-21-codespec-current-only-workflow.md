# CodeSpec Current-Only Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove archive history and legacy workflow behavior so archive leaves only the complete Current state.

**Architecture:** `specs/`, `business.yaml`, and `configuration.yaml` are the sole accepted state. A shared reader validates these files and calculates a stable fingerprint. Archive uses that fingerprint to stale all remaining active Changes; rebase validates and records the same fingerprint.

**Tech Stack:** TypeScript, Node.js `fs/promises`, Zod, YAML, Vitest, Commander.

**Spec:** `docs/superpowers/specs/2026-09-21-codespec-current-only-workflow-design.md`

## Global Constraints

- Support exactly six active artifacts: `metadata.yaml`, `analysis.yaml`, `design.md`, `spec.md`, `tasks.yaml`, and `verification.yaml`.
- Do not read, create, or preserve `archive/`, `archive/changes/`, or archived Change copies.
- Existing modules require `spec.md` and `interface.yaml`; `api.yaml` is derived.
- Archive and rebase consume the same full Current-state validation and fingerprint.
- Every successful archive marks every other active Change stale.
- CLI archive stays interactive; UI POST requires a one-time preflight token.
- Do not add migration or fallback behavior for older Change layouts.
- Every task that creates a Git commit uses the `commit-log-writer` skill to inspect the staged diff and write the commit message.

## Review Focus

- Old Change layouts fail before writes.
- Changes to `interface.yaml`, `api.yaml`, `business.yaml`, or `configuration.yaml` stale an active Change.
- Missing `spec.md` or `interface.yaml` fails identically in archive and rebase.
- UI archive POST without a fresh matching token writes nothing.
- `validate --archived` and `detect-stale` are unavailable rather than silently empty.

---

### Task 1: Delete archive-history paths and old Change branches

**Files:**
- Modify: `src/core/codespec-workflow/types.ts`
- Modify: `src/core/codespec-workflow/schemas.ts`
- Modify: `src/core/codespec-workflow/paths.ts`
- Modify: `src/core/codespec-workflow/loaders.ts`
- Modify: `src/core/codespec-workflow/artifacts.ts`
- Modify: `src/core/codespec-workflow/default-config.ts`
- Modify: `src/core/codespec-workflow/archive-transaction.ts`
- Modify: `src/core/codespec-workflow/rebase.ts`
- Modify: `src/cli/index.ts`
- Test: `test/core/codespec-workflow/loaders.test.ts`
- Test: `test/core/codespec-workflow/archive-transaction.test.ts`
- Test: `test/core/codespec-workflow/stale-rebase.test.ts`

**Interfaces:** `WorkspacePaths` exposes only `codespecDir`, `business`, `configuration`, `changes`, `changeIndex`, `currentSpecs`, and `transactions`. `loadChangeArtifacts()` resolves active Change directories only. Archive and rebase accept only `plan.richDelta` six-artifact Changes.

- [ ] **Step 1: Write failing path and layout tests**

```ts
it('rejects archive path settings', () => {
  expect(() => parseWorkspaceConfig({ ...config, paths: { ...config.paths, archive: 'archive' } }))
    .toThrow(/archive/i);
});

it('rejects a proposal-bearing Change before archive writes', async () => {
  const before = snapshotDirectory(fixture.codespecDir);
  await expect(archiveChange(fixture.workspace, fixture.changeId)).rejects.toThrow(/six-artifact/i);
  expect(snapshotDirectory(fixture.codespecDir)).toEqual(before);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- test/core/codespec-workflow/loaders.test.ts test/core/codespec-workflow/archive-transaction.test.ts`

Expected: FAIL because archive fields and legacy branches remain.

- [ ] **Step 3: Implement the Current-only contract**

```ts
export interface WorkspacePaths {
  codespecDir: string;
  business: string;
  configuration: string;
  changes: string;
  changeIndex: string;
  currentSpecs: string;
  transactions: string;
}

export async function prepareArchive(plan: ArchivePlan): Promise<PreparedArchive> {
  if (!plan.richDelta) throw new Error('归档仅支持六件套 Current Change');
  return prepareCurrentArchive(plan);
}
```

Remove `archive` and `archived_changes` from the canonical `code-spec` types, Zod schema, path resolution, loaders, fixtures, and rendered configuration. Keep the independent `spec-driven` schema and its generic archive command unchanged. Remove archived Change lookup, proposal/five-artifact archive and rebase branches, active-five-artifact migration, and legacy archive preview. Keep removal of an existing `codespec/archive/` directory only inside successful archive commit.

- [ ] **Step 4: Run focused verification**

Run: `npm test -- test/core/codespec-workflow/loaders.test.ts test/core/codespec-workflow/archive-transaction.test.ts test/core/codespec-workflow/stale-rebase.test.ts test/cli-e2e/codespec-workflow-journeys.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: stage the listed changes and deletions, then use `commit-log-writer` to create the commit.

### Task 2: Build one full Current-state fingerprint

**Files:**
- Create: `src/core/codespec-workflow/current-state.ts`
- Modify: `src/core/codespec-workflow/baseline.ts`
- Modify: `src/core/codespec-workflow/stale.ts`
- Modify: `src/core/codespec-workflow/schemas.ts`
- Modify: `src/core/codespec-workflow/types.ts`
- Modify: `src/core/codespec-workflow/archive-transaction.ts`
- Modify: `src/core/codespec-workflow/rebase.ts`
- Test: `test/core/codespec-workflow/baseline.test.ts`
- Test: `test/core/codespec-workflow/stale-rebase.test.ts`
- Test: `test/core/codespec-workflow/archive-transaction.test.ts`

**Interfaces:** `readCurrentState(workspace): Promise<CurrentStateSnapshot>` returns `fingerprint: string` and `files: ReadonlyMap<string, string>`. `ChangeMetadata.baseline.current_fingerprint` is required. `detectStaleChanges(workspace)` receives no Requirement IDs.

- [ ] **Step 1: Write failing full-state tests**

```ts
it.each(['interface.yaml', 'api.yaml', 'business.yaml', 'configuration.yaml'])(
  'changes the Current fingerprint when %s changes',
  async (file) => {
    const before = await readCurrentState(workspace);
    await fs.appendFile(resolveCurrentFile(fixture, file), '\n# changed\n');
    expect((await readCurrentState(workspace)).fingerprint).not.toBe(before.fingerprint);
  },
);

it('marks every remaining active Change stale after archive', async () => {
  await archiveChange(workspace, firstChangeId);
  expect((await loadChangeArtifacts(paths, secondChangeId)).metadata.baseline.stale).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- test/core/codespec-workflow/baseline.test.ts test/core/codespec-workflow/stale-rebase.test.ts`

Expected: FAIL because current baseline hashes selected Requirements only.

- [ ] **Step 3: Implement the shared reader**

```ts
export interface CurrentStateSnapshot {
  fingerprint: string;
  files: ReadonlyMap<string, string>;
}

export async function readCurrentState(workspace: WorkspaceContext): Promise<CurrentStateSnapshot> {
  // Read business.yaml, configuration.yaml, and each registered module's
  // spec.md and interface.yaml in lexical relative-path order. Read api.yaml
  // when present; otherwise derive its bytes from interface.yaml.
  // Reject symlinks, non-files, and missing required sources.
}
```

Hash stable relative paths and effective bytes. The derived `api.yaml` occupies its normal relative path in the snapshot, so a missing generated file and its equivalent rebuilt file have the same fingerprint. Store the fingerprint in `captureBaseline()`. After archive, compare the fresh fingerprint to every active Change and mark every mismatch stale. Rebase reads the same snapshot before deciding and before committing; it rejects missing `spec.md` or `interface.yaml` and permits a derived `api.yaml`.

- [ ] **Step 4: Run focused verification**

Run: `npm test -- test/core/codespec-workflow/baseline.test.ts test/core/codespec-workflow/stale-rebase.test.ts test/core/codespec-workflow/archive-transaction.test.ts`

Expected: PASS for full-state drift, global stale marking, missing `spec.md`/`interface.yaml` failures, and derived `api.yaml` handling.

- [ ] **Step 5: Commit**

Run: stage the listed changes, then use `commit-log-writer` to create the commit.

### Task 3: Remove obsolete CLI history operations

**Files:**
- Modify: `src/cli/index.ts`
- Modify: `src/commands/validate.ts`
- Modify: `src/core/codespec-workflow/rebase.ts`
- Modify: `test/cli-e2e/basic.test.ts`
- Modify: `test/core/codespec-workflow/stale-rebase.test.ts`
- Delete: `test/cli-e2e/validate-archived-tasks.test.ts`

**Interfaces:** `rebaseChange(workspace, changeId)` has no Current-path override. `codespec detect-stale` and `codespec validate --archived` are removed.

- [ ] **Step 1: Write failing command tests**

```ts
it('does not register --current-spec for rebase', async () => {
  const result = await runCLI(['rebase', '--change', id, '--current-spec', 'codespec/specs/MOD-001/spec.md']);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toMatch(/unknown option/i);
});

it('does not register archived validation or manual stale detection', async () => {
  expect((await runCLI(['validate', '--archived'])).stderr).toMatch(/unknown option/i);
  expect((await runCLI(['detect-stale'])).stderr).toMatch(/unknown command/i);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- test/cli-e2e/basic.test.ts test/core/codespec-workflow/stale-rebase.test.ts`

Expected: FAIL because the obsolete commands and option remain registered.

- [ ] **Step 3: Remove obsolete command code**

```ts
export async function rebaseChange(
  workspace: WorkspaceContext,
  changeId: string,
): Promise<RebaseResult> {
  const current = await readCurrentState(workspace);
  // Rebase always uses configured Current state.
}
```

Delete `--current-spec`, `detect-stale`, `--archived`, archived task traversal, and its test suite. Restrict `validate`, `status`, and `show` to active Changes and Current specs.

- [ ] **Step 4: Run focused verification**

Run: `npm test -- test/cli-e2e/basic.test.ts test/core/codespec-workflow/stale-rebase.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: stage the listed changes and deletion, then use `commit-log-writer` to create the commit.

### Task 4: Bind UI archive commit to a one-time preview token

**Files:**
- Modify: `src/core/ui-server.ts`
- Modify: `src/ui/web/app.js`
- Modify: `test/core/ui-server.test.ts`
- Modify: `test/core/ui-web.test.ts`

**Interfaces:** GET `/api/archive/:changeId` returns `confirmationToken`. POST accepts `{ "confirmationToken": "..." }`. The token is single-use, Change-bound, plan-bound, and expires after five minutes.

- [ ] **Step 1: Write failing server tests**

```ts
it('rejects archive POST without a confirmation token', async () => {
  const response = await fetch(`${server.url}/api/archive/${fixture.changeId}`, { method: 'POST' });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: 'archive_confirmation_required' });
});

it('accepts a preview token once and rejects reuse', async () => {
  const preview = await (await fetch(`${server.url}/api/archive/${fixture.changeId}`)).json();
  expect((await postArchive(server, fixture.changeId, preview.confirmationToken)).status).toBe(200);
  expect((await postArchive(server, fixture.changeId, preview.confirmationToken)).status).toBe(409);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- test/core/ui-server.test.ts test/core/ui-web.test.ts`

Expected: FAIL because POST commits without a body or token.

- [ ] **Step 3: Implement token storage and validation**

```ts
type PendingArchive = {
  changeId: string;
  expiresAt: number;
  plan: Awaited<ReturnType<typeof preflightArchive>>;
};

const pendingArchives = new Map<string, PendingArchive>();
```

On GET, preflight and retain the plan under a cryptographically random token. On POST, parse JSON, require a matching unexpired token, delete it before commit, and commit the retained plan. Update the web client to send the token only after its existing confirmation checkbox is checked.

- [ ] **Step 4: Run focused verification**

Run: `npm test -- test/core/ui-server.test.ts test/core/ui-web.test.ts`

Expected: PASS for absent, wrong-Change, expired, reused, and valid tokens.

- [ ] **Step 5: Commit**

Run: stage the listed changes, then use `commit-log-writer` to create the commit.

### Task 5: Remove historical guidance and validate the public contract

**Files:**
- Modify: `src/core/templates/workflows/archive-change.ts`
- Modify: `src/core/templates/workflows/bulk-archive-change.ts`
- Modify: `src/core/templates/workflows/codespec-workflow.ts`
- Modify: `docs/overview.md`
- Modify: `docs/workflows.md`
- Modify: `docs/cli.md`
- Modify: `docs/user-manual.md`
- Modify: `docs/how-commands-work.md`
- Modify or delete: tests asserting archived Change history, proposal workflows, slug Changes, or archived-task validation

**Interfaces:** Generated workflows and documentation name only six active artifacts and the Current archive result.

- [ ] **Step 1: Write a failing template test**

```ts
it('does not emit archive-history instructions', () => {
  const content = getCodespecArchiveCommandTemplate().content;
  expect(content).not.toMatch(/archive\/changes|archived Change/i);
  expect(content).toContain('specs/<模块>/{spec.md,interface.yaml,api.yaml}');
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- test/core/templates/workflows/archive-change.test.ts`

Expected: FAIL because templates still name archived Change history.

- [ ] **Step 3: Rewrite the public contract**

Remove every canonical statement that saves, reads, validates, or displays archived Change history. State that successful archive updates Current and removes the active Change. Remove old Change migration and proposal workflow guidance.

- [ ] **Step 4: Run final verification**

Run: `rg -n "archive/changes|changes/archive|archived Change|archived_changes" src docs test --glob '!docs/superpowers/plans/**' --glob '!docs/superpowers/specs/**'`

Expected: no canonical runtime, template, test, or user-document match.

Run: `npm run typecheck && npm test -- --reporter=dot`

Expected: type checking passes; report the exact count of unrelated existing failures if any remain.

- [ ] **Step 5: Commit**

Run: stage the listed changes, then use `commit-log-writer` to create the commit.

## Plan Self-Review

- Spec coverage: Task 1 removes paths and old Change branches; Task 2 creates global Current fingerprinting; Task 3 removes obsolete commands; Task 4 binds UI preview and commit; Task 5 removes stale guidance and validates the result.
- Completeness: every task contains the target files, failing test, implementation steps, verification command, and commit step.
- Type consistency: `readCurrentState(workspace)` writes one fingerprint through `captureBaseline`, reads it through stale detection, and refreshes it through rebase.
- Review focus coverage: Task 1 tests old layouts; Task 2 tests full-state drift and missing sources; Task 3 tests removed CLI interfaces; Task 4 tests token failures; Task 5 tests generated guidance.
