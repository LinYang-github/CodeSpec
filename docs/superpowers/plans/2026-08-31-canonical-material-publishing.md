# Canonical Material Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add post-apply artifacts and transactional capability-material publication so `forward-docs` archives update one canonical project material per capability while `reverse-docs` remains documentation-only.

**Architecture:** Schema parsing gains explicit artifact phases, disabled apply, skip-specs policy, and a narrowly scoped `archive.materials` declaration. A focused material-publication module parses and secures `documentation-impact.yaml`, prepares whole-file replacements/removals, and exposes snapshot/apply/rollback operations that `ArchiveCommand` composes with its existing spec transaction. Status and apply instructions treat post-apply artifacts as deferred until tracked tasks finish.

**Tech Stack:** TypeScript 6, Node.js 20, Zod 4, YAML 2, Vitest 3, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-31-schema-post-apply-artifacts-design.md`

## Global Constraints

- Existing schemas that omit `phase`, `skipSpecs`, `archive.materials`, or `apply: false` retain current behavior.
- `spec-driven` remains the default schema and keeps `skip_specs: true` support.
- Canonical material targets are fixed below `<planningHome.root>/openspec/materials/`; schemas cannot choose another target root.
- Archive never invokes a language model and never concatenates natural-language material.
- All manifest paths are POSIX relative paths; absolute, traversal, NUL, duplicate, overlapping, and symlink-traversing paths fail before mutation.
- Spec updates, material updates, and moving the change into archive form one recoverable transaction.
- Preserve unrelated working-tree changes and stage only task-specific files in each commit.

---

### Task 1: Extend and validate the schema contract

**Files:**
- Modify: `src/core/artifact-graph/types.ts`
- Modify: `src/core/artifact-graph/schema.ts`
- Modify: `test/core/artifact-graph/schema.test.ts`

**Interfaces:**
- Produces: `ArtifactPhase = 'planning' | 'post-apply'`
- Produces: `SkipSpecsPolicy = 'allowed' | 'forbidden'`
- Produces: `ArchiveMaterials { artifact: string; manifest: string; sourceRoot: string }`
- Produces: `SchemaYaml.apply: ApplyPhase | false | undefined`
- Produces: `getArtifactPhase(artifact: Artifact): ArtifactPhase`
- Consumes: existing relative-path validator and artifact dependency graph.

- [ ] **Step 1: Write failing parser tests for accepted fields and defaults**

Add tests that parse this schema and assert every new property:

```ts
const schema = parseSchema(`
name: docs
version: 1
skipSpecs: forbidden
artifacts:
  - id: tasks
    generates: tasks.md
    description: Tasks
    template: tasks.md
  - id: impact
    phase: post-apply
    generates: documentation-impact.yaml
    description: Impact
    template: documentation-impact.yaml
    requires: [tasks]
apply:
  requires: [tasks]
  tracks: tasks.md
archive:
  materials:
    artifact: impact
    manifest: documentation-impact.yaml
    sourceRoot: materials
`);

expect(schema.skipSpecs).toBe('forbidden');
expect(schema.artifacts[1].phase).toBe('post-apply');
expect(schema.archive?.materials?.artifact).toBe('impact');
```

Also assert a legacy schema parses with `getArtifactPhase(artifact) === 'planning'`, `skipSpecs === 'allowed'`, and no archive declaration.

- [ ] **Step 2: Run the schema tests and verify failure**

Run: `pnpm exec vitest run test/core/artifact-graph/schema.test.ts`

Expected: FAIL because `phase`, `skipSpecs`, `archive`, and `apply: false` are not represented.

- [ ] **Step 3: Add Zod types and helpers**

Implement the contract in `types.ts`:

```ts
export const ArtifactPhaseSchema = z.enum(['planning', 'post-apply']);
export type ArtifactPhase = z.infer<typeof ArtifactPhaseSchema>;

