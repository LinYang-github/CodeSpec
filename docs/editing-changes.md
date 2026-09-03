# Editing and Iterating on a Change

An active Change is a living, reviewable package. Edit its Markdown artifacts
directly or ask `/opsx:workflow` to revise them. OpenSpec Core remains the
authority for Change identity, requirement IDs, baseline, stale state, and
traceability.

## Revise an active Change

```text
openspec/changes/CHG-YYYYMMDD-NNN/
├── proposal.md
├── spec.md
├── design.md
├── tasks.md
└── verification.md
```

After a substantive edit, return to `/opsx:workflow`. It should resolve the
Change, recalculate the requirement delta, and continue through Superpowers'
planning or implementation methods as appropriate.

## Code and spec disagree

- If the code is correct, update the delta and verification evidence to match
  what was actually shipped.
- If the spec is correct, keep implementing until the code matches it.
- If the baseline changed underneath the Change, use `/opsx:rebase` before
  continuing.

Never edit `openspec/archive/specs/` as a shortcut. The Current Specification
is written only by `/opsx:archive`, after Core validation and conflict checks.

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
