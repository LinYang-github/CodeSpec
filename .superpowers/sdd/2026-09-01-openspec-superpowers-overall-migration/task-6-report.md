# Task 6 Report

Status: complete

Commit: `b96b9a64bc4ad183d78bfa5d47f045f675c73758` (amended below only if report metadata changes)

## Files

- `src/core/openspec-workflow/verification.ts`
- `src/core/openspec-workflow/baseline.ts`
- `src/core/openspec-workflow/stale.ts`
- `src/core/openspec-workflow/rebase.ts`
- `src/commands/workflow/instructions.ts`
- `src/cli/index.ts`
- `test/core/openspec-workflow/verification.test.ts`
- `test/core/openspec-workflow/stale-rebase.test.ts`
- `test/helpers/openspec-workflow.ts` (fixture contract support)

## TDD evidence

RED command:

```text
pnpm exec vitest run test/core/openspec-workflow/verification.test.ts test/core/openspec-workflow/stale-rebase.test.ts
```

Output: both suites failed during collection with `Cannot find module .../verification.js` and `Cannot find module .../stale.js`; 0 tests ran.

GREEN command:

```text
pnpm exec vitest run test/core/openspec-workflow/verification.test.ts test/core/openspec-workflow/stale-rebase.test.ts
```

Output: `2 passed (2)`, `3 passed (3)`.

Additional verification:

```text
pnpm exec vitest run test/core/openspec-workflow/verification.test.ts test/core/openspec-workflow/stale-rebase.test.ts && pnpm exec tsc --noEmit
```

Output: focused tests `2 passed (2)`, `3 passed (3)`; TypeScript compiler exited 0 with no diagnostics.

## Implementation notes

Fresh verification executes each supplied command, persists exit status, bounded output summary, timestamps, and Requirement/Scenario coverage to `verification.md`. Baselines capture confirmed-module Change references and affected Requirement IDs. Stale detection scans active canonical Changes and marks only Requirement-overlapping metadata stale. Rebase requires a stale baseline, increments the revision, persists DESIGN status, refreshes the baseline, and emits an explicit semantic decision payload routed to DESIGN. CLI instructions include TDD/fresh-verification/Rebase context, and `openspec rebase --change ...` exposes the flow.

## Concerns

- The public brief types `rebaseChange` as returning `ChangeMetadata`, while its example accesses `result.change` and `result.baseline`; the implementation follows the example and returns `{ change, baseline, decision }`.
- Command execution uses the shell for the requested command strings; callers should provide trusted workflow commands.
- Current-spec paths are accepted as explicit rebase decision context; artifact rewriting remains intentionally limited to the existing canonical design artifact path because no later archive/authoring task was modified.

## Scoped review fix round

Changes: deterministic SHA-256 hashes for canonical module specs and affected Requirement blocks; Requirement-level stale overlap; fresh evidence validation for non-empty commands, VERIFY/ARCHIVE state, PASS status, current revision, and Requirement coverage; deterministic structured Requirement-heading merge during Rebase with explicit conflict decision routed to DESIGN; additional unrelated-change and hash/edge coverage tests.

RED command:

```text
pnpm exec vitest run test/core/openspec-workflow/verification.test.ts test/core/openspec-workflow/stale-rebase.test.ts
```

Output: `1 failed` (`expected [] to deeply equal [ 'CHG-20260901-001' ]`) in the new hash/unrelated-change test because the implementation did not yet persist/calculate the required baseline/stale behavior; other tests passed.

GREEN/build/lint command:

```text
pnpm exec vitest run test/core/openspec-workflow/verification.test.ts test/core/openspec-workflow/stale-rebase.test.ts && pnpm run build && pnpm run lint && git diff --check
```

Output: focused tests `2 passed (2)`, `5 passed (5)`; build `✅ Build completed successfully!`; lint exited 0 with no diagnostics; `git diff --check` exited 0.

Fix-round commit: `70823e33e0d80d7d68bdc982215f5dbf046ed068`
