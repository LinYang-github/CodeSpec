# Writing Good Specs

Write only the Requirements affected by the approved analysis. Start with [Getting Started](getting-started.md) for setup or [Reviewing a Change](reviewing-changes.md) for review.

## Canonical Requirement delta

Read each existing Requirement from Current in your terminal:

```bash
codespec show MOD-002 --type spec --requirement MOD-002-REQ-006 --json
```

Use the returned Requirement snapshot as the source for `Previous`. The rich delta uses `## ADDED`, `## MODIFIED` and `## REMOVED`, without the legacy `Requirements` suffix.

| Action | Required blocks |
|---|---|
| `ADDED` | `New`, `Reason`; omit `Previous` |
| `MODIFIED` | `Previous`, `New`, `Reason` |
| `REMOVED` | `Previous`, `Reason`; omit `New` |

**`Previous`:** the complete current Requirement, including its Scenarios and test cases.

**`New`:** the complete target Requirement with the same stable ID. Preserve every still-valid Scenario and test case.

**`Reason`:** the approved reason for this action. A no-op MODIFIED Requirement fails validation.

### Write a rich delta

This ADDED example shows the canonical Markdown structure:

```markdown
# 用户管理增量

- **模块编号：** MOD-002
- **规格版本：** 1

## ADDED

**New**

### MOD-002-REQ-006：新增用户

##### Scenario: MOD-002-REQ-006-SCN-001 有效提交
- GIVEN 已登录
- WHEN 提交用户
- THEN 用户出现在列表
- ERROR 重复用户时拒绝创建

#### 测试用例

##### MOD-002-REQ-006-SCN-001-TC-UI-01：提交用户
- **类型：** UI
- **自动化测试：** `e2e/users.spec.ts`
- **测试标识：** `data-testid=add-user`
- **最近验证：** 待验证

| 步骤 | 用户操作 | 预期结果 |
| --- | --- | --- |
| 1 | 提交有效信息 | 用户出现在列表 |

**Reason**

允许管理员创建用户。

## 工程文件增量

| 文件 | 模块编号 | 变更 | 作用 | 关联需求 / 场景 / 测试用例 |
| --- | --- | --- | --- | --- |
| `e2e/users.spec.ts` | MOD-002 | 新增 | 自动化测试 | `MOD-002-REQ-006-SCN-001-TC-UI-01` |
```

**Engineering files:** use the exact `工程文件增量` columns. Each changed path declares its module, action and trace references.

**Set equality:** analysis, metadata and spec must declare the same affected Requirement set. Every delta Requirement needs an AC reference.

**Removed or replaced Scenarios:** record archive-impact mappings in `design.md` before approval.

### Keep later Changes scoped

If Current contains REQ-001 and REQ-002, and this Change modifies only REQ-001, its `spec.md` contains only REQ-001. Copying REQ-002 would claim an unrelated change and may fail the delta boundary check.

