# CodeSpec 1.0 Identity and Archive Impact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the incompatible `@hrhy-ai/codespec@1.0.0` CLI, with a `codespec/`-only workspace, HRHY-branded initialization, and auditable archive-impact gates for the default `code-spec` workflow.

**Architecture:** Rename the runtime identity at the boundaries first (package, executable, root resolver, public skills and configuration), then evolve the canonical workflow types and parsers around versioned metadata. Archive-impact validation is a dedicated Core capability consumed by lifecycle gates and the existing atomic archive transaction; it is not inferred from Skills or free-form prose.

**Tech Stack:** Node.js 20.19+, TypeScript 6, Zod 4, Commander, YAML, Vitest, pnpm, Changesets, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-04-codespec-identity-and-archive-impact-design.md`

## Global Constraints

- Publish exactly `@hrhy-ai/codespec@1.0.0`; expose exactly one package binary, `codespec`.
- New installs recognize and create only `codespec/`; do not read, migrate, alias, or clean `openspec/` projects.
- Use `CodeSpec` for display text, `codespec` for CLI/path/package/skill names, `CODESPEC_*` for environment variables, and `CodeSpec...` / `codeSpec...` for TypeScript symbols.
- The only public generated Skills are `codespec-workflow`, `codespec-rebase-change`, and `codespec-archive-change`.
- Default `code-spec` Change IDs remain `CHG-YYYYMMDD-NNN`; historical archived Changes are immutable.
- Level 1 requires `metadata.yaml`, `proposal.md`, `spec.md`, `tasks.md`, and `verification.md`; it may inline design in `spec.md`. Level 2/3 also require `design.md`.
- Treat metadata, paths, YAML, evidence and archive inputs as untrusted; fail closed on invalid input and preserve atomic rollback.
- Do not stage or overwrite the pre-existing unrelated working-tree changes. Execute in a fresh worktree when implementation begins.

---

## File Structure

| Area | Main files | Responsibility |
| --- | --- | --- |
| Package and delivery | `package.json`, `build.js`, `bin/codespec.js`, `scripts/pack-version-check.mjs`, `.github/workflows/*` | Package identity, build output, release and packed-install verification. |
| Root identity | `src/core/config.ts`, `src/core/project-config.ts`, `src/core/codespec-root.ts`, `src/core/planning-home.ts`, `src/core/global-config.ts` | Resolve only `codespec/`, local config/data paths and public vocabulary. |
| Canonical workflow | `src/core/codespec-workflow/{types,schemas,artifacts,gates,state-machine,rebase,verification,archive-impact,archive-transaction}.ts` | Versioned Change contract, lifecycle, evidence, impact checking, current-spec mutation and audit history. |
| Initial UX | `src/ui/ascii-patterns.ts`, `src/ui/welcome-screen.ts`, `src/core/init.ts`, `src/cli/index.ts` | HRHY ASCII animation, static/reduced-motion fallback and `codespec init` interface. |
| Generated interfaces | `src/core/templates/workflows/*`, `src/core/shared/*`, `src/core/command-generation/*`, `schemas/code-spec/*` | Three public Skills and canonical templates/commands. |
| User surfaces | `README.md`, `docs/**`, `assets/**`, `CHANGELOG.md`, `src/telemetry/**` | CodeSpec-only documentation, telemetry and release identity. |
| Tests | `test/{cli-e2e,core/ui,core/codespec-workflow,telemetry,templates}/**` | Behavioral proof for all boundaries and failure paths. |

### Task 1: Establish CodeSpec vocabulary and a no-regrowth test

**Files:**
- Modify: `src/core/config.ts`, `src/core/global-config.ts`, `src/core/project-config.ts`, `src/core/planning-home.ts`, `src/core/root-selection.ts`, `src/core/codespec-root.ts` (renamed from `openspec-root.ts`)
- Modify: `test/vocabulary-sweep.test.ts`, root-resolution and global-config tests
- Create: `test/core/codespec-identity.test.ts`

**Interfaces:**
- Produces `CODESPEC_DIR_NAME = 'codespec'`, `CODESPEC_SKILL_NAMES`, `CODESPEC_MARKERS`, `CodeSpecConfig`, `getCodeSpecConfigDir()` and `getCodeSpecDataDir()`.
- All subsequent tasks import the new names; no source module imports an `openspec-*` Core path.

- [ ] **Step 1: Write failing identity and vocabulary tests.**

```ts
it('accepts only codespec as the project root', () => {
  expect(CODESPEC_DIR_NAME).toBe('codespec');
  expect(resolveCodeSpecConfigFilePath(project)).toBe(path.join(project, 'codespec', 'config.yaml'));
});

it('does not allow an executable OpenSpec identity to regrow', async () => {
  const files = await sourceFiles();
  expect(files.filter(isRuntimeOrGeneratedSurface).join('\n')).not.toMatch(/\bopenspec\b/i);
});
```

- [ ] **Step 2: Run the focused tests and verify failure.**

Run: `pnpm vitest run test/core/codespec-identity.test.ts test/vocabulary-sweep.test.ts`  
Expected: FAIL because only `OPENSPEC_*` constants and `openspec/` resolution exist.

- [ ] **Step 3: Rename the Core root vocabulary and imports.**

```ts
export const CODESPEC_DIR_NAME = 'codespec';
export const CODESPEC_SKILL_NAMES = [
  'codespec-workflow',
  'codespec-rebase-change',
  'codespec-archive-change',
] as const;

export function getCodeSpecConfigDir(): string {
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'codespec');
}
```

Rename `src/core/openspec-root.ts` to `src/core/codespec-root.ts`, the entire `src/core/openspec-workflow/` directory to `src/core/codespec-workflow/`, and update every import in `src/`, `test/`, and scripts. Remove legacy OpenSpec detection/migration branches rather than retaining renamed aliases.

- [ ] **Step 4: Run focused root/config suites.**

Run: `pnpm vitest run test/core/codespec-identity.test.ts test/core/project-config.test.ts test/core/global-config.test.ts test/vocabulary-sweep.test.ts`  
Expected: PASS; an `openspec/` directory is reported as unsupported and is never read.

- [ ] **Step 5: Commit the isolated vocabulary change.**

```bash
git add src/core test/core test/vocabulary-sweep.test.ts
git commit -m "refactor: rename runtime identity to codespec"
```

### Task 2: Ship the `@hrhy-ai/codespec` package and one `codespec` executable

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`, `build.js`, `bin/codespec.js` (renamed from `bin/openspec.js`)
- Modify: `scripts/pack-version-check.mjs`, `scripts/{generate-skillssh,skillssh-shared,parity-hash-shared,regen-parity-hashes}.mjs`
- Modify: `.changeset/config.json`, `.github/workflows/{ci,release-prepare,security}.yml`, `.github/CODEOWNERS`, `CHANGELOG.md`
- Modify: `test/package-install-scripts.test.ts`, `test/cli-e2e/basic.test.ts`

**Interfaces:**
- `package.json` exposes `{ "codespec": "./bin/codespec.js" }` and version `1.0.0`.
- `pnpm run typecheck` is a stable command: `tsc --noEmit`.

- [ ] **Step 1: Add failing package-boundary tests.**

```ts
it('publishes exactly the CodeSpec package and binary', async () => {
  const manifest = JSON.parse(await fs.readFile('package.json', 'utf8'));
  expect(manifest.name).toBe('@hrhy-ai/codespec');
  expect(manifest.version).toBe('1.0.0');
  expect(manifest.bin).toEqual({ codespec: './bin/codespec.js' });
});
```

- [ ] **Step 2: Run the package test and verify failure.**

Run: `pnpm vitest run test/package-install-scripts.test.ts test/cli-e2e/basic.test.ts`  
Expected: FAIL because the package is `@fission-ai/openspec` and ships `openspec`.

- [ ] **Step 3: Update manifest, build/release scripts and fresh changelog.**

```json
{
  "name": "@hrhy-ai/codespec",
  "version": "1.0.0",
  "bin": { "codespec": "./bin/codespec.js" },
  "scripts": { "typecheck": "tsc --noEmit" }
}
```

Make packed-tarball verification install `@hrhy-ai/codespec`, locate `bin/codespec.js`, and run `codespec --version`. Replace the changelog with a single `# CodeSpec` / `## 1.0.0` release entry. Make release automation publish public `@hrhy-ai/codespec`, map prereleases to `beta` and stable versions to `latest`, require a matching `v1.0.0` tag and generate the GitHub release from that tag.

- [ ] **Step 4: Prove build, typecheck and packed install.**

Run: `pnpm typecheck && pnpm build && pnpm run check:pack-version`  
Expected: PASS; the installed package resolves `codespec --version` to `1.0.0` and has no `openspec` binary.

- [ ] **Step 5: Commit package delivery.**

```bash
git add package.json pnpm-lock.yaml build.js bin scripts .github CHANGELOG.md test/package-install-scripts.test.ts test/cli-e2e/basic.test.ts
git commit -m "feat: publish codespec 1.0 package"
```

### Task 3: Make `codespec init` use the HRHY terminal mark

**Files:**
- Modify: `src/ui/ascii-patterns.ts`, `src/ui/welcome-screen.ts`, `src/core/init.ts`, `src/cli/index.ts`, `src/core/onboarding-commands.ts`
- Modify: `test/ui/welcome-screen.test.ts`, `test/core/init.test.ts`, `test/cli-e2e/basic.test.ts`

**Interfaces:**
- `WELCOME_ANIMATION` remains terminal-only and has a peak frame containing the readable `HRHY` mark.
- `CODESPEC_NO_ANIMATION` disables redraws; `--no-animation`, non-TTY and reduced-motion paths render the same branded peak frame once.

- [ ] **Step 1: Write failing welcome-screen tests.**

```ts
it('uses the HRHY mark in every non-animated fallback', async () => {
  process.env.CODESPEC_NO_ANIMATION = '1';
  await showWelcomeScreen(CORE_WORKFLOWS);
  expect(writtenOutput()).toContain('HRHY');
  expect(writtenOutput()).toContain('CodeSpec');
  expect(writtenOutput()).not.toMatch(/OpenSpec|◇/);
});
```

- [ ] **Step 2: Run the UI suite and verify failure.**

Run: `pnpm vitest run test/ui/welcome-screen.test.ts test/core/init.test.ts`  
Expected: FAIL because the current frames and copy say OpenSpec and read `OPENSPEC_NO_ANIMATION`.

- [ ] **Step 3: Replace the ASCII frames and all init copy.**

```ts
const HRHY_WORDMARK = ['██  ██ ██████  ██  ██ ██    ██', '██  ██ ██   ██ ██  ██  ██  ██ ', '██████ ██████  ██████   ████  '];
export const WELCOME_ANIMATION = { interval: 120, frames: buildHrhyFrames(HRHY_WORDMARK) };

if (process.env.CODESPEC_NO_ANIMATION !== undefined) return false;
```

Keep the existing cursor-height calculation and accessibility logic. Change command descriptions, errors, onboarding messages and the `InitCommand` comments to `codespec`; delete the deprecated `experimental` alias instead of mapping it to `init`.

- [ ] **Step 4: Run focused UX tests.**

Run: `pnpm vitest run test/ui/welcome-screen.test.ts test/core/init.test.ts test/cli-e2e/basic.test.ts`  
Expected: PASS for animated, static, narrow-terminal, reduced-motion and `CODESPEC_NO_ANIMATION` paths.

- [ ] **Step 5: Commit the initialization experience.**

```bash
git add src/ui src/core/init.ts src/core/onboarding-commands.ts src/cli/index.ts test/ui test/core/init.test.ts test/cli-e2e/basic.test.ts
git commit -m "feat: brand codespec init with hrhy"
```

### Task 4: Encode the Level-aware Change metadata and artifact contract

**Files:**
- Modify: `src/core/codespec-workflow/{types,schemas,artifacts,change-manager,default-config}.ts`
- Modify: `schemas/code-spec/{schema.yaml,templates/metadata.yaml,templates/spec.md,templates/design.md,templates/verification.md}`
- Modify: `test/core/codespec-workflow/{contracts,loaders,change-manager,templates}.test.ts`, `test/helpers/codespec-workflow.ts` (renamed)

**Interfaces:**
- `ChangeMetadata` gains `change.sdd_level`, `impact.affected_areas` and an optional `artifacts.design` only for Level 1.
- `loadChangeArtifacts()` returns `design: string | null`; callers use `design ?? spec` for required inline design sections.

- [ ] **Step 1: Write schema and loader failures.**

```ts
expect(() => parseChangeMetadata(levelOneWithoutInlineDesign)).toThrow(/SDD.*design/i);
await expect(loadChangeArtifacts(paths, changeId)).resolves.toMatchObject({ design: null });
expect(() => parseChangeMetadata({ ...valid, extra: true })).toThrow(/unrecognized key/i);
```

- [ ] **Step 2: Run the canonical contract tests and verify failure.**

Run: `pnpm vitest run test/core/codespec-workflow/contracts.test.ts test/core/codespec-workflow/loaders.test.ts test/core/codespec-workflow/templates.test.ts`  
Expected: FAIL because all artifacts currently require `design.md` and metadata lacks SDD/area fields.

- [ ] **Step 3: Implement the schema version-1 additions and templates.**

```ts
export type SddLevel = 1 | 2 | 3;
change: { /* existing fields */ sdd_level: SddLevel };
impact: { summary: string; mode: ChangeMode; scope: Scope; affected_areas: string[] };
artifacts: { design?: string };
```

Use strict Zod objects. Enforce the five common artifacts for every level, `design.md` for Level 2/3, and Level-1 `## 设计说明`, `## SDD 分级依据`, and `## 归档影响分析` headings in `spec.md`. Templates must include BDD Scenario placeholders with normal and `ERROR` behavior.

