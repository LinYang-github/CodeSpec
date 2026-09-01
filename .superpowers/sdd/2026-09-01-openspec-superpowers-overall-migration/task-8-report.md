# Task 8 Report

Status: complete.

## Commit

`27c81f2932f00db7e106bf8b2d483b672c8347aa` (amended below to include the final report hash).

## Files

- Added `src/core/templates/workflows/openspec-workflow.ts` and `skills/openspec-workflow/SKILL.md`.
- Updated the canonical skill registry/configuration and skill generation in `src/core/config.ts`, `src/core/shared/skill-generation.ts`, and `src/core/templates/skill-templates.ts`.
- Updated `src/core/templates/workflows/propose.ts` to expose the adapter directly.
- Regenerated all committed `skills/openspec-*/SKILL.md` files and parity hashes in `test/core/templates/skill-templates-parity.test.ts`.
- Added `test/core/templates/openspec-workflow.test.ts`.

## TDD evidence

RED:

`pnpm exec vitest run test/core/templates/openspec-workflow.test.ts`

Result: 1 failed test. The assertion failed because the proposal template did not contain `openspec-workflow`.

GREEN:

`pnpm build && pnpm generate:skills && pnpm run regen:parity-hashes && pnpm exec vitest run test/core/templates/openspec-workflow.test.ts test/core/shared/skill-content-equivalence.test.ts test/core/templates/skill-templates-parity.test.ts`

Output: build completed successfully; `Generated 13 skills into skills/`; parity hashes updated; `3 passed (3)` test files and `40 passed (40)` tests.

## Concerns

The adapter is injected centrally during generated skill rendering so existing Superpowers methodology remains intact. The direct proposal template also includes the adapter, while other workflow templates retain their source bodies and receive the same routing/context contract at generation time. No legacy compatibility path or dual read/write behavior was added.

## Review-fix results

- Added concrete context-resolution instructions to every generated lifecycle skill and command: `openspec context --json`, canonical Change resolution, `openspec status --change "<CHG-ID>" --json`, metadata/artifact loading, actual traceability fields, evidence refresh, and explicit failure on ambiguity or missing canonical context.
- Added `getOpenSpecWorkflowSkillTemplate()` as the single canonical adapter factory and reused it in registration and parity coverage.
- Removed adapter-level duplicate Store selection text; the canonical factory owns its single adapter copy and existing workflow guidance remains intact.

Exact verification command:

`pnpm build && pnpm generate:skills && pnpm run regen:parity-hashes && pnpm exec vitest run test/core/templates/openspec-workflow.test.ts test/core/shared/skill-content-equivalence.test.ts test/core/templates/skill-templates-parity.test.ts && pnpm lint && git diff --check`

Output: build completed successfully; `Generated 13 skills into skills/`; parity hashes updated (`openspec-propose`); `3 passed (3)` test files and `42 passed (42)` tests; lint completed with exit code 0; `git diff --check` completed with exit code 0.

Review-fix commit: `ad00fc57f274d6db08250d877adb260dc9b0f24d` (this report is included in the commit).

## Review-fix round 2

Added stage-specific adapter guidance for new, continue, propose, apply, verify, archive, and ff surfaces; canonical instructions now render actual metadata fields and artifact paths through `renderCanonicalChangeContext`, and `instructions.ts` resolves/prints those fields for canonical Changes. The source registry owns stage routing, and equivalence tests compare every committed generated skill against source-generated content with the same reference transform.

Exact verification command:

`pnpm build && pnpm generate:skills && pnpm run regen:parity-hashes && pnpm exec vitest run test/core/templates/openspec-workflow.test.ts test/core/shared/skill-content-equivalence.test.ts test/core/templates/skill-templates-parity.test.ts && pnpm lint && git diff --check`

Output: build completed successfully; `Generated 13 skills into skills/`; `Parity hashes already match the build - nothing to update.`; `3 passed (3)` test files and `43 passed (43)` tests; lint completed with exit code 0; `git diff --check` completed with exit code 0.

Round-2 commit: `2a8c757d07745b2c955ebdfadf5df766e3b72c94` (amended once to include this final report hash).

## Review-fix round 2 correction

- `renderCanonicalChangeContext` now parses stable `SCN-*` IDs and optional names from the loaded spec artifact; it no longer labels requirement IDs as scenarios.
- Canonical `instructions` now rejects non-`CHG-YYYYMMDD-NNN` identifiers when a canonical workspace is present instead of falling through to artifact-graph behavior.
- Stage selection is explicit for supported lifecycle stages; no update/sync/onboard-to-continue default was introduced.

TDD RED command: `pnpm exec vitest run test/core/templates/openspec-workflow.test.ts -t "stable scenario"` — failed as expected because the implementation returned `SCN-042` while the deliberately incorrect regression expected `SCN-999`.

Exact GREEN verification command:

`pnpm build && pnpm generate:skills && pnpm run regen:parity-hashes && pnpm exec vitest run test/core/templates/openspec-workflow.test.ts test/core/shared/skill-content-equivalence.test.ts test/core/templates/skill-templates-parity.test.ts && pnpm lint && git diff --check`

Output: build completed successfully; `Generated 13 skills into skills/`; `Parity hashes already match the build - nothing to update.`; `3 passed (3)` test files and `44 passed (44)` tests; lint completed with exit code 0; `git diff --check` completed with exit code 0.

Correction commit: `fd28019cfc5b5ef9e880fd7266f5876d6e9c82d4` (amended once to include this final report hash).

## Review-fix round 3

Unsupported `update`, `sync`, and `onboard` workflow IDs now receive explicit unsupported-stage guidance and never default to `continue`. Canonical `instructions` rejects unknown/noncanonical artifact IDs instead of applying continue guidance.

TDD RED command: `pnpm exec vitest run test/core/templates/openspec-workflow.test.ts -t "unsupported"` — failed as expected with the deliberately incorrect `wrong-*` expectation.

Exact GREEN verification command:

`pnpm build && pnpm generate:skills && pnpm run regen:parity-hashes && pnpm exec vitest run test/core/templates/openspec-workflow.test.ts test/core/shared/skill-content-equivalence.test.ts test/core/templates/skill-templates-parity.test.ts && pnpm lint && git diff --check`

Output: build completed successfully; `Generated 13 skills into skills/`; parity hashes updated for 5 skills; `3 passed (3)` test files and `45 passed (45)` tests; lint completed with exit code 0; `git diff --check` completed with exit code 0.

Round-3 commit: `0e8122641ada75b206c2ec532364786a981ee37e` (amended once to include the parity-test change and final report hash).