export const SkipSpecsPolicySchema = z.enum(['allowed', 'forbidden']);
export type SkipSpecsPolicy = z.infer<typeof SkipSpecsPolicySchema>;

export const ArchiveMaterialsSchema = z.object({
  artifact: z.string().min(1),
  manifest: relativePathSchema('archive.materials.manifest'),
  sourceRoot: relativePathSchema('archive.materials.sourceRoot'),
}).strict();

export const ArchiveSchema = z.object({ materials: ArchiveMaterialsSchema }).strict();

export function getArtifactPhase(artifact: Artifact): ArtifactPhase {
  return artifact.phase ?? 'planning';
}
```

Add `phase: ArtifactPhaseSchema.optional()` to `ArtifactSchema`, `apply: z.union([ApplyPhaseSchema, z.literal(false)]).optional()`, `skipSpecs: SkipSpecsPolicySchema.default('allowed')`, and `archive: ArchiveSchema.optional()` to `SchemaYamlSchema`.

- [ ] **Step 4: Write failing semantic-validation tests**

Cover these exact rejected combinations:

```ts
expect(() => parseSchema(postApplyWithoutEnabledApply)).toThrow(/post-apply.*enabled apply/i);
expect(() => parseSchema(postApplyInApplyRequires)).toThrow(/apply\.requires.*post-apply/i);
expect(() => parseSchema(planningDependsOnPostApply)).toThrow(/planning.*post-apply/i);
expect(() => parseSchema(postApplyWithoutTracks)).toThrow(/tracking file/i);
expect(() => parseSchema(publicationReferencesPlanningArtifact)).toThrow(/post-apply artifact/i);
expect(() => parseSchema(publicationManifestDoesNotMatchGenerates)).toThrow(/manifest.*generates/i);
expect(() => parseSchema(applyRequiresUnknownArtifact)).toThrow(/apply\.requires.*does not exist/i);
```

- [ ] **Step 5: Implement cross-field validation**

After Zod parsing, validate apply references, phase dependencies, disabled-apply restrictions, tracking requirements, and `archive.materials`. Keep this logic in focused functions called by `parseSchema`:

```ts
validateApplyReferences(schema);
validateArtifactPhases(schema);
validateArchiveMaterials(schema);
```

- [ ] **Step 6: Run tests and commit**

Run: `pnpm exec vitest run test/core/artifact-graph/schema.test.ts test/core/artifact-graph/graph.test.ts`

Expected: PASS.

Commit:

```bash
git add src/core/artifact-graph/types.ts src/core/artifact-graph/schema.ts test/core/artifact-graph/schema.test.ts
git commit -m "feat(schema): add post-apply material contract"
```

---

### Task 2: Implement post-apply status and instruction states

**Files:**
- Modify: `src/core/artifact-graph/instruction-loader.ts`
- Modify: `src/core/change-status-policy.ts`
- Modify: `src/commands/workflow/shared.ts`
- Modify: `src/commands/workflow/instructions.ts`
- Modify: `src/commands/workflow/status.ts`
- Modify: `src/commands/workflow/shared.ts`
- Modify: `src/core/templates/workflows/apply-change.ts`
- Modify: `src/core/templates/workflows/continue-change.ts`
- Modify: `src/core/templates/workflows/ff-change.ts`
- Modify: `src/core/templates/workflows/archive-change.ts`
- Test: `test/core/artifact-graph/instruction-loader.test.ts`
- Test: `test/commands/artifact-workflow.test.ts`

**Interfaces:**
- Consumes: `getArtifactPhase`, schema apply tracking, `parseTaskLines`.
- Produces: `ArtifactStatus.status` including `'deferred'` and `ArtifactStatus.phase`.
- Produces: `ChangeStatus.applyEnabled`, correct `isPlanningComplete`, and full `isComplete`.
- Produces: `ApplyInstructions.state` including `'post_apply'` and `'disabled'`.
- Produces: `ApplyInstructions.postApplyArtifacts?: string[]`.

- [ ] **Step 1: Write failing status tests**

Create a project-local schema with `tasks` and a post-apply `impact`. Assert:

```ts
expect(beforeTasksDone.artifacts.find(a => a.id === 'impact')).toMatchObject({
  phase: 'post-apply',
  status: 'deferred',
});
expect(beforeTasksDone.isPlanningComplete).toBe(true);
expect(beforeTasksDone.isComplete).toBe(false);
expect(beforeTasksDone.applyEnabled).toBe(true);

