# Getting Started

This guide explains how CodeSpec works after you've installed and initialized it. For installation instructions, see the [main README](../README.md#quick-start) or the [Installation guide](installation.md). New to the whole docs set? The [documentation home](README.md) maps everything.

> **Where do I type these commands?** Two places, and mixing them up is the most common early stumble.
>
> - `codespec ...` commands (like `codespec init`) run in your **terminal**.
> - The three CodeSpec entries run in your **AI assistant's chat**, the same box where you'd ask it to write code.
>
> There's no separate "interactive mode" to start. You just type the slash command in chat and your assistant takes it from there. Full explanation: [How Commands Work](how-commands-work.md).

## Your First Five Minutes

The whole loop, with each step labeled by where it happens:

```text
TERMINAL   $ npm install -g @hrhy-ai/codespec@latest
TERMINAL   $ cd your-project && codespec init
AI CHAT      /codespec:workflow add-dark-mode     (start or continue the Change)
AI CHAT      /codespec:rebase                      (only when the Change is STALE)
AI CHAT      /codespec:archive                     (validate and archive the Change)
```

Two terminal steps to set up, then you live in chat. The rest of this guide unpacks what each step does and what you'll see.

**Don't want to do the terminal part yourself?** Paste the [setup prompt](installation.md#install-with-your-ai-assistant) into your assistant and it handles both lines, then reports what it created.

> **Not sure what to build yet? Start with `/codespec:workflow`.** The workflow entry delegates brainstorming and planning to Superpowers, then routes the approved Change through implementation and verification.

> **Canonical `code-spec` layout.** New workspaces use `business.yaml` and `configuration.yaml` at the CodeSpec root. Each active Change contains exactly `metadata.yaml`, `design.md`, `spec.md`, `tasks.yaml`, and `verification.yaml`. After successful archive, Core updates the current module's `spec.md`, `interface.yaml`, `api.yaml`, the root YAML projections, and removes the active Change; it does not create an archive Change copy or history record. The older Markdown artifact examples below apply only to legacy `spec-driven` workspaces and migration.

## How It Works

CodeSpec helps you and your AI coding assistant agree on what to build before any code is written.

**Default quick path (core profile):**

```text
/codespec:workflow ──► /codespec:rebase (when STALE) ──► /codespec:archive
```

Start with `/codespec:workflow` for every development request. Use `/codespec:rebase` only when Core reports STALE or an unresolved baseline conflict. Use `/codespec:archive` only after implementation and verification pass.

The default `core` profile installs the three public entries. Custom profile
configuration may preserve legacy CLI workflow IDs, but CodeSpec normalizes
them to these entries before generating skills.

## What CodeSpec Creates

After running `codespec init`, your project has this structure:

```
codespec/
├── business.yaml       # Module registry and generated business projections
├── configuration.yaml  # Verification connection snapshot
├── specs/<module>/     # spec.md, interface.yaml, api.yaml
├── changes/<CHG-ID>/   # metadata.yaml, design.md, spec.md, tasks.yaml, verification.yaml
├── changes/index.yaml
├── .transactions/      # Recoverable short-lived archive journals
└── config.yaml
```

**Two key directories:**

- **`specs/`** - The Current Specification. These specs describe how your system currently behaves. Organized by domain (e.g., `specs/auth/`, `specs/payments/`).

- **`changes/`** - Proposed modifications. Each canonical Change gets its own CHG-ID folder. When a Change is complete, its approved typed delta merges into Current Specification through `/codespec:archive`, then the active folder is removed.

## Understanding Artifacts

Each change folder contains artifacts that guide the work:

| Artifact | Purpose |
|----------|---------|
| `metadata.yaml` | Change identity, baseline, approvals, status, and gates |
| `design.md` | Goals, scope, and technical decisions |
| `spec.md` | Readable Requirements, Scenarios, test cases, and engineering-file traceability |
| `tasks.yaml` | Typed implementation tasks, planned files, verification plans, and module deltas |
| `verification.yaml` | Per-test execution evidence and runtime fingerprints |

**Artifacts build on each other:**

```
proposal ──► specs ──► design ──► tasks ──► implement
   ▲           ▲          ▲                    │
   └───────────┴──────────┴────────────────────┘
            update as you learn
```

You can always go back and refine earlier artifacts as you learn more during implementation.

## How Delta Specs Work

Delta specs are the key concept in CodeSpec. They show what's changing relative to your current specs.

### The Format

Delta specs use sections to indicate the type of change:

```markdown
# Delta for Auth

## ADDED Requirements

### Requirement: Two-Factor Authentication
The system MUST require a second factor during login.

#### Scenario: OTP required
- GIVEN a user with 2FA enabled
- WHEN the user submits valid credentials
- THEN an OTP challenge is presented

## MODIFIED Requirements

### Requirement: Session Timeout
The system SHALL expire sessions after 30 minutes of inactivity.
(Previously: 60 minutes)

#### Scenario: Idle timeout
- GIVEN an authenticated session
- WHEN 30 minutes pass without activity
- THEN the session is invalidated

## REMOVED Requirements

### Requirement: Remember Me
(Deprecated in favor of 2FA)
```