- [ ] **Step 4: Run contract, template and empty-workspace journeys.**

Run: `pnpm vitest run test/core/codespec-workflow/contracts.test.ts test/core/codespec-workflow/loaders.test.ts test/core/codespec-workflow/templates.test.ts test/cli-e2e/code-spec-empty-workspace.test.ts`  
Expected: PASS for valid Levels 1–3 and rejection of missing/extra or unsafe metadata.

- [ ] **Step 5: Commit the canonical Change contract.**

```bash
git add src/core/codespec-workflow schemas/code-spec test/core/codespec-workflow test/helpers/codespec-workflow.ts test/cli-e2e/code-spec-empty-workspace.test.ts
git commit -m "feat: add level-aware codespec changes"
```

### Task 5: Add parsed archive-impact mappings and Current Specification checks

**Files:**
- Create: `src/core/codespec-workflow/archive-impact.ts`
- Modify: `src/core/codespec-workflow/{gates,delta-parser,current-spec-parser,module-resolver}.ts`
- Modify: `test/core/codespec-workflow/{archive-impact,gates,current-spec-parser}.test.ts`

**Interfaces:**
- `parseArchiveImpact(source, location)` returns `{ outcome, references, verification }`.
- `validateArchiveImpact(workspace, artifacts, deltas)` returns structured issues, never reads historical archived Changes during normal design validation.

