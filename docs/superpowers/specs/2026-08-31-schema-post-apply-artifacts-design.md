# Schema post-apply artifacts and canonical materials

## Problem

OpenSpec currently treats every schema artifact as a planning artifact. An artifact becomes ready as soon as the files named in `requires` exist, while `apply` is tracked separately.

That model cannot accurately represent `forward-docs`:

- `proposal`, `specs`, `design`, and `tasks` are planning artifacts.
- implementation happens during `apply` and is tracked by `tasks.md`.
- documentation material must describe implemented and verified software, so it must not become ready before every tracked task is complete.

Generating one complete `document-materials.md` inside every change is also the wrong ownership model. Repeated changes to the same capability leave multiple snapshots with no canonical current version, and concatenating natural-language snapshots cannot reliably express replacement, removal, or retirement.

`forward-docs` therefore needs two levels of state:

- each change carries a post-apply publication manifest and complete replacement material only for the capabilities it affects;
- the planning home carries one canonical material file per capability, updated transactionally when the change is archived.

The existing lifecycle also gives `reverse-docs` an implementation step even though that schema only documents existing software.

## Goals

- Let a schema declare artifacts that become available only after `apply` is complete.
- Keep change history separate from the canonical current documentation state.
- Let `forward-docs` publish complete replacement material for affected capabilities during archive.
- Apply spec updates, material publications, and the final change move as one recoverable archive transaction.
- Keep existing schemas and custom schemas working without modification.
- Give status, instructions, generated skills, validation, and archive one consistent lifecycle.
- Let a documentation-only schema explicitly disable `apply`.
- Make `forward-docs` and `reverse-docs` usable through the published CLI without references to unavailable commands or scripts.
- Reuse `reverse-docs` for periodic or release-level full-project verification instead of rebuilding every project material on every archive.
- Add integration coverage for discovery, templates, state transitions, publication, rollback, finalization, and package contents.

## Non-goals

- Rename OpenSpec or its CLI.
- Add a general workflow engine with arbitrary named phases.
- Invoke a language model from `openspec archive`.
- Merge or concatenate arbitrary natural-language material.
- Rebuild the complete project material set for every archived change.
- Add a new release-management command.
- Build a document renderer or define a downstream Word/PDF format.
- Change the default behavior of `spec-driven`.
- Rewrite the legacy `docs/` tree.

## Ownership model

### Change-local publication input

A `forward-docs` change produces these files after implementation and verification:

```text
documentation-impact.yaml
materials/<capability-path>/material.md
```

`documentation-impact.yaml` is the machine-readable publication manifest. Each update entry points to a complete current-state replacement under the change's `materials/` directory. A removal entry explicitly removes a canonical capability material. The manifest is not a prose document and must not duplicate the material body.

Change-local materials are publication inputs and archived evidence. They are not the project's canonical material set.

### Project-level canonical material

The planning home owns the canonical current state:

```text
<planningHome.root>/openspec/materials/
  <capability-path>/material.md
```

There is at most one canonical material file for a capability. Archive replaces that file as a whole; it never appends paragraphs from multiple changes.

Downstream document generation reads this project-level directory. Archived changes remain the history and traceability source.

## Schema contract

### Artifact phase

Add an optional `phase` field to an artifact:

```yaml
artifacts:
  - id: documentation-impact
    phase: post-apply
    generates: documentation-impact.yaml
    template: documentation-impact.yaml
    requires:
      - tasks
```

Accepted values are:

- `planning`, the default when omitted;
- `post-apply`, available only after the configured apply work is complete.

Validation must reject:

- a `post-apply` artifact when the schema has no enabled `apply` configuration;
- a `post-apply` artifact listed in `apply.requires`;
- a planning artifact that depends directly or transitively on a `post-apply` artifact;
- a schema with post-apply artifacts whose `apply` block has no tracking file.

A post-apply artifact may depend on planning artifacts and earlier post-apply artifacts. Existing artifact dependency and cycle checks continue to apply.

### Archive material publication

Add an optional `archive.materials` declaration:

```yaml
archive:
  materials:
    artifact: documentation-impact
    manifest: documentation-impact.yaml
    sourceRoot: materials
```

The declaration must reference a post-apply artifact whose `generates` path is the same manifest. `manifest` and `sourceRoot` are relative to the active change directory. The canonical target is fixed at `<planningHome.root>/openspec/materials/`; schemas cannot redirect it into specs, changes, or another OpenSpec-managed directory. Stores and repository-local planning homes therefore behave the same way.

Schemas that omit `archive.materials` retain current archive behavior.

### Publication manifest

The manifest format is versioned YAML:

```yaml
version: 1
updates:
  - path: identity/user-auth/material.md
removals:
  - path: legacy-auth/material.md
```

Rules:

- every path is POSIX-style and relative to the declared change-local `sourceRoot` and the fixed canonical material root;
- update paths must name regular files that exist below the change's `sourceRoot`;
- update and removal paths must be unique and mutually exclusive;
- absolute paths, `..`, empty segments, NUL bytes, and symlink traversal are rejected;
- only paths listed by the manifest are published;
- an update replaces the canonical target file atomically;
- a removal deletes the canonical target if it exists and otherwise produces a warning;
- archive rejects an empty manifest because selecting `forward-docs` means the change has documentation impact;
- validation rejects material paths that do not end in `<capability-path>/material.md` for the built-in `forward-docs` schema.

For `forward-docs`, every non-retired capability changed by delta specs must have one update entry. Every retired capability must have one removal entry and no update entry. This prevents specs and canonical materials from diverging.

### Disabled apply

Allow the top-level `apply` field to be either the existing configuration object or `false`:

```yaml
apply: false
```

Omitting `apply` preserves compatibility behavior. `apply: false` explicitly declares that the schema has no implementation phase.

### `skip_specs` policy

Add an optional top-level `skipSpecs` policy with these values:

- `allowed`, the default, preserving current behavior;
- `forbidden`, which rejects a change that sets `skip_specs: true`.

Both built-in documentation schemas set `skipSpecs: forbidden`:

- `forward-docs` requires capability deltas so archive can prove which canonical materials must be replaced or removed;
- `reverse-docs` requires current-behavior specs because producing them is part of the workflow's purpose.

Pure refactors, tooling changes, and documentation-only edits with no spec-level behavior change use `spec-driven` with `skip_specs: true` instead of `forward-docs`.

## Lifecycle

### Planning

Planning artifacts retain the current `done`, `skipped`, `ready`, and `blocked` states. `isPlanningComplete` is calculated from planning artifacts only.

Post-apply artifacts expose `phase: "post-apply"` in status output. Before apply completion they have a new `deferred` status. They are not selected by `nextSteps`, `continue`, or fast-forward during planning.

### Apply and finalization

Apply is ready when every artifact in `apply.requires` is complete. The existing task parser remains the source of truth for a tracked apply phase.

When tracked tasks remain, apply behaves as it does today. When all tracked tasks are complete and post-apply artifacts remain, apply instructions return a `post_apply` state and list the ready finalization artifacts.

For `forward-docs`, generated apply guidance performs these steps:

1. Read the completed tasks, actual code changes, affected tests, and verification results.
2. Read the delta spec and the current main spec for each affected capability.
3. Build the complete expected current-state capability after applying the delta.
4. Write one complete replacement material to `materials/<capability-path>/material.md`, except for retired capabilities.
5. Write `documentation-impact.yaml` with update and removal entries.
6. Validate the manifest, referenced files, and capability coverage.

The change reaches `all_done` only when every tracked task and every post-apply artifact is complete. Successful artifact completion does not replace content validation; `openspec validate` and archive validate the manifest and referenced material files.

### Documentation-only completion

For `apply: false`, `openspec instructions apply` returns a disabled response instead of generic implementation guidance. Once all artifacts are complete, status directs the user to review or archive the change.

### Archive transaction

Archive prepares spec and material mutations before writing either kind of target:

1. Resolve and validate the schema, publication declaration, manifest, source files, and target paths.
2. Build and validate every resulting main spec.
3. Verify that changed and retired capabilities are covered by the manifest.
4. Preview spec and material mutations before confirmation.
5. Fingerprint change inputs and existing targets.
6. Capture recoverable snapshots for every spec and material target.
7. Apply spec writes and retirements.
8. Apply material replacements and removals.
9. Move the change into the archive.
10. Verify archived inputs and published targets, then discard snapshots.

If any mutation or final move fails, archive restores both spec and material snapshots and moves the change back when necessary. Archive reports success only after all three effects—specs, materials, and the change move—are complete.

`--skip-specs` is rejected for a schema with archive material publication whose coverage is tied to delta specs. Skipping the spec merge while publishing material would create an inconsistent canonical state.

### Release-level verification

The project-level material directory is incrementally current after each successful `forward-docs` archive. Before a release, users run `reverse-docs` against the current software to audit all capabilities and correct drift. This is a full verification pass, not another source of change history, and this design does not add a release command.

## Command behavior

`openspec status --json` gains additive fields:

- `applyEnabled: boolean`;
- `phase` on each artifact;
- `deferred` as an artifact status;
- post-apply next steps when implementation is complete.

Existing fields remain. `isComplete` means every artifact in every phase is complete. `isPlanningComplete` means every planning artifact is complete.

