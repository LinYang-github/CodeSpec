# How Commands Work

**The one thing to know: CodeSpec has two kinds of commands, and they run in two different places.**

- `codespec ...` commands run in your **terminal**. (Example: `codespec init`.)
- The three CodeSpec entries run in your **AI assistant's chat**. (Example: `/codespec:workflow`.)

If you ever type `/codespec:workflow` into your terminal and nothing happens, this page is why. You are talking to the wrong half of CodeSpec. AI entries are not terminal commands. They are instructions you give to your AI coding assistant, in the same chat box where you'd normally type "add a login form."

That single distinction is the most common stumbling block for new users, so let's make it crystal clear.

## The two halves

CodeSpec is one project wearing two hats.

**The CLI (terminal half).** A program named `codespec` that you install and run from your shell. It sets up your project, lists and validates changes, shows a dashboard, and archives finished work. You type these into iTerm, the VS Code terminal, PowerShell, anywhere you'd run `git` or `npm`.

```bash
codespec init        # set up CodeSpec in this project
codespec list        # see active changes
codespec view        # open the interactive dashboard
```

**The AI entries (chat half).** The public entries `workflow`, `rebase`, and `archive` that you type into your AI assistant. Core performs domain governance. Superpowers performs brainstorming, planning, TDD, debugging, verification, and review.

```text
/codespec:workflow add-dark-mode   (typed in your AI chat)
/codespec:rebase                   (typed in your AI chat when STALE)
/codespec:archive                  (typed in your AI chat)
```

Here's the mental model in one picture:

```text
        YOUR TERMINAL                         YOUR AI ASSISTANT'S CHAT
   ┌──────────────────────┐               ┌──────────────────────────────┐
   │  $ codespec init     │   installs    │  /codespec:workflow add-dark-mode │
   │  $ codespec list     │  ──────────►  │  /codespec:rebase                  │
   │  $ codespec view     │   commands    │  /codespec:archive                │
   └──────────────────────┘    & skills   └──────────────────────────────┘
        run codespec here                       run /codespec:* here
```

Notice the arrow. Running `codespec init` in your terminal is what *installs* the slash commands into your AI tool. The terminal half sets up the chat half. After that, day-to-day driving mostly happens in chat.

## "How do I start interactive mode?"

**There is no separate interactive mode to start.** This question comes up a lot, so it deserves a plain answer.

You don't enter a special CodeSpec mode. You just open your AI coding assistant like you always do, and type a slash command into the chat. The slash command *is* how you "enter" CodeSpec. Your assistant recognizes it, loads the matching CodeSpec skill, and starts following the workflow.

So the real instructions are:

1. Open your AI coding assistant (Claude Code, Cursor, Devin Desktop, and so on) in your project.
2. Type `/codespec:workflow` in its chat, the same place you type any other request.
3. Watch the autocomplete: if CodeSpec is installed, you'll see the tool-specific forms of `workflow`, `rebase`, and `archive` as you type.

That's it. No mode to toggle, no daemon to launch, no separate window.

One thing that *is* genuinely interactive lives in the terminal: `codespec view`. It opens a dashboard for browsing your specs and changes. But that's a viewer, not the thing you propose and build with. The building happens through slash commands in chat.

## Why this split exists

It's worth understanding, because it explains why CodeSpec works with 30+ different AI tools.

The CLI is the **engine**. It knows the rules: what a change folder looks like, which artifacts depend on which, how to merge a delta spec into your source of truth. It's the same everywhere.

The AI entries are the **steering wheel**, and every AI tool has a slightly different spelling. When you run `codespec init`, CodeSpec generates the right kind of file for each tool you selected.

The strength of this design: you learn the workflow once and carry it across tools. The tradeoff: the exact syntax of a command can differ slightly between tools, which is the next section.

## Slash command syntax by tool

The intent is identical everywhere. The spelling follows the file your tool loads.