- [ ] **Step 1: Create failing parser/validator cases.**

```ts
expect(parseArchiveImpact(validAffectedDesign, 'design.md')).toEqual(expect.objectContaining({ outcome: 'affected' }));
expect(validateArchiveImpact(workspace, artifacts, deltas).issues).toContain('MODIFIED delta MOD-001-REQ-010 lacks exactly one mapping');
expect(() => parseArchiveImpact('```yaml\noutcome: none\nreferences: [x]\n```', 'design.md')).toThrow(/references must be empty/i);
```

- [ ] **Step 2: Run the new tests and verify failure.**

Run: `pnpm vitest run test/core/codespec-workflow/archive-impact.test.ts test/core/codespec-workflow/gates.test.ts`  
Expected: FAIL because no archive-impact parser or cross-check exists.

- [ ] **Step 3: Implement strict mapping parsing and semantic checks.**

```ts
export type ArchiveImpactReference = {
  current_requirement: RequirementId;
  current_scenario: ScenarioId;
  disposition: 'modified' | 'superseded';
  replacement_requirement: RequirementId;
  replacement_scenario: ScenarioId;
  reason: string;
  compatibility: string;
  effective_semantics: string;
};
```

Validate `outcome: none` has no references/evidence; `affected` has non-duplicate references and `archive-regression`. Require one mapping for every `MODIFIED`/`REMOVED` delta, require `modified` to align to `MODIFIED`, `superseded` to align to `REMOVED + ADDED`, validate Current Requirement/Scenario existence and require a new Scenario ID when behavior changes.

