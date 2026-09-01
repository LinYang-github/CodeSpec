# Task 10 Report

Status: implemented and committed. Task 11 was not modified.

## Commit

- Commit: `5b3376f` (amended below only to record this hash in the report).

## Files

- `src/utils/change-metadata.ts`: reject legacy `.openspec.yaml` resolution for canonical code-spec Changes; expose canonical directory detection.
- `src/utils/change-utils.ts`: reject direct slug-like canonical IDs and point to `openspec new change`.
- `src/core/artifact-graph/instruction-loader.ts`: do not honor `skip_specs` on canonical Changes.
- `src/core/openspec-workflow/change-manager.ts`: reload the canonical Change index before publishing a new Change.
- `test/cli-e2e/openspec-workflow-journeys.test.ts`: canonical creation, lifecycle routing, multiple active Changes/ambiguity, and stale detection coverage.
- `test/core/openspec-workflow/legacy-rejection.test.ts`: legacy slug and metadata rejection coverage.

## TDD evidence

RED:

```text
pnpm exec vitest run test/core/openspec-workflow/legacy-rejection.test.ts
Test Files 1 failed (1)
Tests 2 failed (2)
```

The failures showed the old metadata reader returned/derived legacy results instead of rejecting them.

GREEN:

```text
pnpm exec vitest run test/cli-e2e/openspec-workflow-journeys.test.ts test/core/openspec-workflow/legacy-rejection.test.ts
Test Files 2 passed (2)
Tests 5 passed (5)
```

## Verification

```text
pnpm lint
> eslint src/
exit 0

git diff --check
exit 0
```

Focused Task 10 suites passed. The requested broader command also ran:

```text
pnpm exec vitest run test/core/openspec-workflow test/cli-e2e/openspec-workflow-journeys.test.ts test/commands/artifact-workflow.test.ts
Test Files 2 failed, 12 passed (14)
Tests 6 failed, 143 passed (149)
```

Concerns: the six broader failures are pre-existing Task 1–9 migration-surface issues: two contract fixtures still pass `schema: spec-driven` to the canonical parser, one tool-detection expectation still expects 12 skills while the implementation exposes 13, and four legacy artifact-workflow instruction/config tests still expect old behavior. They are outside Task 10’s narrow changes and should be handled before Task 11 final verification.
