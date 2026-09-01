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