expect(afterTasksDone.artifacts.find(a => a.id === 'impact')?.status).toBe('ready');
expect(afterImpact.artifacts.find(a => a.id === 'impact')?.status).toBe('done');
expect(afterImpact.isComplete).toBe(true);
```

Also assert `apply: false` exposes `applyEnabled: false` and never recommends apply.

- [ ] **Step 2: Run status tests and verify failure**

Run: `pnpm exec vitest run test/core/artifact-graph/instruction-loader.test.ts test/commands/artifact-workflow.test.ts`

Expected: FAIL because post-apply artifacts are reported ready as soon as their file dependencies exist.

- [ ] **Step 3: Add a shared synchronous apply-completion decision**

In `instruction-loader.ts`, derive tracked progress from the configured tracking file with `resolveArtifactOutputs`, `fs.readFileSync`, and `parseTaskLines`. Treat apply as complete only when at least one checkbox exists and every checkbox is checked. Return false for missing or unreadable tracking files.

Use that result to format post-apply artifacts as `deferred` until apply completion. Compute planning completeness from planning artifacts only and full completeness from all artifacts.

- [ ] **Step 4: Update next-step policy and text rendering**

Change `buildNextSteps` to use explicit planning/full completion:

```ts
if (readyPlanningArtifact) return [artifactInstruction];
if (planningComplete && deferredPostApplyExists) return [applyInstruction];
if (readyPostApplyArtifact) return [artifactInstruction];
if (allArtifactsComplete) return [`Change ... is ready to review and archive.`];
```

Update status indicator/color unions so `deferred` renders separately from `blocked`.

- [ ] **Step 5: Write failing apply-instruction tests**

Assert all state transitions:

```ts
expect(disabled.state).toBe('disabled');
expect(tasksPending.state).toBe('ready');
expect(tasksDoneImpactMissing.state).toBe('post_apply');
expect(tasksDoneImpactMissing.postApplyArtifacts).toEqual(['documentation-impact']);
expect(tasksDoneImpactPresent.state).toBe('all_done');
```

Assert `openspec instructions documentation-impact` fails while the artifact is deferred and names the remaining tracked-task count.

- [ ] **Step 6: Implement apply and artifact instruction guards**

Extend `ApplyInstructions`:

```ts
state: 'blocked' | 'ready' | 'post_apply' | 'all_done' | 'disabled';
postApplyArtifacts?: string[];
```

For `apply: false`, return `disabled` without task parsing. When tasks are complete but post-apply outputs are absent, return `post_apply` with the artifact IDs and schema finalization guidance. Reject direct generation instructions for a deferred artifact before loading its template.

- [ ] **Step 7: Update generated workflow templates**

Teach generated apply/continue/fast-forward/archive workflows to accept `deferred`, `post_apply`, and `disabled`, and to create post-apply artifacts only after tracked work is complete. Archive guidance must require every artifact to be `done` or legitimately `skipped` and must not call apply for an `apply: false` schema.

- [ ] **Step 8: Run tests and commit**

Run: `pnpm exec vitest run test/core/artifact-graph/instruction-loader.test.ts test/commands/artifact-workflow.test.ts test/core/templates`

Expected: PASS.

Commit:

```bash
git add src/core/artifact-graph/instruction-loader.ts src/core/change-status-policy.ts src/commands/workflow/shared.ts src/commands/workflow/instructions.ts src/commands/workflow/status.ts src/core/templates/workflows test/core/artifact-graph/instruction-loader.test.ts test/commands/artifact-workflow.test.ts test/core/templates
git commit -m "feat(workflow): support post-apply finalization"
```

---

### Task 3: Parse and secure material publication manifests

**Files:**
- Create: `src/core/material-publication.ts`
- Create: `test/core/material-publication.test.ts`
- Modify: `src/core/artifact-graph/index.ts`

**Interfaces:**
- Produces: `MaterialManifest { version: 1; updates: Array<{ path: string }>; removals: Array<{ path: string }> }`
- Produces: `PreparedMaterialMutation { relativePath; source?; target; operation; sourceFingerprint; targetFingerprint; expectedContent? }`
- Produces: `prepareMaterialPublication(input): Promise<PreparedMaterialPublication>`.
- Produces: `captureMaterialSnapshots`, `applyMaterialPublication`, `restoreMaterialSnapshots`, and `finalizeMaterialSnapshots`.
- Consumes: selected root path, active change directory, `SchemaYaml.archive.materials`, and expected capability outcomes from archive.

- [ ] **Step 1: Write failing manifest tests**

Cover a valid replacement/removal manifest and these exact failures:

```ts
await expect(prepare({ updates: [{ path: '../escape.md' }] })).rejects.toThrow(/relative POSIX path/i);
await expect(prepare({ updates: [{ path: '/abs/material.md' }] })).rejects.toThrow(/relative POSIX path/i);
await expect(prepare({ updates: [{ path: 'a/material.md' }, { path: 'a/material.md' }] })).rejects.toThrow(/duplicate/i);
await expect(prepare({ updates: [{ path: 'a/material.md' }], removals: [{ path: 'a/material.md' }] })).rejects.toThrow(/both update and removal/i);
await expect(prepare({ updates: [{ path: 'a/readme.md' }] })).rejects.toThrow(/material\.md/i);
await expect(prepare({ updates: [{ path: 'missing/material.md' }] })).rejects.toThrow(/source.*missing/i);
await expect(prepareThroughSymlink).rejects.toThrow(/symbolic link/i);
await expect(prepareEmptyManifest).rejects.toThrow(/at least one update or removal/i);
```

- [ ] **Step 2: Run manifest tests and verify failure**

Run: `pnpm exec vitest run test/core/material-publication.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement parsing, path validation, and capability coverage**

