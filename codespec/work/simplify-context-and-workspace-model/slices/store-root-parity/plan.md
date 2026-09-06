# Context Store Root Parity Plan

## Status

Planned.

This plan follows the slice spec after the 2026-06-10 product review decisions.
It is written as an implementation plan, but the product contract comes first:
humans and agents should experience a context store as a normal CodeSpec root
with one thin identity file.

## Source Of Truth

Start from `spec.md`.

Also keep these nearby artifacts in view:

- `../../goal.md`
- `../../roadmap.md`
- `../../../AGENTS.md`

The core model for this slice is:

```text
context store = normal CodeSpec root + .codespec-store/store.yaml
```

That means durable planning state lives in normal CodeSpec artifacts:

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

`.codespec-store/store.yaml` is identity metadata only. It is not a planning
model, workspace model, initiative model, migration marker, or compatibility
contract for old beta files.

## User-Facing Frame

What the human wants:

- "Create a context store I can use as a normal CodeSpec place for specs and
  changes."
- "Register the context store my teammate already pushed and I cloned locally."
- "Tell me whether this store is healthy without secretly changing files."
- "Do not overwrite my config, specs, changes, archives, or old local files."

What the agent needs to know:

- Whether the folder is a healthy CodeSpec root.
- Whether the context-store identity metadata exists and matches the store id.
- Whether the local registry already knows this id and path.
- Exactly which files or directories were created by this operation.
- Whether a refusal means "unsafe folder", "not an CodeSpec root", "missing
  confirmation", "metadata problem", or "already registered".

Where the work lives:

- User-authored planning work lives under `codespec/`.
- Portable context-store identity lives in `.codespec-store/store.yaml`.
- Machine-local registration state stays in the local context-store registry.
- Old beta files may exist beside these files, but this slice ignores them.

How the user knows it worked:

- Human output names the store id and root path, then points toward normal
  CodeSpec specs and changes.
- JSON output reports exact resulting state and relative `created_files`.
- Re-running the same command reports "already registered", "already exists",
  or "nothing to change" without mutating files.
- `context-store doctor --json` reports `codespec_root` separately from
  `metadata` and `git`.

## Goal

Make `context-store setup`, `context-store register`, and
`context-store doctor` agree on one product shape:

- Setup creates or preserves a standalone CodeSpec root, then adds thin
  context-store identity metadata.
- Register remembers an existing local root or clone. It does not initialize
  planning files.
- Doctor diagnoses root health, metadata health, and Git health as separate
  concerns.

## Non-Goals

- Do not add store selectors to core lifecycle commands.
- Do not create initiative links, initiative collections, or workspace-owned
  planning state.
- Do not install generated agent skills, slash commands, onboarding files, or
  tool configuration.
- Do not call full `codespec init` from context-store setup or register.
- Do not add clone, pull, push, sync, branch, worktree, dashboard, apply,
  verify, or archive orchestration.
- Do not migrate, clean up, preserve, repair, or back-compat old beta planning
  shapes.
- Do not rewrite public terminology or broad docs in this slice.

## Locked Direction

- A healthy CodeSpec root contains `codespec/`, a config file
  (`codespec/config.yaml` or `codespec/config.yml`), `codespec/specs/`,
  `codespec/changes/`, and `codespec/changes/archive/`.
- When setup creates config, it writes `codespec/config.yaml` with the default
  `spec-driven` schema.
- Setup accepts missing directories, empty directories, Git-only directories,
  and existing healthy CodeSpec roots.
- Setup rejects arbitrary non-empty unmarked folders without writing root or
  metadata files.
- Setup rejects nested Git paths for this slice. Keep that rule isolated so a
  later slice can relax it if the product direction changes.
- Register is for an existing local root or clone. It does not scaffold
  planning files.
- Registering a cloned context store with existing `.codespec-store/store.yaml`
  should succeed and only update local registry state when needed.
- Registering a healthy CodeSpec root without context-store identity should ask
  before turning it into the named context store.
- For non-interactive conversion, use `--yes` on `context-store register` as the
  explicit confirmation for this slice. Without it, JSON/non-interactive mode
  refuses before writing metadata or registry state.
- Old beta files such as `initiatives/`, `.codespec-workspace/`,
  `workspace.yaml`, `AGENTS.md`, `.codex/`, `.claude/`, and `.cursor/` are
  ignored. They are not migrated, deleted, repaired, or treated as proof of a
  healthy root.
- Re-running setup or register for the same healthy id and path is a no-op
  success with no duplicate registry entries and empty `created_files`.
- Doctor reports root health under `codespec_root`, separate from `metadata`
  and `git`, and never repairs while inspecting.

## User Workflows

### Fresh Setup

A human or agent asks CodeSpec to create a new context store in a missing or
empty directory.

