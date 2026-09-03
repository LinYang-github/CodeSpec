# AI entries

OpenSpec exposes three AI entries. Type the tool-specific spelling in your AI assistant's chat, not in the terminal.

| Entry | Use it for | Core owner |
|---|---|---|
| `openspec-workflow` | Start or continue one Change | OpenSpec Core and Superpowers |
| `openspec-rebase-change` | Recover STALE, baseline, or multi-Change conflicts | OpenSpec Core |
| `openspec-archive-change` | Validate and archive a completed Change | OpenSpec Core |

OpenSpec generates these entries from the templates in `src/core/templates/`. The root `skills/` directory is generated output and contains the same three Skill directories.

## Invoke an entry

Use the spelling that `openspec init` prints for your selected tool.

| Tool surface | `workflow` | `rebase` | `archive` |
|---|---|---|---|
| Namespaced command file | `/opsx:workflow` | `/opsx:rebase` | `/opsx:archive` |
| Flat command file | `/opsx-workflow` | `/opsx-rebase` | `/opsx-archive` |
| Amazon Q prompt | `@opsx-workflow` | `@opsx-rebase` | `@opsx-archive` |
| Default Skill invocation | `/openspec-workflow` | `/openspec-rebase-change` | `/openspec-archive-change` |
| Kimi Code | `/skill:openspec-workflow` | `/skill:openspec-rebase-change` | `/skill:openspec-archive-change` |
| Codex | `$openspec-workflow` | `$openspec-rebase-change` | `$openspec-archive-change` |

See [Supported Tools](supported-tools.md#how-to-invoke) for the file path used by each tool.

## `workflow`

Use `workflow` for every normal development request.

```text
/opsx:workflow add-rate-limit
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
/opsx:rebase
```

The entry reads the target Change, current baseline, and conflicting Changes before changing anything. It stops when the target or conflict decision is ambiguous.

Core performs the rebase transaction. The Skill does not implement `captureBaseline()`, `detectStale()`, `resolveChange()`, revision changes, or state resets. After a successful rebase, the entry routes back to `workflow`.

## `archive`

Use `archive` after the Change is implemented and verification has passed.

```text
/opsx:archive
```

Core checks the archive preconditions and runs the transaction:

1. `preflightArchive()` checks completion, verification, traceability, canonical spec validity, and conflicts.
2. `prepareArchive()` calculates the included delta and prepares the recoverable write set.
3. `commitArchive()` applies the delta to Current Specification and moves the Change into the archive.
4. `archiveTransaction()` preserves the transaction boundary and recovery behavior.

`archive` is the only public entry that can commit Current Specification. `syncSpecs()`, `applyDelta()`, `detectArchiveConflict()`, and `archiveTransaction()` are Core capabilities, not separate Skills.

## What belongs to Core and Superpowers

OpenSpec Core owns domain state and governance:

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
