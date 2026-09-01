# Task 2 Report: Load the workspace, module registry, Change index, and artifacts

## Status

- Status: complete
- Date: 2026-09-01
- Worktree: `/Users/wanglinan/Documents/01_工作/02_AI/01_project/CodeSpec/CodeSpec/.worktrees/openspec-superpowers-migration`

## Commit Hashes

- Task 2 implementation commit: `9d3123977226d198b86e87406eb008b64bf9b360`
- Task 2 implementation parent: `d7945af996768c7bff583bfce90bafc84262ede5`
- Follow-up canonical config fix: `ea5d55a86d504f4a2778990f7a7481d3b73a10d5`
- Scoped review fix round: pending commit

## Changed Files

- `src/core/openspec-workflow/loaders.ts`
- `src/core/openspec-workflow/business-registry.ts`
- `src/core/openspec-workflow/change-index.ts`
- `src/core/openspec-workflow/artifacts.ts`
- `src/core/openspec-workflow/paths.ts`
- `src/core/project-config.ts`
- `src/core/init.ts`
- `test/core/openspec-workflow/loaders.test.ts`
- `test/core/init.test.ts`
- `test/helpers/openspec-workflow.ts`

## TDD Evidence

### RED

Focused Task 2 command:

```bash
pnpm exec vitest run test/core/openspec-workflow/loaders.test.ts test/core/init.test.ts -t "canonical|module|duplicate"
```

Output before implementation:

```text
 RUN  v3.2.6 /Users/wanglinan/Documents/01_工作/02_AI/01_project/CodeSpec/CodeSpec/.worktrees/openspec-superpowers-migration

 ❯ test/core/init.test.ts (119 tests | 1 failed | 118 skipped) 56ms
   × InitCommand > execute with --tools flag > should create canonical openspec workspace files without deleting legacy files 55ms
     → expected false to be true // Object.is equality

 FAIL  test/core/openspec-workflow/loaders.test.ts [ test/core/openspec-workflow/loaders.test.ts ]
Error: Cannot find module '../../../src/core/openspec-workflow/loaders.js' imported from '/Users/wanglinan/Documents/01_工作/02_AI/01_project/CodeSpec/CodeSpec/.worktrees/openspec-superpowers-migration/test/core/openspec-workflow/loaders.test.ts'

 Test Files  2 failed (2)
      Tests  1 failed | 118 skipped (119)
```

Observed RED reason: the canonical loader layer did not exist yet, and init still created the retired layout instead of the canonical `business.md`, `changes/index.yaml`, `archive/specs`, and `archive/changes` structure.

Follow-up TDD for the language-aware canonical config edge:

```bash
pnpm exec vitest run test/core/init.test.ts -t "canonical config when language context is requested"
```

```text
 RUN  v3.2.6 /Users/wanglinan/Documents/01_工作/02_AI/01_project/CodeSpec/CodeSpec/.worktrees/openspec-superpowers-migration

 ❯ test/core/init.test.ts (120 tests | 1 failed | 119 skipped) 62ms
   × InitCommand > execute with --tools flag > should create canonical config when language context is requested 61ms
     → expected 'schema: spec-driven\n\ncontext: |\n  …' to contain 'version: 1'

 Test Files  1 failed (1)
      Tests  1 failed | 119 skipped (120)
```

Observed RED reason: the `--language` path still emitted the older minimal config shape instead of the canonical workspace config.

### GREEN

Main Task 2 verification:

```bash
pnpm exec vitest run test/core/openspec-workflow/loaders.test.ts test/core/init.test.ts -t "canonical|module|duplicate"
```

```text
 RUN  v3.2.6 /Users/wanglinan/Documents/01_工作/02_AI/01_project/CodeSpec/CodeSpec/.worktrees/openspec-superpowers-migration

 ✓ test/core/openspec-workflow/loaders.test.ts (4 tests) 48ms
- Creating OpenSpec structure...
▌ OpenSpec structure created
 ✓ test/core/init.test.ts (120 tests | 118 skipped) 108ms

 Test Files  2 passed (2)
      Tests  6 passed | 118 skipped (124)
```

Follow-up canonical config verification:

```bash
pnpm exec vitest run test/core/init.test.ts -t "canonical config when language context is requested"
```

```text
 RUN  v3.2.6 /Users/wanglinan/Documents/01_工作/02_AI/01_project/CodeSpec/CodeSpec/.worktrees/openspec-superpowers-migration

- Creating OpenSpec structure...
▌ OpenSpec structure created
 ✓ test/core/init.test.ts (120 tests | 119 skipped) 71ms

 Test Files  1 passed (1)
      Tests  1 passed | 119 skipped (120)
```