Use strict Zod schemas and `parse` from `yaml`. Normalize neither separators nor case: reject backslashes and require POSIX manifest text. Verify each source and every existing path segment with `lstat`/`realpath`; no symlink may participate.

Map a capability path to exactly `${capability}/material.md`. Compare manifest entries with archive's expected outcomes:

```ts
export interface ExpectedCapabilityMaterial {
  capability: string;
  operation: 'update' | 'remove';
}
```

Reject missing, extra, or wrong-operation entries so changed specs and canonical materials cannot diverge.

- [ ] **Step 4: Write failing mutation and rollback tests**

Test replacing an existing file, creating a new file, removing an existing file, warning on an already absent removal, restoring all targets after a forced second-write failure, and refusing rollback over a concurrent edit.

- [ ] **Step 5: Implement recoverable whole-file mutations**

Write update contents through a sibling temporary file and rename into place. For removals, rename the target into a private backup until archive commits. Snapshots record original bytes/mode or absence plus the bytes archive expects to have written. Rollback restores in reverse order only when current content matches archive's expected mutation; otherwise throw without overwriting concurrent work.

- [ ] **Step 6: Run tests and commit**

Run: `pnpm exec vitest run test/core/material-publication.test.ts`

Expected: PASS.

Commit:

```bash
git add src/core/material-publication.ts src/core/artifact-graph/index.ts test/core/material-publication.test.ts
git commit -m "feat(archive): prepare canonical material mutations"
```

---

### Task 4: Compose material publication into archive transaction