The next Change for REQ-001 reads the version produced by the previous archive. It does not copy the previous Change or the full module. See [Current Specification and history](concepts.md#current-specification-and-history) for merge behavior.

## Legacy `spec-driven` authoring

The short examples and `## ADDED Requirements` format below apply to legacy `spec-driven` Changes. Canonical `code-spec` uses the rich structure above.

## A spec is behavior, not code

A spec says what your system *does*, in terms anyone could check — not how it's built. It's made of **requirements** (statements of behavior) and **scenarios** (concrete examples that prove them).

```markdown
### Requirement: Session Timeout
The system SHALL expire a session after 30 minutes of inactivity.

#### Scenario: Idle timeout
- GIVEN an authenticated session
- WHEN 30 minutes pass with no activity
- THEN the session is invalidated and the user must re-authenticate
```

Keep the *how* — the queue, the library, the table schema — in `design.md` or the code. When behavior and implementation get mixed into one requirement, the requirement stops being testable and starts going stale the moment the code changes.

## What makes a good requirement

A good requirement is one behavior, stated so plainly you could hand it to someone else to test.

- **One statement, one `SHALL`/`MUST`.** If a requirement has three "and also" clauses, it's really three requirements. Split them.
- **Observable.** Someone outside the code should be able to tell whether it holds. "The system SHALL show an error banner when the upload exceeds 10 MB" is observable. "The system SHALL handle large uploads gracefully" is not.
- **The right strength.** CodeSpec uses the RFC 2119 keywords, and they mean different things:

  | Keyword | Meaning |
  |---------|---------|
  | `MUST` / `SHALL` | A hard requirement. Non-negotiable. |
  | `SHOULD` | A strong recommendation, with room for a justified exception. |
  | `MAY` | Genuinely optional. |

  Reach for `MUST`/`SHALL` by default. Use `SHOULD` only when you truly mean "unless there's a good reason not to."

The test for a requirement: *could a tester who's never seen the code tell whether it passed?* If not, it needs sharpening.

## What makes a good scenario

Scenarios are where a requirement earns its keep. Each one is a concrete GIVEN / WHEN / THEN that could become an automated test.

- **It exercises its requirement.** A scenario that just restates the requirement in other words tests nothing. Make it a specific situation with a specific outcome.
- **Cover the cases that matter, not just the happy path.** The valid login is easy. The empty input, the expired token, the second click, the thing that goes wrong — those are where bugs live, and where a scenario is worth the most.
- **Name the case in the title.** "Scenario: Rejects an expired token" tells a reviewer what's covered at a glance; "Scenario: Test 2" doesn't.

For canonical `code-spec` Changes, add an explicit `- **ERROR**` line to every Scenario. It may be empty while the exception path is still being analyzed, but do not infer its content from `THEN`; a human must describe the system handling before Verification or archive. Multiple `ERROR` lines are allowed when one failure path has several observable handling steps.

A useful habit: before approving, ask *what's the one case I'd be upset to see broken?* — and make sure a scenario names it.

## Pick the right kind of delta

A change describes its edits to the specs with three section types. Using the right one keeps your archived specs honest:

- **`## ADDED Requirements`** — brand-new behavior that didn't exist before.
- **`## MODIFIED Requirements`** — behavior that already existed and is changing. Include the full new version; a short note on what changed helps a reviewer.
- **`## REMOVED Requirements`** — behavior going away, with a line on why.

On archive, ADDED gets appended to Current Specification, MODIFIED replaces the old version, and REMOVED is dropped from it. Remove the last requirement a capability has and you retire it: rather than leave a spec with nothing in it, archive deletes `codespec/specs/<capability>/spec.md`. Because that is the one archive step that removes a file, it has to be asked for — add `retire_capabilities: true` to the Change's `.codespec.yaml`, alongside the `schema:` that file already needs. Without it the archive aborts and tells you so. If you mark a real Change as ADDED, you end up with two competing requirements; if you describe new behavior as MODIFIED, there's nothing to replace. When in doubt, open the current spec and see whether the requirement is already there.

One more section is worth knowing about. When your delta creates a capability that doesn't exist yet, open it with `## Purpose` — a sentence or two on what the capability is for. Archive uses it as the Purpose of the Current Specification it creates; skip it and you get a `TBD` placeholder to fill in by hand. An existing spec already has a Purpose, so a delta's is ignored there — edit `codespec/specs/<capability-path>/spec.md` directly to change one. Here, `<capability-path>` is the directory relative to `specs/`, such as `user-auth` in a flat project or `identity/user-auth` in a project organized by domain.

## Right-size the change

The single most common authoring mistake isn't a badly worded requirement — it's a change that's trying to be three changes.

**A good change has one intent you can say in a sentence.** "Add a dark-mode toggle." "Rate-limit the login endpoint." "Migrate sessions off cookies." If describing the change needs a lot of "and also," that's the signal to split it.

Signs a change is too big:

- The proposal's scope reads like a list of unrelated features.
- Reviewing it would take an afternoon, so nobody will.
- Two people couldn't work on it without colliding.
- Half the tasks could ship on their own.

Smaller changes are easier to review, easier to build in one focused session, and easier to reason about six months later when the archive is all that's left. You can always run several changes in parallel — see [Editing & iterating](editing-changes.md) and [Workflows](workflows.md).

The opposite also happens: a one-line typo fix doesn't need three requirements and a design doc. Match the ceremony to the stakes.

## How to steer the AI toward a good draft

Because `workflow` creates the first draft, the quality of what you get back tracks the quality of what you give it. You don't have to write requirements by hand. Give the workflow a concrete scope and review its output:

- **State the intent and the boundary.** *"Add a dark-mode toggle that follows the OS setting on first load — don't touch the existing theme API."* The out-of-scope half matters as much as the in-scope half.
- **Name the cases you care about.** *"Make sure there's a scenario for a user who already picked a theme manually."* The AI covers what you point at.
- **Then edit.** It's plain Markdown. Tighten a vague `SHALL`, delete a scenario that tests nothing, add the case it missed — or ask the AI to: *"the timeout requirement is vague, pin it to 30 minutes."*

Draft, sharpen, repeat. A few rounds of that produces a spec you'd trust, which is the whole point.

## A quick checklist

- [ ] Each requirement is one observable behavior with a `SHALL`/`MUST`.
- [ ] No implementation details are baked into the requirements.
- [ ] Every requirement has at least one scenario that actually exercises it.
- [ ] The important edge and error cases have scenarios, not just the happy path.
- [ ] Deltas use ADDED / MODIFIED / REMOVED correctly against the current spec.
- [ ] The whole change has one intent you can state in a sentence.

## Where to go next

- [Reviewing a Change](reviewing-changes.md) — the two-minute pass that catches what slipped through.
- [Concepts](concepts.md) — the deeper model behind specs, changes, and deltas.
- [Examples & Recipes](examples.md) — real changes from start to finish.
