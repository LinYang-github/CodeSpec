# CodeSpec workflow

OpenSpec exposes three AI entries. Use them in your assistant's chat.

| Entry | When to use it |
|---|---|
| `openspec-workflow` | Every normal development request |
| `openspec-rebase-change` | Core reports STALE, baseline drift, or a multi-Change conflict |
| `openspec-archive-change` | The Change is implemented and verified |

## Development

Start every Change with `workflow`.

```text
/opsx:workflow add-dark-mode
```

Core resolves the Change, allocates IDs, captures the baseline, detects stale state, and advances the CodeSpec lifecycle. Superpowers handles brainstorming, plan writing, TDD, debugging, verification, review, and branch finishing.

The workflow entry may ask for a Change name, module scope, or a decision when the request is ambiguous. It does not write Current Specification directly.

## Rebase

Use `rebase` only after Core reports a stale or conflicting Change.

```text
/opsx:rebase
```

Core reads the baseline and candidate Changes, presents the conflict, and performs the rebase transaction. The entry stops when an automatic decision would be unsafe. A successful rebase returns to `workflow`.

## Archive

Use `archive` after all implementation tasks and verification pass.

```text
/opsx:archive
```

Core validates requirement deltas, traceability, canonical specs, and archive conflicts. It then prepares and commits the archive transaction. Current Specification is writable only inside this transaction.

## Internal capabilities

These names describe Core operations. They are not AI Skill entries:

- `createChange()`, `resolveChange()`, `allocateChangeId()`
- `resolveModules()`, `allocateRequirementId()`
- `captureBaseline()`, `detectStale()`
- `validateRequirementDelta()`, `validateTraceability()`, `validateCanonicalSpec()`
- `syncSpecs()`, `applyDelta()`
- `detectArchiveConflict()`, `archiveTransaction()`
- `assessSddLevel()`, `resolveSddProfile()`, `escalateSddLevel()`

Use [AI entries](commands.md) for the public reference and [CLI Reference](cli.md) for terminal commands.
