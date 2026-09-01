# Task 3 Report: Implement Change IDs, creation, deterministic resolution, and resume

## Status

- Status: complete
- Date: 2026-09-01
- Worktree: `/Users/wanglinan/Documents/01_工作/02_AI/01_project/CodeSpec/CodeSpec/.worktrees/openspec-superpowers-migration`

## Commit Hashes

- Task 3 implementation commit: `7ac8af6035b94274803671177ad0393826db86cf`
- Task 3 implementation parent: `b2929d286828b5e8f6fd89e7160adbf3cff458bc`

## Changed Files

- `src/core/openspec-workflow/change-manager.ts`
- `src/core/openspec-workflow/change-resolver.ts`
- `src/commands/workflow/new-change.ts`
- `src/commands/workflow/shared.ts`
- `src/cli/index.ts`
- `test/core/openspec-workflow/change-manager.test.ts`
- `test/commands/artifact-workflow.test.ts`
- `src/core/openspec-workflow/schemas.ts`

## TDD Evidence

### RED

Focused Task 3 command:

```bash
pnpm exec vitest run test/core/openspec-workflow/change-manager.test.ts test/commands/artifact-workflow.test.ts -t "allocates|guess|Change"
```

Output before implementation:

```text
 RUN  v3.2.6 /Users/wanglinan/Documents/01_工作/02_AI/01_project/CodeSpec/CodeSpec/.worktrees/openspec-superpowers-migration

 ❯ test/commands/artifact-workflow.test.ts (80 tests | 3 failed | 77 skipped) 845ms
   × artifact-workflow CLI commands > new change command > creates a canonical Change directory for code-spec workspaces
     → expected 'Created change \'my-new-feature\' at …' to contain 'Created change \'CHG-'
   × artifact-workflow CLI commands > new change command > supports deprecated change new as an alias for canonical Change creation
     → expected 1 to be +0 // Object.is equality
   × artifact-workflow CLI commands > new change command > rejects a user-supplied canonical Change id as the new change name
     → expected '✖ Error: Change name must be lowercas…' to contain 'canonical Change IDs are allocated au…'

 FAIL  test/core/openspec-workflow/change-manager.test.ts [ test/core/openspec-workflow/change-manager.test.ts ]
Error: Cannot find module '../../../src/core/openspec-workflow/change-manager.js' imported from '/Users/wanglinan/Documents/01_工作/02_AI/01_project/CodeSpec/CodeSpec/.worktrees/openspec-superpowers-migration/test/core/openspec-workflow/change-manager.test.ts'

 Test Files  2 failed (2)
      Tests  3 failed | 77 skipped (80)
```

Observed RED reason:

- the canonical change manager/resolver modules did not exist yet
- the CLI still created slug-named change directories
- the deprecated `openspec change new` path was not wired to the new workflow

### GREEN

Fresh build for CLI-backed tests:

```bash
pnpm run build
```

First build output exposed the compile blocker I had to clear before a truthful GREEN:

```text
src/commands/workflow/new-change.ts(169,41): error TS2551: Property 'changeId' does not exist on type 'CreateChangeResult | CreatedCanonicalChange'.
src/core/openspec-workflow/schemas.ts(359,3): error TS2322: Type '{ id: string; name: string; responsibilities: string[]; keywords: string[]; description?: string | undefined; }' is not assignable to type 'BusinessModule'.
src/core/openspec-workflow/schemas.ts(363,3): error TS2322: Type '{ schema_version: 1; change: { id: string; revision: number; title: string; mode: "feature" | "bugfix" | "refactor"; status: "ANALYZE" | "DESIGN" | "PLAN" | "IMPLEMENT" | "VERIFY" | "ARCHIVE" | "ARCHIVED" | "ABANDONED"; created_at: string; updated_at: string; }; ... }' is not assignable to type 'ChangeMetadata'.
❌ Build failed!
```

After the minimal fixes, the fresh build succeeded:

```text
> @fission-ai/openspec@1.11.0 build /Users/wanglinan/Documents/01_工作/02_AI/01_project/CodeSpec/CodeSpec/.worktrees/openspec-superpowers-migration
> node build.js

🔨 Building OpenSpec...

Cleaning dist directory...
Compiling TypeScript...
Version 6.0.3

✅ Build completed successfully!
```

Focused GREEN verification:

```bash
pnpm exec vitest run test/core/openspec-workflow/change-manager.test.ts test/commands/artifact-workflow.test.ts -t "allocates|guess|Change"
```

```text
 RUN  v3.2.6 /Users/wanglinan/Documents/01_工作/02_AI/01_project/CodeSpec/CodeSpec/.worktrees/openspec-superpowers-migration

 ✓ test/core/openspec-workflow/change-manager.test.ts (5 tests) 72ms
 ✓ test/commands/artifact-workflow.test.ts (80 tests | 77 skipped) 818ms
   ✓ artifact-workflow CLI commands > new change command > creates a canonical Change directory for code-spec workspaces  333ms

 Test Files  2 passed (2)
      Tests  8 passed | 77 skipped (85)
```

Implemented behavior:

- canonical `CHG-YYYYMMDD-NNN` allocation now scans both active and archived Change directories
- canonical code-spec creation now writes `metadata.yaml`, `proposal.md`, `design.md`, `spec.md`, `tasks.md`, `verification.md`, and updates `changes/index.yaml`
- resolver precedence now follows explicit ID, bound context, unique semantic match, sole active Change, then ambiguity
- shared workflow selector handling now resolves canonical Changes for status/instructions entry points
- `openspec new change` now allocates canonical IDs for canonical code-spec workspaces and rejects user-supplied canonical IDs
- deprecated `openspec change new` now forwards to the same creation path
- `resumeChange` now reloads metadata and emits a `STALE` diagnostic before `IMPLEMENT` and `ARCHIVE` when the baseline is stale

## Exact Commands Run

```bash
pnpm exec vitest run test/core/openspec-workflow/change-manager.test.ts test/commands/artifact-workflow.test.ts -t "allocates|guess|Change"
pnpm run build
pnpm run build
pnpm exec vitest run test/core/openspec-workflow/change-manager.test.ts test/commands/artifact-workflow.test.ts -t "allocates|guess|Change"
git diff --check
git add src/cli/index.ts src/commands/workflow/new-change.ts src/commands/workflow/shared.ts src/core/openspec-workflow/change-manager.ts src/core/openspec-workflow/change-resolver.ts src/core/openspec-workflow/schemas.ts test/commands/artifact-workflow.test.ts test/core/openspec-workflow/change-manager.test.ts
git commit -m "feat: migrate code-spec changes to canonical IDs"
```

Commit output:

```text
[codex/openspec-superpowers-migration 7ac8af6] feat: migrate code-spec changes to canonical IDs
 8 files changed, 790 insertions(+), 30 deletions(-)
 create mode 100644 src/core/openspec-workflow/change-manager.ts
 create mode 100644 src/core/openspec-workflow/change-resolver.ts
 create mode 100644 test/core/openspec-workflow/change-manager.test.ts
```

`git diff --check` result before the implementation commit: no output, exit code `0`.

## Concerns

- I made one minimal compile-boundary change in `src/core/openspec-workflow/schemas.ts` so the freshly rebuilt CLI could type-check against the stricter canonical interfaces; that file was not listed in the Task 3 sample `git add`, but without the cast the exact GREEN workflow could not be rebuilt honestly.
- The focused Task 3 verification intentionally covered the new canonical domain layer and CLI creation/alias behavior only. I did not broaden verification into later lifecycle-gate or archive-task surfaces.

## Review Fix Round

### Status

- Status: complete
- Review fix commit: `81f3499c077030c7576acedc76f8d1e61f40014f`
- Review fix parent: `0f260164de7883713201b820b71e9ca03f9d4f8b`

### Review Fix Scope

- Removed silent fallback from `new-change.ts` and `shared.ts` when a canonical `openspec/config.yaml` is present but canonical workspace loading fails.
- Updated `resolveChange()` so a semantic selector with no match falls through to sole-active resolution when exactly one active Change exists.
- Updated `resumeChange()` to reject terminal statuses and only resume active Change states.
- Replaced the broad parser return assertions in `schemas.ts` with typed canonical ID schemas so the Task 3 type mismatch is fixed at the schema boundary instead of the parser call sites.
- Made `createCanonicalChange()` publish via staging and temp index files, with cleanup on failure so a broken publish does not leave a partial canonical Change behind.

### RED

Focused review-fix command:

```bash
pnpm exec vitest run test/core/openspec-workflow/change-manager.test.ts test/commands/artifact-workflow.test.ts -t "canonical|semantic|resume|staged|legacy|falling back|loading is broken"
```

