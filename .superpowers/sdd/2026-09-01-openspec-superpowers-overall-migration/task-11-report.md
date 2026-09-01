# Task 11 remediation report

## Exact inventory

- `schema.test.ts`: `config.yml` update-in-place regression.
- `github-copilot-cloud-agent.test.ts`: `config.yml` persistence regression.
- `init.test.ts`: language error wrapping and best-effort semantics.
- `project-config.test.ts` / `root-selection.test.ts`: `.yml` fallback, precedence, and origin.
- `command-registry.test.ts`: deprecated `change new` completion parity.
- `skill-generation.test.ts`: intentional `openspec-workflow` skill and generic formatting.
- `declared-store-fallback.test.ts`: obsolete legacy filesystem expectation at the breaking migration boundary.
- `version-check.test.ts`: 16 loopback listener `EPERM` environment errors.

## Environment caveat

The restricted local environment cannot bind `127.0.0.1`; the 16 version-check listener errors are environmental and require the requested escalated run.

## Remediation round 2 results

Escalated focused run: `version-check.test.ts` passed all 48 tests; `declared-store-fallback.test.ts` passed all 5 tests after asserting canonical `archive/specs`; `init.test.ts` passed all 120 tests. The remaining completion failures were non-environmental and fixed by adding the `rebase` registry entry and complete deprecated `change new` flags. The store-selection guidance still needs the alias text synchronized in a follow-up if its generated guidance assertion remains red.

## Remediation round 3 results

- Synchronized generated store-selection guidance with every visible `--store` command: `new change`, deprecated `change new`, `status`, `instructions`, `list`, `show`, `validate`, `archive`, `doctor`, `context`, `schemas`, and `view`.
- Removed the phantom `spec new` completion entry; retained the visible deprecated `change new` alias and its matching flags.
- Updated README and CHANGELOG with the breaking canonical layout (`business.md`, `changes/CHG-*`, `archive/specs`, `archive/changes`), explicit archive, and unsupported slug/`.openspec.yaml` behavior. Generic schema guidance remains scoped to explicitly configured non-code-spec workflows.
- Regenerated 13 deployed skills and refreshed 37 parity hashes.
- Targeted parity: 39/39 tests passed.
- Escalated verification: lint passed; build passed; 4,308/4,311 repository tests passed. The 48 version-check tests passed with loopback access, so no EPERM listener failures remained. Three date-sensitive workflow tests failed because the environment date is 2026-09-02 while fixtures expect 2026-09-01; no legacy fallback was restored and no tests were skipped.
- `git diff --check`: passed.

## Remediation round 4 results

- Root cause: three tests hard-coded `CHG-20260901-001` while production allocation correctly follows the local current date:
  - `canonical OpenSpec workflow journeys > supports multiple active Changes but rejects ambiguous semantic selection` (`test/cli-e2e/openspec-workflow-journeys.test.ts`)
  - `openspec workflow change management > creates a canonical Change with metadata, artifacts, and navigation index entry` (`test/core/openspec-workflow/change-manager.test.ts`)
  - `openspec workflow change management > preserves an existing destination Change when publish collides after allocation` (`test/core/openspec-workflow/change-manager.test.ts`)
- Made the tests deterministic without changing migration behavior: the journey derives the explicit ID from the created Change; the two date-sensitive manager tests inject a fixed `2026-09-01` clock, and collision paths derive the allocated ID.
- Focused regression run: 11/11 tests passed.
- Final escalated verification command `pnpm lint && pnpm build && pnpm generate:skills && pnpm test && git diff --check`: lint passed, build passed, 13 skills generated, 159 test files and 4,311/4,311 tests passed, including `version-check.test.ts` 48/48 with loopback access, and diff-check passed.
