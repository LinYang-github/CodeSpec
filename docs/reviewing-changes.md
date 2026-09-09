# Reviewing a Change

Review the Change before implementation and again before archive. The public
development entry is `/codespec:workflow`; Superpowers performs the engineering
review and verification, while CodeSpec Core validates requirements,
traceability, canonical specs, and baseline freshness.

```text
/codespec:workflow ──► review artifacts ──► build + verify ──► /codespec:archive
                         │                    │
                         └── /codespec:rebase if baseline or conflict is stale
```

## Before implementation

Open the active Change in this order:

```text
codespec/changes/CHG-YYYYMMDD-NNN/
├── metadata.yaml     status, baseline, approvals, and gates
├── design.md         goals, scope, and technical decisions
├── spec.md           readable requirements, scenarios, and test cases
├── tasks.yaml        implementation plan and typed module deltas
└── verification.yaml fresh per-test execution evidence
```

Check that:

- the design and scope match the requested outcome;
- the scope has no unrelated work;
- every requirement is observable and has useful scenarios;
- design decisions are consistent with the repository;
- tasks map to requirements, scenarios, test cases, planned files, and verification plans.

Use Superpowers brainstorming, writing-plans, and requesting-code-review when
the problem or design needs deeper engineering discussion. These methods do
not create competing CodeSpec entry points.

## After implementation

Superpowers verification-before-completion checks tests, behavior, and the
implementation against the approved plan. CodeSpec Core then checks:

| Check | Question |
| --- | --- |
| Completeness | Are the tasks and requirement scenarios covered? |
| Traceability | Can each implementation and test be traced to a requirement? |
| Canonical validity | Will the delta produce a valid Current Specification? |
| Freshness | Was the Change built from the current baseline? |

If the baseline is stale or multiple Changes conflict, stop and invoke
`/codespec:rebase`. Do not archive a stale Change.

## Archive review

Run `/codespec:archive` only after verification evidence is fresh and the Change is
ready to become part of the Current Specification. Archive is the only public
entry allowed to write `codespec/specs/`; its transaction must validate, detect conflicts, apply the typed delta, update `business.yaml`/`configuration.yaml`, and remove the active Change without creating a new history copy.

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