Output before the fix:

```text
 RUN  v3.2.6 /Users/wanglinan/Documents/01_工作/02_AI/01_project/CodeSpec/CodeSpec/.worktrees/openspec-superpowers-migration

 ❯ test/core/openspec-workflow/change-manager.test.ts (7 tests | 2 failed | 2 skipped) 245ms
   × openspec workflow change management > resolves Change selectors by explicit ID, bound context, semantic match, then sole active Change
     → promise rejected "Error: No active Change matches "no seman…" instead of resolving
   × openspec workflow change management > cleans up a staged Change when index publication fails 8ms
     → promise resolved "Stats{ ... }" instead of rejecting

 ❯ test/commands/artifact-workflow.test.ts (82 tests | 2 failed | 77 skipped) 1647ms
   × artifact-workflow CLI commands > status command > fails explicitly instead of resolving legacy slug Changes when canonical loading is broken 555ms
     → expected +0 to be 1 // Object.is equality
   × artifact-workflow CLI commands > new change command > fails explicitly instead of falling back when canonical workspace loading is broken 255ms
     → expected +0 to be 1 // Object.is equality

 Test Files  2 failed (2)
      Tests  4 failed | 6 passed | 79 skipped (89)
```

Observed RED reason:

- canonical workspace load errors were still swallowed and routed into legacy slug behavior
- semantic no-match raised immediately instead of allowing the sole-active fallback
- failed canonical publish left the partially created Change directory behind

### GREEN

Fresh build:

```bash
pnpm run build
```

```text
> @fission-ai/openspec@1.11.0 build /Users/wanglinan/Documents/01_工作/02_AI/01_project/CodeSpec/CodeSpec/.worktrees/openspec-superpowers-migration
> node build.js

🔨 Building OpenSpec...

Cleaning dist directory...
Compiling TypeScript...
Version 6.0.3

✅ Build completed successfully!
```

Focused verification after the fix:

```bash
pnpm exec vitest run test/core/openspec-workflow/change-manager.test.ts test/commands/artifact-workflow.test.ts -t "canonical|semantic|resume|staged|legacy|falling back|loading is broken"
```

```text
 RUN  v3.2.6 /Users/wanglinan/Documents/01_工作/02_AI/01_project/CodeSpec/CodeSpec/.worktrees/openspec-superpowers-migration

 ✓ test/core/openspec-workflow/change-manager.test.ts (7 tests | 2 skipped) 83ms
 ✓ test/commands/artifact-workflow.test.ts (82 tests | 77 skipped) 1359ms
   ✓ artifact-workflow CLI commands > status command > fails explicitly instead of resolving legacy slug Changes when canonical loading is broken  341ms

 Test Files  2 passed (2)
      Tests  10 passed | 79 skipped (89)
```

Diff hygiene:

```bash
git diff --check
```

```text
[no output]
```

### Exact Commands Run

```bash
pnpm exec vitest run test/core/openspec-workflow/change-manager.test.ts test/commands/artifact-workflow.test.ts -t "canonical|semantic|resume|staged|legacy|falling back|loading is broken"
pnpm run build
pnpm exec vitest run test/core/openspec-workflow/change-manager.test.ts test/commands/artifact-workflow.test.ts -t "canonical|semantic|resume|staged|legacy|falling back|loading is broken"
git diff --check
git add src/commands/workflow/new-change.ts src/commands/workflow/shared.ts src/core/openspec-workflow/change-manager.ts src/core/openspec-workflow/change-resolver.ts src/core/openspec-workflow/schemas.ts test/commands/artifact-workflow.test.ts test/core/openspec-workflow/change-manager.test.ts
git commit -m "fix: tighten canonical task 3 change workflow"
```

Commit output:

```text
[codex/openspec-superpowers-migration 81f3499] fix: tighten canonical task 3 change workflow
 7 files changed, 207 insertions(+), 38 deletions(-)
```

### Updated Concerns

- This review fix deliberately removed the broad parser-return casts and replaced them with typed canonical ID schemas only in `src/core/openspec-workflow/schemas.ts`; I did not broaden the change into later workflow modules.
- The explicit no-fallback behavior is limited to the Task 3 canonical detection path: when `openspec/config.yaml` is present, canonical loading errors now surface directly instead of dropping into legacy slug compatibility.

