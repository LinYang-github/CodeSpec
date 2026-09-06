# Context Store As Standalone CodeSpec Root Spec

## Outcome

`context-store setup` and `context-store register` treat a context store as a
normal standalone CodeSpec root with a thin identity file.

After setup or registration, the durable planning state lives in normal
CodeSpec artifacts: config, specs, changes, and archived changes. The
`.codespec-store/` directory remains identity or local registry metadata, not a
separate planning model.

The existing beta context-store, initiative, and workspace shapes are not a
compatibility contract. This slice ignores old beta files unless they are the
thin `.codespec-store/store.yaml` identity file used by the new model.

## User Experience

A human or agent can create or register a standalone CodeSpec repo and then see
the same root shape they would expect from a normal CodeSpec project:

```text
context-store-root/
  .codespec-store/
    store.yaml
  codespec/
    config.yaml
    specs/
    changes/
      archive/
```

The command output and help point users toward normal CodeSpec specs and
changes, not initiatives, workspace-owned planning, generated agent files, or
collection-specific state.

In plain terms:

```text
context store = normal CodeSpec root + .codespec-store/store.yaml
```

## Scope

In scope:

- Root shape parity for `context-store setup` and `context-store register`.
- Default config creation during setup.
- Safe handling of missing, empty, Git-only, and existing healthy CodeSpec-root
  directories.
- Registering cloned or existing context stores on the local machine.
- Turning a healthy standalone CodeSpec root into a context store only after
  clear user confirmation.
- Separate `context-store doctor` reporting for CodeSpec-root health.
- Tests that verify setup, register, doctor, idempotency for the new model, and
  unsafe-folder behavior.

Out of scope:

- Store selectors for core lifecycle commands.
- Creating initiative links or initiative collections.
- Workspace-owned planning behavior.
- Agent/tool installation, generated commands, migration, or onboarding flows.
- Clone, pull, push, sync, branch, worktree, dashboard, apply, verify, or archive
  orchestration.
- Migrating, preserving, or cleaning up old beta context-store, initiative, or
  workspace file shapes.
- Public terminology cleanup or broad documentation rewrites.

## Acceptance Criteria

### Setup Ensures A Normal Root

`context-store setup` creates or preserves a healthy CodeSpec root. A healthy
CodeSpec root contains `codespec/`, a config file
(`codespec/config.yaml` or `codespec/config.yml`), `codespec/specs/`,
`codespec/changes/`, and `codespec/changes/archive/`.

When setup creates a config file, it creates `codespec/config.yaml` with the
default `spec-driven` schema.

#### Scenario: Setting Up A Missing Or Empty Store

- **GIVEN** a missing directory or empty directory
- **WHEN** the user runs `context-store setup`
- **THEN** CodeSpec leaves the directory with `.codespec-store/store.yaml`
- **AND** `codespec/config.yaml` exists with the default `spec-driven` schema
- **AND** `codespec/specs/`, `codespec/changes/`, and
  `codespec/changes/archive/` exist
- **AND** JSON output reports the relative paths created by the operation in
  `created_files`

#### Scenario: Accepting A Git-Only Directory

- **GIVEN** an existing directory that contains only `.git/`
- **WHEN** the user runs `context-store setup`
- **THEN** CodeSpec treats the directory as a safe fresh store
- **AND** CodeSpec preserves `.git/`
- **AND** CodeSpec creates the context-store identity metadata and healthy
  CodeSpec root

#### Scenario: Preserving An Existing Healthy Root

- **GIVEN** an initialized standalone CodeSpec root
- **WHEN** the user runs `context-store setup`
- **THEN** CodeSpec preserves existing config, specs, changes, and archived
  changes
- **AND** CodeSpec creates `.codespec-store/store.yaml` when identity metadata
  is missing

#### Scenario: Creating Default Config Non-Interactively

- **GIVEN** setup runs in non-interactive or JSON mode without tool selection
- **AND** no `codespec/config.yaml` or `codespec/config.yml` exists
- **WHEN** setup completes successfully
- **THEN** `codespec/config.yaml` exists with the default `spec-driven` schema

#### Scenario: Preserving Existing Config

- **GIVEN** `codespec/config.yaml` or `codespec/config.yml` already exists
- **WHEN** setup completes successfully
- **THEN** CodeSpec preserves the existing config file

#### Scenario: Rejecting Unsafe Folders

- **GIVEN** an arbitrary non-empty unmarked folder
- **WHEN** the user runs `context-store setup`
- **THEN** CodeSpec rejects it without treating it as a store root
- **AND** it does not create context-store metadata or CodeSpec-root files in
  that folder

#### Scenario: Rejecting Nested Git Setup Paths

- **GIVEN** a setup target path inside another Git repository
- **WHEN** the user runs `context-store setup`
- **THEN** CodeSpec rejects the path as unsafe for this slice
- **AND** it does not create context-store metadata or CodeSpec-root files in
  that path

### Register Requires An Existing Root

`context-store register` remembers a local clone or existing local root on this
machine. It does not initialize planning files.

#### Scenario: Registering A Cloned Context Store