- [ ] **Step 4: Run impact and regression tests.**

Run: `pnpm vitest run test/core/codespec-workflow/archive-impact.test.ts test/core/codespec-workflow/gates.test.ts test/core/codespec-workflow/current-spec-parser.test.ts`  
Expected: PASS for compatible addition, partial revision, full replacement, unchanged-intent bugfix, and every invalid mapping case.

- [ ] **Step 5: Commit archive-impact parsing.**

```bash
git add src/core/codespec-workflow/archive-impact.ts src/core/codespec-workflow test/core/codespec-workflow
git commit -m "feat: validate codespec archive impacts"
```

### Task 6: Make traceability and verification evidence Level-aware and executable

**Files:**
- Modify: `src/core/codespec-workflow/{traceability,verification,gates}.ts`
- Modify: `schemas/code-spec/templates/verification.md`, `src/cli/index.ts`
- Modify: `test/core/codespec-workflow/{traceability,verification,gates}.test.ts`

**Interfaces:**
- `VerificationKind` becomes `'requirements' | 'unit' | 'bdd' | 'integration' | 'archive-regression' | 'typecheck' | 'build' | 'lint' | 'security' | 'performance' | 'migration'`.
- Evidence records command, category, exit code, start/finish time, revision and output artifact; trace rows bind `requirement_id → scenario_id → task_id → test_id → evidence_id`.

