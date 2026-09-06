# CLI

> The `codespec` terminal commands.

<!-- Installing, updating, and uninstalling the CLI itself live in installation.md. -->

## Commands

**Set up**

| Command | What it does |
|---|---|
| [`codespec init`](#codespec-init) | Initialize CodeSpec in a project. |
| [`codespec update`](#codespec-update) | Update CodeSpec's installed instruction files. |
| [`codespec config`](#codespec-config) | View and change global configuration. |

**Changes and specs**

| Command | What it does |
|---|---|
| [`codespec list`](#codespec-list) | List changes, or specs with `--specs`. |
| [`codespec show`](#codespec-show) | Print a change or spec, as markdown or JSON. |
| [`codespec view`](#codespec-view) | One-screen dashboard of specs and changes. |
| [`codespec validate`](#codespec-validate) | Check changes and specs for structural issues. |
| [`codespec archive`](#codespec-archive) | Move a completed change to the archive and update the main specs. |

**Workflows and schemas**

Your agent runs most of these during the workflow.

| Command | What it does |
|---|---|
| [`codespec new`](#codespec-new) | Create a new change directory. |
| [`codespec status`](#codespec-status) | Artifact completion status for one or every active change. |
| [`codespec instructions`](#codespec-instructions) | Instructions for creating an artifact, applying, or archiving. |
| [`codespec templates`](#codespec-templates) | Resolved template paths for a schema's artifacts. |
| [`codespec schemas`](#codespec-schemas) | List available workflow schemas. |
| [`codespec schema`](#codespec-schema) | Inspect, fork, or create a schema (experimental). |

**Multi-repo (beta)**

| Command | What it does |
|---|---|
| [`codespec store`](#codespec-store) | Create and manage stores: standalone CodeSpec repos registered on your machine. |
| [`codespec doctor`](#codespec-doctor) | Report relationship health for the resolved CodeSpec root. |
| [`codespec context`](#codespec-context) | Print the working context for the resolved CodeSpec root. |
| [`codespec workset`](#codespec-workset) | Compose, keep, and open personal working views. |

**Utilities**

| Command | What it does |
|---|---|
| [`codespec feedback`](#codespec-feedback) | Submit feedback about CodeSpec. |
| [`codespec completion`](#codespec-completion) | Install or generate shell completions. |

**Deprecated**

| Command | What it does |
|---|---|
| [`codespec change`](#codespec-change) | Noun form of show, list, and validate for changes. The CLI warns and points to the verb-first commands. |
| [`codespec spec`](#codespec-spec) | Noun form of show, list, and validate for specs, with the same warning. |

Every command takes `-h, --help`. The bare `codespec` command also takes:

- `-V, --version`: print the CLI version.
- `--no-color`: disable colored output.

## codespec init

Initializes CodeSpec in a project.

```bash
codespec init                        # current directory, interactive tool picker
codespec init --tools claude,cursor  # set up specific tools, no prompts
codespec init --tools none           # codespec/ structure only, no tool files
```

With no `--tools`, init prompts you to pick tools in an interactive terminal. Outside one, it sets up the tools it detects in the project. With none detected it exits 1 and lists the valid ids.

**Arguments**

| Argument | What it is |
|---|---|
| `path` | The project directory to initialize. Default: current directory. Created if missing. |

**Options**

| Flag | Effect |
|---|---|
| `--tools <tools>` | Comma-separated tool ids, `all`, or `none`. Skips the picker. Ids are listed in [Supported tools](supported-tools.md). |
| `--force` | Remove files from older CodeSpec layouts without asking. Interactive runs otherwise confirm the cleanup first. |
| `--profile <profile>` | Override the global config profile for this run: `core` (the standard workflow set) or `custom` (the workflows saved in global config). |
| `--no-animation` | Show a static welcome screen instead of the animated one. |

**Output**

Each selected tool gets CodeSpec's skills and commands in its own directory:

```
▌ CodeSpec structure created
✔ Setup complete for Claude Code

CodeSpec Setup Complete

Created: Claude Code
6 skills and 6 commands in .claude/
Config: codespec/config.yaml (schema: spec-driven)

Getting started:
  Start your first change: /codespec:propose "your idea"

Restart your IDE for the new commands to take effect.
```

`--tools none` creates only `codespec/config.yaml`. On an already-initialized project, init rewrites the installed files in place and the summary reads `Refreshed: Claude Code` with `Config: codespec/config.yaml (exists)`.

**Exit codes**

- `0`: setup completed.
- `1`: invalid `--tools` or `--profile` value, or a non-interactive run with no tools detected and no `--tools`.

## codespec update

Updates CodeSpec's installed instruction files.

```bash
codespec update           # refresh tools whose files are older than the CLI
codespec update --force   # rewrite files even when they're current
```

update finds the tools init configured and compares their generated files against the CLI's version. When a newer CodeSpec release exists, it first offers to upgrade the CLI, then reruns with the upgraded version. Set `CODESPEC_NO_UPDATE_CHECK=1` to skip the check.

**Arguments**

| Argument | What it is |
|---|---|
| `path` | The project directory to update. Default: current directory. |

**Options**

| Flag | Effect |
|---|---|
| `--force` | Rewrite every configured tool's files even when they're up to date. |

**Output**

When every tool's files match the CLI version:

```
✓ All 1 tool(s) up to date (v1.7.0)
  Tools: claude

Use --force to refresh files anyway.
```

When a tool's files came from an older CLI (or with `--force`, which prints `Force updating 1 tool(s): claude` instead):

```
Updating 1 tool(s): claude (1.6.0 → 1.7.0)

✔ Updated Claude Code

✓ Updated: Claude Code (v1.7.0)
Tools: Claude Code

Restart your IDE for changes to take effect.
```

In a directory without CodeSpec, update refuses:

```
✖ Error: No CodeSpec directory found. Run 'codespec init' first.
```

**Exit codes**

- `0`: files updated, or everything already up to date.
- `1`: no CodeSpec directory at the path, or the update failed.

## codespec config

Views and changes global configuration.

```bash
codespec config list                  # see current settings
codespec config set delivery skills   # change one value
codespec config profile               # interactive workflow picker
```

| Subcommand | What it does |
|---|---|
| `path` | Print the config file location. |
| `list` | Show all current settings. |
| `get <key>` | Print one value, raw and scriptable. |
| `set <key> <value>` | Set a value, coercing its type. |
| `unset <key>` | Remove a key so its default applies. |
| `reset` | Reset all configuration to defaults. |
| `edit` | Open the config file in `$EDITOR`. |
| `profile [preset]` | Configure delivery mode and workflows. |

Config is global to your machine, stored as JSON where `config path` points: `$XDG_CONFIG_HOME/codespec/config.json` if set, else `~/.config/codespec/config.json` (macOS, Linux) or `%APPDATA%\codespec\config.json` (Windows). Every subcommand accepts `--scope <scope>`, but only `global` works today. Any other scope exits 1 with `Error: Project-local config is not yet implemented`.

### codespec config path

```bash
codespec config path
```

```
/Users/you/.config/codespec/config.json
```

### codespec config list

```bash
codespec config list          # readable settings plus profile summary
codespec config list --json   # raw config as JSON
```

**Options**

| Flag | Effect |
|---|---|
| `--json` | Print the config object as JSON. |

**Output**

Each setting, then a profile summary that marks values as explicit or default:

```
featureFlags: {}
profile: core
delivery: both

Profile settings:
  profile: core (default)
  delivery: both (default)
  workflows: propose, explore, apply, update, sync, archive (from core profile)
```

### codespec config get

```bash
codespec config get delivery
```

**Arguments**

| Argument | What it is |
|---|---|
| `key` | The key to read. Dots reach nested values (`featureFlags.workspaces`). |

**Output**

The bare value, ready for scripts. Objects print as compact JSON:

```
both
```

**Exit codes**

- `0`: value printed.
- `1`: key has no value, and nothing is printed.

### codespec config set

```bash
codespec config set delivery skills
codespec config set featureFlags.workspaces true
```

**Arguments**

| Argument | What it is |
|---|---|
| `key` | The key to write, dotted for nested values. |
| `value` | The new value. `true`/`false` become booleans, numeric strings become numbers. |

**Options**

| Flag | Effect |
|---|---|
| `--string` | Store the value as a string, skipping type coercion. |
| `--allow-unknown` | Permit keys the schema doesn't know. |

**Output**

```
Set featureFlags.workspaces = true
```

Unknown keys and invalid values fail with exit 1 before anything is saved:

```
Error: Invalid configuration key "bogus.key". Unknown top-level key "bogus".
Use "codespec config list" to see available keys.
Pass --allow-unknown to bypass this check.
```

```
Error: Invalid configuration - delivery: Invalid option: expected one of "both"|"skills"|"commands"
```

### codespec config unset

```bash
codespec config unset delivery
```

Removes the key so the default applies again. Keys with built-in defaults always count as set, so this reports success even if you never set them:

```
Unset delivery (reverted to default)
```

A key with no value at all prints `Key "featureFlags.nothere" was not set`. Both cases exit 0.

### codespec config reset

```bash
codespec config reset --all      # asks for confirmation
codespec config reset --all -y   # no prompt
```

**Options**

| Flag | Effect |
|---|---|
| `--all` | Required. Reset everything. |
| `-y, --yes` | Skip the confirmation prompt. |

**Output**

```
Configuration reset to defaults
```

Without `--all` it exits 1 and prints the usage line.

**Exit codes**

- `0`: reset done, or you answered no at the prompt.
- `1`: `--all` missing.
- `130`: prompt cancelled with Ctrl-C.

### codespec config edit

```bash
codespec config edit
```

Opens the config file in `$EDITOR` (falling back to `$VISUAL`), creating it with defaults first if missing. When the editor closes, the file is validated. Invalid JSON or an invalid config exits 1. With no editor configured it exits 1:

```
Error: No editor configured
Set the EDITOR or VISUAL environment variable to your preferred editor
Example: export EDITOR=vim
```

### codespec config profile

```bash
codespec config profile        # interactive picker (needs a terminal)
codespec config profile core   # apply the core preset directly
```

**Arguments**

| Argument | What it is |
|---|---|
| `preset` | Optional preset name. Only `core` exists. It selects the core workflows and keeps your delivery setting. |

With no preset, an interactive picker shows your current delivery and workflows, lets you change either or both (delivery: both, skills only, or commands only; workflows: a checkbox list), prints the diff, and inside an CodeSpec project offers to run `codespec update` for you. Outside a terminal it exits 1:

```
Interactive mode required. Use `codespec config profile core` or set config via environment/flags.
```

**Output**

Changed config doesn't reach projects until they update:

```
Config updated. Run `codespec update` in your projects to apply.
```

**Exit codes**

- `0`: profile saved, or you kept current settings.
- `1`: unknown preset, no terminal, or the offered `codespec update` failed.
- `130`: picker cancelled with Ctrl-C.

## codespec list

Lists changes, or specs with `--specs`.

```bash
codespec list           # changes, most recently modified first
codespec list --specs   # specs with requirement counts
codespec list --json    # machine-readable, includes the resolved root
```

Rows come from `codespec/changes/` and `codespec/specs/` under the resolved root. The `archive/` folder is skipped.

**Options**

| Flag | Effect |
|---|---|
| `--specs` | List specs instead of changes. |
| `--changes` | List changes. This is the default. |
| `--sort <order>` | `recent` (last modified first) or `name`. Default: `recent`. Specs always sort by name. |
| `--json` | Print JSON instead of the table. |
| `--store <id>` | Use a registered store as the CodeSpec root instead of the current project. |

**Output**

One row per change: name, task status, last modified. The status column reads `No tasks`, `2/5 tasks`, or `✓ Complete`.

```
Changes:
  add-rate-limit     No tasks      just now
```

```
Specs:
  api     requirements 1
```

`--json` adds task counts and a `status` of `no-tasks`, `in-progress`, or `complete`:

```json
{
  "changes": [
    {
      "name": "add-rate-limit",
      "completedTasks": 0,
      "totalTasks": 0,
      "lastModified": "2026-08-11T13:44:40.171Z",
      "status": "no-tasks"
    }
  ],
  "root": {
    "path": "/Users/you/projects/my-app",
    "source": "nearest"
  }
}
```

An empty listing prints `No active changes found.` or `No specs found.` and still exits 0.

**Exit codes**

- `0`: listing printed, even when empty.
- `1`: no CodeSpec root found (outside a project, no `--store`).

## codespec show

Prints a change or spec, as markdown or JSON.

```bash
codespec show add-rate-limit              # change: prints proposal.md
codespec show add-rate-limit --diff       # change: append requirement diffs
codespec show api                         # spec: prints spec.md
codespec show api --json --no-scenarios   # spec JSON without scenario text
```

With no name, show asks change or spec, then lists items to pick from. Outside an interactive terminal it exits 1 and prints the direct forms instead.

**Arguments**

| Argument | What it is |
|---|---|
| `item-name` | The change or spec to show, by folder name (`add-rate-limit`, `api`). |

**Options**

| Flag | Effect |
|---|---|
| `--json` | Print structured JSON instead of raw markdown. |
| `--type <change\|spec>` | Pick the type when a change and a spec share a name. |
| `--no-interactive` | Never prompt: a missing name becomes an error. |
| `--deltas-only` | JSON, change: restrict output to deltas. Change JSON is already delta-only, so output matches plain `--json`. |
| `--requirements-only` | Deprecated alias for `--deltas-only`. Warns on stderr. |
| `--diff` | Change: append per-requirement delta diffs. Ignored with a warning for specs. |
| `--requirements` | JSON, spec: keep requirement text, empty the `scenarios` arrays. |
| `--no-scenarios` | JSON, spec: same output as `--requirements`. |
| `-r, --requirement <id>` | JSON, spec: output one requirement by 1-based position. Can't combine with `--requirements`. |
| `--store <id>` | Use a registered store as the CodeSpec root instead of the current project. |

Flags that don't apply to the resolved type are ignored with a warning on stderr.

**Output**

Text mode is a raw passthrough: a change prints its `proposal.md`, a spec prints its `spec.md`.

```
# Add rate limiting

## Why
Unauthenticated clients can exhaust the API.

## What Changes
- Add per-client rate limiting to the public API.
```

For a change, `--diff` prints the proposal first, then a `Specifications Changed (diffs)` section. ADDED requirements include their full text. REMOVED requirements retain the authored Reason and Migration. RENAMED requirements show FROM and TO. MODIFIED requirements show a unified diff against the matching main requirement.

If a MODIFIED header matches only after folding case or whitespace, the output includes both the diff and a warning that archive matching is exact. If the main spec or requirement is missing, the output warns and prints the full delta block. A MODIFIED block with no textual difference prints `(no textual changes)`.

A change with `--json` is delta-shaped:

```json
{
  "id": "add-rate-limit",
  "title": "Add rate limiting",
  "deltaCount": 1,
  "deltas": [
    {
      "spec": "api",
      "operation": "ADDED",
      "description": "Add requirement: The API SHALL limit each client to 100 requests per minute.",
      "requirement": {
        "text": "The API SHALL limit each client to 100 requests per minute.",
        "scenarios": [
          {
            "rawText": "- **WHEN** a client sends its 101st request within a minute\n- **THEN** the API responds 429"
          }
        ]
      },
      ...
    }
  ],
  "root": {
    "path": "/Users/you/projects/my-app",
    "source": "nearest"
  }
}
```

`--json --diff` keeps this top-level shape. A MODIFIED delta gains a `diff` string, a `warning` string, or both. Other operations are unchanged. An empty `diff` string means the main and delta blocks are textually identical.

A spec with `--json` lists its requirements with scenarios:

```json
{
  "id": "api",
  "title": "api",
  "overview": "Public HTTP API behavior.",
  "requirementCount": 1,
  "requirements": [
    {
      "text": "The API SHALL expose a health endpoint.",
      "scenarios": [
        {
          "rawText": "- **WHEN** a client requests GET /health\n- **THEN** the API responds 200"
        }
      ]
    }
  ],
  "metadata": {
    "version": "1.0.0",
    "format": "codespec"
  },
  "root": {
    "path": "/Users/you/projects/my-app",
    "source": "nearest"
  }
}
```

An unknown name suggests near matches: `Unknown item 'does-not-exist'. Did you mean: add-rate-limit, api?`. A name that matches both a change and a spec errors and asks for `--type`.

**Exit codes**

- `0`: item printed.
- `1`: unknown or ambiguous name, no name outside a terminal, an out-of-range `-r` index, `--requirements` combined with `-r`, or a delta or main spec cannot be read for `--diff`.

## codespec view

Prints a one-screen dashboard of specs and changes.

```bash
codespec view   # project summary in one screen
```

view prints the dashboard once and exits. It reads no keystrokes. Changes group by task progress: Draft (no tasks yet), Active (tasks underway, with a progress bar and percent), Completed (every task checked). Specs list with requirement counts, largest first.

**Options**

| Flag | Effect |
|---|---|
| `--store <id>` | Use a registered store as the CodeSpec root instead of the current project. |

**Output**

```
CodeSpec Dashboard

════════════════════════════════════════════════════════════
Summary:
  ● Specifications: 1 specs, 1 requirements
  ● Draft Changes: 1
  ● Active Changes: 0 in progress
  ● Completed Changes: 0

Draft Changes
────────────────────────────────────────────────────────────
  ○ add-rate-limit

Specifications
────────────────────────────────────────────────────────────
  ▪ api                            1 requirement

════════════════════════════════════════════════════════════

Use codespec list --changes or codespec list --specs for detailed views
```

A `Task Progress` summary line appears when any change has tasks underway.

**Exit codes**

- `0`: dashboard printed.
- `1`: no CodeSpec root found (outside a project, no `--store`).

## codespec validate

Checks changes and specs for structural issues.

```bash
codespec validate add-rate-limit   # one change or spec, by name
codespec validate --all            # every change and spec
```

With no name and no bulk flag, validate prompts you to pick items. Outside an interactive terminal it exits 1 and prints the bulk flags instead.

**Arguments**

| Argument | What it is |
|---|---|
| `item-name` | The change or spec to validate, by folder name (`add-rate-limit`, `api`). |

**Options**

| Flag | Effect |
|---|---|
| `--all` | Validate every change and spec. |
| `--changes` | Validate every change. |
| `--specs` | Validate every spec. |
| `--strict` | Treat warnings as failures. |
| `--type <change\|spec>` | Pick the type when a change and a spec share a name. |
| `--json` | Print a structured report instead of text. |
| `--concurrency <n>` | Max parallel validations in bulk runs. Default: `CODESPEC_CONCURRENCY`, else 6. |
| `--no-interactive` | Never prompt: a missing or ambiguous name becomes an error. |
| `--store <id>` | Use a registered store as the CodeSpec root instead of the current project. |

**Output**

One line per item. Bulk runs end with totals:

```
✓ change/add-rate-limit
✓ spec/api
Totals: 2 passed, 0 failed (2 items)
```

A failing item lists each issue and the fix:

```
Change 'add-rate-limit' has issues
✗ [ERROR] api/spec.md: ADDED "Rate limiting" must include at least one scenario
Next steps:
  - Ensure change has deltas in specs/: use headers ## ADDED/MODIFIED/REMOVED/RENAMED Requirements
  - Each requirement MUST include at least one #### Scenario: block
  - Debug parsed deltas: codespec show add-rate-limit --json --deltas-only
```

`--json` prints one report for the run:

```json
{
  "items": [
    {
      "id": "add-rate-limit",
      "type": "change",
      "valid": true,
      "issues": [],
      "durationMs": 2
    }
  ],
  "summary": {
    "totals": {
      "items": 1,
      "passed": 1,
      "failed": 0
    },
    "byType": {
      "change": {
        "items": 1,
        "passed": 1,
        "failed": 0
      }
    }
  },
  "version": "1.0",
  "root": {
    "path": "/Users/you/projects/my-app",
    "source": "nearest"
  }
}
```

`issues` entries carry a `level` of `ERROR`, `WARNING`, or `INFO`.

**Exit codes**

- `0`: every validated item passed.
- `1`: an item failed, or the run couldn't validate anything (unknown name, nothing to validate).

## codespec archive

Moves a completed change to the archive and updates the main specs.

```bash
codespec archive add-rate-limit -y                # archive one change, merge its deltas
codespec archive add-rate-limit -y --skip-specs   # archive without touching the specs
```

With no name, archive prompts you to pick a change. Outside an interactive terminal it exits 1 and prints the rerun command instead.

**Arguments**

| Argument | What it is |
|---|---|
| `change-name` | The change to archive, by folder name (`add-rate-limit`). |

**Options**

| Flag | Effect |
|---|---|
| `-y, --yes` | Answer yes to every confirmation: spec updates, incomplete tasks, skipped validation. |
| `--skip-specs` | Archive without touching the main specs (infrastructure, tooling, or doc-only changes). |
| `--no-validate` | Skip validation. Archive asks you to confirm first, and `-y` answers it. |
| `--json` | Print a structured result instead of text. Needs `--yes` to confirm spec updates. |
| `--store <id>` | Use a registered store as the CodeSpec root instead of the current project. |

**Output**

A successful run reports task status, previews the spec updates, applies them, and names the archive folder:

```
Task status: ✓ Complete

Specs to update:
  api: update
Applying changes to codespec/specs/api/spec.md:
  + 1 added
Totals: + 1, ~ 0, - 0, → 0
Specs updated successfully.
Change 'add-rate-limit' archived as '2026-08-11-add-rate-limit'.
```

The change folder moves whole to `codespec/changes/archive/2026-08-11-add-rate-limit/`, today's date prefixed to its name. Each delta merges into its main spec: the ADDED requirement above was appended to `codespec/specs/api/spec.md`. Without `-y`, archive shows the preview and asks before updating. Declining still archives the change and leaves the specs alone.

With `--json --yes`:

```json
{
  "archive": {
    "change": "add-rate-limit",
    "archivedAs": "2026-08-11-add-rate-limit",
    "path": "/Users/you/projects/my-app/codespec/changes/archive/2026-08-11-add-rate-limit",
    "specsUpdated": true,
    "totals": {
      "added": 1,
      "modified": 0,
      "removed": 0,
      "renamed": 0
    }
  },
  "root": {
    "path": "/Users/you/projects/my-app",
    "source": "nearest"
  }
}
```

Archive validates the change first and refuses one that fails:

```
Validation errors in change delta specs:
  ✗ ADDED "Rate limiting" must include at least one scenario

Validation failed. Please fix the errors before archiving.
To skip validation (not recommended), use --no-validate flag.
```

Incomplete tasks warn but don't block. Interactively archive asks whether to continue, and `-y` continues on its own:

```
Task status: 1/2 tasks
Warning: 1 incomplete task(s) found. Continuing due to --yes flag.
```

**Exit codes**

- `0`: the change was archived, with or without spec updates.
- `1`: validation failed, the change name is unknown, or a confirmation was needed and no answer could be read.

## codespec new

Creates a new change directory.

```bash
codespec new change add-caching                                # metadata only
codespec new change add-search --goal "Users can search docs"  # record a goal
```

`new` has one subcommand, `new change <name>`. It creates `codespec/changes/<name>/` containing a single [`.codespec.yaml` metadata file](configuration/change-metadata.md):

```yaml
schema: spec-driven
created: 2026-08-11
```

Artifacts (proposal, specs, design, tasks) aren't scaffolded here. You write them later, and `codespec status` tells you which one is next.

**Arguments**

| Argument | What it is |
|---|---|
| `name` | Folder name for the change (`add-caching`). |

**Options**

| Flag | Effect |
|---|---|
| `--description <text>` | Also create a `README.md` in the change directory with this text. |
| `--goal <text>` | Store a `goal:` line in `.codespec.yaml`. |
| `--schema <name>` | Workflow schema for the change. Default: `spec-driven`, the only schema that ships. |
| `--json` | Print the created change as JSON instead of text. |
| `--store <id>` | Use a registered store as the CodeSpec root instead of the current project. |

**Output**

```
Created change 'add-caching' at codespec/changes/add-caching/
Schema: spec-driven
Next: codespec status --change add-caching
```

With `--json`:

```json
{
  "change": {
    "id": "add-caching",
    "path": "/Users/you/projects/my-app/codespec/changes/add-caching",
    "metadataPath": "/Users/you/projects/my-app/codespec/changes/add-caching/.codespec.yaml",
    "schema": "spec-driven"
  },
  "root": {
    "path": "/Users/you/projects/my-app",
    "source": "nearest"
  }
}
```

**Exit codes**

- `0`: change created.
- `1`: the change already exists, or the schema is unknown.

## codespec status

Reports artifact completion status for one change or every active change.

```bash
codespec status --change add-rate-limit          # checklist view
codespec status --change add-rate-limit --json   # structured report
codespec status --all                            # every active change
codespec status --all --json                     # one batch report
```

When active changes exist, use exactly one of `--change` or `--all`. Without either, status exits 1 and lists the available changes, even when only one exists:

```text
✖ Error: Missing required option --change (or --all for every active change). Available changes:
  add-rate-limit
```

When the project has no active changes, status prints `No active changes. Create one with: codespec new change <name>` and exits 0 even without either flag. With `--all --json`, the same empty state is `{ "changes": [], "message": "No active changes.", "root": ... }`.

**Options**

| Flag | Effect |
|---|---|
| `--change <id>` | The change to report on, by folder name. |
| `--all` | Report every active change, sorted by name. Can't be combined with `--change`. |
| `--schema <name>` | Override the schema auto-detected from `codespec/config.yaml`. An unknown name is an error. |
| `--json` | Print a structured report instead of text. |
| `--store <id>` | Use a registered store as the CodeSpec root instead of the current project. |

**Output**

A checklist of the schema's artifacts: `[x]` done, `[ ]` ready to write, `[-]` blocked until the artifacts it depends on exist.

```
Change: add-rate-limit
Schema: spec-driven
Change root: /Users/you/projects/my-app/codespec/changes/add-rate-limit
Progress: 2/4 artifacts complete

[x] proposal
[x] specs
[ ] design
[-] tasks (blocked by: design)
```

`--json` adds per-artifact dependencies, resolved file paths, and a suggested next step. Trimmed:

```json
{
  "changeName": "add-rate-limit",
  "schemaName": "spec-driven",
  "isComplete": false,
  "nextSteps": [
    "Run codespec instructions design --change \"add-rate-limit\" --json before writing that artifact."
  ],
  "artifacts": [
    {
      "id": "proposal",
      "outputPath": "proposal.md",
      "status": "done",
      "requires": []
    },
    {
      "id": "design",
      "outputPath": "design.md",
      "status": "ready",
      "requires": [
        "proposal"
      ]
    },
    {
      "id": "tasks",
      "outputPath": "tasks.md",
      "status": "blocked",
      "requires": [
        "specs",
        "design"
      ],
      "missingDeps": [
        "design"
      ]
    }
  ]
}
```

With `--all --json`, `changes` contains the same status object for each change, without a per-change `root`. The selected root appears once on the envelope. This example trims the per-change status fields shown above:

```json
{
  "changes": [
    {
      "changeName": "add-rate-limit",
      "schemaName": "spec-driven",
      "artifacts": []
    }
  ],
  "root": {
    "path": "/Users/you/projects/my-app",
    "source": "nearest"
  }
}
```

If one change can't load, the batch continues. Its entry contains `changeName` and a `status` diagnostic while the other entries remain available. The command exits 1, including in JSON mode, so CI doesn't accept an incomplete report as successful. JSON output remains one parseable document.

**Exit codes**

- `0`: every requested status printed; an empty `--all` report also exits 0.
- `1`: a requested change failed to load, `--change` or `--all` is missing, the two flags were combined, the change doesn't exist, or the schema override is unknown.

## codespec instructions

Prints instructions for creating an artifact, applying, or archiving. Your agent runs this during the workflow to fetch the instruction text for its next step.

```bash
codespec instructions proposal --change add-rate-limit   # how to write one artifact
codespec instructions apply --change add-rate-limit      # how to implement the change
codespec instructions archive --change add-rate-limit    # inputs for archiving
```

**Arguments**

| Argument | What it is |
|---|---|
| `artifact` | An artifact id from the schema (`proposal`, `specs`, `design`, `tasks` in `spec-driven`), or the reserved words `apply` and `archive`. |

**Options**

| Flag | Effect |
|---|---|
| `--change <id>` | The change to generate instructions for. Required. |
| `--schema <name>` | Override the schema. Auto-detected from `config.yaml` otherwise. |
| `--json` | Print a structured object instead of text. |
| `--store <id>` | Use a registered store as the CodeSpec root instead of the current project. |

**Output**

The artifact form prints one instruction block: the task, the file to write, how to write it, the artifact's template, and what completing it unlocks.

```
<artifact id="proposal" change="add-rate-limit" schema="spec-driven">

<task>
Create the proposal artifact for change "add-rate-limit".
Initial proposal document outlining the change
</task>

<output>
Write to: /Users/you/projects/my-app/codespec/changes/add-rate-limit/proposal.md
</output>

<instruction>
Create the proposal document that establishes WHY this change is needed.
...
```

`apply` prints context files, task progress, and the working instruction:

```
## Apply: add-rate-limit
Schema: spec-driven

### Context Files
- proposal: /Users/you/projects/my-app/codespec/changes/add-rate-limit/proposal.md
- specs: /Users/you/projects/my-app/codespec/changes/add-rate-limit/specs/api/spec.md
- tasks: /Users/you/projects/my-app/codespec/changes/add-rate-limit/tasks.md

### Progress
1/3 complete

### Tasks
- [x] 1.1 Add rate limit middleware
- [ ] 1.2 Return 429 with Retry-After header
- [ ] 1.3 Add tests for burst traffic

### Instruction
Read context files, work through pending tasks, mark complete as you go.
Pause if you hit blockers or need clarification.

No project context or operation guidance configured.
```

When required artifacts are missing, `apply` reports `### ⚠️ Blocked` and names them instead. `archive` prints the change name plus any project context and operation guidance from config. With none configured it says so and nothing more.

With `--json`, each form returns one object. The artifact form starts:

```json
{
  "changeName": "add-rate-limit",
  "artifactId": "proposal",
  "schemaName": "spec-driven",
  "changeDir": "/Users/you/projects/my-app/codespec/changes/add-rate-limit",
  ...
```

and continues with `outputPath`, `existingOutputPaths`, the full `instruction` and `template` strings, `dependencies`, `unlocks`, and `root`. The `apply` form carries `contextFiles`, `progress`, `tasks`, `state` (`blocked`, `ready`, `all_done`), and `instruction`.

**Exit codes**

- `0`: instructions printed.
- `1`: unknown artifact, unknown change, unknown schema, or missing `--change`. Each error lists the valid values.

## codespec templates

Prints the resolved template paths for a schema's artifacts.

```bash
codespec templates          # default schema: spec-driven
codespec templates --json   # map of artifact ids to paths
```

**Options**

| Flag | Effect |
|---|---|
| `--schema <name>` | Schema to resolve. Default: `spec-driven`. |
| `--json` | Print a JSON map of artifact ids to template paths. |

**Output**

```
Schema: spec-driven
Source: package

proposal:
  /usr/local/lib/node_modules/@fission-ai/codespec/schemas/spec-driven/templates/proposal.md
specs:
  /usr/local/lib/node_modules/@fission-ai/codespec/schemas/spec-driven/templates/spec.md
design:
  /usr/local/lib/node_modules/@fission-ai/codespec/schemas/spec-driven/templates/design.md
tasks:
  /usr/local/lib/node_modules/@fission-ai/codespec/schemas/spec-driven/templates/tasks.md
```

`Source` names where the schema resolved from: `project` (`codespec/schemas/` in your project), `user` (a global override), or `package` (built into the CLI). Project wins over user, user over package.

```json
{
  "proposal": {
    "path": "/usr/local/lib/node_modules/@fission-ai/codespec/schemas/spec-driven/templates/proposal.md",
    "source": "package"
  },
  "specs": {
    "path": "/usr/local/lib/node_modules/@fission-ai/codespec/schemas/spec-driven/templates/spec.md",
    "source": "package"
  },
  "design": {
    "path": "/usr/local/lib/node_modules/@fission-ai/codespec/schemas/spec-driven/templates/design.md",
    "source": "package"
  },
  "tasks": {
    "path": "/usr/local/lib/node_modules/@fission-ai/codespec/schemas/spec-driven/templates/tasks.md",
    "source": "package"
  }
}
```

**Exit codes**

- `0`: paths printed.
- `1`: unknown schema. The error lists available schemas.

## codespec schemas

Lists available workflow schemas.

```bash
codespec schemas          # names, descriptions, artifact order
codespec schemas --json   # machine-readable, for agent use
```

**Options**

| Flag | Effect |
|---|---|
| `--json` | Output as JSON (for agent use). |

**Output**

```
Available schemas:

  spec-driven
    Default CodeSpec workflow - proposal → specs → design → tasks
    Artifacts: proposal → specs → design → tasks
```

Schemas from your project are labeled `(project)`, and global overrides are labeled `(user override)`.

```json
[
  {
    "name": "spec-driven",
    "description": "Default CodeSpec workflow - proposal → specs → design → tasks",
    "artifacts": [
      "proposal",
      "specs",
      "design",
      "tasks"
    ],
    "source": "package"
  }
]
```

**Exit codes**

- `0`: schemas listed.
- `1`: the schema list couldn't be read.

## codespec schema

Inspects, forks, or creates a schema (experimental). Every subcommand first prints `Note: Schema commands are experimental and may change.` on stderr.

```bash
codespec schema which spec-driven          # where a schema resolves from
codespec schema fork spec-driven my-flow   # copy a schema into the project
codespec schema init my-schema             # create a schema from scratch
```

| Subcommand | What it does |
|---|---|
| `which` | Show where a schema resolves from. |
| `validate` | Check a schema's structure and templates. |
| `fork` | Copy an existing schema into the project for customization. |
| `init` | Create a new project-local schema. |

Schemas resolve from three locations. The first match wins:

| Source | Location |
|---|---|
| `project` | `codespec/schemas/` in the current project. |
| `user` | `~/.local/share/codespec/schemas/` (`XDG_DATA_HOME` and Windows `%LOCALAPPDATA%` respected). |
| `package` | The schemas shipped with the CLI. `spec-driven` lives here. |

### codespec schema which

Shows which copy of a schema the CLI will use.

```bash
codespec schema which spec-driven
codespec schema which --all        # every schema, grouped by source
```

**Arguments**

| Argument | What it is |
|---|---|
| `name` | The schema to look up. Required unless `--all` is set. Without either, which exits 1. |

**Options**

| Flag | Effect |
|---|---|
| `--all` | List every schema with its resolution source. |
| `--json` | Print the resolution as JSON. |

**Output**

```
Schema: spec-driven
Source: package
Path: /usr/local/lib/node_modules/@fission-ai/codespec/schemas/spec-driven
```

When a higher-priority copy hides another, a `Shadows:` section lists the hidden copies. With `--json`:

```json
{
  "name": "my-flow",
  "source": "project",
  "path": "/Users/you/projects/my-app/codespec/schemas/my-flow",
  "shadows": []
}
```

An unknown name exits 1 and lists the available schemas.

### codespec schema validate

Checks a schema's structure and templates.

```bash
codespec schema validate spec-driven   # one schema, from any source
codespec schema validate               # every project-local schema
```

It verifies that `schema.yaml` exists and parses, that the structure matches the schema format, that every artifact's template file exists inside the schema's `templates/` directory, and that the dependency graph has no cycles or unknown references.

**Options**

| Flag | Effect |
|---|---|
| `--json` | Print a structured report instead of text. |
| `--verbose` | Print each validation step. |

**Output**

```
✓ Schema 'spec-driven' is valid
```

With no name, each project schema gets one line under a `Validation Results:` header. A failing schema lists its issues and the run exits 1:

```
✗ Schema 'my-schema' has errors:
  error: Template file 'tasks.md' not found for artifact 'tasks'
```

### codespec schema fork

Copies an existing schema into the project so you can customize it.

```bash
codespec schema fork spec-driven my-flow
```

**Arguments**

| Argument | What it is |
|---|---|
| `source` | The schema to copy, from any source location. |
| `name` | Name for the copy. Kebab-case (`my-workflow`). Default: `<source>-custom`. |

**Options**

| Flag | Effect |
|---|---|
| `--force` | Overwrite an existing destination schema. |
| `--json` | Print the result as JSON. |

**Output**

```
✔ Forked 'spec-driven' to 'my-flow'

Source: /usr/local/lib/node_modules/@fission-ai/codespec/schemas/spec-driven (package)
Destination: /Users/you/projects/my-app/codespec/schemas/my-flow
```

The fork lands in `codespec/schemas/`, and the `name:` field in its `schema.yaml` is rewritten to the new name:

```
codespec/schemas/my-flow/
├── schema.yaml
└── templates/
    ├── design.md
    ├── proposal.md
    ├── spec.md
    └── tasks.md
```

An existing destination is an error unless you pass `--force`. A fork that keeps the source's name shadows the original.

### codespec schema init

Creates a new project-local schema with starter templates.

```bash
codespec schema init my-schema --description "Lightweight flow" --artifacts proposal,tasks
```

With no `--description` and no `--artifacts` in an interactive terminal, init prompts for a description, an artifact checklist, and whether to make the schema the project default. Outside a terminal it uses the defaults below.

**Arguments**

| Argument | What it is |
|---|---|
| `name` | Name for the new schema. Kebab-case (`my-workflow`). |

**Options**

| Flag | Effect |
|---|---|
| `--description <text>` | Schema description. Default: `Custom workflow schema for <name>`. |
| `--artifacts <list>` | Comma-separated artifact IDs from `proposal`, `specs`, `design`, `tasks`. Default: all four. |
| `--default` | Writes `schema: <name>` to the existing `codespec/config.yaml` or `codespec/config.yml`. Creates `codespec/config.yaml` if neither exists. New changes use this schema. |
| `--no-default` | Skip the prompt about the default. |
| `--force` | Overwrite an existing schema with the same name. |
| `--json` | Print the result as JSON. |

Schema creation and the `--default` config update are one operation. If CodeSpec cannot validate or write the config, it leaves both the config and any existing schema unchanged.

**Output**

```
✔ Created schema 'my-schema'

Schema created at: /Users/you/projects/my-app/codespec/schemas/my-schema

Artifacts: proposal, tasks
```

The layout on disk:

```
codespec/schemas/my-schema/
├── schema.yaml
└── templates/
    ├── proposal.md
    └── tasks.md
```

`schema.yaml` wires the selected artifacts with their dependencies. When `tasks` is included it also gets an `apply` phase that tracks `tasks.md`. Use the schema with `codespec new --schema my-schema`.

## codespec store

Creates and manages stores: standalone CodeSpec repos registered on your machine.

```bash
codespec store setup team-context --path ~/codespec/team-context   # create and register
codespec store register ~/stores/design-system                     # register an existing checkout
codespec store list                                                # see what's registered
```

Registrations live in a per-machine registry: `~/.local/share/codespec/stores/registry.yaml`, or `$XDG_DATA_HOME/codespec/stores/registry.yaml` when `XDG_DATA_HOME` is set. Every subcommand takes `--json` to print a structured report instead of text. Running `codespec store` with a missing or unknown subcommand exits 1 and lists the subcommands.

| Subcommand | What it does |
|---|---|
| `setup [id]` | Create a store folder and register it. |
| `register [path]` | Register an existing store folder. |
| `unregister <id>` | Forget the registration. The folder stays on disk. |
| `remove <id>` | Forget the registration and delete the folder. |
| `list` (alias `ls`) | List registered stores. |
| `doctor [id]` | Check registration, metadata, and Git state for registered stores. |

### codespec store setup

Creates a store folder and registers it.

```bash
codespec store setup team-context --path ~/codespec/team-context
```

In an interactive terminal, setup prompts for a missing name and location and confirms before creating anything. Outside one, a missing name or `--path` exits 1 with the flag to pass. Rerunning setup for a registered store reports `Registry: already registered`.

**Arguments**

| Argument | What it is |
|---|---|
| `id` | The store name. It becomes the id you pass to `--store`. |

**Options**

| Flag | Effect |
|---|---|
| `--path <path>` | Folder where the store should live (`~` expands). |
| `--init-git` | Initialize a Git repository with an initial commit. Default. |
| `--no-init-git` | Skip every Git action: no init, no initial commit. |
| `--remote <url>` | Canonical clone source recorded in `store.yaml`. |

**Output**

```
Store ready: team-context
Location: /Users/you/stores/team-context
CodeSpec root: ready
Registry: registered

Next: run normal CodeSpec commands against this store, for example:
  codespec new change <change-id> --store team-context
Share this store by committing and pushing it like any Git repo.
```

`--json` reports what was created and where it was registered:

```json
{
  "store": {
    "id": "design-system",
    "root": "/Users/you/stores/design-system",
    "metadata_path": "/Users/you/stores/design-system/.codespec-store/store.yaml"
  },
  "registry": {
    "path": "/Users/you/.local/share/codespec/stores/registry.yaml",
    "registered": true,
    "already_registered": false
  },
  "git": {
    "is_repository": true,
    "initialized": true,
    "committed": true
  },
  "created_files": [
    "codespec/",
    "codespec/specs/",
    "codespec/changes/",
    "codespec/changes/archive/",
    "codespec/config.yaml",
    "codespec/specs/.gitkeep",
    "codespec/changes/archive/.gitkeep",
    ".codespec-store/store.yaml"
  ],
  "status": []
}
```

### codespec store register

Registers an existing store folder, for example a teammate's store you cloned.

```bash
codespec store register ~/stores/design-system
```

The folder must contain a healthy `codespec/` root. With `.codespec-store/store.yaml` present, register reuses the recorded id. Without it, register asks before creating that metadata. Outside an interactive terminal, pass `--yes` instead. A machine can register one checkout per store id. A second path under the same id, or the same path under a second id, exits 1.

**Arguments**

| Argument | What it is |
|---|---|
| `path` | The store folder to register (`~` expands). Required. |

**Options**

| Flag | Effect |
|---|---|
| `--id <id>` | Store id. Defaults to metadata or folder name. |
| `--yes` | Confirm creating store identity metadata for a healthy CodeSpec root. |

**Output**

```
Store registered: design-system
Location: /Users/you/stores/design-system
CodeSpec root: ready
Registry: registered
```

`--json` prints the same document shape as `store setup --json`.

### codespec store unregister

Forgets the registration. The folder stays on disk.

```bash
codespec store unregister design-system
```

```
Unregistered store: design-system
Files kept at: /Users/you/stores/design-system
```

### codespec store remove

Forgets the registration and deletes the folder.

```bash
codespec store remove design-system --yes
```

Interactively, remove asks before deleting. With `--json` or outside an interactive terminal, deletion requires `--yes`:

```
Error: Pass --yes to delete store files non-interactively.
Fix: codespec store remove design-system --yes
```

**Options**

| Flag | Effect |
|---|---|
| `--yes` | Confirm local store folder deletion. |

**Output**

```
Removed store: design-system
Deleted: /Users/you/stores/design-system
```

### codespec store list

Lists registered stores. `ls` is an alias.

```bash
codespec store list
```

```
CodeSpec stores (2)

ID              Location
design-system   /Users/you/stores/design-system
team-context    /Users/you/stores/team-context
```

With nothing registered, list prints `No stores registered.` and the setup and register commands to run next.

### codespec store doctor

Checks registration, metadata, and Git state for registered stores.

```bash
codespec store doctor                # every registered store
codespec store doctor team-context  # one store
```

**Output**

```
Store doctor

team-context
  Location: /Users/you/stores/team-context
  CodeSpec root: ok
  Metadata: ok
  Git: repository detected (commits: yes, uncommitted changes: no, remote: none)
  Issues: none
```

**Exit codes**

- `0`: the report printed, even when a store reports issues.
- `1`: the report couldn't run (for example an unknown store id).

## codespec doctor

Reports relationship health for the resolved CodeSpec root.

```bash
codespec doctor                       # nearest codespec/ root above your cwd
codespec doctor --store team-context  # a registered store as the root
```

Doctor is read-only: it never clones, syncs, or repairs. It reports whether the root is healthy and whether each reference declared in `codespec/config.yaml` resolves on this machine. With no root above your cwd and no `--store`, it exits 1 and names your registered stores.

**Options**

| Flag | Effect |
|---|---|
| `--store <id>` | Use a registered store as the CodeSpec root instead of the current project. |
| `--json` | Print the health report as JSON. |

**Output**

```
Doctor

Root
  Location: /Users/you/projects/my-app
  CodeSpec root: ok

References
  - team-context: ok (/Users/you/stores/team-context)
```

With `--store`, the root is the store and the report adds a store line:

```
Using CodeSpec root: team-context (/Users/you/stores/team-context)
Doctor

Root
  Location: /Users/you/stores/team-context
  CodeSpec root: ok
  Store: team-context (metadata ok)

References
  (none declared)
```

```json
{
  "root": {
    "path": "/Users/you/projects/my-app",
    "source": "nearest",
    "healthy": true,
    "status": []
  },
  "store": null,
  "references": [
    {
      "store_id": "team-context",
      "root": "/Users/you/stores/team-context",
      "status": []
    }
  ],
  "status": []
}
```

**Exit codes**

- `0`: the report printed, including when it lists issues.
- `1`: no root resolved (no `codespec/` above your cwd and no `--store`), or an unknown `--store` id.

## codespec context

Prints the working context for the resolved CodeSpec root: the root plus every referenced store declared in `codespec/config.yaml`, each with a fetch command.

```bash
codespec context                       # nearest codespec/ root above your cwd
codespec context --store team-context  # a registered store as the root
codespec context --json                # agent brief
```

References that don't resolve on this machine land in a `Not available on this machine` section, each with a fix.

**Options**

| Flag | Effect |
|---|---|
| `--store <id>` | Use a registered store as the CodeSpec root instead of the current project. |
| `--json` | Print the agent brief as JSON. |
| `--code-workspace <path>` | Also write a VS Code workspace file for the set. |
| `--force` | Overwrite an existing `--code-workspace` file. |

**Output**

```
Working context for my-app (/Users/you/projects/my-app)

CodeSpec root
  my-app  /Users/you/projects/my-app

Referenced stores
  team-context  /Users/you/stores/team-context
    Fetch: codespec show <spec-id> --type spec --store team-context
```

With `--store`, the store is the whole set:

```
Using CodeSpec root: team-context (/Users/you/stores/team-context)
Working context for team-context (/Users/you/stores/team-context)

CodeSpec root
  team-context  /Users/you/stores/team-context

No references declared; the working set is this root alone.
```

```json
{
  "root": {
    "path": "/Users/you/projects/my-app",
    "source": "nearest",
    "role": "codespec_root"
  },
  "members": [
    {
      "role": "referenced_store",
      "id": "team-context",
      "path": "/Users/you/stores/team-context",
      "fetch": "codespec show <spec-id> --type spec --store team-context",
      "status": []
    }
  ],
  "status": []
}
```

**Writing a workspace file**

`--code-workspace` writes a VS Code workspace file at the path you give: one folder for the root, one `ref:<id>` folder per available referenced store. Unavailable references are skipped and named in the summary line, `Wrote /Users/you/projects/my-app/codespec.code-workspace (2 folders)`. The summary prints on stderr, so `--json` stdout stays one JSON document. An existing file exits 1 unless you pass `--force`.

```json
{
  "folders": [
    {
      "name": "my-app",
      "path": "/Users/you/projects/my-app"
    },
    {
      "name": "ref:team-context",
      "path": "/Users/you/stores/team-context"
    }
  ]
}
```

**Exit codes**

- `0`: the report printed.
- `1`: no root resolved (no `codespec/` above your cwd and no `--store`), or the `--code-workspace` write was refused.

## codespec workset

Composes, keeps, and opens personal working views. A workset is a saved, named list of folders you work across together.

```bash
codespec workset create checkout --member ~/projects/checkout-api --member web=~/projects/checkout-web
codespec workset list
codespec workset remove checkout --yes
```

| Subcommand | What it does |
|---|---|
| `create [name]` | Compose and save a named working view of folders you choose. |
| `list`, `ls` | Show saved worksets with their members. |
| `open <name>` | Open a saved workset in your tool (editor window or agent session). |
| `remove <name>` | Delete a saved workset (member folders are never touched). |

A workset is purely local:

- Its state lives in one folder: `~/.local/share/codespec/worksets/` (`$XDG_DATA_HOME/codespec/worksets/` when set; `%LOCALAPPDATA%\codespec\worksets\` on Windows).
- Nothing is written into the member folders, and nothing is committed or shared.
- Deleting that one folder removes every trace.

### codespec workset create

Saves a named working view of folders.

```bash
codespec workset create checkout \
  --member ~/projects/checkout-api \
  --member web=~/projects/checkout-web
```

In an interactive terminal, create prompts for whatever the flags didn't provide: the name, folders one at a time, a tool, then an offer to open the workset now. Outside one, a missing name or member is an error. A name that's already saved is always an error. Remove it first.

**Arguments**

| Argument | What it is |
|---|---|
| `name` | The workset name. Kebab-case: lowercase letters, numbers, single hyphens. Required outside an interactive terminal. |

**Options**

| Flag | Effect |
|---|---|
| `--member <member>` | Member folder as `<path>` or `<name>=<path>`, repeatable. The first is the primary. The path must be an existing folder, and the label defaults to the folder's own name. |
| `--tool <id>` | Preferred tool to open this workset with. Built-in ids: `code` (VS Code), `cursor` (Cursor). `claude` and `codex` are temporarily disabled. |
| `--json` | Print the saved workset as JSON. |

**Output**

```
Saved workset 'checkout' (2 members) to your machine.
Open it any time with: codespec workset open checkout
```

### codespec workset list

Shows saved worksets with their members, sorted by name.

```bash
codespec workset list   # alias: ls
```

**Options**

| Flag | Effect |
|---|---|
| `--json` | Print the worksets as JSON. |

**Output**

One block per workset: the name, its tool when it has one, then one `name  path` row per member. With nothing saved, list prints `No worksets saved. Create one with: codespec workset create`.

```
checkout
  checkout-api  /Users/you/projects/checkout-api
  web           /Users/you/projects/checkout-web
checkout-tool  (opens in VS Code)
  checkout-api  /Users/you/projects/checkout-api
```

With `--json`:

```json
{
  "worksets": [
    {
      "name": "checkout",
      "members": [
        {
          "name": "checkout-api",
          "path": "/Users/you/projects/checkout-api"
        },
        {
          "name": "web",
          "path": "/Users/you/projects/checkout-web"
        }
      ]
    }
  ],
  "status": []
}
```

### codespec workset open

Opens a saved workset in your tool. Editor tools (`code`, `cursor`) get a generated `.code-workspace` file. A window opens and the command returns. CLI agent tools (`claude`, `codex`) would take over this terminal with every member attached. They are temporarily disabled while that flow is reworked, so worksets open in an IDE for now.

```bash
codespec workset open checkout                # saved tool, or a prompt
codespec workset open checkout --tool cursor  # this tool just this once
```

**Arguments**

| Argument | What it is |
|---|---|
| `name` | The workset to open. |

**Options**

| Flag | Effect |
|---|---|
| `--tool <id>` | Open with this tool just this once. |

With no `--tool` and no saved tool, open prompts you to pick an installed tool. Outside an interactive terminal it exits 1 instead.

- A member folder that no longer exists is skipped with a warning. When the primary is missing, the next surviving member becomes the primary for this open. When no member folder exists, the open fails.
- `--json` is rejected: open hands the terminal to the tool and has no JSON mode.
- When the launch fails, the error ends with the manual route: the workspace file's path and the member list.

**Exit codes**

- Mirrors the tool: the command exits with the tool's own exit code, and a signal becomes `128+n` (`130` after Ctrl-C).
- `1`: unknown workset, no member folder available, or no usable tool.

### codespec workset remove

Deletes a saved workset and its generated `.code-workspace` file. Member folders are never touched.

```bash
codespec workset remove checkout --yes
```

In an interactive terminal, remove shows the workset and asks you to confirm. With `--json`, or outside a terminal, it requires `--yes` and exits 1 without it.

**Options**

| Flag | Effect |
|---|---|
| `--yes` | Confirm removal non-interactively. |
| `--json` | Print the removal as JSON. |

**Output**

```
Removed workset 'checkout'. Member folders were not touched.
```

## codespec feedback

Submits feedback about CodeSpec.

```bash
codespec feedback "Validate output is hard to scan"
codespec feedback "Archive fails on Windows" --body "Steps: init, propose, archive. Error: EPERM."
```

The CLI files your message as a GitHub issue on the `Fission-AI/CodeSpec` repo through your `gh` CLI. The title becomes `Feedback: <message>`. The body holds your `--body` text plus a footer with CLI version, platform, and timestamp. The issue gets the `feedback` label. If the repo doesn't define that label, the CLI retries without it and says so.

**Arguments**

| Argument | What it is |
|---|---|
| `message` | One-line summary. Becomes the issue title. Required. |

**Options**

| Flag | Effect |
|---|---|
| `--body <text>` | Longer description added to the issue body. |

**Output**

On success:

```
✓ Feedback submitted successfully!
Issue URL: https://github.com/Fission-AI/CodeSpec/issues/1234
```

Without `gh` installed, or with `gh` not logged in, nothing is submitted. The CLI prints your formatted feedback between `--- FORMATTED FEEDBACK ---` markers, then a prefilled new-issue URL to open in the browser. The not-logged-in path adds `To auto-submit in the future: gh auth login`.

**Exit codes**

- `0`: issue created, or the manual-submission fallback ran (no `gh`, or `gh` not logged in).
- `1`: no message given.
- `gh`'s own code: `gh` failed after authentication (network, rate limit, issues disabled). The CLI reprints your feedback and the manual-submission URL first.

## codespec completion

Installs or generates shell completions.

```bash
codespec completion install        # detect your shell, install, wire up config
codespec completion generate zsh   # print the script to stdout
```

Supported shells: `zsh`, `bash`, `fish`, `powershell`. Every subcommand takes an optional shell argument. Omit it and the CLI detects your shell from the environment.

| Subcommand | What it does |
|---|---|
| `generate [shell]` | Print the completion script to stdout. |
| `install [shell]` | Write the script and configure your shell startup file. |
| `uninstall [shell]` | Remove the script and the config block. |

### codespec completion generate

Prints the script and writes nothing.

```
#compdef codespec

# Zsh completion script for CodeSpec CLI
# Auto-generated - do not edit manually

_codespec() {
  local context state line
  typeset -A opt_args
...
```

### codespec completion install

Writes the script and edits your shell config. Config edits sit between `# CodeSpec:START` and `# CodeSpec:END` markers. An existing script is backed up first (`.backup-<timestamp>` copy).

| Shell | Script location | Config edited |
|---|---|---|
| zsh | `~/.zsh/completions/_codespec` | `~/.zshrc` |
| bash | `~/.local/share/bash-completion/completions/codespec` | `~/.bashrc` |
| fish | `~/.config/fish/completions/codespec.fish` | None: fish auto-loads it. |
| powershell | `CodeSpecCompletion.ps1` beside your profile | `$PROFILE` |

With Oh My Zsh installed, the script lands in `$ZSH_CUSTOM/completions/_codespec` instead (default `~/.oh-my-zsh/custom/completions/_codespec`).

**Options**

| Flag | Effect |
|---|---|
| `--verbose` | Also print the installed path, any backup path, and which config file was edited. |

**Output**

```
✓ Completion script installed and .zshrc configured successfully

Restart your shell or run: exec zsh
```

### codespec completion uninstall

Removes the script and the marked config block. It asks before touching your config (default: No).

**Options**

| Flag | Effect |
|---|---|
| `-y, --yes` | Skip confirmation prompts. |

**Output**

```
✓ Completion script removed from /Users/you/.zsh/completions/_codespec. Removed CodeSpec configuration from ~/.zshrc
```

**Exit codes**

- `0`: script generated, installed, or removed. A cancelled uninstall also exits 0.
- `1`: shell not supported or not detected, or an install or uninstall step failed.

## codespec change

Deprecated noun form of `show`, `list`, and `validate`. Every run warns and points to the verb-first commands, then runs anyway:

```
Warning: The "codespec change ..." commands are deprecated. Prefer verb-first commands (e.g., "codespec list", "codespec validate --changes").
Warning: "codespec change list" is deprecated. Use "codespec list".
add-rate-limit
```

| Deprecated | Use instead |
|---|---|
| `codespec change show <name>` | `codespec show <name>` |
| `codespec change list` | `codespec list` |
| `codespec change validate <name>` | `codespec validate <name>` (all changes: `codespec validate --changes`) |

The verb-first sections document the flags.

## codespec spec

Deprecated noun form of `show`, `list`, and `validate`. Every run warns and points to the verb-first commands, then runs anyway:

```
Warning: The "codespec spec ..." commands are deprecated. Prefer verb-first commands (e.g., "codespec show", "codespec validate --specs").
api
```

| Deprecated | Use instead |
|---|---|
| `codespec spec show <id>` | `codespec show <id>` |
| `codespec spec list` | `codespec list --specs` |
| `codespec spec validate <id>` | `codespec validate <id>` (all specs: `codespec validate --specs`) |

The verb-first sections document the flags.