Expected result:

- The directory exists.
- `.codespec-store/store.yaml` exists.
- `codespec/config.yaml` exists with `schema: spec-driven`.
- `codespec/specs/`, `codespec/changes/`, and
  `codespec/changes/archive/` exist.
- JSON `created_files` lists the relative paths created by setup.
- No initiative, workspace, agent, slash-command, or tool files are created.

### Git-Only Setup

A human has already run `git init` or cloned an empty repo, so the target folder
contains only `.git/`.

Expected result:

- Setup treats the folder as safe fresh input.
- `.git/` is preserved.
- The normal CodeSpec root and context-store identity are created.
- The command does not stage, commit, push, create remotes, or define Git
  workflow policy.

### Existing Healthy Root Setup

A human already has a standalone CodeSpec root and wants it to become a context
store.

Expected result:

- Existing config, specs, changes, archives, and user-authored content are
  preserved.
- Missing `.codespec-store/store.yaml` is created.
- Existing valid `.codespec-store/store.yaml` is preserved.
- Setup does not overwrite config just because the command ran.

### Teammate Clone Register

A teammate created a context store, pushed it to GitHub, and the human cloned it
locally.

Expected result:

- `context-store register <path>` validates the clone as a healthy CodeSpec
  root with valid context-store identity.
- The local registry remembers that id and path.
- The cloned planning files are not created, rewritten, migrated, or repaired.
- Re-registering the same id and path reports that it is already registered or
  has nothing to change.

### Convert Healthy Root Register

A human has a normal CodeSpec root that does not yet have
`.codespec-store/store.yaml`.

Expected result:

- Interactive register asks whether to turn that root into the named context
  store.
- If confirmed, register writes only the identity metadata and local registry
  entry.
- If declined, register writes nothing.
- JSON/non-interactive register refuses unless explicit confirmation is passed
  with `--yes`.

### Doctor Without Repair

A human or agent wants to know whether registered stores are usable.

Expected result:

- Doctor reports CodeSpec-root health separately from metadata and Git health.
- Missing `codespec/changes/archive/` appears under `codespec_root`.
- Doctor does not create missing directories or repair files.

## Command Behavior

### `context-store setup`

Setup creates or preserves the context-store root for this machine.

Accept:

- Missing target directory.
- Empty target directory.
- Existing target directory that contains only `.git/`.
- Existing healthy CodeSpec root.
- Existing root with matching valid context-store identity.

Reject:

- A file path.
- An arbitrary non-empty unmarked folder.
- A setup target nested inside another Git repository.
- A root with invalid or conflicting `.codespec-store/store.yaml`.

Mutations:

- Create only missing root-shape files and directories.
- Create `.codespec-store/store.yaml` when missing.
- Register the store in the machine-local registry.
- Preserve existing user-authored config, specs, changes, archives, and old
  beta files.

Human output should stay small:

```text
Context store ready

ID: team-context
Location: /Users/me/src/team-context
CodeSpec root: ready
Registry: registered

Next: use normal CodeSpec specs and changes in this store.
```

JSON output should report exact state, including relative `created_files`.

### `context-store register`

Register remembers an existing local context store path. It is not an init
command.

Accept:

- An existing healthy CodeSpec root with valid `.codespec-store/store.yaml`.
- An existing healthy CodeSpec root without identity only after clear
  confirmation.

Reject:

- Missing paths.
- Partial CodeSpec roots.
- Arbitrary directories.
- Beta-only directories.
- Invalid or mismatched context-store identity.
- Healthy roots without identity in JSON/non-interactive mode unless `--yes`
  is passed.

Mutations:

- With existing identity, update local registry only when needed.
- With confirmed conversion, create `.codespec-store/store.yaml` and update the
  local registry.
- Never create `codespec/` planning files during register.

Interactive conversion prompt should be direct:

```text
Turn this CodeSpec root into context store "team-context"?
```

### `context-store doctor`

Doctor is the non-mutating health surface.

It checks:

- Registered root path exists and is a directory.
- `.codespec-store/store.yaml` exists, parses, and matches the registry id.
- `codespec/` exists.
- `codespec/config.yaml` or `codespec/config.yml` exists.
- `codespec/specs/` exists.
- `codespec/changes/` exists.
- `codespec/changes/archive/` exists.
- Git health, where existing doctor behavior already reports it.

It does not:

- Create missing CodeSpec directories.
- Create missing config.
- Rewrite metadata.
- Repair registry entries.
- Migrate beta files.

## Agent / JSON Contract

Setup and register mutation output should keep the existing `created_files`
field, but treat it as "relative paths created by this operation." It may list
directories and files.

For a no-op success:

```json
{
  "created_files": [],
  "status": [
    {
      "code": "already_registered",
      "severity": "info",
      "message": "Context store is already registered at this path."
    }
  ]
}
```

For doctor, each store should include a distinct `codespec_root` section beside
`metadata` and `git`:

```json
{
  "id": "team-context",
  "root": "/Users/me/src/team-context",
  "codespec_root": {
    "present": true,
    "config": {
      "present": true,
      "path": "codespec/config.yaml"
    },
    "specs": {
      "present": true
    },
    "changes": {
      "present": true
    },
    "archive": {
      "present": false
    },
    "status": [
      {
        "code": "codespec_archive_missing",
        "severity": "error",
        "message": "Missing codespec/changes/archive/."
      }
    ]
  },
  "metadata": {},
  "git": {}
}
```

Exact diagnostic wording can follow existing CLI conventions, but the JSON
shape must let agents distinguish root health from metadata and Git health.

## Implementation Plan

### 1. Add An CodeSpec Root Helper

Create `src/core/codespec-root.ts`.

Responsibilities:

- Define canonical relative paths for a normal CodeSpec root.
- Inspect root health without mutating files.
- Return a healthy/unhealthy result with diagnostics suitable for doctor.
- Ensure the root shape for setup only.
- Create default `codespec/config.yaml` with `schema: spec-driven` when setup
  needs config.
- Preserve existing `config.yaml` or `config.yml`.
- Track a created-path ledger for files and directories.
- Roll back only ledger-created files and empty directories on failure.

This helper should know nothing about context-store registry state, Git policy,
prompts, agents, slash commands, workspaces, or initiatives.

### 2. Share Root Scaffolding With Init Safely

Refactor the directory and config creation pieces from `src/core/init.ts` into
the new helper where useful.

Keep these behaviors separate:

- `codespec init` may keep its current prompts, non-interactive config behavior,
  legacy cleanup, tool detection, and generated assets.
- `context-store setup` uses only root scaffolding and default config creation.
- `context-store register` does not use root scaffolding.

Do not call `InitCommand.execute()` from context-store operations.

### 3. Rework Setup Operations

Update `src/core/context-store/operations.ts` so setup classifies the target
before writing:

- Missing path: create root and full CodeSpec shape.
- Empty path: create full CodeSpec shape.
- Git-only path: preserve `.git/`, create full CodeSpec shape.
- Healthy CodeSpec root: preserve root content, add identity if missing.
- Matching context-store identity: preserve and no-op when everything is
  already healthy.
- Arbitrary non-empty path: refuse without writes.
- Nested Git path: refuse without writes for this slice.

Then perform mutations in a safe order:

1. Ensure the CodeSpec root shape if setup is allowed.
2. Write missing context-store identity metadata.
3. Commit the local registry update.
4. On failure, roll back only paths created in this operation.

Update setup JSON so `created_files` includes both CodeSpec-root paths and
`.codespec-store/store.yaml` when they were created.

### 4. Rework Register Operations

Update register so it begins by inspecting the existing path:

- The path must exist and be a healthy CodeSpec root.
- Existing valid `.codespec-store/store.yaml` supplies or confirms the store id.
- A healthy CodeSpec root without identity can be converted only after user
  confirmation.
- JSON/non-interactive conversion requires `--yes`.
- Missing, partial, arbitrary, beta-only, invalid-metadata, or conflicting roots
  fail before registry mutation.

Register should not create `codespec/`, `config.yaml`, `specs/`, `changes/`, or
`archive/`. It only writes `.codespec-store/store.yaml` for confirmed
conversion, then updates the local registry.

### 5. Make Idempotency Explicit

Update registry and operation behavior so same id plus same root path is a
stable no-op success.

Expected no-op behavior:

- No metadata rewrite.
- No config rewrite.
- No duplicate registry entry.
- `created_files: []`.
- Human output says already registered, already exists, or nothing to change.
- JSON includes an info diagnostic or status entry that agents can interpret.

Same id with a different path and same path under a different id should keep
the existing conflict protections unless the spec for a future replacement flow
changes that.

### 6. Extend Doctor Output

Extend `ContextStoreInspection` in `src/core/context-store/operations.ts` with
CodeSpec-root inspection results.

Update `src/commands/context-store.ts` output types and printers so:

- Human doctor output names CodeSpec-root health separately.
- JSON doctor output includes `codespec_root`.
- Metadata diagnostics remain metadata diagnostics.
- Git diagnostics remain Git diagnostics.
- Doctor never calls the root ensure/scaffold helper.

### 7. Remove Old Initiative-Oriented Guidance

Update setup/register human output and help text in `src/commands/context-store.ts`
so the next step points toward normal CodeSpec specs and changes.

Avoid language like:

- "create an initiative"
- "workspace planning"
- "collections"
- generated agent/tool setup