- [ ] **Step 1: Write failing trace/evidence tests.**

```ts
expect(validateChangeTraceability(artifacts).issues).toContain('Scenario SCN-021 is not covered by a Test');
await expect(recordVerification(workspace, changeId, [{ command: 'pnpm typecheck', kind: 'typecheck' }]))
  .rejects.toThrow(/archive-regression/i);
```

- [ ] **Step 2: Run them and verify failure.**

Run: `pnpm vitest run test/core/codespec-workflow/traceability.test.ts test/core/codespec-workflow/verification.test.ts`  
Expected: FAIL because the current evidence kinds and markdown extraction cannot represent test IDs, typecheck or archive regression.

- [ ] **Step 3: Implement machine-readable trace rows and command policy.**

```ts
type TraceRow = {
  requirement_id: RequirementId; scenario_id: ScenarioId; task_id: string;
  test_id: string; evidence_id: string; result: 'PASS' | 'FAIL'; code_reference?: string;
};
```

Parse the table/YAML from `verification.md`; require code references for Level 3. Resolve command categories from trusted workspace configuration, write only bounded output summaries/artifact paths, and require `unit`, `typecheck`, `build`, `lint` plus Level-appropriate `bdd`/`integration`; require successful `archive-regression` whenever impact is affected.

- [ ] **Step 4: Run traceability, verification and CLI tests.**