## Collision Fix Round

### Status

- Status: complete
- Collision fix commit: `f78700b3c3db322bf6ebb544ec2deca972eb6871`
- Collision fix parent: `b3878fabac4d015592e2e2872bd1b0d3ef8f519f`

### Collision Fix Scope

- `createCanonicalChange()` now tracks whether this invocation successfully published `stagingDir` into `changeDir` before cleanup.
- Failure cleanup removes `changeDir` only when this invocation owns the destination; a preexisting colliding destination is preserved.
- Added a focused regression test that forces a destination collision immediately before publish and verifies the existing Change stays intact while the temporary staging directory is removed.

### RED

Focused collision regression:

```bash
pnpm exec vitest run test/core/openspec-workflow/change-manager.test.ts -t "collides|staged Change"
```

Output before the ownership fix:

```text
 RUN  v3.2.6 /Users/wanglinan/Documents/01_工作/02_AI/01_project/CodeSpec/CodeSpec/.worktrees/openspec-superpowers-migration

 ❯ test/core/openspec-workflow/change-manager.test.ts (8 tests | 1 failed | 6 skipped) 26ms
   ✓ openspec workflow change management > cleans up a staged Change when index publication fails 20ms
   × openspec workflow change management > preserves an existing destination Change when publish collides after allocation 6ms
     → Cannot spy on export "rename". Module namespace is not configurable in ESM.
```

After converting the regression to a real collision hook, the failure reproduced against the actual Task 3 bug:

```text
 RUN  v3.2.6 /Users/wanglinan/Documents/01_工作/02_AI/01_project/CodeSpec/CodeSpec/.worktrees/openspec-superpowers-migration

 ❯ test/core/openspec-workflow/change-manager.test.ts (8 tests | 1 failed | 6 skipped) 1340ms
   ✓ openspec workflow change management > cleans up a staged Change when index publication fails 19ms
   × openspec workflow change management > preserves an existing destination Change when publish collides after allocation 1320ms
     → promise resolved "{ changeId: 'CHG-20260901-001', … }" instead of rejecting
```

Observed RED reason:

- cleanup always treated `changeDir` as owned by the current invocation
- the regression needed a deterministic pre-rename collision to reproduce the destination-ownership bug in this harness

### GREEN

Build verification:

```bash
pnpm run build
```

```text
> @fission-ai/openspec@1.11.0 build /Users/wanglinan/Documents/01_工作/02_AI/01_project/CodeSpec/CodeSpec/.worktrees/openspec-superpowers-migration
> node build.js

🔨 Building OpenSpec...

Cleaning dist directory...
Compiling TypeScript...
Version 6.0.3

✅ Build completed successfully!
```

Focused collision verification:

```bash
pnpm exec vitest run test/core/openspec-workflow/change-manager.test.ts -t "collides|staged Change"
```

```text
 RUN  v3.2.6 /Users/wanglinan/Documents/01_工作/02_AI/01_project/CodeSpec/CodeSpec/.worktrees/openspec-superpowers-migration

 ✓ test/core/openspec-workflow/change-manager.test.ts (8 tests | 6 skipped) 27ms

 Test Files  1 passed (1)
      Tests  2 passed | 6 skipped (8)
```

Diff hygiene:

```bash
git diff --check
```

```text
[no output]
```

### Exact Commands Run

```bash
pnpm exec vitest run test/core/openspec-workflow/change-manager.test.ts -t "collides|staged Change"
pnpm exec vitest run test/core/openspec-workflow/change-manager.test.ts -t "collides|staged Change"
pnpm run build
pnpm exec vitest run test/core/openspec-workflow/change-manager.test.ts -t "collides|staged Change"
git diff --check
git add src/core/openspec-workflow/change-manager.ts test/core/openspec-workflow/change-manager.test.ts
git commit -m "fix: preserve colliding canonical change destinations"
```

Commit output:

```text
[codex/openspec-superpowers-migration f78700b] fix: preserve colliding canonical change destinations
 2 files changed, 48 insertions(+), 1 deletion(-)
```

### Updated Concerns

- The deterministic collision regression uses a tiny test-only hook in `change-manager.ts` so the test can force the exact pre-rename race without broadening runtime behavior.
- Collision errors surfaced as `EEXIST` or `ENOTEMPTY` depending on filesystem behavior, so the regression asserts destination preservation rather than pinning to one platform-specific error code.
