# CodeSpec Requirement Clarification Closed-Loop Design

**Date:** 2026-09-15

**Status:** Approved

## 1. Problem

Canonical `code-spec` currently starts a Change in `ANALYZE`, but the stage has no dedicated artifact for requirement clarification. The five active artifacts are `metadata.yaml`, `design.md`, `spec.md`, `tasks.yaml`, and `verification.yaml`. High-level intent is reduced to `metadata.yaml.impact.summary`; detailed goals, non-goals, scope boundaries, constraints, assumptions, unresolved questions, and acceptance criteria either remain in chat or leak into `design.md` and `spec.md`.

The gate is therefore incomplete. It checks that a summary and module candidates exist and that a mutable gate boolean is set, but it cannot prove that questions were resolved, scope was approved, or downstream requirements still implement the approved user intent. A later requirement change can also invalidate design, tasks, implementation conclusions, and verification without a single transaction that routes the Change back to the earliest affected stage.

The canonical archive branch also treats the active `spec.md` as a complete module Specification and replaces the target module wholesale. The older proposal-bearing branch performs Requirement-level delta application. That split is the concrete reason a later Change for the same business requirement tends to carry the previous module Spec forward: the authoring path must preserve unrelated content because archive currently publishes the whole active document. The implementation must remove this semantic split and make canonical archive apply only explicit Requirement deltas.

This design closes that loop without adding another public CodeSpec Skill.

## 2. Goals

1. Persist requirement clarification as a structured, reviewable canonical artifact.
2. Require explicit user approval before `ANALYZE -> DESIGN`.
3. Trace approved acceptance criteria through Requirement, Scenario, Task, Test Case, Evidence, Current Specification, and archive history.
4. Make semantic revision invalidate every downstream conclusion deterministically.
5. Keep Current Specification as the complete current truth and active `spec.md` as a Requirement-scoped delta.
6. Preserve the three public CodeSpec entry Skills: workflow, rebase, and archive.
7. Keep historical Changes readable and provide an explicit migration path for active five-file Changes.

## 3. Non-goals

- Do not add a standalone `codespec-analyze` or `codespec-clarify` Skill.
- Do not restore legacy `proposal.md` as the canonical intent artifact.
- Do not let an AI approve analysis, design, plan, or archive on the user's behalf.
- Do not infer resolutions for open questions or confirmation for assumptions.
- Do not write Current Specification before the archive transaction.
- Do not copy archived Change content into a later Change.
- Do not redesign implementation verification runners in this change; only bind their evidence to the approved intent chain.

## 4. Chosen Architecture

Add a sixth canonical active artifact, `analysis.yaml`, and a third approval stage, `analyze`.

Each artifact has one authority:

| Concern | Authority |
|---|---|
| User intent and clarification | `analysis.yaml` |
| Lifecycle state, revision, artifact paths, approval receipts | `metadata.yaml` |
| Technical design and trade-offs | `design.md` |
| Requirement and Scenario behavior delta | `spec.md` |
| Implementation graph and planned verification | `tasks.yaml` |
| Executed verification evidence | `verification.yaml` |
| Complete accepted behavior | `codespec/specs/<module>/spec.md` |
| Immutable change history | `codespec/archive/changes/<CHG-ID>/` |

`metadata.yaml.modules` and `metadata.yaml.requirements` remain query projections for compatibility. They are derived from `analysis.yaml` and `spec.md`; agents must not treat them as independently editable sources of truth. Core validates equality before transitions.

## 5. `analysis.yaml` Contract

New Changes create the following structurally valid draft:

```yaml
version: 1
change: CHG-20260915-001
revision: 1
problem: 用户提交的原始问题摘要
goals: []
nonGoals: []
scope:
  in: []
  out: []
actors: []
constraints: []
assumptions: []
openQuestions: []
acceptanceCriteria: []
modules: []
requirements: []
```

Completed records use these shapes:

```yaml
goals:
  - id: GOAL-001
    statement: 管理员可以在用户列表内查看用户基础详情
nonGoals:
  - id: NON-GOAL-001
    statement: 本次不提供用户资料编辑能力
scope:
  in:
    - 用户列表中的详情查看入口
  out:
    - 新增后端 API
actors:
  - 管理员
constraints:
  - id: CONSTRAINT-001
    statement: 复用现有用户查询接口
    source: 当前系统约束
assumptions:
  - id: ASSUMPTION-001
    statement: 当前接口已返回详情所需字段
    status: CONFIRMED
openQuestions:
  - id: QUESTION-001
    question: 无权限时展示什么结果
    status: RESOLVED
    resolution: 展示无权限提示并保持列表状态
acceptanceCriteria:
  - id: AC-001
    statement: 点击用户后在当前页面展示基础详情
    priority: MUST
    requirements:
      - MOD-002-REQ-006
modules:
  - module: MOD-002
    outcome: OWNED
    reason: 用户查看行为由用户管理模块负责
requirements:
  - id: MOD-002-REQ-006
    action: MODIFIED
    reason: 在现有用户查看需求中增加列表内详情场景
```

The structural parser accepts empty draft arrays so a newly created Change can load. `validateAnalysisCompleteness()` applies the stricter exit gate.

### 5.1 ANALYZE completion rules

ANALYZE is complete only when all conditions hold:

- `problem` is non-empty.
- At least one goal and one in-scope item exist.
- At least one explicit non-goal or out-of-scope item exists.
- Every goal, non-goal, constraint, assumption, question, and acceptance criterion has a unique stable ID within the document.
- No question has status `OPEN`.
- No assumption has status `PROPOSED`; it must be `CONFIRMED` or `REJECTED`.
- At least one acceptance criterion exists and every one uses priority `MUST`, `SHOULD`, or `COULD`.
- At least one `OWNED` module is confirmed.
- Every affected Requirement has a valid `ADDED`, `MODIFIED`, or `REMOVED` disposition and belongs to one confirmed `OWNED` module.
- Existing Requirement IDs resolve in Current Specification; new Requirement IDs are reserved through Core before approval.
- `analysis.yaml.change` and `analysis.yaml.revision` equal metadata.
- The metadata module/Requirement projections equal the analysis projection.

Core computes this gate. `metadata.gates.analyze.satisfied` becomes a recorded projection, not an agent-controlled switch.

## 6. Approval Model

`ApprovalStage` becomes:

```ts
type ApprovalStage = 'analyze' | 'design' | 'plan';
```

`metadata.yaml.approvals` contains three records. Each approval binds the current Change revision and a semantic content hash.

### 6.1 Hash inputs

- `analyze`: normalized parsed `analysis.yaml`, excluding presentation-only ordering but including all decisions and resolutions.
- `design`: valid analyze projection, `design.md`, semantic `spec.md` projection, SDD level, module ownership, and Requirement action set.
- `plan`: valid analyze and design projections plus `tasks.yaml` with execution status and runtime evidence excluded.

Changing a bound field makes the approval invalid even if metadata still says `approved`. Transitions compare the stored hash with a fresh hash and fail closed.

### 6.2 Transition requirements

| Transition | Required approval |
|---|---|
| `ANALYZE -> DESIGN` | `analyze` |
| `DESIGN -> PLAN` | `design` |
| `PLAN -> IMPLEMENT` | `plan` |
| `IMPLEMENT -> VERIFY` | No new approval; tasks and implementation gate must pass |
| `VERIFY -> ARCHIVE` | No new approval; fresh verification and archive preflight must pass |

`codespec approve --stage analyze` is valid only in `ANALYZE` and only after the computed ANALYZE gate passes. The user must approve in a separate message or interactive action; AI automation cannot use `--yes` to bypass it.

## 7. End-to-End Lifecycle

### 7.1 Create and clarify