**Files:**
- Modify: `src/core/archive.ts`
- Modify: `test/core/archive.test.ts`

**Interfaces:**
- Consumes: `prepareMaterialPublication`, material snapshot/apply/rollback API, prepared spec outcomes.
- Produces: `ArchiveResult.materialsUpdated`, `materialUpdates`, and `materialRemovals`.
- Preserves: existing archive confirmation, spec rollback, retirement, cross-device move, JSON diagnostics, and store behavior.

- [ ] **Step 1: Write failing archive success tests**

Create a project-local schema declaring `archive.materials`, a completed change with delta specs, checked tasks, `documentation-impact.yaml`, and a change-local material file. Assert one archive run:

```ts
expect(await fs.readFile(path.join(root, 'openspec/materials/auth/material.md'), 'utf8'))
  .toBe('# Current auth material\n');
expect(await fs.stat(activeChange)).rejects.toMatchObject({ code: 'ENOENT' });
expect(json.archive.materialsUpdated).toBe(true);
expect(json.archive.materialUpdates).toEqual(['auth/material.md']);
```

Add a capability-retirement test that removes the canonical material with its spec.

- [ ] **Step 2: Run focused archive tests and verify failure**

Run: `pnpm exec vitest run test/core/archive.test.ts -t "material"`

Expected: FAIL because archive ignores the schema material declaration.

- [ ] **Step 3: Prepare material mutations beside spec previews**

Resolve the change schema at the beginning of archive. Block missing post-apply artifacts before task confirmation. After preparing spec outcomes, derive:

```ts
const expectedMaterials = prepared
  .filter(p => p.outcome !== 'skip')
  .map(p => ({
    capability: p.update.id,
    operation: p.outcome === 'retire' ? 'remove' : 'update',
  }));
```

Prepare/fingerprint material inputs and display replacements/removals before the existing confirmation. Reject `--skip-specs` when `archive.materials` is configured.

- [ ] **Step 4: Write failing transaction rollback tests**

Inject failures at these boundaries using existing filesystem spies:

- after spec write but before material write;
- after one material mutation;
- while moving the change to archive;
- after a concurrent edit changes the manifest source or canonical target.

For each failure assert main specs, canonical materials, and active change are restored, with no archived change left behind.

- [ ] **Step 5: Apply and rollback both snapshot sets**

Capture spec and material snapshots before the first mutation. Within the existing archive try/catch:

```ts
await applySpecMutations();
await applyMaterialPublication(materialPlan, materialSnapshots);
await moveDirectory(changeDir, archivePath, verification);
await finalizeRetirementBackups(specSnapshots, mainSpecsDir);
await finalizeMaterialSnapshots(materialSnapshots);
```

On error, restore material snapshots before spec snapshots, then move the archived change back if needed. Aggregate rollback errors without hiding the original failure.

- [ ] **Step 6: Verify archived inputs and JSON/human output**

Extend the final move verifier to compare the archived manifest and update source fingerprints. Verify each canonical target matches the prepared bytes or expected removal. Add human preview/result lines and additive JSON fields.

- [ ] **Step 7: Run archive tests and commit**

Run: `pnpm exec vitest run test/core/archive.test.ts test/core/material-publication.test.ts`

Expected: PASS.

Commit:

```bash
git add src/core/archive.ts test/core/archive.test.ts
git commit -m "feat(archive): publish canonical materials atomically"
```

---

### Task 5: Enforce schema skip policy and update built-in documentation schemas

**Files:**
- Modify: `src/core/artifact-graph/instruction-loader.ts`
- Modify: `src/core/validation/validator.ts`
- Modify: `src/core/validation/constants.ts`
- Modify: `src/core/archive.ts`
- Modify: `test/core/validation.skip-specs.test.ts`
- Modify: `test/core/artifact-graph/resolver.test.ts`
- Modify: `schemas/forward-docs/schema.yaml`
- Delete: `schemas/forward-docs/templates/document-materials.md`
- Create: `schemas/forward-docs/templates/documentation-impact.yaml`
- Create: `schemas/forward-docs/templates/material.md`
- Modify: `schemas/reverse-docs/schema.yaml`
- Modify: reverse-docs templates only where current instructions conflict with `apply: false` or release-level verification.

