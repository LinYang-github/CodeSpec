# Editing and Iterating on a Change

Edit the owning artifact, then ask Core to reconcile the revision. For initial setup, see [Getting Started](getting-started.md).

## Revise an active Change

After editing an approved artifact, run this in your terminal:

```bash
codespec revise --change CHG-20260915-001 --reason "Scope changed after review"
codespec status --change CHG-20260915-001 --json
```

Core returns the earliest invalidated stage:

| Edited authority | Route | Approvals invalidated |
|---|---|---|
| `analysis.yaml` intent | ANALYZE | analyze, design, plan |
| `design.md` or behavioral `spec.md` | DESIGN | design, plan |
| Planned `tasks.yaml` definitions | PLAN | plan |
| Task execution status only | Current stage | None |

**Semantic revision:** increments the Change revision and clears stale verification. Remaining artifacts are comparison material until their revision and content pass the gate.

**Approval:** use the [stage approval commands](cli.md#canonical-lifecycle-commands) after reviewing the revised result. Do not edit `metadata.yaml.approvals` to preserve an obsolete receipt.

## Rebase against Current

Run rebase when Core reports `baseline.stale`:

```bash
codespec rebase --change CHG-20260915-001
codespec status --change CHG-20260915-001 --json
```

**DESIGN route:** Current changed, but the approved intent still holds. Core refreshes only affected Requirement `Previous` snapshots and preserves `New`, `Reason` and action.

**ANALYZE route:** Current invalidates an assumption, module ownership, Requirement disposition or AC. Review the returned conflicts in `analysis.yaml` before requesting approval again.

Both routes increment revision and invalidate downstream verification. Rebase reads Current as the only baseline; it does not import archived Change text.

## Migrate an active five-artifact Change

Run the exact command returned by status:

```bash
codespec migrate --change CHG-20260915-001
codespec instructions analyze --change CHG-20260915-001 --json
```

**Created artifact:** `analysis.yaml`, containing deterministic facts from metadata and an OPEN `Q-MIGRATION-001` question.

**Required edit:** confirm goals, non-goals, scope, assumptions and ACs. Migration does not infer them from design, code or history.

**State:** revision increases and the Change returns to ANALYZE. Reconcile `spec.md` with the [rich delta contract](writing-specs.md#canonical-requirement-delta), then obtain new approvals.

Archived Changes and legacy proposal-bearing Changes are not rewritten by this command.

## Code and spec disagree

- If the user intent changed, edit the owning artifact and run revise before continuing implementation.
- If the spec is correct, keep implementing until the code matches it.
- If the baseline changed underneath the Change, use `/codespec:rebase` before
  continuing.

Never edit `codespec/specs/` as a shortcut. The Current Specification
is written only by `/codespec:archive`, after Core validation and conflict checks.

## Update or start another Change?

Update the current Change when the intent is the same and only the scope,
design, or requirements are being refined. Start a new Change when the intent
has fundamentally changed or the work has split into independent outcomes.

Superpowers brainstorming is an internal method for clarifying a rethink;
`workflow` remains the only development entry.

## Related

- [Reviewing a Change](reviewing-changes.md)
- [Workflows](workflows.md)
- [Commands](commands.md)
