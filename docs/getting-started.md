# Getting Started

This guide explains how OpenSpec works after you've installed and initialized it. For installation instructions, see the [main README](../README.md#quick-start) or the [Installation guide](installation.md). New to the whole docs set? The [documentation home](README.md) maps everything.

> **Where do I type these commands?** Two places, and mixing them up is the most common early stumble.
>
> - `openspec ...` commands (like `openspec init`) run in your **terminal**.
> - The three OpenSpec entries run in your **AI assistant's chat**, the same box where you'd ask it to write code.
>
> There's no separate "interactive mode" to start. You just type the slash command in chat and your assistant takes it from there. Full explanation: [How Commands Work](how-commands-work.md).

## Your First Five Minutes

The whole loop, with each step labeled by where it happens:

```text
TERMINAL   $ npm install -g @fission-ai/openspec@latest
TERMINAL   $ cd your-project && openspec init
AI CHAT      /opsx:workflow add-dark-mode     (start or continue the Change)
AI CHAT      /opsx:rebase                      (only when the Change is STALE)
AI CHAT      /opsx:archive                     (validate and archive the Change)
```

Two terminal steps to set up, then you live in chat. The rest of this guide unpacks what each step does and what you'll see.

**Don't want to do the terminal part yourself?** Paste the [setup prompt](installation.md#install-with-your-ai-assistant) into your assistant and it handles both lines, then reports what it created.

> **Not sure what to build yet? Start with `/opsx:workflow`.** The workflow entry delegates brainstorming and planning to Superpowers, then routes the approved Change through implementation and verification.

## How It Works

OpenSpec helps you and your AI coding assistant agree on what to build before any code is written.

**Default quick path (core profile):**

```text
/opsx:workflow ──► /opsx:rebase (when STALE) ──► /opsx:archive
```

Start with `/opsx:workflow` for every development request. Use `/opsx:rebase` only when Core reports STALE or an unresolved baseline conflict. Use `/opsx:archive` only after implementation and verification pass.

The default `core` profile installs the three public entries. Custom profile
configuration may preserve legacy CLI workflow IDs, but OpenSpec normalizes
them to these entries before generating skills.

## What OpenSpec Creates

After running `openspec init`, your project has this structure:

```
openspec/
├── archive/specs/      # Current Specification (system behavior)
│   └── <domain>/
│       └── spec.md
├── changes/            # Proposed updates (one folder per change)
│   └── <change-name>/
│       ├── proposal.md
│       ├── design.md
│       ├── tasks.md
│       ├── spec.md     # Requirement deltas (what's changing)
│       └── verification.md
└── config.yaml         # Project configuration (optional)
```

**Two key directories:**

- **`archive/specs/`** - The Current Specification. These specs describe how your system currently behaves. Organized by domain (e.g., `archive/specs/auth/`, `archive/specs/payments/`).

- **`changes/`** - Proposed modifications. Each Change gets its own folder with all related artifacts. When a Change is complete, its delta merges into Current Specification through `/opsx:archive`.

## Understanding Artifacts

Each change folder contains artifacts that guide the work:

| Artifact | Purpose |
|----------|---------|
| `proposal.md` | The "why" and "what" - captures intent, scope, and approach |
| `specs/` | Delta specs showing ADDED/MODIFIED/REMOVED requirements |
| `design.md` | The "how" - technical approach and architecture decisions |
| `tasks.md` | Implementation checklist with checkboxes |

**Artifacts build on each other:**

```
proposal ──► specs ──► design ──► tasks ──► implement
   ▲           ▲          ▲                    │
   └───────────┴──────────┴────────────────────┘
            update as you learn
```

You can always go back and refine earlier artifacts as you learn more during implementation.

## How Delta Specs Work

Delta specs are the key concept in OpenSpec. They show what's changing relative to your current specs.

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

When you archive a change:

1. **ADDED** requirements are appended to the main spec
2. **MODIFIED** requirements replace the existing version
3. **REMOVED** requirements are deleted from the main spec

The Change folder moves to `openspec/archive/changes/` for audit history.

## Example: Your First Change

Let's walk through adding dark mode to an application.

### 1. Start the Change (Default)

```text
You: /opsx:workflow add-dark-mode

AI:  Created openspec/changes/add-dark-mode/
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
You: /opsx:workflow

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
You: /opsx:archive

AI:  Archiving add-dark-mode...
     ✓ Merged the delta into openspec/archive/specs/ui/spec.md
     ✓ Moved to openspec/archive/changes/2025-01-24-add-dark-mode/
     Done! Ready for the next feature.
```

Your delta is now part of Current Specification, documenting how your system works.

## Verifying and Reviewing

Use the CLI to check on your changes:

```bash
# List active changes
openspec list

# View change details
openspec show add-dark-mode

# Validate spec formatting
openspec validate add-dark-mode

# Interactive dashboard
openspec view
```

## Next Steps

- [Explore First](explore.md) - Clarify an idea through Superpowers inside `workflow`
- [Reviewing a Change](reviewing-changes.md) - What to check in the plan the AI drafts, before any code
- [Writing Good Specs](writing-specs.md) - What a strong requirement and scenario look like
- [Using OpenSpec in an Existing Project](existing-projects.md) - Start on a large brownfield codebase
- [Editing & Iterating on a Change](editing-changes.md) - Update artifacts, go back, reconcile manual edits
- [Core Concepts at a Glance](overview.md) - The whole mental model on one page
- [Examples & Recipes](examples.md) - Real changes, start to finish
- [Workflows](workflows.md) - Common patterns and when to use each command
- [Commands](commands.md) - Full reference for all slash commands
- [Concepts](concepts.md) - Deeper understanding of specs, changes, and schemas
- [Customization](customization.md) - Make OpenSpec work your way
- [Stores](stores-beta/user-guide.md) - Planning that spans repos or teams? Keep it in its own repo (beta)
- [FAQ](faq.md) and [Troubleshooting](troubleshooting.md) - When you get stuck