Run: `pnpm vitest run test/core/codespec-workflow/traceability.test.ts test/core/codespec-workflow/verification.test.ts test/cli-e2e/openspec-workflow-journeys.test.ts`  
Expected: PASS, including secret-redaction, required command categories, stale revision rejection and Level 3 code references.

- [ ] **Step 5: Commit evidence and CI policy.**

```bash
git add src/core/codespec-workflow schemas/code-spec src/cli/index.ts test/core/codespec-workflow test/cli-e2e
git commit -m "feat: enforce codespec verification evidence"
```

### Task 7: Enforce lifecycle invalidation, rebase safety and archive audit history

**Files:**
- Modify: `src/core/codespec-workflow/{state-machine,rebase,gates,archive-transaction,change-index}.ts`
- Modify: `src/commands/workflow/{status,instructions,archive}.ts`
- Modify: `test/core/codespec-workflow/{state-machine,stale-rebase,archive-transaction}.test.ts`, `test/cli-e2e/validate-archived-tasks.test.ts`

**Interfaces:**
- `rebaseChange()` returns `DESIGN`, increments revision, clears task/evidence receipts and records a rebase decision.
- Archive history record contains `change`, `archived_at`, `input_revision`, `impact`, `resulting_specs[]`, and `evidence_ids[]`.

- [ ] **Step 1: Add lifecycle and archive-history failures.**

```ts
expect(rebased.change.status).toBe('DESIGN');
expect(rebased.change.verification.verified_at).toBeNull();
expect(history.records.at(-1)).toMatchObject({
  change: changeId, input_revision: 2,
  resulting_specs: [{ module: 'MOD-001', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }],
});
```

- [ ] **Step 2: Run state/rebase/archive suites and verify failure.**

Run: `pnpm vitest run test/core/codespec-workflow/state-machine.test.ts test/core/codespec-workflow/stale-rebase.test.ts test/core/codespec-workflow/archive-transaction.test.ts`  
Expected: FAIL because archive history only has change/status/time and invalidation does not cover all new inputs.

- [ ] **Step 3: Centralize invalidation and commit the audit record atomically.**

```ts
function invalidateAfterDesignChange(metadata: ChangeMetadata): ChangeMetadata {
  return { ...metadata, tasks: { total: 0, completed: 0, items: {} },
    verification: emptyVerification(), archive: { ready: false, conflict: false, archived_at: null } };
}

const archiveRecord = {
  change: plan.changeId, archived_at: archivedMetadata.archive.archived_at,
  input_revision: plan.artifacts.metadata.change.revision,
  impact: summarizedImpact, resulting_specs: specDigests, evidence_ids: evidenceIds,
};
```

Use the existing staging/backup transaction to write the extended `history.yaml` with the Current Specification content hashes. Preserve rollback tests for every install step and reject stale/revised Evidence before the transaction starts.

- [ ] **Step 4: Run archive atomicity and lifecycle suites.**

Run: `pnpm vitest run test/core/codespec-workflow/state-machine.test.ts test/core/codespec-workflow/stale-rebase.test.ts test/core/codespec-workflow/archive-transaction.test.ts test/cli-e2e/validate-archived-tasks.test.ts`  
Expected: PASS; all failure injections leave Current Specs, active Change, index and history byte-for-byte unchanged.

- [ ] **Step 5: Commit lifecycle and archive audit work.**

```bash
git add src/core/codespec-workflow src/commands/workflow test/core/codespec-workflow test/cli-e2e/validate-archived-tasks.test.ts
git commit -m "feat: audit codespec archive transactions"
```

### Task 8: Generate only the three CodeSpec Skills and remove OpenSpec public surfaces

**Files:**
- Modify: `src/core/{profiles,onboarding-commands,shared/index,shared/skill-generation,templates/skill-templates}.ts`
- Move/modify: `src/core/templates/workflows/openspec-workflow.ts` → `codespec-workflow.ts`; equivalent rebase/archive templates
- Modify: `src/core/command-generation/**`, `scripts/{generate-skillssh,parity-hash-shared,regen-parity-hashes}.mjs`
- Modify: `test/core/{shared/skill-generation,shared/skill-content-equivalence,templates/openspec-workflow,templates/rebase-change,templates/archive-change,templates/skillssh-parity}.test.ts`

