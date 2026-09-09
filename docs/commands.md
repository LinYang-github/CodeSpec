# AI entries

CodeSpec exposes three AI entries. Type the tool-specific spelling in your AI assistant's chat, not in the terminal.

| Entry | Use it for | Core owner |
|---|---|---|
| `codespec-workflow` | Start or continue one Change | CodeSpec Core and Superpowers |
| `codespec-rebase-change` | Recover STALE, baseline, or multi-Change conflicts | CodeSpec Core |
| `codespec-archive-change` | Validate and archive a completed Change | CodeSpec Core |

CodeSpec generates these entries from the templates in `src/core/templates/`. The root `skills/` directory is generated output and contains the same three Skill directories.

## Invoke an entry

Use the spelling that `codespec init` prints for your selected tool.

| Tool surface | `workflow` | `rebase` | `archive` |
|---|---|---|---|
| Namespaced command file | `/codespec:workflow` | `/codespec:rebase` | `/codespec:archive` |
| Flat command file | `/codespec-workflow` | `/codespec-rebase` | `/codespec-archive` |
| Amazon Q prompt | `@codespec-workflow` | `@codespec-rebase` | `@codespec-archive` |
| Default Skill invocation | `/codespec-workflow` | `/codespec-rebase-change` | `/codespec-archive-change` |
| Kimi Code | `/skill:codespec-workflow` | `/skill:codespec-rebase-change` | `/skill:codespec-archive-change` |
| Codex | `$codespec-workflow` | `$codespec-rebase-change` | `$codespec-archive-change` |

See [Supported Tools](supported-tools.md#how-to-invoke) for the file path used by each tool.

## `workflow`

Use `workflow` for every normal development request.

```text
/codespec:workflow add-rate-limit
```

The entry performs these steps through Core and Superpowers:

1. Resolve or create the Change.
2. Resolve modules and allocate requirement IDs.
3. Capture the baseline and check for STALE or conflicting Changes.
4. Delegate brainstorming and planning to `superpowers:brainstorming` and `superpowers:writing-plans`.
5. Delegate implementation to TDD and plan execution.
6. Delegate debugging, verification, and review to the matching Superpowers skills.
7. Route STALE or unsafe multi-Change state to `rebase`.
8. Route a completed and verified Change to `archive`.

`workflow` does not write Current Specification directly. It consumes Core results and preserves the archive transaction as the only Current Specification write boundary.

## `rebase`

Use `rebase` only when Core reports STALE, a baseline conflict, or an unsafe multi-Change state.

```text
/codespec:rebase
```

The entry reads the target Change, current baseline, and conflicting Changes before changing anything. It stops when the target or conflict decision is ambiguous.

Core performs the rebase transaction. The Skill does not implement `captureBaseline()`, `detectStale()`, `resolveChange()`, revision changes, or state resets. After a successful rebase, the entry routes back to `workflow`.

## `archive`

Use `archive` after the Change is implemented and verification has passed.

```text
/codespec:archive
```

Core checks the archive preconditions and runs the transaction:

1. `preflightArchive()` checks completion, verification, traceability, canonical spec validity, and conflicts.
2. `prepareArchive()` calculates the included delta and prepares the recoverable write set.
3. `commitArchive()` applies the delta or complete projection to Current Specification through the transaction boundary.
4. Canonical `code-spec` archive removes the active Change after commit; it does not create `test-cases.md`, a static graph file, or a second Change history copy. Generic `spec-driven` keeps its own archive behavior.

`archive` is the only public entry that can commit Current Specification. `syncSpecs()`, `applyDelta()`, `detectArchiveConflict()`, and `archiveTransaction()` are Core capabilities, not separate Skills.

## What belongs to Core and Superpowers

CodeSpec Core owns domain state and governance:

- Change creation, resolution, and ID allocation
- module and requirement-ID resolution
- baseline capture and STALE detection
- requirement delta, traceability, and canonical-spec validation
- spec synchronization, delta application, conflict detection, and archive transactions
- SDD level and profile decisions

Superpowers owns engineering method:

- brainstorming
- plan writing and execution
- test-driven development
- systematic debugging
- verification before completion
- code review and development-branch finishing

The public entries route to these capabilities. They do not expose the internal function names as additional AI Skills.

## CLI compatibility

The terminal CLI keeps its machine-oriented commands for scripts and migration. These commands are not additional AI entries. Use [CLI Reference](cli.md) for their syntax and [Migration Guide](migration-guide.md) for older generated Skill and command files.