| Your tool's command file | How you type it | Example tools |
|--------------------------|-----------------|---------------|
| `.../commands/codespec/<id>.*` | `/codespec:workflow` | Claude Code, Gemini CLI, Crush |
| `.../codespec-<id>.*` | `/codespec-workflow` | Cursor, GitHub Copilot (IDE), Devin Desktop, Trae, Oh My Pi |
| `.amazonq/prompts/codespec-<id>.md` | `@codespec-workflow` | Amazon Q Developer |
| none — skills only | `/codespec-workflow` | CodeArts, ForgeCode, Hermes, Mistral Vibe, Zed Agent, shared `.agents` |
| none — Kimi Code | `/skill:codespec-workflow` | Kimi Code |
| none — Codex CLI | `$codespec-workflow` | Codex |

Devin is the one tool that spans two rows. Devin Desktop reads
`.devin/workflows/`, while Devin Local uses the generated skill form. Both
forms expose the same three public entries; use the invocation printed by
`codespec init` for the tool you selected.

Every tool is listed in [How To Invoke](supported-tools.md#how-to-invoke) — that
table is the authoritative one. Two rows are not slash commands at all: Amazon Q
loads its files into a prompt library invoked with `@`, and the skills-only rows
use the public skill name directly.

When in doubt, read the "Getting started" line `codespec init` printed: it already
uses the form your tools registered. Typing a slash and watching the autocomplete
works too, for the tools that surface slash commands at all.

## How the commands got there: skills and commands

When you run `codespec init` (or `codespec update`), CodeSpec writes small files into your project so your AI tool can find the workflow. Depending on your tool and settings, these are **skills**, **commands**, or both.

- **Skills** live in places like `.claude/skills/codespec-*/SKILL.md`. They're the emerging cross-tool standard: a folder of instructions your assistant auto-detects.
- **Commands** live in places like `.cursor/commands/codespec-<id>.md` or `.claude/commands/codespec/<id>.md` — the layout is the tool's, and it decides how you type the command. They're the older per-tool slash command files. Codex does not get generated command files; use `.agents/skills/codespec-*`.

You don't have to care which one your tool uses. You just type the slash command and it works. But knowing these files exist helps when something goes wrong: if your commands vanish, it usually means these files are missing or stale, and `codespec update` regenerates them.

See [Supported Tools](supported-tools.md) for the exact paths per tool, and [Migration Guide](migration-guide.md) for how skills replaced the older command-only approach.

## Confirming it's installed

Quick checks, fastest first:

1. **Type a slash in your AI chat.** Start typing `/codespec` and watch for autocomplete suggestions. If they appear, you're set. On a skills-only tool (Codex, Kimi Code, CodeArts, ForgeCode, Hermes, Mistral Vibe, Zed Agent, or the shared `.agents` target) `/codespec` never completes even on a healthy install — try the skill name from the table above instead.
2. **Look for the files.** For Claude Code, check that `.claude/skills/` contains `codespec-*` folders. Other tools use their own directories ([Supported Tools](supported-tools.md) lists them).
3. **Re-run setup.** From your project root, run `codespec update`. This regenerates the skill and command files for whatever tools you configured.
4. **Restart your assistant.** Many tools scan for skills and commands at startup, so a fresh window can be the missing step.

## Which commands do I even have?

By default, CodeSpec installs the three public entries: `workflow`, `rebase`, and `archive`. `workflow` is the normal development entry. `rebase` is for STALE or conflicts. `archive` is the only Current Specification write boundary.

For what each command does in detail, see [Commands](commands.md). For when to reach for which, see [Workflows](workflows.md).

## A clean first run

Putting it together, here is the whole sequence with each step labeled by where it happens.

```text
TERMINAL   $ npm install -g @hrhy-ai/codespec@latest
TERMINAL   $ cd your-project
TERMINAL   $ codespec init
              (installs slash commands into your AI tool)

AI CHAT      /codespec:workflow add-dark-mode
              (Core and Superpowers route the Change)

AI CHAT      /codespec:rebase
              (only when Core reports STALE or a conflict)

AI CHAT      /codespec:archive
              (change is merged into your specs and filed away)
```

Two terminal steps to set up. Then you live in chat. That's the rhythm.

## Related

- [Getting Started](getting-started.md): the full first-change walkthrough
- [Commands](commands.md): every slash command in detail
- [CLI](cli.md): every terminal command in detail
- [Supported Tools](supported-tools.md): per-tool syntax and file locations
- [FAQ](faq.md): more quick answers
- [Troubleshooting](troubleshooting.md): fixes when commands don't show up