**Interfaces:**
- `getSkillTemplates()` returns exactly `codespec-workflow`, `codespec-rebase-change`, `codespec-archive-change`.
- Generated Skill text invokes `codespec` and names the `codespec/` paths, never an OpenSpec command or old alias.

- [ ] **Step 1: Add failing generated-output assertions.**

```ts
expect(getSkillTemplates().map((item) => item.name)).toEqual([
  'codespec-workflow', 'codespec-rebase-change', 'codespec-archive-change',
]);
expect(rendered).toContain('codespec archive');
expect(rendered).not.toMatch(/openspec|opsx-/i);
```

- [ ] **Step 2: Run Skills/template tests and verify failure.**

Run: `pnpm vitest run test/core/shared/skill-generation.test.ts test/core/templates/openspec-workflow.test.ts test/core/templates/rebase-change.test.ts test/core/templates/archive-change.test.ts`  
Expected: FAIL because current template names and parity hashes use OpenSpec.

- [ ] **Step 3: Rename templates and regenerate deterministic parity hashes.**

```ts
export const PUBLIC_WORKFLOWS = ['workflow', 'rebase-change', 'archive-change'] as const;
export const CODESPEC_SKILL_NAMES = ['codespec-workflow', 'codespec-rebase-change', 'codespec-archive-change'] as const;
```

Delete obsolete workflow templates from the public registry. Update every adapter's filename, frontmatter and allowed-command reference to `codespec`; regenerate only the checked-in parity hashes with `pnpm regen:parity-hashes`.

- [ ] **Step 4: Verify generated project output.**

Run: `pnpm vitest run test/core/shared/skill-generation.test.ts test/core/shared/skill-content-equivalence.test.ts test/core/templates/skillssh-parity.test.ts && pnpm generate:skills`  
Expected: PASS; generated Skills contain exactly three CodeSpec folders and no old prefix.

- [ ] **Step 5: Commit public workflow generation.**

```bash
git add src/core/profiles.ts src/core/onboarding-commands.ts src/core/shared src/core/templates src/core/command-generation scripts test/core/shared test/core/templates
git commit -m "feat: generate codespec workflow skills"
```

### Task 9: Replace telemetry, documentation, assets and CI references

**Files:**
- Modify: `src/telemetry/{config,index}.ts`, `test/telemetry/{config,index}.test.ts`
- Modify: `README.md`, `docs/**` current user guides, `assets/**`, `.github/workflows/**`, `flake.nix`, `nix/**` if present
- Delete/replace: OpenSpec-named public visual assets and current-user examples; keep only clearly marked historical design-decision references under `docs/superpowers/specs/`
- Modify: `test/cli-e2e/**`, source/package documentation sweep tests

**Interfaces:**
- Telemetry uses `CODESPEC_TELEMETRY`, `CODESPEC_NO_UPDATE_CHECK`, `codespec config`, and CodeSpec-owned config/data directories.
- No code or packed documentation references `openspec`; controlled unsupported-input test assertions are the only runtime exception.

- [ ] **Step 1: Write telemetry and public-surface failures.**

```ts
it('honors CODESPEC_TELEMETRY and never OPENSPEC_TELEMETRY', () => {
  process.env.CODESPEC_TELEMETRY = '0';
  expect(isTelemetryEnabled()).toBe(false);
});

it('has no old public identity in packaged files', async () => {
  expect(await packedText()).not.toMatch(/openspec/i);
});
```

- [ ] **Step 2: Run the sweep and telemetry tests to verify failure.**

Run: `pnpm vitest run test/telemetry/config.test.ts test/telemetry/index.test.ts test/vocabulary-sweep.test.ts`  
Expected: FAIL because telemetry endpoints/config and published docs still use OpenSpec.

