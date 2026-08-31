# Schema post-apply artifacts

## Problem

OpenSpec currently treats every schema artifact as a planning artifact. An artifact becomes ready as soon as the files named in `requires` exist, while `apply` is tracked separately.

That model cannot accurately represent `forward-docs`:

- `proposal`, `specs`, `design`, and `tasks` are planning artifacts.
- implementation happens during `apply` and is tracked by `tasks.md`.
- `document-materials` must describe the implemented and verified software, so it must not become ready before every tracked task is complete.

With the current schema, `document-materials` requires only `tasks`. It therefore becomes ready as soon as `tasks.md` exists, and `openspec status` can recommend generating it before implementation. The same generic lifecycle also gives `reverse-docs` an implementation step even though that schema only documents existing software.

## Goals

- Let a schema declare artifacts that become available only after `apply` is complete.
- Keep existing schemas and custom schemas working without modification.
- Give status, instructions, generated skills, and archive one consistent lifecycle.
- Let a documentation-only schema explicitly disable `apply`.
- Make `forward-docs` and `reverse-docs` usable through the published CLI without references to unavailable commands or scripts.
- Add integration coverage for discovery, templates, state transitions, finalization, and package contents.

## Non-goals

- Rename OpenSpec or its CLI.
- Add a general workflow engine with arbitrary named phases.
- Build a new document renderer or define a downstream Word/PDF format.
- Change the default behavior of `spec-driven`.
- Rewrite the legacy `docs/` tree.

## Schema contract

### Artifact phase

Add an optional `phase` field to an artifact:

```yaml
artifacts:
  - id: document-materials
    phase: post-apply
    generates: document-materials.md
    requires:
      - tasks
```

Accepted values are:

- `planning`, the default when the field is omitted.
- `post-apply`, available only after the configured apply work is complete.

Validation must reject:

- a `post-apply` artifact when the schema has no enabled `apply` configuration;
- a `post-apply` artifact listed in `apply.requires`;
- a planning artifact that depends directly or transitively on a `post-apply` artifact;
- a schema with `post-apply` artifacts whose `apply` block has no tracking file, because it has no deterministic completion signal.

A post-apply artifact may depend on planning artifacts and earlier post-apply artifacts. Existing artifact dependency and cycle checks continue to apply.

### Disabled apply

Allow the top-level `apply` field to be either the existing configuration object or `false`:

```yaml
apply: false
```

Omitting `apply` preserves the current compatibility behavior: all artifacts are required and the default apply guidance is used. `apply: false` explicitly declares that the schema has no implementation phase.

### skip_specs policy

Add an optional top-level `skipSpecs` policy with these values:

- `allowed`, the default, preserving current behavior.
- `forbidden`, which rejects a change that sets `skip_specs: true`.

`forward-docs` uses the default `allowed` policy. `reverse-docs` sets `skipSpecs: forbidden` because producing current-behavior specs is part of that workflow's purpose.

## Lifecycle

### Planning

Planning artifacts retain the current `done`, `skipped`, `ready`, and `blocked` states. `isPlanningComplete` is calculated from planning artifacts only.

Post-apply artifacts expose `phase: "post-apply"` in status output. Before apply completion they have a new `deferred` status. They are not selected by `nextSteps`, `continue`, or fast-forward during planning.

### Apply

Apply is ready when every artifact in `apply.requires` is complete or legitimately skipped. The existing task parser remains the source of truth for a tracked apply phase.

When tracked tasks remain, apply behaves as it does today. When all tracked tasks are complete and post-apply artifacts remain, apply instructions return a new `post_apply` state and list the ready finalization artifacts. Generated apply skills respond by loading each artifact's authoritative schema instructions and template, then creating those artifacts in dependency order.

Apply reaches `all_done` only when both conditions hold:

- every tracked task is complete;
- every post-apply artifact is complete.

### Documentation-only completion

For `apply: false`, `openspec instructions apply` returns a clear disabled response instead of generic implementation guidance. Once all artifacts are complete, status directs the user to review or archive the change.

### Archive

Archive must refuse to archive a change that has incomplete post-apply artifacts. Its error names the missing artifacts and points to the corresponding `openspec instructions <artifact>` command.

## Command behavior

`openspec status --json` gains additive fields:

- `applyEnabled: boolean`;
- `phase` on each artifact;
- `deferred` as an artifact status;
- post-apply next steps when implementation is complete.

Existing fields remain. `isComplete` continues to mean every artifact in every phase is complete. `isPlanningComplete` means every planning artifact is complete.

`openspec instructions <artifact>` refuses to issue creation instructions for a deferred post-apply artifact and explains that tracked apply tasks must be completed first.

`openspec instructions apply --json` gains the `post_apply` and `disabled` states. The human-readable output carries the same meaning.

## Built-in schema changes

### forward-docs

- Replace every `openspec-cn` command reference with `openspec`.
- Mark `document-materials` as `phase: post-apply`.
- Keep `apply.requires: [tasks]` and `tracks: tasks.md`.
- Generate `document-materials.md` only after all tracked tasks and applicable verification are complete.

### reverse-docs

- Set `apply: false`.
- Set `skipSpecs: forbidden`.
- Keep all four artifacts in the planning phase.
- Remove the unsupported claim that `render-document-materials.mjs` maintains traceability. The artifact generation flow maintains the stable marker block instead; no standalone renderer is promised.

## Error handling

- Invalid phase combinations fail schema validation with the artifact ID and the violated rule.
- A deferred artifact request fails without writing files and reports remaining task counts.
- A forbidden `skip_specs` marker fails when the change context is loaded and tells the user to remove the marker or select another schema.
- A disabled apply request exits without implementation instructions and identifies the schema as documentation-only.
- Missing post-apply outputs block archive even if all tasks are checked.

## Tests

Use test-driven development and add coverage at these levels:

1. Schema parsing and validation
   - default planning phase;
   - accepted post-apply phase;
   - invalid apply and dependency combinations;
   - `apply: false` and `skipSpecs` parsing.
2. Artifact and status integration
   - `document-materials` is deferred before tasks finish;
   - it becomes ready after all tasks finish;
   - planning completion and full completion remain distinct;
   - next steps never recommend final materials early.
3. Instructions and apply
   - deferred artifact instructions are rejected;
   - apply transitions from ready to post-apply to all-done;
   - disabled apply returns documentation-only guidance.
4. Archive
   - archive blocks on missing post-apply artifacts and succeeds after they exist.
5. Built-in schemas and CLI
   - `openspec schemas --json` lists all three built-ins;
   - both new schemas expose every expected template;
   - new changes persist either schema name;
   - both end-to-end artifact orders are covered.
6. Distribution
   - the package file list contains both schema directories and every template.

## Documentation

- Add runnable selection examples to both new schema reference pages.
- Add a short built-in schema table to the root README.
- Document `phase`, `apply: false`, `skipSpecs`, status states, and lifecycle behavior in `docs-lab`.
- Correct generated skill/reference text that currently says every artifact is created before implementation.
- Leave the legacy `docs/` tree unchanged.

## Compatibility

Existing schemas omit the new fields and retain current behavior. `spec-driven` remains unchanged. JSON additions are additive; existing status values remain except that consumers must accept `deferred` for explicitly post-apply artifacts. No existing package name, CLI name, directory, or environment variable changes.