### What Happens on Archive

When you archive a canonical `code-spec` Change:

1. Core validates the two approvals, completed tasks, structured verification, relations, and runtime configuration.
2. The transaction projects each current module's `spec.md`, `interface.yaml`, and derived `api.yaml`, and regenerates the root `business.yaml` and `configuration.yaml` snapshots.
3. For a UI Change, Core first starts the real project, waits for configured services, and reruns browser E2E; missing startup/browser data or a failed run blocks archive.
4. After the commit marker is durable, the active Change and index entry are removed. No `test-cases.md` or static graph file is created.

## Example: Your First Change

Let's walk through adding dark mode to an application.

### 1. Start the Change (Default)

```text
You: /codespec:workflow add-dark-mode

AI:  Created codespec/changes/add-dark-mode/
     ✓ proposal.md — why we're doing this, what's changing
     ✓ specs/       — requirements and scenarios
     ✓ design.md    — technical approach
     ✓ tasks.md     — implementation checklist
     Ready for review and implementation!
```

The workflow may call Superpowers brainstorming and writing-plans internally;
there is no second public planning entry.

### 2. What Gets Created

**proposal.md** - Captures the intent:

```markdown
# Proposal: Add Dark Mode

## Intent
Users have requested a dark mode option to reduce eye strain
during nighttime usage.

## Scope
- Add theme toggle in settings
- Support system preference detection
- Persist preference in localStorage

## Approach
Use CSS custom properties for theming with a React context
for state management.
```

**specs/ui/spec.md** - Delta showing new requirements:

```markdown
# Delta for UI

## ADDED Requirements

### Requirement: Theme Selection
The system SHALL allow users to choose between light and dark themes.

#### Scenario: Manual toggle
- GIVEN a user on any page
- WHEN the user clicks the theme toggle
- THEN the theme switches immediately
- AND the preference persists across sessions

#### Scenario: System preference
- GIVEN a user with no saved preference
- WHEN the application loads
- THEN the system's preferred color scheme is used
```

**tasks.md** - Implementation checklist:

```markdown
# Tasks

## 1. Theme Infrastructure
- [ ] 1.1 Create ThemeContext with light/dark state
- [ ] 1.2 Add CSS custom properties for colors
- [ ] 1.3 Implement localStorage persistence

## 2. UI Components
- [ ] 2.1 Create ThemeToggle component
- [ ] 2.2 Add toggle to settings page
- [ ] 2.3 Update Header to include quick toggle

## 3. Styling
- [ ] 3.1 Define dark theme color palette
- [ ] 3.2 Update components to use CSS variables
```

### 3. Implement

```
You: /codespec:workflow

AI:  Working through tasks...
     ✓ 1.1 Created ThemeContext with light/dark state
     ✓ 1.2 Added CSS custom properties to globals.css
     ✓ 1.3 Implemented localStorage persistence
     ✓ 2.1 Created ThemeToggle component
     ...
     All tasks complete; verification evidence recorded.
```

During implementation, if you discover the design needs adjustment, just update the artifact and continue.

### 4. Archive

```
You: /codespec:archive

AI:  Archiving add-dark-mode...
     ✓ Merged the delta into codespec/specs/ui/spec.md
     ✓ Moved to codespec/archive/changes/2025-01-24-add-dark-mode/
     Done! Ready for the next feature.
```

Your delta is now part of Current Specification, documenting how your system works.

## Verifying and Reviewing

Use the CLI to check on your changes:

```bash
# List active changes
codespec list

# View change details
codespec show add-dark-mode

# Validate spec formatting
codespec validate add-dark-mode

# Interactive dashboard
codespec view
```

## Next Steps

- [Explore First](explore.md) - Clarify an idea through Superpowers inside `workflow`
- [Reviewing a Change](reviewing-changes.md) - What to check in the plan the AI drafts, before any code
- [Writing Good Specs](writing-specs.md) - What a strong requirement and scenario look like
- [Using CodeSpec in an Existing Project](existing-projects.md) - Start on a large brownfield codebase
- [Editing & Iterating on a Change](editing-changes.md) - Update artifacts, go back, reconcile manual edits
- [Core Concepts at a Glance](overview.md) - The whole mental model on one page
- [Examples & Recipes](examples.md) - Real changes, start to finish
- [Workflows](workflows.md) - Common patterns and when to use each command
- [Commands](commands.md) - Full reference for all slash commands
- [Concepts](concepts.md) - Deeper understanding of specs, changes, and schemas
- [Customization](customization.md) - Make CodeSpec work your way
- [Stores](stores-beta/user-guide.md) - Planning that spans repos or teams? Keep it in its own repo (beta)
- [FAQ](faq.md) and [Troubleshooting](troubleshooting.md) - When you get stuck