Use language like:

- "Use normal CodeSpec specs and changes in this store."
- "This store is a standalone CodeSpec root."

### 8. Keep Old Beta Files Ignored

Do not add migration or cleanup logic for old beta files.

If old beta files exist inside an otherwise healthy root, setup/register should
leave them byte-for-byte unchanged.

If old beta files are the only signal in a directory, setup/register should not
treat that directory as healthy or registered. The folder is still arbitrary
non-empty input unless the new root shape is present.

## Test Plan

### Root Helper Tests

Add focused helper coverage, likely in `test/core/codespec-root.test.ts`:

- Healthy root with `config.yaml`.
- Healthy root with `config.yml`.
- Missing config.
- Missing `specs/`.
- Missing `changes/`.
- Missing `changes/archive/`.
- Ensure creates root shape and default config.
- Ensure preserves existing config and user-authored files.
- Rollback removes only ledger-created files and empty directories.

### Command Tests

Update `test/commands/context-store.test.ts`:

- Setup JSON for a missing directory expects the full root shape and
  `created_files`.
- Setup accepts an empty directory.
- Setup accepts a Git-only directory and preserves `.git/`.
- Setup preserves an existing healthy CodeSpec root and config edits.
- Setup creates config in JSON/non-interactive mode without tool selection.
- Setup rejects arbitrary non-empty folders and creates no CodeSpec files.
- Setup rejects nested Git paths, including the old interactive override path.
- Registering a plain folder now fails.
- Registering a cloned healthy context store succeeds without planning-file
  mutation.
- Registering a healthy root without identity prompts for conversion.
- Declining conversion writes nothing.
- JSON/non-interactive conversion without `--yes` refuses.
- JSON/non-interactive conversion with `--yes` writes identity and registry.
- Repeating setup/register produces `created_files: []` and no duplicate
  registry entry.
- Setup/register do not create `initiatives/`, `.codespec-workspace/`,
  `workspace.yaml`, `AGENTS.md`, `.codex/`, `.claude/`, or `.cursor/`.
- Old beta files inside healthy roots are ignored and preserved.
- Beta-only folders are rejected as unsafe or non-root.
- Doctor JSON includes `codespec_root` separate from `metadata` and `git`.
- Doctor reports missing archive under `codespec_root` without creating it.

### Core Context-Store Tests

Add or update operation-level tests around:

- `prepareContextStoreSetup`.
- `setupPreparedContextStore`.
- `registerExistingContextStore`.
- `doctorContextStores`.
- Registry no-op behavior for same id and same path.
- Registry conflict behavior for same id different path and same path different
  id.
- Failure cleanup when registry commit fails after setup/register created files.

### Regression Tests

Keep existing init and workspace tests honest:

- `codespec init` still creates its expected files and generated assets.
- Context-store setup/register do not accidentally inherit those generated
  assets.
- Existing metadata validation tests still enforce the thin identity shape.

## Verification

Run targeted tests first:

```bash
pnpm exec vitest run test/core/codespec-root.test.ts
pnpm exec vitest run test/core/context-store/registry.test.ts
pnpm exec vitest run test/commands/context-store.test.ts
pnpm exec vitest run test/core/init.test.ts
```

Then run the broader repo checks:

```bash
pnpm test
pnpm run build
```

## Main Risks

- Rollback is the easiest place to damage user trust. Use a ledger and remove
  only files/directories created by the current operation.
- Register currently accepts arbitrary folders. Changing that behavior is
  intentional, but tests and user-facing errors need to make the new rule clear.
- Nested Git rejection is locked for this slice but may change later. Keep the
  check small and easy to replace.
- Full `codespec init` is tempting to reuse, but it carries unrelated behavior.
  Use only root scaffolding.
- JSON shape changes should be explicit enough for agents while preserving
  existing fields where practical.

## Done When

- A fresh setup leaves a normal CodeSpec root plus
  `.codespec-store/store.yaml`.
- Setup accepts Git-only directories and existing healthy roots.
- Setup rejects arbitrary non-empty folders and nested Git paths without writes.
- Register succeeds for cloned context stores with existing identity metadata.
- Register can turn a healthy CodeSpec root into a context store only after
  confirmation.
- Register refuses missing, partial, arbitrary, beta-only, or unconfirmed roots
  without writes.
- Doctor reports `codespec_root`, `metadata`, and `git` as separate health
  areas.
- Re-running setup/register is a no-op success for the same healthy id and path.
- User-authored config, specs, changes, archives, identity metadata, and old
  beta files are preserved.
- Setup/register do not create initiative, workspace, agent, slash-command, or
  tool-generation artifacts.
- Targeted tests, `pnpm test`, and `pnpm run build` pass.
