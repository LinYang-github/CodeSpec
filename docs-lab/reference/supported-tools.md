# Supported tools

> Which AI coding tools CodeSpec supports, and each one's command syntax.

Every tool in the matrix runs the same CodeSpec workflows. A skill and its command are
the same workflow instructions. The only difference is what you type. Which form init
installs is the delivery setting, covered in
[Set up your project](../start/setup.md#the-workflow-files-skills-and-commands).

## Support matrix

Invocations are shown for the apply workflow. Every workflow follows the same shape.
The id goes to `codespec init --tools <id>` to skip the picker ([CLI](cli.md)).

| Tool | `--tools` id | Skills | Skill invocation | Commands | Command invocation |
|---|---|---|---|---|---|
| Amazon Q Developer | `amazon-q` | `.amazonq/skills/` | `/codespec-apply-change` | `.amazonq/prompts/` | `@codespec-apply` |
| Antigravity | `antigravity` | `.agents/skills/` | `/codespec-apply-change` | `.agents/workflows/` | `/codespec-apply` |
| Auggie (Augment CLI) | `auggie` | `.augment/skills/` | `/codespec-apply-change` | `.augment/commands/` | `/codespec-apply` |
| Bob Shell | `bob` | `.bob/skills/` | `/codespec-apply-change` | `.bob/commands/` | `/codespec-apply` |
| Claude Code | `claude` | `.claude/skills/` | `/codespec-apply-change` | `.claude/commands/codespec/` | `/codespec:apply` |
| Cline | `cline` | `.cline/skills/` | `/codespec-apply-change` | `.clinerules/workflows/` | `/codespec-apply` |
| CodeArts | `codeartsagent` | `.codeartsdoer/skills/` | `/codespec-apply-change` | none | none |
| CodeBuddy Code (CLI) | `codebuddy` | `.codebuddy/skills/` | `/codespec-apply-change` | `.codebuddy/commands/codespec/` | `/codespec:apply` |
| Codex | `codex` | `.agents/skills/` | `$codespec-apply-change` | none | none |
| Continue | `continue` | `.continue/skills/` | `/codespec-apply-change` | `.continue/prompts/` | `/codespec-apply` |
| CoStrict | `costrict` | `.cospec/skills/` | `/codespec-apply-change` | `.cospec/codespec/commands/` | `/codespec-apply` |
| Crush | `crush` | `.crush/skills/` | `/codespec-apply-change` | `.crush/commands/codespec/` | `/codespec:apply` |
| Cursor | `cursor` | `.cursor/skills/` | `/codespec-apply-change` | `.cursor/commands/` | `/codespec-apply` |
| Devin Desktop (formerly Windsurf) | `devin` | `.devin/skills/` | `/codespec-apply-change` | `.devin/workflows/` | `/codespec-apply` |
| Factory Droid | `factory` | `.factory/skills/` | `/codespec-apply-change` | `.factory/commands/` | `/codespec-apply` |
| ForgeCode | `forgecode` | `.forge/skills/` | `/codespec-apply-change` | none | none |
| Gemini CLI | `gemini` | `.gemini/skills/` | `/codespec-apply-change` | `.gemini/commands/codespec/` | `/codespec:apply` |
| GitHub Copilot | `github-copilot` | `.github/skills/` | `/codespec-apply-change` | `.github/prompts/` | `/codespec-apply` |
| Hermes Agent | `hermes` | `.hermes/skills/` | `/codespec-apply-change` | none | none |
| iFlow | `iflow` | `.iflow/skills/` | `/codespec-apply-change` | `.iflow/commands/` | `/codespec-apply` |
| Junie | `junie` | `.junie/skills/` | `/codespec-apply-change` | `.junie/commands/` | `/codespec-apply` |
| Kilo Code | `kilocode` | `.kilocode/skills/` | `/codespec-apply-change` | `.kilocode/workflows/` | `/codespec-apply` |
| Kimi Code | `kimi` | `.kimi-code/skills/` | `/skill:codespec-apply-change` | none | none |
| Kiro | `kiro` | `.kiro/skills/` | `/codespec-apply-change` | `.kiro/prompts/` | `/codespec-apply` |
| Lingma | `lingma` | `.lingma/skills/` | `/codespec-apply-change` | `.lingma/commands/codespec/` | `/codespec:apply` |
| MiniMax Code | `minimax-code` | `~/.minimax/skills/` (global) | `/codespec-apply-change` | none | none |
| Mistral Vibe | `vibe` | `.vibe/skills/` | `/codespec-apply-change` | none | none |
| Oh My Pi | `oh-my-pi` | `.omp/skills/` | `/codespec-apply-change` | `.omp/commands/` | `/codespec-apply` |
| OpenCode | `opencode` | `.opencode/skills/` | `/codespec-apply-change` | `.opencode/commands/` | `/codespec-apply` |
| Pi | `pi` | `.pi/skills/` | `/codespec-apply-change` | `.pi/prompts/` | `/codespec-apply` |
| Qoder | `qoder` | `.qoder/skills/` | `/codespec-apply-change` | `.qoder/commands/codespec/` | `/codespec:apply` |
| Qwen Code | `qwen` | `.qwen/skills/` | `/codespec-apply-change` | `.qwen/commands/` | `/codespec-apply` |
| Trae | `trae` | `.trae/skills/` | `/codespec-apply-change` | `.trae/commands/` | `/codespec-apply` |
| ZCode | `zcode` | `.zcode/skills/` | `/codespec-apply-change` | `.zcode/commands/codespec/` | `/codespec:apply` |
| Zoo Code | `roocode` | `.roo/skills/` | `/codespec-apply-change` | `.roo/commands/` | `/codespec-apply` |
| Shared `.agents` skills | `agents` | `.agents/skills/` | `/codespec-apply-change` | none | none |

- **Skill invocation**: whether a tool registers skills as typed entries is the tool's
  own behavior. The column shows the spelling CodeSpec uses in generated files and in
  the hint init prints. Check your tool's docs if typing it does nothing.
- **Command file formats**: most tools take `.md` command files. Gemini CLI takes
  `.toml`, Continue `.prompt`, Kiro and GitHub Copilot `.prompt.md`. The spelling you
  type is the same either way.

## Per-tool notes

A tool not listed here behaves exactly as its row reads.

### Antigravity

- **Current folder**: Antigravity v1.20.5 and later read workspace skills and
  workflows from `.agents/`.
- **Legacy folder**: after CodeSpec writes replacements, it removes equivalent
  generated files from `.agent/`. Custom files and changed generated files stay in
  `.agent/` for you to review.
- **Shared skills**: Antigravity shares `.agents/skills/` with Codex, Zed Agent, and
  the `agents` target. CodeSpec writes that skill tree once while still writing
  Antigravity commands to `.agents/workflows/`.

### Cline

Cline reads commands from `.clinerules/workflows/`, not from its `.cline/` folder.
Skills stay in `.cline/skills/`.

### Codex

- **Invocation**: type `$codespec-<skill>`. Codex does not recognize the
  `/codespec-<skill>` form ([upstream issue](https://github.com/openai/codex/issues/11817)).
- **No command files**: Codex runs skills directly, so init skips commands even when
  delivery includes them and prints `Commands skipped for: codex (uses skills)`.
- **Shared folder**: Codex skills land in `.agents/skills/`, the same tree Antigravity,
  Zed Agent, and the `agents` target use. Selecting more than one keeps a single
  compatible tree, and its handoffs spell both `$codespec-*` and `/codespec-*` when
  Codex owns it.
- **Legacy path**: skills installed under `.codex/skills/` by older versions are
  migrated on the next `codespec update`.

### Devin Desktop (formerly Windsurf)

- **Two agents**: command files in `.devin/workflows/` work only in Devin Desktop.
  Devin Local runs skills only, so generated skills reference `/codespec-<skill>`,
  which works in both.
- **Rename**: `--tools windsurf` still resolves to `devin`. A project holding
  CodeSpec files in the legacy `.windsurf/` folder is offered the move on the next
  `codespec update`.

### GitHub Copilot

Prompt files register as slash commands in the Copilot IDE extensions (VS Code,
JetBrains, Visual Studio). Copilot CLI does not read `.github/prompts/`.

### Hermes Agent

Hermes loads skills only from `~/.hermes/skills/` by default. Add the project's
`.hermes/skills/` folder to `skills.external_dirs` in `~/.hermes/config.yaml`;
init prints this reminder after install.

### MiniMax Code

- **Global only**: skills go to `~/.minimax/skills/`. Nothing is written inside
  the repo.
- **Safe across projects**: a commands-only delivery leaves the global skills in
  place, so one project's setting cannot remove skills another project uses.

### Shared `.agents` skills

- **When it fits**: any tool that reads the shared `.agents/skills/` folder,
  including tools with no row in the matrix.
- **Alongside other targets**: Antigravity, Codex, Zed Agent, and this target share
  one physical skill tree. CodeSpec records one writer in `.codespec-target` and
  writes the tree once per run. Each tool's separate command files are still
  generated.
- **What CodeSpec claims**: only the `codespec-*` folders and the
  `.codespec-target` marker. Anything else under `.agents/` is left alone.
- **`AGENTS.md`**: not created or edited. The target is the `.agents/` folder, not
  the file.
