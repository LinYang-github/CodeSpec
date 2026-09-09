# Core Concepts at a Glance

## 当前 code-spec 协议

代码变更使用 `codespec/changes/CHG-YYYYMMDD-NNN/metadata.yaml` 作为状态权威；当前规格位于 `codespec/specs/<模块>/`，业务关系与验证配置分别位于根级 `business.yaml`、`configuration.yaml`。同一 workspace 支持多个 active Change。需求使用稳定的 Requirement ID，每个 Scenario 都必须包含 `ERROR` 异常处理；完成后须在 `verification.yaml` 写入 fresh 证据，并显式执行 archive。

**CodeSpec is a lightweight agreement layer between you and your AI.** You write down what a change should do, the AI drafts the details, you both look at the same plan, and only then does code get written. This page is the whole mental model on one screen. When you want the long version, [Concepts](concepts.md) has it.

Here's the entire idea in five words: **agree first, then build confidently.**

## The five ideas

Everything in CodeSpec is built from five concepts. Learn these and the rest is detail.

**1. Specs are the truth.** A code-spec spec describes how your system behaves *right now*. It lives in `codespec/specs/`, organized by stable module IDs. Specs are made of Requirement IDs and scenarios (concrete GIVEN/WHEN/THEN examples with explicit ERROR handling). Think of specs as the single agreed-upon answer to "what does this software do?"

**2. A change is one unit of work.** In canonical code-spec, create `codespec/changes/CHG-YYYYMMDD-NNN/` with `metadata.yaml`, `design.md`, `spec.md`, `tasks.yaml`, and `verification.yaml`. Generic `spec-driven` workspaces may retain the older slug-based layout.

**3. Delta specs describe what's changing, not the whole world.** Canonical code-spec deltas live in `spec.md` and merge into `codespec/specs/`; generic `spec-driven` workspaces may use their historical `codespec/changes/<slug>/specs/` layout.

**4. Artifacts build on each other.** A change contains a few documents, created in a natural order, each feeding the next:

```text
design ──► spec ──► tasks.yaml ──► implement ──► verification.yaml
  scope      behavior     steps          do it          evidence
```

You can revisit any of them at any time. Their contents remain editable, while the two explicit approvals act as gates before implementation and archive.

**5. Archiving folds the change back into the truth.** For canonical code-spec, the archive transaction validates approved YAML deltas, updates `codespec/specs/`, `business.yaml`, and `configuration.yaml`, then removes the active Change. It does not create an archived Change copy or history record. Generic `spec-driven` workflows retain their historical paths and behavior.

## The picture

```text
┌─────────────────────────────────────────────────────────────────┐
│                          codespec/                              │
│                                                                 │
│   ┌──────────────────┐         ┌──────────────────────────┐    │
│   │ specs/   │         │        changes/          │    │
│   │                  │ ◄─────  │                          │    │
│   │ source of truth  │  merge  │ one folder per change    │    │
│   │ how things work  │  on     │ design · spec ·          │    │
│   │ today            │ archive │ tasks.yaml · verification│   │
│   └──────────────────┘         └──────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Two folders. `codespec/specs/` is what's true. `changes/` is what
you're proposing. Archiving applies approved deltas to the Current
Specification and removes the active Change after the transaction commits.

## The loop you'll actually run

In the default setup, your day uses one development entry and two recovery or
commit boundaries.

```text
/codespec:workflow add-dark-mode    →  Superpowers + Core draft and build the Change
/codespec:rebase                    →  rebuild the baseline when STALE or conflicted
/codespec:archive                   →  validate and update Current Specification
```

**When in doubt, start with `/codespec:workflow`.** It delegates brainstorming and
planning to Superpowers, then returns to the same entry for implementation and
verification. CodeSpec Core remains responsible for domain governance.

Those are slash commands, typed in your AI assistant's chat. Setup (`codespec init`) happens in your terminal. If that split is new to you, read [How Commands Work](how-commands-work.md) first; it's the most common point of confusion.

## "Enablers, not gates"

This phrase shows up everywhere in CodeSpec, so here's what it means in plain terms.

Old-school spec processes are waterfalls: finish planning, *then* you're allowed to implement, and going back is painful. CodeSpec keeps the workflow reviewable while requiring two independent confirmations: design first, then tasks. The order `design → spec → tasks.yaml → verification.yaml` describes the current contract.

Discover during implementation that the design was wrong? Update the relevant artifact and repeat the affected confirmation. Approval fingerprints prevent semantic changes from silently reusing an old confirmation; locator-only verification updates can remain valid.

The strength here is honesty: real work is messy and iterative, and CodeSpec lets it be. The tradeoff is discipline: because nothing forces you forward, it's on you to keep a change focused rather than letting it sprawl. The [Workflows](workflows.md) guide has good habits for that.

## Why this is worth the small overhead

Plain truth: CodeSpec adds a step. You write a short plan before building. So what do you get for it?

- **You catch wrong turns before they cost you.** Fixing a misunderstanding in a one-paragraph proposal is free. Fixing it after the AI wrote 400 lines is not.
- **The plan and the code stay in the same repo.** Six months later, the spec tells you (and the next AI session) why the system works the way it does.
- **Changes are reviewable.** A change folder is a tidy package: read the proposal, skim the deltas, check the tasks. No archaeology through chat history.
- **It fits existing codebases.** Deltas mean you can specify a change to a 50,000-line app without first documenting the whole thing.

And the honest tradeoff: for a truly trivial one-line fix, the ceremony may not pay off, and that's fine. CodeSpec is designed to be lightweight, but it isn't free. Use it where agreement matters, which turns out to be most of the time once you're working with an AI that will confidently build whatever you vaguely asked for.

## Where to go next

- New here? [Getting Started](getting-started.md) walks the first change in full.
- Not sure what to build yet? [Explore First](explore.md) is the place to start.
- Confused about where commands run? [How Commands Work](how-commands-work.md).
- Want the deep version of everything above? [Concepts](concepts.md).
- Learn by example? [Examples & Recipes](examples.md).
- Need a term defined? [Glossary](glossary.md).