1. `codespec new change "<title>"` creates six artifacts.
2. `analysis.yaml.problem` is initialized from `--goal`, `--description`, or the title.
3. `codespec-workflow` invokes `superpowers:brainstorming` when intent is unclear or the mode is `feature`.
4. The agent updates the structured clarification fields and uses Current Specification, not archive history, to classify Requirement impact.
5. `codespec status --change <id> --json` returns `analysisSummary`, `openQuestions`, `gateErrors`, and the exact next command.
6. Once complete, the workflow stops and asks the user to confirm the analysis.
7. The user runs or authorizes `codespec approve --change <id> --stage analyze`.
8. `codespec transition --change <id> --to DESIGN --reason "analysis approved"` succeeds only while the approval hash remains valid.

### 7.2 Design and Requirement delta

1. DESIGN consumes only the approved `analysis.yaml` and Current Specification.
2. For an existing Requirement, the workflow reads the exact baseline using:

   ```bash
   codespec show MOD-002 --type spec --requirement MOD-002-REQ-006 --json
   ```

3. Active `spec.md` contains only affected Requirement IDs.
4. `Previous` is the complete Current snapshot for that Requirement.
5. `New` is the complete target state for the same Requirement and preserves still-valid Scenarios.
6. Removed or behaviorally replaced Scenarios require explicit archive-impact mappings.
7. Core checks that every `analysis.yaml.acceptanceCriteria[].requirements` reference exists in `spec.md`, and every delta Requirement is justified by at least one acceptance criterion.
8. DESIGN approval binds analysis, design, and behavioral spec.

Canonical `spec.md` uses the rich Current Specification Requirement model inside `ADDED`, `MODIFIED`, and `REMOVED` sections. It is not parsed with the legacy short-ID delta parser. Core exposes one shared Requirement snapshot parser/renderer so Current reads, baseline hashes, delta validation, rebase, and archive compare the same semantic object. Engineering-file changes remain an explicit file delta and are merged by file path.

### 7.3 Plan, implement, and verify

1. PLAN creates tasks that trace to Requirement, Scenario, Test Case, and acceptance criterion IDs.
2. `tasks.yaml` gains `changeRevision` and each task gains `acceptanceCriteria`.
3. PLAN approval ignores mutable task execution status but binds task definitions, planned files, and verification plans.
4. IMPLEMENT can update task status without invalidating plan approval.
5. Verification records the same Change revision and adds acceptance criterion IDs to evidence rows.
6. VERIFY fails if any `MUST` acceptance criterion lacks a complete passing chain.

The required chain is:

```text
Goal
  -> Acceptance Criterion
  -> Requirement
  -> Scenario
  -> Task
  -> Test Case
  -> Evidence
  -> Current Specification
  -> Archived Change
```

### 7.4 Archive

Archive preflight checks:

- analyze, design, and plan approvals are current and hash-valid;
- no unresolved question or proposed assumption exists;
- `analysis.yaml`, metadata projections, delta spec, tasks, and verification refer to the same Change revision;
- every MUST acceptance criterion has passing evidence;
- `Previous` still matches Current Specification;
- only explicitly listed Requirement deltas are applied.

The archive transaction moves all six artifacts into immutable history. The canonical module-replacement branch is replaced by Requirement-level delta application: `ADDED` inserts one Requirement, `MODIFIED` replaces one Requirement after exact `Previous` validation, and `REMOVED` deletes one Requirement. Unlisted Requirements remain untouched. The legacy proposal-bearing compatibility branch remains readable but is not the semantic model for new Changes.

## 8. Semantic Revision and Backward Routing

A new Core transaction, exposed as `codespec revise --change <id> --reason <text>`, classifies the earliest invalidated authority and routes the Change backward.

| Changed authority | Route | Invalidated conclusions |
|---|---|---|
| `analysis.yaml` | `ANALYZE` | analyze, design, plan approvals; task revision; verification; archive readiness |
| Behavioral `design.md` or `spec.md` | `DESIGN` | design and plan approvals; task revision; verification; archive readiness |
| Planned `tasks.yaml` fields | `PLAN` | plan approval; verification; archive readiness |
| Task execution status only | Remain `IMPLEMENT` | No approval invalidation |
| Verification evidence only | Remain `VERIFY` | No design/plan invalidation |

