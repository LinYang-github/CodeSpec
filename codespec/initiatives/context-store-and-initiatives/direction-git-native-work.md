# Git-Native Specs And Work Direction

This note captures the current product direction after the initiative,
workspace, context-store, and multi-repo planning discussion.

The positive shape is:

```text
CodeSpec is a Git-native artifact format for specs and work.

Specs are what is true.
Work is what is in motion.
```

CodeSpec artifacts live as files in Git. That Git repo may be the code repo, a
planning repo, or a contracts repo. CodeSpec should not introduce a separate
authoritative state system outside those files.

## Core Shape

The preferred future shape is:

```text
codespec/
  README.md
  codespec.yml
  specs/
  work/
```

- `specs/` describes accepted behavior.
- `work/` describes intended effort in motion.

This shape should be the same whether the CodeSpec root lives beside code or in
a dedicated planning or contracts repo.

```text
app-repo/
  codespec/
    specs/
    work/

planning-repo/
  codespec/
    specs/
    work/
```

There is no separate product mode for "repo-local", "external", "workspace",
"context store", or "multi-repo" artifacts. The placement choice is simply
which Git repo contains the CodeSpec files.

## Vocabulary

Use a small vocabulary first:

```text
Spec       current accepted behavior
Work       intended effort in motion
Change     work that applies concrete deltas to targets
Initiative work that coordinates or decomposes other work
Target     repo, service, package, path, or system where work lands
```

Users should not need to learn `context store`, `project`, `workspace`,
`artifact home`, or `index` as primary product nouns.

## Domain Terms

Use these terms when explaining the near-term product:

```text
CodeSpec root
  The `codespec/` directory that contains specs, changes, work, and config.

In-project CodeSpec
  CodeSpec initialized inside the project repo it helps describe.

Standalone CodeSpec repo
  A separate Git repo whose main purpose is to hold CodeSpec artifacts.

Target project repo
  A code repo that a change or work item applies to.

Local repo map
  Private local resolution from a target repo id to a checkout path.

Workspace view
  Legacy or beta local-view language. In the new direction, this should reduce
  to a local repo map plus an optional focused CodeSpec root or work item.
```

Examples:

```text
In-project CodeSpec:

app-repo/
  codespec/
    specs/
    changes/

Standalone CodeSpec repo:

app-codespec-repo/
  codespec/
    specs/
    changes/

Target project repo:

app-repo/
  src/
  tests/
```

The product should avoid the term `repo-local` for this distinction. It is too
easy to confuse "CodeSpec lives in this project repo" with "this work targets
this repo."

The product should also avoid making `workspace` a primary user-facing noun.
The job that remains is simpler: map target repo ids to local checkout paths so
agents and commands can assemble the relevant Git repos on this machine.

## Work Is The Primitive

`work/` is one canonical area for units of work at different scales.

```text
codespec/
  specs/
    auth/session-limits.md
  work/
    add-login-rate-limit/
      work.yaml
      proposal.md
      tasks.md
      deltas/
    checkout-modernization/
      work.yaml
      README.md
```

A change is work with change capabilities:

```yaml
id: add-login-rate-limit
kind: change
status: proposed
targets:
  - repo: app
```

An initiative is also work:

```yaml
id: checkout-modernization
kind: initiative
status: active
children:
  - work: add-login-rate-limit
  - work: add-checkout-tax
```

The distinction between a change and an initiative should not come from which
top-level folder the artifact lives in. It should come from metadata and
capabilities:

- Work with targets and deltas can validate and archive those deltas into
  `specs/`.
- Work with children, dependencies, and context can coordinate and roll up other
  work.
- Some work may be both change-shaped and coordination-shaped.

## Git Is The Source Of Truth

CodeSpec should stay Git-native:

- History comes from Git.
- Review uses normal Git and forge workflows.
- Diffs are normal file diffs.
- External planning means another Git repo, not another state system.
- Indexes, dashboards, status rollups, and orchestration are derived views.

Forge-specific status such as pull request state, CI, review approvals, or
merge status may be read by adapters. That status should not become a competing
CodeSpec truth.

## Targets

Filesystem location should not imply implementation target. Work declares where
it lands.

```yaml
targets:
  - repo: api
  - repo: web
```

Targets may later address repos, services, packages, paths, external systems,
or monorepo subtrees. Use plural `targets` in the format early, even if some MVP
lifecycle commands only support one target.

## Nesting And References

The rule is:

```text
Nest within a repo.
Reference across repos.
```

Within one Git repo, work can nest when that is the real relationship:

```text
app-repo/
  codespec/
    work/
      checkout-modernization/
        work.yaml
        work/
          add-login-rate-limit/
```

Across Git repo boundaries, work references other work by stable identity:

```yaml
id: checkout-modernization
kind: initiative
children:
  - repo: api
    work: add-tax-api
  - repo: web
    work: update-checkout-ui
```

This keeps each repo's executable work close to the code it affects while still
allowing a planning or contracts repo to coordinate the larger effort.

Work identity must come from metadata, not from the path. Folder paths can help
humans browse; they should not be the durable identity of the work.

## Dependency And Sequencing

Multi-repo complexity is mostly about sequencing, not folder placement.