Implemented behavior:

- `loadWorkspace(openspecDir)` now reads `config.yaml` first, resolves canonical configured paths, then loads the business registry and Change navigation index.
- `loadBusinessRegistry(paths)` now parses stable `MOD-###` table rows, responsibilities, and keywords, rejects duplicate IDs and names, and fails clearly when the registry is missing.
- `loadChangeIndex(paths)` now reads `changes/index.yaml` as navigation entries only.
- `loadChangeArtifacts(paths, changeId)` now loads canonical active Change artifacts and rejects legacy `.openspec.yaml`-only Change directories as unsupported.
- `initializeCodeSpecWorkspace(projectRoot)` now creates canonical directories and default files without deleting legacy files.
- `test/helpers/openspec-workflow.ts` now writes canonical fixture config, supports config overrides, provides `writeChangeArtifacts`, and exposes `metadataAt(status)` for later tasks.

## Exact Commands Run

```bash
pnpm exec vitest run test/core/openspec-workflow/loaders.test.ts test/core/init.test.ts -t "canonical|module|duplicate"
pnpm exec vitest run test/core/openspec-workflow/loaders.test.ts test/core/init.test.ts -t "canonical|module|duplicate"
git diff --check
git add src/core/openspec-workflow/loaders.ts src/core/openspec-workflow/business-registry.ts src/core/openspec-workflow/change-index.ts src/core/openspec-workflow/artifacts.ts src/core/openspec-workflow/paths.ts src/core/project-config.ts src/core/init.ts test/core/openspec-workflow/loaders.test.ts test/core/init.test.ts test/helpers/openspec-workflow.ts
git commit -m "feat: load canonical openspec workspace"
pnpm exec vitest run test/core/init.test.ts -t "canonical config when language context is requested"
pnpm exec vitest run test/core/init.test.ts -t "canonical config when language context is requested"
pnpm exec vitest run test/core/openspec-workflow/loaders.test.ts test/core/init.test.ts -t "canonical|module|duplicate"
git add src/core/init.ts test/core/init.test.ts
git commit -m "fix: keep canonical init config with language"
```

Commit outputs:

```text
[codex/openspec-superpowers-migration 9d31239] feat: load canonical openspec workspace
 10 files changed, 670 insertions(+), 40 deletions(-)
 create mode 100644 src/core/openspec-workflow/artifacts.ts
 create mode 100644 src/core/openspec-workflow/business-registry.ts
 create mode 100644 src/core/openspec-workflow/change-index.ts
 create mode 100644 src/core/openspec-workflow/loaders.ts
 create mode 100644 test/core/openspec-workflow/loaders.test.ts
```

```text
[codex/openspec-superpowers-migration ea5d55a] fix: keep canonical init config with language
 2 files changed, 59 insertions(+), 28 deletions(-)
```

`git diff --check` result before the implementation commit: no output, exit code `0`.

## Concerns

- The approved step list’s sample `git add` command omitted `src/core/openspec-workflow/paths.ts` and `test/helpers/openspec-workflow.ts`, but both needed Task 2 changes for canonical root tracking and the later-task fixture contract.
- The focused verification is intentionally narrow to Task 2’s brief. I did not run unrelated workflow command suites in this task.

## Review Fix Round

Fixed the scoped review findings:

- Validate Change IDs against `CHG-YYYYMMDD-NNN` before joining them to the active Changes path; added a regression test for `../outside`.
- Canonical `loadWorkspace` and project-config resolution now require `openspec/config.yaml`; `config.yml` is no longer a canonical fallback. Init still recognizes an existing legacy `config.yml` only for its non-overwrite guard.
- Restored required `schema: spec-driven` in generated canonical config and the workspace contract.

Exact verification commands and results:

```text
pnpm exec vitest run test/core/openspec-workflow/loaders.test.ts -t "escape|requires config.yaml"
PASS: 2 tests passed, 4 skipped

pnpm exec vitest run test/core/init.test.ts -t "canonical config when language context is requested|create config.yaml with default schema"
PASS: 2 tests passed, 118 skipped

pnpm exec vitest run test/core/openspec-workflow/loaders.test.ts test/core/init.test.ts -t "canonical|module|duplicate|config\\.yaml|language context"
PASS: 10 tests passed, 116 skipped

git diff --check
PASS: exit code 0, no output
```
