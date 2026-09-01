# OpenSpec + Superpowers Overall Migration Design

> Status: approved for implementation.

## Purpose

Replace the current code-spec Change model with the OpenSpec + Superpowers
protocol described in the supplied overall design. OpenSpec becomes the
long-lived source of truth for modules, requirements, Change lifecycle,
traceability, verification evidence, baselines, and archive history;
Superpowers remains the methodology engine for analysis, planning, TDD,
debugging, execution, review, and fresh verification.

This is an intentional breaking migration. Existing slug-based Changes,
`.openspec.yaml` metadata, and the previous code-spec archive layout are not
read or written by the new code-spec workflow. Existing files are left in place
for manual migration or removal by the repository owner; the CLI reports them
as unsupported rather than silently interpreting them as new Changes.

## Goals

- Use `metadata.yaml` and `changes/index.yaml` as the Change control contract.
- Support multiple independent active Changes without a workspace-level
  `current_change`.
- Preserve stable `MOD-###` module IDs and `MOD-###-REQ-###` Requirement IDs.
- Track Change-local revisions, baselines, relations, task progress, and fresh
  verification evidence.
- Allocate new Requirement IDs across both current specifications and all
  active Changes.
- Apply ADDED, MODIFIED, and REMOVED deltas with optimistic concurrency checks.
- Make archive application transactional: validate every input before writing
  any current specification or history file.
- Mark only requirement-overlapping active Changes STALE after an archive and
  provide semantic Rebase back to the latest current specification.
- Route OpenSpec lifecycle actions to Superpowers skills without forking their
  methodology or creating a second long-lived plan/spec source.
- Keep the existing CLI's cross-platform path and JSON-output guarantees.

## Non-Goals

- Do not preserve compatibility with old Change IDs, `.openspec.yaml`, or the
  old `openspec/specs` delta layout.
- Do not implement replacement versions of brainstorming, writing-plans, TDD,
  systematic debugging, verification, review, or branch-finishing skills.
- Do not infer lifecycle state from artifact existence alone.
- Do not automatically archive a Change after VERIFY or after a revision.
- Do not delete existing legacy files as part of normal command execution.
- Do not treat same-module Changes as conflicting without Requirement overlap.

## Canonical Workspace Model

The code-spec workspace is rooted at `openspec/` and contains:

```text
openspec/
├── config.yaml
├── business.md
├── changes/
│   ├── index.yaml
│   └── CHG-YYYYMMDD-NNN/
│       ├── metadata.yaml
│       ├── proposal.md
│       ├── design.md
│       ├── spec.md
│       ├── tasks.md
│       └── verification.md
└── archive/
    ├── README.md
    ├── specs/<module-slug>/spec.md
    └── changes/CHG-YYYYMMDD-NNN/
        ├── metadata.yaml
        ├── proposal.md
        ├── design.md
        ├── spec.md
        ├── tasks.md
        └── verification.md
```

`business.md` is the stable module registry. `archive/specs` is the current
specification. `archive/changes` is immutable Change history. The active index
is navigation only; `changes/<id>/metadata.yaml` is the authority for one
Change's status.

`config.yaml` must define the actual paths and the ID formats. The loader never
hardcodes a workspace path after configuration is loaded. The supported default
configuration is:

```yaml
version: 1
project:
  name: <project-name>
paths:
  business: business.md
  changes: changes
  change_index: changes/index.yaml
  archive: archive
  specs: archive/specs
  archived_changes: archive/changes
workflow:
  multiple_active_changes: true
requirements:
  id_format: "{module}-REQ-{sequence:03d}"
changes:
  id_format: "CHG-{date}-{sequence:03d}"
archive:
  update_index: true
  require_verification: true
  conflict_strategy: optimistic
```

The registry parser preserves IDs across renames and requires each module to
declare responsibilities and keywords. Module resolution ranks
responsibilities, existing Requirement semantics, keywords, then display name
and description. An ownership result is one of `OWNED`, `DEPENDENCY`, or
`IRRELEVANT`; dependencies never become Requirement owners.

