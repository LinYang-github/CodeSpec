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
