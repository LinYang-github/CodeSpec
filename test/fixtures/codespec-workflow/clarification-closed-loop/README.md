# Clarification closed-loop fixture

The executable fixture lives in `test/commands/artifact-workflow.test.ts`, in
`canonical clarification closed loop in one process`. It creates a temporary
workspace using `createCurrentArchiveFixture` only to seed Current, the module
registry, configuration, and engineering files. It does not use
`writeCanonicalChange`, pre-approved receipts, or pre-completed metadata.

Each of two Changes to the same Requirement is created through Core's real
`createCanonicalChange` entry point. Only `analysis.yaml` is authored; Core
previews its derived query fields for status and persists them atomically with
the analyze approval. Metadata, approval receipts, task counters, and gate
flags are never written by the fixture. The real
approval and transition entry points run in a single process. Requirement
selection uses `ShowCommand.execute` and captures only its console output.
The approvals represent explicit user approval events in this test, not an
agent granting itself approval.

The sequence is ANALYZE approval → DESIGN → exact Current read → rich delta →
design approval → PLAN → AC-linked tasks → plan approval → IMPLEMENT → DONE
tasks → VERIFY → executed passing evidence with artifact identity → ARCHIVE.
Verification runs actual Node assertions against a temporary implementation
file; this tests evidence execution and binding, not a product's business
implementation or browser automation. No server or loopback socket is needed.

Assertions cover pending-task and missing-evidence rejection, real index
updates, exactly six archived artifacts, preservation of active spec/analysis
bytes in history, and immutable first-Change history after the second archive.
The second delta's Previous is the first archive's Current snapshot. Both
deltas contain only the affected Requirement; the second excludes the first
Change's ID, delta title, and Reason. Unrelated Requirement bytes and parsed
semantics, unrelated engineering records, and another module's complete tree
remain unchanged. Together these assertions reject whole-module replacement
and importing historical prose as the next Change's baseline.

The adjacent archive-transaction suite covers rollback, conflict detection,
crash recovery, and compatibility. The public skill parity suite separately
checks the unchanged three-entry public registry and generated content.