## Domain Contracts

### Change metadata

`metadata.yaml` contains only control data:

```yaml
schema_version: 1
change:
  id: CHG-YYYYMMDD-NNN
  revision: 1
  title: <title>
  mode: feature
  status: ANALYZE
  created_at: <timestamp>
  updated_at: <timestamp>
baseline:
  created_at: <timestamp>
  stale: false
  modules: {}
relations:
  depends_on: []
  related_to: []
  conflicts_with: []
  supersedes: []
modules:
  candidates: []
  confirmed: []
  dependencies: []
requirements:
  added: []
  modified: []
  removed: []
tasks:
  total: 0
  completed: 0
  items: {}
verification:
  requirements_verified: false
  tests_passed: false
  build_passed: false
  lint_passed: false
  verified_at: null
archive:
  ready: false
  conflict: false
  archived_at: null
```

The allowed lifecycle is:

```text
ANALYZE → DESIGN → PLAN → IMPLEMENT → VERIFY → ARCHIVE → ARCHIVED
                                             ├→ IMPLEMENT
                                             └→ DESIGN (revision + 1)
```

An active Change may explicitly become `ABANDONED`. Entry and exit gates are
validated by domain state, not by file presence. `ARCHIVE` is a deliberate
command and `archive.ready: true` is only a precondition, never an automatic
archive action.

### Requirements and delta specification

Each changed Requirement has one stable ID. ADDED allocates a new ID by
scanning current specifications and every active Change reservation. MODIFIED
and REMOVED retain the existing ID and carry `Previous`; MODIFIED also carries
`New`, while REMOVED carries `Reason`.

The Change `spec.md` is a delta and uses the English protocol tokens
`ADDED`, `MODIFIED`, `REMOVED`, `Previous`, `New`, `Reason`, `GIVEN`, `WHEN`,
and `THEN`. Requirement names and business prose are Chinese. Every Scenario
is linked to its Requirement and every changed Requirement is represented
exactly once in metadata, design, and spec.

The consistency validator enforces:

```text
R(metadata) = R(design) = R(spec)
R(spec) ⊆ R(tasks)
```

It also validates task references, dependency acyclicity, valid module
ownership, scenario structure, and verification coverage.

### Task and verification bridge

Superpowers' detailed plan is stored at
`docs/superpowers/plans/<date>-<change-id>.md` only as an execution artifact of
the current agent session. The OpenSpec `tasks.md` remains the concise status
projection and archive gate. Both use `SP-##` IDs, but `tasks.md` never copies
the detailed plan prose. Task completion requires observed RED, minimal GREEN,
regression coverage, and scenario coverage; Requirement verification is a
separate gate recorded in `verification.md` with fresh command output.

## Lifecycle Orchestration

The new `openspec-workflow` integration layer owns these actions:

```text
create-change, resolve-change, resume, analyze, resolve-modules,
load-specs, allocate-requirements, design, plan, implement, verify,
detect-stale, rebase, archive, abandon
```

It loads `config.yaml`, `business.md`, the selected Change, and only the
Current Specifications and related Changes required for the current action.
Change resolution is deterministic: explicit ID, bound conversation context,
unique semantic match, the sole active Change, then a user choice for multiple
candidates. `继续` with multiple candidates never guesses.

Mode routing is:

```text
feature → brainstorming → planning → TDD
bugfix  → systematic-debugging → spec-impact decision → TDD
refactor → design-impact → planning → TDD
```

The integration layer injects Change ID, Requirement IDs, Scenarios, Task IDs,
baseline, and required verification commands into existing Superpowers skills.
It does not fork or reimplement their rules.

## Baseline, STALE, and Rebase

At design start, the Change captures the latest current Change affecting each
confirmed module. After a successful archive, the workflow compares the
archived Requirement IDs and baseline against every active Change. Only Changes
whose Requirements or baseline overlap are marked `baseline.stale: true` and
optionally registered in `conflicts_with`.