- [ ] **Step 3: Apply the CodeSpec-only public identity.**

```ts
if (process.env.CODESPEC_TELEMETRY === '0') return false;
console.error('CodeSpec collects anonymous usage stats. Opt out: CODESPEC_TELEMETRY=0 or codespec config set telemetry.enabled false');
```

Replace the telemetry host/key only with values supplied by HRHY release configuration; if no endpoint/key has been provisioned, default telemetry to disabled and do not send events. Rewrite installation, CLI, workflow, Store, reference and troubleshooting docs; regenerate or replace SVG/PNG labels; update Nix and CI output/binary checks. Do not add a legacy-config migration because CodeSpec 1.0 intentionally has none.

- [ ] **Step 4: Verify user surfaces.**

Run: `pnpm vitest run test/telemetry/config.test.ts test/telemetry/index.test.ts test/vocabulary-sweep.test.ts && rg -n -i 'openspec' README.md docs assets src scripts .github package.json`  
Expected: tests PASS; the scan returns only explicitly documented unsupported-input assertions and preserved historical decision files.

- [ ] **Step 5: Commit public identity cleanup.**

```bash
git add src/telemetry test/telemetry README.md docs assets .github flake.nix nix test/vocabulary-sweep.test.ts
git commit -m "docs: complete codespec public identity"
```

### Task 10: Run release-grade end-to-end verification and request review

**Files:**
- Modify only if a failing test exposes a defect: the exact production/test file that owns the failure
- Create: `.changeset/codespec-1.0.0.md` only if the release workflow still requires Changesets for publishing the initial version

**Interfaces:**
- A clean install can initialize `codespec/`, author and archive compatible/affected Changes, and preserve audit history.

- [ ] **Step 1: Add a complete clean-project E2E journey.**

```ts
it('archives an affected replacement into the current CodeSpec without changing old history', async () => {
  await run(['codespec', 'init', '.', '--tools', 'none', '--no-animation']);
  await createAndVerifyAffectedChange(project, 'CHG-20260904-001');
  await run(['codespec', 'archive', 'CHG-20260904-001', '--yes']);
  expect(await readCurrentSpec('MOD-001')).toContain('MOD-001-REQ-012');
  expect(await readHistory()).toContain('resulting_specs:');
});
```

- [ ] **Step 2: Run the new journey and verify failure before any final fixes.**

Run: `pnpm vitest run test/cli-e2e/codespec-1-archive-impact.test.ts`  
Expected: FAIL until every package/root/workflow rename and archive contract is complete.

- [ ] **Step 3: Fix only the owning defect and keep the test as regression coverage.**

```ts
// Do not add a compatibility branch. The clean fixture must contain only codespec/.
expect(await exists(path.join(project, 'openspec'))).toBe(false);
```

- [ ] **Step 4: Run the full verification matrix.**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm run check:pack-version`  
Expected: all commands PASS; the packed package exposes only `codespec`, version `1.0.0`, and can complete the clean-project E2E.

- [ ] **Step 5: Commit final E2E coverage and open a review.**

```bash
git add test/cli-e2e/codespec-1-archive-impact.test.ts .changeset
git commit -m "test: verify codespec 1 archive workflow"
```

Request review with the final diff and attach the five-command verification output. Do not tag or publish without HRHY npm credentials and explicit release authorization.

## Plan Self-Review

- **Spec coverage:** Tasks 1–3 cover identity, package, workspace and HRHY animation; Tasks 4–7 cover Level artifacts, strict metadata, impact mapping, BDD/TDD traceability, Rebase and atomic audit history; Tasks 8–9 cover only-three Skills, telemetry, docs/assets and release identity; Task 10 covers the complete acceptance path.
- **Deliberate boundary:** no legacy `openspec` compatibility/migration is introduced. Historical design documents may retain historical wording but are excluded from package/runtime scans.
- **Verification coverage:** every task starts with a focused failing test, then ends with focused passing tests and an isolated commit; Task 10 runs the release-grade suite.