- **GIVEN** an existing healthy CodeSpec root with `.codespec-store/store.yaml`
- **WHEN** the user runs `context-store register`
- **THEN** CodeSpec registers it
- **AND** CodeSpec writes local registry state only when needed
- **AND** CodeSpec does not create or rewrite CodeSpec planning files

#### Scenario: Turning A Healthy Root Into A Context Store

- **GIVEN** an existing healthy CodeSpec root without `.codespec-store/store.yaml`
- **WHEN** the user runs `context-store register`
- **THEN** CodeSpec asks whether to turn the root into the named context store
- **AND** if the user confirms, CodeSpec creates `.codespec-store/store.yaml`
  and registers the store locally
- **AND** if the user declines, CodeSpec does not write metadata or registry
  state

#### Scenario: Refusing Unconfirmed Non-Interactive Conversion

- **GIVEN** an existing healthy CodeSpec root without `.codespec-store/store.yaml`
- **WHEN** the user runs `context-store register` in non-interactive or JSON mode
  without explicit confirmation
- **THEN** CodeSpec refuses to convert the root into a context store
- **AND** CodeSpec does not write metadata or registry state

#### Scenario: Refusing Arbitrary Directories

- **GIVEN** a missing directory, partial CodeSpec root, or existing directory
  that is not a healthy CodeSpec root
- **WHEN** the user runs `context-store register`
- **THEN** CodeSpec refuses to register it
- **AND** CodeSpec does not silently initialize it as an CodeSpec root
- **AND** CodeSpec does not create `.codespec-store/store.yaml` or local
  registry state

### Metadata Stays Thin

Context-store metadata remains identity or registry metadata only.

#### Scenario: Avoiding Old Planning Models In This Slice

- **WHEN** setup or register completes
- **THEN** CodeSpec does not create initiative links, initiative collections, or
  workspace-owned planning state
- **AND** CodeSpec does not install generated agent skills, slash commands, or
  tool configuration files into the store
- **AND** CodeSpec does not run full `codespec init`, tool detection, legacy
  cleanup, migration, skill generation, command generation, or onboarding flows

#### Scenario: Ignoring Old Beta Files

- **GIVEN** a directory contains old beta files such as `initiatives/`,
  `.codespec-workspace/`, `workspace.yaml`, `AGENTS.md`, `.codex/`, `.claude/`,
  or `.cursor/`
- **WHEN** setup or register succeeds for the new model
- **THEN** CodeSpec ignores those files for this slice
- **AND** CodeSpec does not migrate, upgrade, delete, or repair those files
- **AND** CodeSpec does not treat those files as proof that the folder is a
  healthy CodeSpec root or valid context store
- **AND** CodeSpec does not preserve old beta planning behavior as a requirement

#### Scenario: Validating Thin Identity Metadata

- **GIVEN** `.codespec-store/store.yaml` exists
- **WHEN** setup, register, or doctor reads it
- **THEN** CodeSpec treats it as the context-store identity file
- **AND** the file must match the thin identity shape for the new model
- **AND** invalid or mismatched identity metadata is reported as a metadata issue

### Doctor Separates Root Health

`context-store doctor` reports CodeSpec-root health separately from
context-store metadata and Git health. In JSON output, each store includes a
distinct `codespec_root` section.

#### Scenario: Reporting CodeSpec Root Health

- **WHEN** doctor inspects a context store
- **THEN** the report covers the `codespec/` directory,
  `codespec/config.yaml` or `codespec/config.yml`, `codespec/specs/`,
  `codespec/changes/`, and `codespec/changes/archive/`
- **AND** root-health issues are distinguishable from metadata and Git issues in
  human and JSON output
- **AND** JSON output includes `codespec_root` separately from `metadata` and
  `git`
- **AND** doctor does not mutate files

#### Scenario: Reporting Without Repairing

- **GIVEN** a registered context store has valid metadata and Git state but is
  missing `codespec/changes/archive/`
- **WHEN** doctor inspects the context store
- **THEN** doctor reports the missing archive directory under `codespec_root`
- **AND** doctor does not create `codespec/changes/archive/`

### Safety, Not Beta Compatibility

This slice protects user-authored files and repeatable command behavior. It does
not treat previous beta context-store behavior as a stable surface.

#### Scenario: Repeating Setup Or Register

- **GIVEN** the same context-store id and path are already registered and the
  CodeSpec root is healthy
- **WHEN** setup or register runs again for that root
- **THEN** CodeSpec reports that the store is already registered, already exists,
  or has nothing to change
- **AND** CodeSpec does not mutate files just to prove the command worked
- **AND** JSON output reports no newly created files for the no-op operation
- **AND** CodeSpec does not duplicate registry entries

#### Scenario: Preserving User Edits Across Reruns

- **GIVEN** the user edits `codespec/config.yaml` or `codespec/config.yml` after
  setup
- **WHEN** setup or register runs again for that root
- **THEN** CodeSpec preserves the edited config file
- **AND** CodeSpec preserves user-authored specs, changes, archived changes, and
  valid identity metadata

#### Scenario: Preserving User Content On Failure

- **GIVEN** setup or register creates files or directories during an operation
- **WHEN** the operation fails before completion
- **THEN** CodeSpec removes only files and empty directories it created during
  that operation
- **AND** CodeSpec preserves unrelated user content