**Interfaces:**
- Consumes: `SchemaYaml.skipSpecs`, `SchemaYaml.archive.materials`.
- Produces: one consistent forbidden-skip diagnostic across status, instructions, validation, and archive.
- Produces: built-in `forward-docs` artifact order `proposal → specs → design → tasks → documentation-impact`.

- [ ] **Step 1: Write failing forbidden-skip tests**

Create a change with `.openspec.yaml` containing `schema: forward-docs` and `skip_specs: true`. Assert status, instructions, validate, and archive fail with guidance to remove the marker or select `spec-driven`.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm exec vitest run test/core/validation.skip-specs.test.ts test/core/artifact-graph/resolver.test.ts`

Expected: FAIL because schema policy is not consulted.

- [ ] **Step 3: Add one policy guard and reuse it**

Expose a helper from the artifact-graph layer:

```ts
export function assertSkipSpecsAllowed(schema: SchemaYaml, metadata: ChangeMetadata | undefined): void {
  if (schema.skipSpecs === 'forbidden' && metadata?.skip_specs) {
    throw new Error(`Schema '${schema.name}' forbids skip_specs. Remove skip_specs or use spec-driven for a change without behavior deltas.`);
  }
}
```

Call it after schema and metadata resolution in context loading, validator change loading, and archive. Keep marker-invalid diagnostics unchanged.

- [ ] **Step 4: Replace the forward-docs final artifact and templates**

Set:

```yaml
skipSpecs: forbidden
artifacts:
  # proposal/specs/design/tasks unchanged except openspec-cn → openspec
  - id: documentation-impact
    phase: post-apply
    generates: documentation-impact.yaml
    description: 受影响 capability 的项目级素材发布清单
    template: documentation-impact.yaml
    requires: [tasks]
apply:
  requires: [tasks]
  tracks: tasks.md
archive:
  materials:
    artifact: documentation-impact
    manifest: documentation-impact.yaml
    sourceRoot: materials
```

The manifest template contains `version: 1`, one example update path, and an empty `removals: []`. The material template keeps the existing clean current-state structure but explicitly scopes one file to one capability and writes to `materials/<capability-path>/material.md`.

- [ ] **Step 5: Make reverse-docs documentation-only**

Set `apply: false` and `skipSpecs: forbidden`. Keep its current `inventory`, `specs`, `coverage`, and `verification` artifacts. Ensure instructions describe release/full-project drift verification and do not promise automatic publication.

- [ ] **Step 6: Run built-in schema tests and commit**

Run: `pnpm exec vitest run test/core/artifact-graph/resolver.test.ts test/core/validation.skip-specs.test.ts test/commands/schemas.test.ts`

Expected: PASS.

Commit:

```bash
git add src/core/artifact-graph/instruction-loader.ts src/core/validation src/core/archive.ts test/core/validation.skip-specs.test.ts test/core/artifact-graph/resolver.test.ts schemas/forward-docs schemas/reverse-docs
git commit -m "feat(schema): ship canonical forward docs workflow"
```

---

### Task 6: Update reference documentation, distribution coverage, and end-to-end behavior

**Files:**
- Modify: `docs-lab/reference/schemas/schema-yaml.md`
- Modify: `docs-lab/reference/schemas/forward-docs/index.md`
- Modify: `docs-lab/reference/schemas/reverse-docs/index.md`
- Modify: `docs-lab/reference/schemas/index.md`
- Modify: `docs-lab/reference/cli.md`
- Modify: `docs-lab/reference/configuration/config-yaml.md`
- Modify: `docs-lab/customize/schemas.md`
- Modify: `docs-lab/README.md`
- Modify: `test/commands/artifact-workflow.test.ts`
- Modify: `test/commands/schemas.test.ts`
- Modify or create: package/distribution test that inspects `package.json#files` and built-in schema assets.