`openspec instructions <artifact>` refuses to issue creation instructions for a deferred post-apply artifact and reports remaining task counts.

`openspec instructions apply --json` gains the `post_apply` and `disabled` states. Human-readable output carries the same meaning.

`openspec archive` previews canonical material replacements and removals next to spec changes. JSON archive results add:

- `materialsUpdated: boolean`;
- `materialUpdates: string[]`;
- `materialRemovals: string[]`;
- publication warnings when a requested removal was already absent.

## Built-in schema changes

### `forward-docs`

- Replace every `openspec-cn` command reference with `openspec`.
- Replace the change-local `document-materials.md` artifact with the post-apply `documentation-impact` artifact.
- Generate `documentation-impact.yaml` and complete replacement files under `materials/<capability-path>/material.md` only after tracked tasks and applicable verification are complete.
- Declare archive material publication from the change's `materials/` directory to the planning home's canonical `openspec/materials/` directory.
- Set `skipSpecs: forbidden`.
- Keep `apply.requires: [tasks]` and `tracks: tasks.md`.

### `reverse-docs`

- Set `apply: false`.
- Set `skipSpecs: forbidden`.
- Keep `inventory`, `specs`, `coverage`, and `verification` as planning artifacts.
- Do not generate `document-materials.md`; module specs remain the independent behavior materials, while coverage and verification provide completeness and evidence records.
- Remove the unsupported claim that `render-document-materials.mjs` maintains traceability. No standalone renderer is promised.

## Error handling

- Invalid phase or archive material combinations fail schema validation with the artifact ID and violated rule.
- A deferred artifact request fails without writing files and reports remaining task counts.
- An invalid or unsafe publication manifest fails before any target is mutated.
- Missing update sources and uncovered changed capabilities block archive.
- A forbidden `skip_specs` marker fails when change context is loaded and identifies an appropriate schema.
- `--skip-specs` fails before confirmation when the selected schema requires spec/material consistency.
- A disabled apply request exits without implementation instructions and identifies the schema as documentation-only.
- Missing post-apply outputs block archive even if every task is checked.
- Concurrent changes to manifest, source material, main specs, or canonical material targets abort before mutation or trigger full rollback.

## Tests

Use test-driven development and add coverage at these levels:

1. Schema parsing and validation
   - default planning phase and accepted post-apply phase;
   - invalid apply and dependency combinations;
   - accepted and rejected archive material declarations;
   - `apply: false` and `skipSpecs` parsing.
2. Publication manifest
   - accepted update and removal entries;
   - duplicate, overlapping, missing, absolute, traversal, NUL, and symlinked paths;
   - empty manifests and missing update source files;
   - store-aware canonical target resolution.
3. Artifact and status integration
   - `documentation-impact` is deferred before tasks finish;
   - it becomes ready after all tasks finish;
   - planning completion and full completion remain distinct;
   - next steps never recommend finalization early.
4. Instructions and apply
   - deferred artifact instructions are rejected;
   - apply transitions from ready to post-apply to all-done;
   - generated instructions require complete capability replacement material;
   - disabled apply returns documentation-only guidance.
5. Archive material publication
   - changed capabilities require update entries;
   - retired capabilities require removal entries;
   - replacements and removals publish with spec updates;
   - failures restore specs, canonical materials, and the active change;
   - concurrent source or target mutation is detected;
   - `--skip-specs` is rejected when publication coverage depends on deltas;
   - JSON and human output report every material mutation.
6. Built-in schemas and CLI
   - `openspec schemas --json` lists all three built-ins;
   - both documentation schemas expose every expected template;
   - new changes persist either schema name;
   - both end-to-end artifact orders are covered.
7. Distribution
   - the package contains both schema directories, templates, and material manifest support.

## Documentation

- Add runnable selection examples to both new schema reference pages.
- Explain the difference between archived change inputs and canonical project materials.
- Document `phase`, `apply: false`, `skipSpecs`, archive material publication, manifest validation, status states, and lifecycle behavior in `docs-lab`.
- Document that `forward-docs` is for behavior changes that must update canonical documentation material; pure refactors and tooling changes use `spec-driven`.
- Document release-level `reverse-docs` verification as the drift-correction step.
- Correct generated skill/reference text that currently says every artifact is created before implementation.
- Leave the legacy `docs/` tree unchanged.

## Compatibility

Existing schemas omit the new fields and retain current behavior. `spec-driven` remains unchanged. JSON additions are additive. Existing status values remain except that consumers must accept `deferred` for explicitly post-apply artifacts. Existing archive behavior is unchanged when no archive material declaration is present. No existing package name, CLI name, directory, or environment variable changes.