For semantic changes, the transaction:

1. increments `metadata.change.revision`;
2. sets `analysis.yaml.revision` and `tasks.yaml.changeRevision` to the new revision only when their content is regenerated for that revision;
3. revokes the affected approval records;
4. clears verification receipts and archive readiness;
5. captures a fresh Requirement-scoped baseline after module and Requirement decisions are valid;
6. updates metadata and the Change index atomically.

Artifacts may remain on disk for comparison, but revision mismatch prevents them from satisfying a gate. Core does not silently mark stale tasks or evidence current.

## 9. Rebase Routing

`codespec-rebase-change` continues to own Current Specification drift.

- If Current changed but the approved problem, scope, and acceptance criteria remain valid, rebase refreshes only affected Requirement `Previous` snapshots, increments revision, invalidates design/plan/verification, and routes to DESIGN.
- If Current invalidates a confirmed assumption, module ownership decision, Requirement disposition, or acceptance criterion, rebase records the conflict, revokes all approvals, and routes to ANALYZE.
- Rebase never imports archived Change text. It uses approved analysis as intent and Current Specification as the only behavioral baseline.

## 10. Commands and Status UX

No public Skill is added. The CLI surface changes are:

```bash
codespec approve --change <CHG-ID> --stage analyze
codespec revise --change <CHG-ID> --reason <text>
codespec show <MOD-ID> --type spec --requirement <REQ-ID> --json
codespec status --change <CHG-ID> --json
codespec instructions analyze --change <CHG-ID> --json
```

Canonical status JSON adds:

```json
{
  "analysis": {
    "path": "changes/CHG-20260915-001/analysis.yaml",
    "complete": false,
    "approved": false,
    "openQuestions": ["QUESTION-001"],
    "unconfirmedAssumptions": [],
    "acceptanceCriteria": ["AC-001"]
  },
  "next": {
    "action": "resolve_analysis_questions",
    "command": "codespec instructions analyze --change CHG-20260915-001 --json"
  }
}
```

Text status presents the same information in Chinese and retains English protocol values.

## 11. Skill Responsibilities

The public Skill count remains three.

### `codespec-workflow`

- Drives ANALYZE through `superpowers:brainstorming`.
- Reads and updates `analysis.yaml`.
- Stops for independent analyze, design, and plan approvals.
- Uses Requirement-scoped Current reads when authoring delta specs.
- Never changes Current Specification.

### `codespec-rebase-change`

- Uses approved analysis as intent.
- Chooses ANALYZE or DESIGN recovery according to invalidated assumptions and acceptance criteria.
- Refreshes only affected Requirement baselines.

### `codespec-archive-change`

- Requires all approval and traceability receipts to be current.
- Archives `analysis.yaml` with the other Change evidence.
- Keeps user-controlled archive confirmation and the existing transaction boundary.

## 12. Migration and Compatibility

- New canonical Changes always contain `analysis.yaml`.
- Metadata parsing keeps `artifacts.analysis` optional only so existing active and archived Changes remain readable.
- Any active Change without `analysis.yaml` is blocked from its next transition with an actionable migration message.
- `codespec migrate --change <CHG-ID>` creates a draft analysis using only deterministic facts:
  - `problem` from `metadata.impact.summary`;
  - modules and Requirement actions from metadata projections;
  - scope candidates from `impact.affected_areas`;
  - one unresolved migration question requiring the user to confirm goals, non-goals, scope, assumptions, and acceptance criteria.
- Migration does not infer user decisions from `design.md`, `spec.md`, code, or archive history.
- Migrated active Changes route to ANALYZE and require analyze approval.
- Archived Changes are not rewritten; their missing analysis is reported as historical format, not corruption.
- Legacy `spec-driven` Changes retain `proposal.md` behavior and do not gain `analysis.yaml`.