**Interfaces:**
- Documents: `phase`, `apply: false`, `skipSpecs`, `archive.materials`, manifest format, deferred/post_apply/disabled states, canonical material path, and release-level reverse-docs audit.
- Verifies: installed package contains every built-in schema and template.

- [ ] **Step 1: Write failing end-to-end tests**

Exercise the published CLI flow in a temporary project:

1. create a `forward-docs` change;
2. create planning artifacts and leave one task pending;
3. assert status reports `documentation-impact` deferred;
4. check the task and assert apply reports `post_apply`;
5. create manifest/material source and assert apply reports `all_done`;
6. archive and assert the canonical material exists;
7. create a `reverse-docs` change and assert apply reports `disabled`.

Assert `openspec schemas --json` reports the final artifact names and package source.

- [ ] **Step 2: Run end-to-end tests and verify failure**

Run: `pnpm exec vitest run test/commands/artifact-workflow.test.ts test/commands/schemas.test.ts`

Expected: FAIL until all CLI surfaces and built-in files agree.

- [ ] **Step 3: Rewrite the schema reference around the final contract**

Document exact YAML examples and constraints. Replace every `document-materials` change-local claim with `documentation-impact` plus canonical capability materials. State that complete means complete for the affected capability, not a whole-project rewrite.

- [ ] **Step 4: Update CLI examples and navigation**

Update human and JSON `openspec schemas` samples, status/apply state descriptions, archive material preview/result fields, and built-in schema tables. Preserve unrelated wording already changed in the working tree.

- [ ] **Step 5: Add package coverage**

Assert the package schema directories include:

```ts
expect(files).toEqual(expect.arrayContaining([
  'schemas/forward-docs/schema.yaml',
  'schemas/forward-docs/templates/documentation-impact.yaml',
  'schemas/forward-docs/templates/material.md',
  'schemas/reverse-docs/schema.yaml',
]));
```

- [ ] **Step 6: Run docs/CLI tests and commit**

Run: `pnpm exec vitest run test/commands/artifact-workflow.test.ts test/commands/schemas.test.ts test/core/artifact-graph/resolver.test.ts`

Expected: PASS.

Commit:

```bash
git add docs-lab schemas test/commands test/core/artifact-graph/resolver.test.ts
git commit -m "docs: explain canonical documentation materials"
```

---

### Task 7: Full verification and final review

**Files:**
- Review: every file changed by Tasks 1–6.

**Interfaces:**
- Verifies all public TypeScript, JSON, YAML, CLI, and package contracts.

- [ ] **Step 1: Run focused regression suites**

Run:

```bash
pnpm exec vitest run \
  test/core/artifact-graph \
  test/core/material-publication.test.ts \
  test/core/archive.test.ts \
  test/core/validation.skip-specs.test.ts \
  test/commands/artifact-workflow.test.ts \
  test/commands/schemas.test.ts
```

Expected: PASS with zero failed tests.

- [ ] **Step 2: Run full static and test verification**

Run:

```bash
pnpm run build
pnpm run lint
pnpm test
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Inspect the package payload**

Run: `pnpm pack --dry-run`

Expected: output lists both built-in schema directories and every referenced template; it does not list removed `schemas/forward-docs/templates/document-materials.md`.

- [ ] **Step 4: Review working-tree ownership and final diff**

Run:

```bash
git status --short
git diff --stat HEAD~6..HEAD
git diff --check HEAD~6..HEAD
```

Confirm no unrelated pre-existing file was removed or overwritten and every design requirement maps to a test.

- [ ] **Step 5: Commit any verification-only corrections**

If verification required a correction, stage only those exact files and commit:

```bash
git commit -m "fix: complete canonical material verification"
```

If no correction was needed, do not create an empty commit.