CodeSpec should be able to record dependency intent in Git:

```yaml
depends_on:
  - work: publish-tax-contract
```

Future views can answer:

- How does this large effort decompose?
- What has to happen first?
- Which targets are affected?
- Which teams own the slices?
- What surrounding context does an agent need?

The free artifact format should be able to describe ordering and dependencies.
Automation that enforces sequencing, gates merges, or rolls up live forge status
can remain a derived orchestration layer.

## MVP Implication

The immediate release path should keep the current CodeSpec baseline working:

```text
codespec/
  README.md
  codespec.yml
  specs/
  changes/
```

The first mental model is:

```text
Specs = what is true.
Changes = what should change.
```

Near-term work should not require the future `work/` layout. `change` remains
important because a change applies deltas. The `work/` model is the future
layout direction, not a prerequisite for making standalone CodeSpec repos
useful.

## Roadmap

### 1. Preserve The Current Baseline

Keep the existing in-project CodeSpec flow working and understandable:

```text
app-repo/
  codespec/
    specs/
    changes/
```

The first release goal is not to rename everything. It is to make the current
model boring and reliable.

### 2. Make The Placement Choice Explicit

Teach the product language:

```text
CodeSpec can live inside your project repo,
or in its own Git repo.
```

Use:

- `in-project CodeSpec` for `app-repo/codespec/`
- `standalone CodeSpec repo` for `app-codespec-repo/codespec/`

Avoid `repo-local` as the user-facing term for this split.

### 3. Support Standalone CodeSpec Repos

Allow CodeSpec to be initialized and validated in a Git repo that does not hold
application code:

```text
app-codespec-repo/
  codespec/
    specs/
    changes/
```

This should use the same parser, templates, validation, and archive concepts as
in-project CodeSpec. A standalone repo is not a new state system.

### 4. Add Target Project Repo Resolution

Standalone CodeSpec repos need to describe where changes land:

```yaml
targets:
  - repo: app
```

The first slice can keep target resolution simple:

- register local target repos
- validate that referenced targets exist
- report unresolved targets clearly
- let agents know which CodeSpec repo and target repos are involved

Do not clone, branch, sync, orchestrate, or infer complex repo state yet.

This is the simplified successor to the larger workspace-view concept. Existing
workspace beta behavior may remain as compatibility, but new direction should
use local repo mapping as the product shape.

### 5. Add Cross-Repo Context And Doctoring

Once standalone CodeSpec repos can target project repos, add read-oriented
support for relevant context:

- doctor checks for missing target repo mappings
- local path mapping for agents
- read-only references to other CodeSpec repos when needed
- clear output showing which Git repo owns each artifact

Remote Git URL support, pull/push helpers, status dashboards, and sequencing
enforcement can come later.

### 6. Evolve Toward `work/`

After the baseline and standalone repo flow are solid, introduce the future
layout direction:

```text
codespec/
  specs/
  work/
```

At that point:

- existing `changes/` can be supported as legacy or migrated
- changes become change-shaped work
- initiatives become coordination-shaped work
- dependency and sequencing views can build on stable work identity

Do not make `/work` block the standalone CodeSpec repo release.

## Decisions Considered

### Separate `changes/` And `initiatives/`

Rejected as the preferred future shape:

```text
codespec/
  changes/
  initiatives/
```

This uses folders as the type system and makes changes and initiatives feel
artificially unrelated. The cleaner model is one `work/` tree where change and
initiative are shapes of work.

### Initiative-Owned Change Folders

Rejected as canonical storage:

```text
codespec/
  initiatives/
    checkout-modernization/
      changes/
        add-tax-api/
```

This makes initiative ownership look like lifecycle ownership. A larger unit of
work may coordinate a smaller one, but the smaller unit still has its own
identity, targets, deltas, and lifecycle.

### Project Or Repo Buckets As Lifecycle Roots

Rejected as the default:

```text
projects/
  api/
    codespec/
      changes/
  web/
    codespec/
      changes/
```

Repo buckets work when each artifact cleanly belongs to one repo, but they get
awkward for cross-repo work, shared contracts, monorepos, and initiatives that
span several targets. Repos should be targets, not mandatory lifecycle roots.

### Stateful Context Store As Core Primitive

Rejected as the core framing.

A dedicated planning or contracts repo may hold CodeSpec artifacts, but it is
still a Git repo. CodeSpec should not create a separate authoritative store that
can disagree with Git.

### Configurable Layout Modes

Rejected as an MVP product shape.

Custom layout modes force every tool, doc, and agent instruction to branch.
Prefer one opinionated layout and let users choose which Git repo contains it.

### Workspace As A Primary Product Object

Rejected as the new user-facing shape.

The useful part of workspace-view behavior is local resolution: knowing where
the CodeSpec repo and target project repos are checked out on this machine. That
should be treated as a local repo map, not as a planning container, lifecycle
owner, or durable source of truth.

## Supersession Note

This direction supersedes the older product boundary that centered context
stores, collections, initiatives, workspaces, and repo-local changes as separate
primary nouns. Those artifacts remain useful historical context and describe
implemented beta behavior, but new product direction should start from the
Git-native `specs/` and `work/` shape.
