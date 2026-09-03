# Examples and Recipes

These examples use the three public OpenSpec entries. Engineering methods such
as brainstorming, writing plans, TDD, debugging, and verification are supplied
by Superpowers inside `workflow`; they are not separate OpenSpec entries.

## A normal change

```text
You: /opsx:workflow add-logout-button

AI:  Core resolved CHG-20260902-001.
     Superpowers drafted the plan and requirements.
     Review the Change, then implementation can continue.

You: /opsx:workflow

AI:  TDD and implementation are complete.
     Fresh verification evidence is recorded.

You: /opsx:archive

AI:  Core validated the delta and updated Current Specification.
     The Change is archived.
```

## An unclear request

```text
You: /opsx:workflow
     Checkout sometimes creates duplicate orders. Investigate the code,
     compare approaches, and propose the smallest safe fix.
```

Superpowers brainstorming investigates the repository and clarifies the
approach. Core then creates the canonical Change and assigns stable
Requirement IDs. The same `workflow` entry continues through planning,
implementation, and verification.

## A stale Change

```text
You: /opsx:workflow

AI:  The baseline is STALE because Current Specification changed.
     Archive is blocked until the Change is rebased.

You: /opsx:rebase

AI:  Core captured the new baseline, recalculated the delta, and reported
     the requirement conflict for review.

You: /opsx:workflow
     Continue after reviewing the rebased Change.
```

`rebase` is the only public recovery entry. It does not write Current
Specification; it prepares the Change for continued development.

## Multiple active Changes

Multiple Changes may exist at once. Core resolves each Change and detects
overlapping requirement or baseline conflicts. Keep implementing independent
Changes through `workflow`; when one becomes stale, use `rebase`. Archive each
Change through the single `archive` transaction in a deliberate order.

## A manual code edit

```text
You: I changed the timeout directly in the code. Please reconcile the active
     Change and update the requirement delta and verification evidence.

You: /opsx:workflow
```

If the code is correct, the artifacts must describe the shipped behavior. If
the specification is correct, implementation must be brought back into
agreement. Never edit `openspec/archive/specs/` directly.

## CLI inspection

The AI entries operate in chat. Use the CLI for inspection and deterministic
validation:

```bash
openspec list
openspec status --change CHG-20260902-001
openspec validate CHG-20260902-001
openspec view
```

## Related

- [Commands](commands.md)
- [Workflows](workflows.md)
- [Reviewing a Change](reviewing-changes.md)
- [Troubleshooting](troubleshooting.md)
