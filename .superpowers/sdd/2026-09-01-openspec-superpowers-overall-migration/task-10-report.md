# Task 10 Report

Status: reviewed, fixed, and committed. Task 11 was not modified.

## Commit

- Prior Task 10 commit: `80fff09`.
- Review-fix commit: `c57c895`.
- Fixture/regression-test commit: `da6c7ab`.
- Fix round 2 commit: pending until this report update is committed.

## Files

- `src/utils/change-metadata.ts`: reject legacy `.openspec.yaml` resolution for canonical code-spec Changes; expose canonical directory detection.
- `src/utils/change-utils.ts`: reject direct slug-like canonical IDs and point to `openspec new change`.
- `src/core/artifact-graph/instruction-loader.ts`: do not honor `skip_specs` on canonical Changes.
- `src/core/openspec-workflow/change-manager.ts`: reload the canonical Change index before publishing a new Change.
- `test/cli-e2e/openspec-workflow-journeys.test.ts`: canonical creation, lifecycle routing, multiple active Changes/ambiguity, and stale detection coverage.
- `test/core/openspec-workflow/legacy-rejection.test.ts`: legacy slug and metadata rejection coverage, including write protection.
- `test/commands/artifact-workflow.test.ts`: migrated canonical fixtures to `schema: code-spec` and updated the skill-count expectation.
- `src/commands/workflow/shared.ts`, `src/commands/workflow/new-change.ts`, `src/commands/workflow/instructions.ts`: scope canonical routing to `schema: code-spec`, support lifecycle stage instruction names, and preserve generic spec-driven behavior.
- `src/core/templates/workflows/openspec-workflow.ts`: include explicit current lifecycle status in canonical context.

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

## Review-fix TDD evidence

The broader suite initially reproduced 6 failures (2 canonical contract fixtures, 1 skill-count expectation, and 3 CLI fixture/routing failures). After scoping canonical detection to `schema: code-spec`, migrating the broken canonical fixtures, and rebuilding the CLI, the focused failing cases passed:

```text
pnpm exec vitest run test/commands/artifact-workflow.test.ts -t 'fails explicitly instead|canonical analyze|fails explicitly instead of falling back'
Test Files 1 passed (1)
Tests 3 passed (3)
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
pnpm build
✅ Build completed successfully!

pnpm lint && pnpm exec vitest run test/core/openspec-workflow test/cli-e2e/openspec-workflow-journeys.test.ts test/commands/artifact-workflow.test.ts && git diff --check
Test Files 14 passed (14)
Tests 150 passed (150)
exit 0
```

Concerns: full repository verification remains Task 11 scope. The required Task 10 focused and broader migration suites are green.

## Fix round 2

- Replaced raw-text canonical detection in `shared.ts`, `new-change.ts`, and `instructions.ts` with structural YAML parsing and canonical workspace loading. Quoted schema formatting is covered by the CLI fixture; generic `spec-driven` configs continue through the generic path.
- Expanded `WorkflowStage` to include `analyze`, `design`, `plan`, and `implement`; stage selection now uses a type guard with no unsafe cast.
- Updated legacy metadata comments to describe `.openspec.yaml` only as generic-workflow metadata.

Exact verification:

```text
pnpm build
✅ Build completed successfully!

pnpm lint
> eslint src/
exit 0

pnpm exec vitest run test/core/openspec-workflow test/cli-e2e/openspec-workflow-journeys.test.ts test/commands/artifact-workflow.test.ts
Test Files 14 passed (14)
Tests 150 passed (150)

pnpm exec vitest run test/commands/artifact-workflow.test.ts && git diff --check
Test Files 1 passed (1)
Tests 85 passed (85)
exit 0
```