Resuming a STALE Change first reloads the current specifications and performs
impact analysis. Rebase is semantic: it re-evaluates the original business
goal against the new Current Specification, rewrites affected Previous/New
content and dependent artifacts, increments `revision`, refreshes the
baseline, and returns the Change to `DESIGN`. It never mechanically replaces
`Previous` strings.

## Transactional Archive

Archive is implemented as a single transaction:

```text
read all → validate all → conflict-check all → prepare all resulting specs
→ validate result → stage writes → commit staged writes → update index
→ write immutable history → post-archive stale scan
```

ADDED requires the Requirement ID to be absent from Current Specification.
MODIFIED and REMOVED require `Current == Previous`. Any mismatch produces an
explicit archive conflict and leaves every current specification, active
Change, and index unchanged. Staging uses a temporary sibling directory and
backups/rollback for failures during the commit boundary. History is copied
before the active Change is removed from the index, and its metadata is updated
to `ARCHIVED` with `archived_at`.

Dependencies must already be `ARCHIVED` before final archive. Related Changes
do not block archive. Superseded Changes may be moved to `ABANDONED` through an
explicit action.

## CLI and Skill Integration

Existing user-facing lifecycle commands keep their names where practical, but
operate on the new Change contract and reject legacy metadata. The command
surfaces are:

```text
openspec new change [title]
openspec status --change CHG-...
openspec instructions analyze|design|plan|implement|verify|archive
openspec detect-stale --change CHG-...
openspec rebase --change CHG-...
openspec archive CHG-...
openspec abandon CHG-...
```

JSON output includes the resolved Change ID, status, revision, baseline,
Requirements, task progress, verification state, and actionable gate errors.
Paths are produced with Node's `path` module and remain valid on Windows.

Generated skills are derived from templates. The `using-superpowers` template
detects `openspec/config.yaml` before selecting brainstorming. The
brainstorming and writing-plans integrations route artifacts to the active
Change. Verify and archive instructions consume fresh evidence and never treat
Task DONE as Requirement PASS.

## Error Handling

- Missing or malformed configuration fails closed with the expected path and
  field.
- Missing Change IDs list active candidates; ambiguous semantic resolution asks
  the user instead of guessing.
- Invalid transitions report the current status and allowed transitions.
- Unknown modules, duplicate IDs, malformed delta blocks, unassigned
  Requirements, incomplete traceability, stale baselines, unmet dependencies,
  and archive conflicts are blocking errors.
- Transaction failures preserve the staged or backup location for recovery and
  never report a successful archive.
- Unsupported legacy Changes are diagnosed explicitly and are not converted
  implicitly.

## Verification Strategy

Tests are organized around the domain boundaries:

- schema and YAML contract tests for config, registry, metadata, index, and
  artifact templates;
- unit tests for ID allocation, module resolution, state transitions,
  requirement parsing, traceability, baseline comparison, stale detection, and
  semantic rebase;
- archive transaction tests for ADDED/MODIFIED/REMOVED success, optimistic
  conflict, dependency blocking, rollback, and immutable history;
- CLI tests for explicit/semantic/ambiguous Change resolution, JSON errors,
  Windows-safe paths, and the lifecycle command sequence;
- generated Skill parity tests for the OpenSpec workflow injection;
- end-to-end tests for ordinary feature, revisions, independent parallel
  Changes, same-module different Requirement, same-Requirement conflict,
  STALE/Rebase, parallel Requirement allocation, VERIFY branches, bug routing,
  dependency, supersede/abandon, and interrupted resume.

Every implementation task follows RED → verify RED → minimal GREEN → verify
GREEN → refactor. Completion claims require fresh test/build/lint output, and
`verification.md` stores the exact commands and results used for the current
Change.

## Migration Boundary

The built-in `code-spec` schema becomes the sole supported schema for this
workflow and is rewritten to the new path and document contracts. Existing
generic schemas may remain available only if they do not enter this workflow;
the old `spec-driven` Change model is removed from code-spec resolution.

No compatibility adapter, automatic slug-to-CHG conversion, old metadata
fallback, or old archive fallback is included. A future explicit migration
command can be added separately without weakening the new source-of-truth
rules.
