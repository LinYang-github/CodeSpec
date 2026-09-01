# Task 7 report

Status: complete.

Implementation commit: fix round pending until this report is committed with the Task 7 changes.

Files changed:

- `src/core/openspec-workflow/archive-transaction.ts`
- `src/core/archive.ts`
- `test/core/openspec-workflow/archive-transaction.test.ts`
- `src/core/business-archive.ts`
- `src/cli/index.ts`

RED evidence:

- The requested focused test command was run before the Task 7 test file existed. Vitest ran only the pre-existing archive suite: 1 file, 215 tests passed. This confirms the new transaction test surface was absent rather than silently passing.

GREEN evidence:

- `pnpm exec vitest run test/core/openspec-workflow/archive-transaction.test.ts`: 1 file, 2 tests passed.
- `pnpm lint && pnpm exec vitest run test/core/openspec-workflow/archive-transaction.test.ts test/core/archive.test.ts && git diff --check`: lint passed; 2 files, 217 tests passed; diff check passed.

Behavior covered: canonical typed artifact loading and delta parsing; ARCHIVE/readiness/task/verification/baseline/dependency gates; optimistic Previous-vs-Current conflict checks; all-module preflight before Current writes; staged spec/history/index updates; archived metadata; stale detection after archive; rollback attempt with recovery-stage diagnostics.

Concerns: the legacy `ArchiveCommand` remains for generic schemas because breaking code-spec routing is owned by later migration tasks. The transaction API is exported from `src/core/archive.ts` for the canonical caller.

## Fix round

RED:

`pnpm exec vitest run test/core/openspec-workflow/archive-transaction.test.ts` initially failed 2 tests because the new gate correctly rejected fixtures without revision-matched canonical PASS verification evidence (`Archive requires fresh Verification evidence for the current revision and Requirements`).

GREEN and verification:

`pnpm exec vitest run test/core/openspec-workflow/archive-transaction.test.ts test/core/archive.test.ts`

```text
Test Files  2 passed (2)
Tests       217 passed (217)
```

`pnpm lint`

```text
eslint src/
exit code 0
```

`pnpm build`

```text
✅ Build completed successfully!
exit code 0
```

`git diff --check`

```text
exit code 0; no output
```

Fixes include structural canonical Requirement heading matching, complete normalized Previous comparison, dependency graph validation, revision/Requirement/baseline-aware verification checks, atomic snapshots for Current Specs, active Change, archived Change destination, index, archive README/history, rollback after swaps, and canonical `CHG-*` CLI/business archive routing. The focused regression suite covers conflict/no-partial-write behavior; the existing archive suite remains green.