## 13. Failure Handling

- Malformed `analysis.yaml`: loading reports the exact schema path and performs no state mutation.
- Open questions or proposed assumptions: analyze approval fails with IDs and suggested next action.
- Content changed after approval: transition fails with an approval hash mismatch and recommends `codespec revise`.
- Current Requirement differs from `Previous`: DESIGN/VERIFY/archive reports `ARCHIVE CONFLICT` before any write.
- Revision mismatch across analysis, tasks, or verification: the earliest owning stage is reported.
- Migration or revision transaction failure: metadata, index, and artifacts are restored from snapshots.
- Archive failure: the existing archive journal restores Current Specification and the active Change, including `analysis.yaml`.

## 14. Testing Strategy

### Contract tests

- Parse draft and complete `analysis.yaml`.
- Reject duplicate IDs, unresolved questions, proposed assumptions, invalid module ownership, and mismatched Change revisions.
- Verify stable semantic hashes and exclusion of execution-only fields.

### Lifecycle tests

- Block `ANALYZE -> DESIGN` without analyze approval.
- Reject approval before analysis completeness passes.
- Invalidate approvals according to the revision matrix.
- Preserve approvals for execution-status-only and locator-only changes.

### Traceability tests

- Require every MUST acceptance criterion to reach a Requirement and Scenario.
- Require tasks and passing verification evidence for every mapped Scenario.
- Reject orphan delta Requirements and orphan acceptance criteria.

### Delta and archive tests

- Modify the same Requirement in two sequential Changes without copying unrelated Requirements.
- Preserve unchanged Scenarios inside `New`.
- Preserve unrelated Current Requirements semantically and avoid rewriting their content while applying the targeted delta.
- Reject no-op MODIFIED entries and whole-Spec carryover.
- Archive all six artifacts atomically.

### Migration tests

- Deterministically scaffold analysis for an active five-file Change and route it to ANALYZE.
- Leave archived five-file Changes unchanged and readable.
- Roll back partial migration writes.

### Generated content tests

- Ensure all three generated Skills describe analysis approval and Requirement-scoped delta authoring.
- Ensure generated Skill files remain in parity with source templates.
- Ensure no fourth public CodeSpec Skill appears.

## 15. Delivery Slices

The implementation should be delivered in independently testable slices:

1. `analysis.yaml` schema, artifact loading, scaffolding, and migration compatibility.
2. ANALYZE completeness, computed gate, analyze approval, and transition enforcement.
3. Semantic revision transaction and approval invalidation matrix.
4. Acceptance-criterion traceability through tasks and verification.
5. Requirement-scoped Current reads and delta boundary enforcement.
6. Rebase and archive integration for the sixth artifact.
7. Status/instructions UX, generated Skills, documentation, and end-to-end verification.

Each slice must pass its focused tests before the next slice begins. Full-suite verification and a real temporary canonical workflow conclude the change.

## 16. Acceptance Criteria

The design is complete when an implementation can demonstrate all of the following:

1. A newly created canonical Change contains exactly six declared artifacts, including `analysis.yaml`.
2. No Change can leave ANALYZE with open questions, unconfirmed assumptions, missing scope boundaries, missing acceptance criteria, or absent user approval.
3. Each downstream artifact is traceable to approved acceptance criteria and the same Change revision.
4. Editing approved intent cannot reuse old design, plan, task, or verification conclusions.
5. A second Change for the same Requirement contains only that Requirement's Current `Previous` and complete target `New`.
6. Archive changes only explicitly affected Requirements and preserves unrelated Current Requirements.
7. Rebase returns to ANALYZE when intent assumptions are invalidated and otherwise returns to DESIGN.
8. The public CodeSpec Skill set remains workflow, rebase, and archive.
9. Existing archived Changes remain readable without mutation.
10. The canonical archive path no longer replaces a whole module from active `spec.md`; both new authoring and archive enforcement use the rich Requirement-delta contract.
