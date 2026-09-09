# Task 4 Report

## Outcome

- Connected the unified all-Change table's `归档` action to `openArchiveConfirmation(candidate)` as the only UI archive write path.
- Kept the existing GET preflight and POST archive transaction, with an explicit impact-confirmation checkbox required before enabling `确认归档`.
- Grouped the confirmation view into Change 信息、关联模块/需求、SDD 等级与状态、门禁结果、Spec 影响、归档目标、Verification Receipt.
- Preserved the current Change-table filter context after successful archive; POST failures keep the dialog open and show the server error without retrying.
- Unified current-spec archive requests with the canonical preflight/prepare/commit flow so ineligible Changes return 409 without committing.

## Files

- `src/ui/web/app.js`
- `src/ui/web/styles.css`
- `src/core/ui-server.ts`
- `test/core/ui-web.test.ts`
- `test/core/ui-server.test.ts`

## Verification

- `pnpm exec vitest run test/core/ui-server.test.ts test/core/ui-web.test.ts` — 13 passed.
- `pnpm run typecheck` — passed.
- `pnpm run lint` — passed.
- `node --check src/ui/web/app.js` — passed.
- `git diff --check` — passed.
- `pnpm test` — 4446/4447 tests passed; the only failure is the pre-existing `test/core/ui-web-assets.test.ts` contract requiring removed archive-history symbols (`renderArchiveHistory`, `changeButton`, `groupChangesByModule`). HEAD's baseline `src/ui/web/app.js` already lacked those symbols.

## Concerns

- The focused server tests need permission to bind `127.0.0.1`; they were run with the required sandbox escalation.
- No browser acceptance was added; the task scope remains static UI contracts plus server archive-flow tests.
- The full suite remains blocked by the out-of-scope stale UI asset test above; that test was intentionally not changed to preserve Task 4 scope.
