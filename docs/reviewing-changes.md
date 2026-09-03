# Reviewing a Change

Review the Change before implementation and again before archive. The public
development entry is `/opsx:workflow`; Superpowers performs the engineering
review and verification, while OpenSpec Core validates requirements,
traceability, canonical specs, and baseline freshness.

```text
/opsx:workflow ──► review artifacts ──► build + verify ──► /opsx:archive
                         │                    │
                         └── /opsx:rebase if baseline or conflict is stale
```

## Before implementation

Open the active Change in this order:

```text
openspec/changes/CHG-YYYYMMDD-NNN/
├── proposal.md       intent, scope, and non-goals
├── spec.md           requirement deltas and scenarios
├── design.md         technical approach when needed
├── tasks.md          implementation checklist
└── verification.md   fresh evidence collected before archive
```

Check that:

- the intent matches the requested outcome;
- the scope has no unrelated work;
- every requirement is observable and has useful scenarios;
- design decisions are consistent with the repository;
- tasks map to requirements and are independently reviewable.

Use Superpowers brainstorming, writing-plans, and requesting-code-review when
the problem or design needs deeper engineering discussion. These methods do
not create competing OpenSpec entry points.

## After implementation

Superpowers verification-before-completion checks tests, behavior, and the
implementation against the approved plan. OpenSpec Core then checks:

| Check | Question |
| --- | --- |
| Completeness | Are the tasks and requirement scenarios covered? |
| Traceability | Can each implementation and test be traced to a requirement? |
| Canonical validity | Will the delta produce a valid Current Specification? |
| Freshness | Was the Change built from the current baseline? |

If the baseline is stale or multiple Changes conflict, stop and invoke
`/opsx:rebase`. Do not archive a stale Change.

## Archive review

Run `/opsx:archive` only after verification evidence is fresh and the Change is
ready to become part of the Current Specification. Archive is the only public
entry allowed to write `openspec/archive/specs/`; its transaction must validate,
detect conflicts, apply the delta, and preserve immutable Change history.

## Quick checklist

- [ ] Intent and non-goals are clear.
- [ ] Requirements and scenarios are testable.
- [ ] Tasks map to requirements.
- [ ] Superpowers verification has fresh evidence.
- [ ] Core reports a current baseline and valid traceability.
- [ ] Archive is the next and only Current Specification write.

## Related

- [Commands](commands.md): public entry responsibilities
- [Workflows](workflows.md): lifecycle and recovery paths
- [Editing a Change](editing-changes.md): revise before archive
