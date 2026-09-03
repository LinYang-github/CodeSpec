# Explore and Clarify a Change

OpenSpec has one development entry: `/opsx:workflow`. When the intent is
unclear, the workflow delegates exploration to Superpowers brainstorming
before it creates or updates a Change.

Use this path when you know the problem but not the solution, need to compare
approaches, or are unfamiliar with the affected code. Superpowers owns the
engineering conversation; OpenSpec Core owns Change identity, requirements,
baseline, traceability, and stale detection.

```text
idea or problem
      │
      ▼
/opsx:workflow
      │
      ├─ Superpowers brainstorming / plan / TDD / debug / verify
      ├─ OpenSpec Core Change + requirements + baseline governance
      └─ /opsx:rebase when the baseline is stale or changes conflict
```

## Start

```text
You: /opsx:workflow

You: The checkout sometimes creates duplicate orders. Please investigate,
     compare safe approaches, and turn the selected approach into a Change.
```

The workflow should inspect the repository, clarify scope and non-goals, then
create a canonical Change under `openspec/changes/CHG-YYYYMMDD-NNN/`. The
resulting artifacts are reviewed before implementation begins.

## Keep exploration useful

- Describe the problem and constraints before prescribing a library or design.
- Ask for tradeoffs and evidence from the current codebase.
- Keep the Change focused; split unrelated work into another Change.
- If the requested behavior changes after implementation starts, revise the
  current artifacts and let Core recalculate the baseline and requirement delta.

Do not use exploration as a second public OpenSpec entry. It is an internal
Superpowers method reached through `workflow`.

## Related

- [Commands](commands.md): the three public entries
- [Workflows](workflows.md): the complete lifecycle
- [Reviewing a Change](reviewing-changes.md): review before implementation
- [Editing a Change](editing-changes.md): revise an active Change
