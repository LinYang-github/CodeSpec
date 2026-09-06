# Supported Tools

CodeSpec works with many AI coding assistants. When you run `codespec init`, CodeSpec configures selected tools using your active profile/workflow selection and delivery mode.

## How It Works

For each selected tool, CodeSpec can install:

1. **Skills** (if delivery includes skills): `.../skills/codespec-*/SKILL.md`
2. **Commands** (if delivery includes commands): tool-specific `codespec-*` command files

Codex is skills-only: CodeSpec installs `.agents/skills/codespec-*/SKILL.md` for Codex even when delivery is set to `commands`, and it does not generate Codex custom prompt files. Existing CodeSpec-managed skills under the legacy `.codex/skills` path are reconciled after their replacements are written; custom and divergent files are preserved.

By default, CodeSpec uses the `core` profile, which installs three public
entries: `workflow`, `rebase`, and `archive`. Core operations and engineering
methods run inside those entries.

## How To Invoke

These docs use `/codespec:workflow` as the canonical example, but each tool spells it the
way it loads the file CodeSpec wrote. Find your tool's command path in the
[Tool Directory Reference](#tool-directory-reference) below, then match its shape here.

| Command file CodeSpec writes | You type | Tools |
|------------------------------|----------|-------|
| `.../commands/codespec/<id>.*` — an `codespec/` folder namespaces it | `/codespec:<id>` | Claude Code, CodeBuddy, Crush, Gemini CLI, Lingma, Qoder, ZCode |
| `.../codespec-<id>.*` — the filename is the command | `/codespec-<id>` | Every other tool with generated command files, except Amazon Q and Devin |
| `.devin/workflows/codespec-<id>.md` — read by only one of Devin's two agents | `/codespec-<id>` on Devin Desktop, `/codespec-<skill>` on Devin Local | Devin Desktop\*\*\*\* |
| `.amazonq/prompts/codespec-<id>.md` — a prompt, not a command | `@codespec-<id>` | Amazon Q Developer |
| none — skills only | `/codespec-<skill>` | CodeArts, ForgeCode, Hermes, MiniMax Code, Mistral Vibe, Zed Agent, shared `.agents` |
| none — Kimi Code | `/skill:codespec-<skill>` | Kimi Code |
| none — Codex CLI | `$codespec-<skill>` | Codex ([`/codespec-<skill>` is not recognized](https://github.com/openai/codex/issues/11817)) |

So `/codespec:workflow` is `/codespec-workflow` in Cursor, `@codespec-workflow` in Amazon Q,
and `$codespec-workflow` in Codex. The same tool-specific spelling applies to
`rebase` and `archive`.

Two things vary independently, which is why the rows do not collapse:

- **The name.** Rows 1–2 differ only in how the file names the command, and the
  `codespec-<id>` / `codespec:<id>` stem is the same for every tool with generated
  command files.
- **The wrapper.** Amazon Q loads its files into a prompt library invoked with
  `@`. Skills-only tools generate no command files at all, so their last three
  rows use *skill* names — listed under
  [Generated Skill Names](#generated-skill-names) — which do not map one-to-one
onto the public entries (`/codespec:workflow` is the `codespec-workflow` skill).

The command path patterns above are extension-neutral (`.*`) on purpose: the
extension is the tool's (`.toml` for Gemini CLI, `.prompt` for Continue,
`.prompt.md` for Kiro and GitHub Copilot), and a few tools show the name with
its extension in the picker. Match the directory shape, not the extension.

The files CodeSpec generates, and the "Getting started" hint printed after setup,
already use the right form for the tools you selected — so the fastest answer is
to read the hint.

## Tool Directory Reference

| Tool (ID) | Skills path pattern | Command path pattern |
|-----------|---------------------|----------------------|
| Amazon Q Developer (`amazon-q`) | `.amazonq/skills/codespec-*/SKILL.md` | `.amazonq/prompts/codespec-<id>.md` |
| Antigravity (`antigravity`) | `.agent/skills/codespec-*/SKILL.md` | `.agent/workflows/codespec-<id>.md` |
| Auggie (`auggie`) | `.augment/skills/codespec-*/SKILL.md` | `.augment/commands/codespec-<id>.md` |
| IBM Bob Shell (`bob`) | `.bob/skills/codespec-*/SKILL.md` | `.bob/commands/codespec-<id>.md` |
| Claude Code (`claude`) | `.claude/skills/codespec-*/SKILL.md` | `.claude/commands/codespec/<id>.md` |
| Cline (`cline`) | `.cline/skills/codespec-*/SKILL.md` | `.clinerules/workflows/codespec-<id>.md` |
| Command Code (`command-code`) | `.commandcode/skills/codespec-*/SKILL.md` | `.commandcode/commands/codespec-<id>.md` |
| CodeArts (`codeartsagent`) | `.codeartsdoer/skills/codespec-*/SKILL.md` | Not generated (no command adapter; use skill-based `/codespec-*` invocations) |
| CodeBuddy (`codebuddy`) | `.codebuddy/skills/codespec-*/SKILL.md` | `.codebuddy/commands/codespec/<id>.md` |
| Codex (`codex`) | `.agents/skills/codespec-*/SKILL.md` | Not generated (skills-only; use `$codespec-*`) |
| Devin Desktop, formerly Windsurf (`devin`) | `.devin/skills/codespec-*/SKILL.md` | `.devin/workflows/codespec-<id>.md`\*\*\*\* |
| ForgeCode (`forgecode`) | `.forge/skills/codespec-*/SKILL.md` | Not generated (no command adapter; use skill-based `/codespec-*` invocations) |
| Continue (`continue`) | `.continue/skills/codespec-*/SKILL.md` | `.continue/prompts/codespec-<id>.prompt` |
| CoStrict (`costrict`) | `.cospec/skills/codespec-*/SKILL.md` | `.cospec/codespec/commands/codespec-<id>.md` |
| Crush (`crush`) | `.crush/skills/codespec-*/SKILL.md` | `.crush/commands/codespec/<id>.md` |
| Cursor (`cursor`) | `.cursor/skills/codespec-*/SKILL.md` | `.cursor/commands/codespec-<id>.md` |
| Factory Droid (`factory`) | `.factory/skills/codespec-*/SKILL.md` | `.factory/commands/codespec-<id>.md` |
| Gemini CLI (`gemini`) | `.gemini/skills/codespec-*/SKILL.md` | `.gemini/commands/codespec/<id>.toml` |
| GitHub Copilot (`github-copilot`) | `.github/skills/codespec-*/SKILL.md` | `.github/prompts/codespec-<id>.prompt.md`\*\* |
| Hermes Agent (`hermes`) | `.hermes/skills/codespec-*/SKILL.md`\*\*\* | Not generated (no command adapter; use skill-based `/codespec-*` invocations) |
| iFlow (`iflow`) | `.iflow/skills/codespec-*/SKILL.md` | `.iflow/commands/codespec-<id>.md` |
| Junie (`junie`) | `.junie/skills/codespec-*/SKILL.md` | `.junie/commands/codespec-<id>.md` |
| Kilo Code (`kilocode`) | `.kilocode/skills/codespec-*/SKILL.md` | `.kilocode/workflows/codespec-<id>.md` |
| Kimi Code (`kimi`) | `.kimi-code/skills/codespec-*/SKILL.md` | Not generated (no command adapter; use skill-based `/skill:codespec-*` invocations) |
| Kiro (`kiro`) | `.kiro/skills/codespec-*/SKILL.md` | `.kiro/prompts/codespec-<id>.prompt.md` |
| Lingma (`lingma`) | `.lingma/skills/codespec-*/SKILL.md` | `.lingma/commands/codespec/<id>.md` |
| MiniMax Code (`minimax-code`) | `~/.minimax/skills/codespec-*/SKILL.md` | Not generated (no command adapter; use MiniMax Code skills) |
| Mistral Vibe (`vibe`) | `.vibe/skills/codespec-*/SKILL.md` | Not generated (no command adapter; use skill-based `/codespec-*` invocations) |
| Oh My Pi (`oh-my-pi`) | `.omp/skills/codespec-*/SKILL.md` | `.omp/commands/codespec-<id>.md` |
| OpenCode (`opencode`) | `.opencode/skills/codespec-*/SKILL.md` | `.opencode/commands/codespec-<id>.md` |
| Pi (`pi`) | `.pi/skills/codespec-*/SKILL.md` | `.pi/prompts/codespec-<id>.md` |
| Qoder (`qoder`) | `.qoder/skills/codespec-*/SKILL.md` | `.qoder/commands/codespec/<id>.md` |
| Qwen Code (`qwen`) | `.qwen/skills/codespec-*/SKILL.md` | `.qwen/commands/codespec-<id>.md` |
| [Rovo Dev CLI](https://support.atlassian.com/rovo/docs/use-rovo-dev-cli/) (`rovodev`) | `.rovodev/skills/codespec-*/SKILL.md` | Not generated. Rovo has no slash-command surface. Ask it to use the `codespec-workflow` skill; `/skills` only manages skills. |
| [Zoo Code](https://github.com/Zoo-Code-Org/Zoo-Code) (`roocode`) | `.roo/skills/codespec-*/SKILL.md` | `.roo/commands/codespec-<id>.md` |
| Trae (`trae`) | `.trae/skills/codespec-*/SKILL.md` | `.trae/commands/codespec-<id>.md` |
| [Zed Agent](https://zed.dev/docs/ai/skills) (`zed`) | `.agents/skills/codespec-*/SKILL.md` | Not generated (skills-only; use `/codespec-*` or `@codespec-*`) |
| ZCode (`zcode`) | `.zcode/skills/codespec-*/SKILL.md` | `.zcode/commands/codespec/<id>.md` |
| Shared `.agents` skills (`agents`) | `.agents/skills/codespec-*/SKILL.md` | Not generated (no command adapter; use skill-based `/codespec-*` invocations) |

\*\* GitHub Copilot prompt files are recognized as custom slash commands in IDE extensions (VS Code, JetBrains, Visual Studio). Copilot CLI does not currently consume `.github/prompts/*.prompt.md` directly. Selecting `github-copilot` can also set up the GitHub-hosted **cloud coding agent** — see [GitHub Copilot cloud coding agent](#github-copilot-cloud-coding-agent) below.

\*\*\* Hermes loads skills from `~/.hermes/skills/` by default. To use project-local CodeSpec skills, add the project `.hermes/skills/` directory to `skills.external_dirs` in `~/.hermes/config.yaml`; Hermes then exposes skills with user-facing slash invocations such as `/codespec-workflow`.

\*\*\*\* Windsurf was [rebranded to Devin Desktop](https://docs.devin.ai/desktop/devin-desktop-faq) on June 2, 2026, and its config directory moved: `.devin/` is the preferred read + write location, `.windsurf/` a legacy read-only fallback. CodeSpec follows the rename — the tool id is `devin`, and `--tools windsurf` still resolves to it so existing setup scripts keep working. A project still holding CodeSpec files in `.windsurf/` is offered the move on the next `codespec update`; declining leaves them in place, and files you wrote yourself are never touched. Workflows are invoked by filename, so `.devin/workflows/codespec-apply.md` is `/codespec-apply`. The [Devin Local agent does not support workflows](https://docs.devin.ai/desktop/devin-local) — only skills, and it does not read `.windsurf/` at all — so whenever CodeSpec writes Devin skills it keeps their bodies, and the getting-started hint, on `/codespec-*` skill invocations, which work on both agents. Under commands-only delivery no skills are written and both fall back to `/codespec-*`.

MiniMax Code is a global skills-only integration. CodeSpec writes only its
`codespec-*` directories under `~/.minimax/skills/`; it does not create
repo-local `.minimax` or `.mavis` directories. Commands-only delivery leaves
existing global MiniMax Code skills untouched so one project's delivery setting
cannot remove skills used by another project.

### GitHub Copilot cloud coding agent

GitHub's [Copilot coding agent](https://docs.github.com/en/copilot/using-github-copilot/coding-agent) runs on GitHub in a GitHub Actions environment — separate from Copilot in your editor. CodeSpec can set it up to use the CodeSpec CLI by generating two files:

- `.github/workflows/copilot-setup-steps.yml` — installs `@hrhy-ai/codespec` in the agent's environment
- `.github/agents/codespec.agent.md` — tells the agent how to drive CodeSpec

Because this writes a GitHub Actions workflow into your repository, it is **opt-in**:

| How | Behavior |
|-----|----------|
| `codespec init` (interactive) | Asks whether to set up cloud files. Default is **No**. |
| `codespec init --copilot-cloud` | Sets them up without prompting (for scripts/CI). |
| `codespec init --no-copilot-cloud` | Skips them without prompting, and removes any previously generated ones. |
| `codespec update` | Never prompts. Refreshes the files only if you opted in (or the project already has them). If you opted out, it removes CodeSpec-managed cloud files. |

Your choice is saved in `codespec/config.yaml` as `githubCopilot.cloudAgent: true|false`, so non-interactive updates honor it. CodeSpec only ever writes or removes files whose content it generated — if you customize `copilot-setup-steps.yml` or `codespec.agent.md`, or already have your own, it is left untouched (and `init`/`update` tell you so).

### When to pick the shared `.agents` target

`agents` is the vendor-neutral option: it writes skills to `.agents/skills/`, the
shared root many agent tools read, instead of a tool-specific directory.

| Situation | Pick |
|-----------|------|
| Your tool has its own row above | Its own ID — you get that tool's integration, including slash commands where it supports them |
| Several agents on one repo, all reading `.agents/skills` | `agents` — one skill tree instead of one per tool |
| Your tool isn't listed yet but reads `.agents/skills` | `agents` |

Selecting it alongside a tool-specific ID is fine; each normally writes to its
own root. Codex and Zed Agent are the exceptions because they use the same canonical
`.agents` root. If Codex is selected with Zed or `agents`, CodeSpec keeps one
Codex-led tree. Its handoffs name both `$codespec-*` for Codex and
`/codespec-*` for other agents, so `--tools all` and existing multi-agent
setups keep working without two writers overwriting the same files.
CodeSpec also offers it automatically once a project has a `.agents/skills/`
directory — a bare `.agents/` is not enough, since tools use that root for rules
and subagent definitions too. Note `.agents` is not `.agent`: the singular
directory belongs to Antigravity.

Two things to know:

- **Skills only.** No command adapter exists, so no `codespec-*` command files are
  written; with a commands-inclusive delivery mode `codespec init` lists `agents`
  among the tools it reports under `Commands skipped for: … (no adapter)`.
  Invoke the workflows by skill name —
  most assistants that read `.agents/skills` spell that `/codespec-workflow`, the form
  CodeSpec's setup hint prints. The target is vendor-neutral, so check your
  assistant's own docs if it uses another form.
- **No `AGENTS.md` is created or edited.** The target is the `.agents/` directory.
  If your root `AGENTS.md` still carries CodeSpec marker blocks from an older
  version, `codespec update` strips them — see the [Migration Guide](migration-guide.md).

Zed support here is for the built-in Zed Agent. Zed External Agents and Terminal
Threads use their own integrations. Agent Skills require
[Zed v1.4.2](https://github.com/zed-industries/zed/releases/tag/v1.4.2) or newer.
Project-local skills are unavailable in an untrusted worktree until you
[grant trust](https://zed.dev/docs/worktree-trust).

Because `.agents/skills/` is shared by Codex, Zed Agent, and the vendor-neutral target,
it is worth knowing what CodeSpec claims there:
it writes, refreshes, and removes only the `codespec-*` skill directories for your
selected workflows, plus an `.codespec-target` marker that records whether Codex,
Zed Agent, or the vendor-neutral target rendered that shared tree. Anything else in that
directory is left alone. Treat the `codespec-*` names and marker as CodeSpec's —
edits inside them are replaced on the next `codespec update`, the same as for
every other tool.

For pre-marker projects, CodeSpec infers ownership from managed skill references:
`$codespec-*` means Codex and `/codespec-*` means the vendor-neutral target. A
generic canonical tree alongside legacy `.codex/skills` is treated as an older
dual-target install and consolidated into the compatible shared tree.

`codespec update` honors this ownership too. If a project owns `.agents` as the
vendor-neutral target and a leftover Codex install is detected only from stray
prompt files, the update leaves the established `agents` tree in place instead of
rewriting it with Codex syntax, and preserves those legacy prompt files rather
than deleting them. To hand the shared tree to Codex, run `codespec init --tools
codex` explicitly.

## Non-Interactive Setup

For CI/CD or scripted setup, use `--tools` (and optionally `--profile`):

```bash
# Configure specific tools
codespec init --tools claude,cursor

# Configure all supported tools
codespec init --tools all

# Skip tool configuration
codespec init --tools none

# Override profile for this init run
codespec init --profile core
```

**Available tool IDs (`--tools`)** — `windsurf` is also accepted, as an alias for `devin`: `amazon-q`, `antigravity`, `auggie`, `bob`, `claude`, `cline`, `command-code`, `codeartsagent`, `codex`, `devin`, `forgecode`, `codebuddy`, `continue`, `costrict`, `crush`, `cursor`, `factory`, `gemini`, `github-copilot`, `hermes`, `iflow`, `junie`, `kilocode`, `kimi`, `kiro`, `lingma`, `minimax-code`, `vibe`, `oh-my-pi`, `opencode`, `pi`, `qoder`, `qwen`, `roocode`, `trae`, `zed`, `zcode`, `agents`

## Workflow-Dependent Installation

CodeSpec installs workflow artifacts based on selected workflows:

- **Core profile (default):** `propose`, `explore`, `apply`, `update`, `sync`, `archive`
- **Custom selection:** any subset of all workflow IDs:
  `propose`, `explore`, `new`, `continue`, `apply`, `update`, `ff`, `sync`, `archive`, `bulk-archive`, `verify`, `onboard`

In other words, skill/command counts are profile-dependent and delivery-dependent, not fixed.

## Generated Skill Names

When selected by profile/workflow config, CodeSpec generates these skills:

- `codespec-workflow`
- `codespec-rebase-change`
- `codespec-archive-change`

See [Commands](commands.md) for command behavior and [CLI](cli.md) for `init`/`update` options.

## Related

- [CLI Reference](cli.md) — Terminal commands
- [Commands](commands.md) — Slash commands and skills
- [Getting Started](getting-started.md) — First-time setup
