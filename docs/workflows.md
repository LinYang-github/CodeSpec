# Workflows

The public lifecycle has one development entry, one recovery entry, and one archive entry.

```text
workflow ──► implementation and verification ──► archive
   │
   └── STALE or conflict ──► rebase ──► workflow
```

## Start and continue a Change

Use `workflow` for every development request:

```text
/opsx:workflow add-rate-limit
```

The entry resolves the Change and its modules. Core allocates requirement IDs, captures the baseline, checks STALE state, and advances domain state. Superpowers handles brainstorming, planning, TDD, debugging, verification, and review.

The workflow can resume an existing Change. If more than one Change matches, it stops and asks you to choose one.

## Recover a stale Change

Use `rebase` only when Core reports STALE, a baseline conflict, or an unsafe multi-Change state:

```text
/opsx:rebase
```

Core presents the target Change, baseline, and conflict set before the transaction. An ambiguous conflict stops for a user decision. A successful rebase returns to `workflow`.

## Archive a completed Change

Use `archive` after implementation and verification pass:

```text
/opsx:archive
```

Core performs the archive gate and transaction:

1. Validate tasks, verification, requirement deltas, traceability, canonical specs, and conflicts.
2. Prepare the included delta and recoverable write set.
3. Apply the delta to Current Specification.
4. Move the completed Change to the archive.

Only `archive` can commit Current Specification. Sync, delta application, conflict detection, and transaction handling remain internal Core capabilities.

## Engineering methods

The entries route method decisions to Superpowers:

- `superpowers:brainstorming` clarifies intent and compares approaches.
- `superpowers:writing-plans` turns an approved design into an execution plan.
- `superpowers:test-driven-development` drives implementation with tests.
- `superpowers:systematic-debugging` investigates failures before fixes.
- `superpowers:verification-before-completion` checks evidence before completion.
- Review and branch-finishing skills handle collaboration and integration.

Use [AI entries](commands.md) for invocation details and [CodeSpec workflow](opsx.md) for the internal capability boundary.
