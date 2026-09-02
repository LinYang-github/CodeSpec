<p align="center">
  <a href="https://github.com/Fission-AI/OpenSpec">
    <picture>
      <source srcset="assets/openspec_bg.png">
      <img src="assets/openspec_bg.png" alt="OpenSpec logo">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://github.com/Fission-AI/OpenSpec/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Fission-AI/OpenSpec/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://www.npmjs.com/package/@fission-ai/openspec"><img alt="npm version" src="https://img.shields.io/npm/v/@fission-ai/openspec?style=flat-square" /></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" /></a>
  <a href="https://discord.gg/YctCnvvshC"><img alt="Discord" src="https://img.shields.io/discord/1411657095639601154?style=flat-square&logo=discord&logoColor=white&label=Discord&suffix=%20online" /></a>
</p>

<details>
<summary><strong>面向 AI 协作的需求与变更管理工具。</strong></summary>

[![Stars](https://img.shields.io/github/stars/Fission-AI/OpenSpec?style=flat-square&label=Stars)](https://github.com/Fission-AI/OpenSpec/stargazers)
[![Downloads](https://img.shields.io/npm/dm/@fission-ai/openspec?style=flat-square&label=Downloads/mo)](https://www.npmjs.com/package/@fission-ai/openspec)
[![Contributors](https://img.shields.io/github/contributors/Fission-AI/OpenSpec?style=flat-square&label=Contributors)](https://github.com/Fission-AI/OpenSpec/graphs/contributors)

</details>
<p></p>
我们的工作方式：

```text
→ 灵活，而不是僵化
→ 迭代，而不是瀑布
→ 清晰，而不是复杂
→ 适用于存量项目，也适用于新项目
→ 从个人项目扩展到团队项目
```

> [!TIP]
> **默认工作流是 `code-spec`。** OpenSpec 使用产物驱动的工作流。
>
> 在 AI 对话中运行 `/opsx:propose "你的想法"` 开始。→ [了解工作流](docs/opsx.md)

> [!WARNING]
> **`code-spec` 迁移边界：**规范目录为 `openspec/business.md`、`openspec/changes/CHG-YYYYMMDD-NNN/`、`openspec/archive/specs/` 和 `openspec/archive/changes/`。使用 `openspec new change` 创建 Change，使用 `openspec archive CHG-...` 显式归档。旧 Change 标识、slug 目录和 `.openspec.yaml` 不再兼容。旧文件可以保留，但不会被新的 canonical 工作流读取。只有显式指定时才使用通用 Schema 工作流。

<p align="center">
  Follow <a href="https://x.com/0xTab">@0xTab on X</a> for updates · Join the <a href="https://discord.gg/YctCnvvshC">OpenSpec Discord</a> for help and questions.
</p>

<!-- TODO: Add GIF demo of /opsx:propose → /opsx:archive workflow -->

## 使用示例

```text
You: /opsx:explore
AI:  What would you like to explore?
You: I want dark mode but I'm not sure how to do it cleanly.
AI:  Let me look at your styling setup...
     Cleanest path here: CSS variables + a small theme context,
     with system-preference detection. No new dependencies. Scope it?
You: Yes, let's do it.

You: /opsx:propose add-dark-mode
AI:  Created openspec/changes/CHG-YYYYMMDD-NNN/
     ✓ proposal.md — why we're doing this, what's changing
     ✓ specs/       — requirements and scenarios
     ✓ design.md    — technical approach
     ✓ tasks.md     — implementation checklist
     Ready for implementation!

You: /opsx:apply
AI:  Implementing tasks...
     ✓ 1.1 Add theme context provider
     ✓ 1.2 Create toggle component
     ✓ 2.1 Add CSS variables
     ✓ 2.2 Wire up localStorage
     All tasks complete!

You: /opsx:archive
AI:  Archived explicitly to openspec/archive/changes/CHG-YYYYMMDD-NNN/
     Specs updated. Ready for the next feature.
```

<details>
<summary><strong>What do the specs actually look like?</strong></summary>

Plain Markdown — requirements with concrete scenarios, no special syntax to learn. Here's what goes in the `specs/` folder created above:

```markdown
## ADDED Requirements

### Requirement: Theme selection
The app SHALL let users switch between light and dark themes,
defaulting to the system preference.

#### Scenario: User toggles dark mode
- **WHEN** the user clicks the theme toggle
- **THEN** the app switches to dark mode and persists the choice
```

Your AI writes these; you review the plan before any code is written.

OpenSpec is built with OpenSpec — browse this repo's live [specs](openspec/specs) and in-flight [changes](openspec/changes) for real examples at scale.

</details>

<details>
<summary><strong>OpenSpec Dashboard</strong></summary>

<p align="center">
  <img src="assets/openspec_dashboard.png" alt="OpenSpec dashboard preview" width="90%">
</p>

</details>

## Why teams adopt OpenSpec

Solo, OpenSpec keeps you and your AI honest on a single repo. On a team, the hard part moves: a feature spans the API server, the web app, and a shared library; requirements are owned by one team and consumed by others; planning starts before any code exists.

**[Stores](docs/stores-beta/user-guide.md)** are the answer — planning in a repo of its own. The same `openspec/` shape you already know (specs and changes), shared by `git push` like anything else. One source of truth your whole team and every coding agent can read, across every repo.

- **Cross-repo features** — one change, one plan, even when the code lands in three repos.
- **Shared requirements** — a platform team owns the specs; product teams reference them read-only, right where their coding agent can read them. No drifting wiki.
- **Plan before code** — capture the plan in the store now; the code repos catch up later.

> Stores are in **beta**. Start with the [Stores User Guide](docs/stores-beta/user-guide.md).

## 快速开始

**需要 Node.js 20.19.0 或更高版本。**

在终端中全局安装 OpenSpec：

```bash
npm install -g @fission-ai/openspec@latest
```

进入项目目录并初始化：

```bash
cd your-project
openspec init
```

> **让 AI 协助安装：**将[安装提示词](docs/installation.md#install-with-your-ai-assistant)粘贴到编码助手中。它会安装 CLI、运行 `openspec init` 并验证结果。

然后在 AI 对话中使用：

- **还不确定做什么：**先运行 `/opsx:explore`，让 AI 读取代码、比较方案并整理计划。（[Explore 指南](docs/explore.md)）
- **已经明确目标：**直接运行 `/opsx:propose <what-you-want-to-build>`。

Both are in the default profile. If you want the expanded workflow (`/opsx:new`, `/opsx:continue`, `/opsx:ff`, `/opsx:verify`, `/opsx:bulk-archive`, `/opsx:onboard`), select it with `openspec config profile` and apply with `openspec update`.

`/opsx:propose` is the canonical name; your tool may spell it `/opsx-propose` (Cursor, GitHub Copilot), `@opsx-propose` (Amazon Q) or `$openspec-propose` (Codex). `openspec init` prints the right form for the tools you picked — see [How To Invoke](docs/supported-tools.md#how-to-invoke).

> [!NOTE]
> Not sure if your tool is supported? [View the full list](docs/supported-tools.md) – we support 30+ tools and growing.
>
> Also works with pnpm, yarn, bun, and nix. [See installation options](docs/installation.md).

## 文档

**从这里开始：**[文档首页](docs/README.md)提供完整导航。第一次使用 OpenSpec？先读[快速入门](docs/getting-started.md)，再读[命令如何工作](docs/how-commands-work.md)，了解 `/opsx:propose` 应该在哪输入。

→ **[Getting Started](docs/getting-started.md)**: first steps<br>
→ **[Explore First](docs/explore.md)**: think it through with `/opsx:explore` before you commit<br>
→ **[How Commands Work](docs/how-commands-work.md)**: where slash commands run vs the CLI<br>
→ **[Core Concepts at a Glance](docs/overview.md)**: the whole mental model, one page<br>
→ **[Examples & Recipes](docs/examples.md)**: real changes, start to finish<br>
→ **[Workflows](docs/workflows.md)**: combos and patterns<br>
→ **[Existing Projects](docs/existing-projects.md)**: adopt OpenSpec on a brownfield codebase<br>
→ **[Editing a Change](docs/editing-changes.md)**: update artifacts, go back, reconcile manual edits<br>
→ **[Commands](docs/commands.md)**: slash commands & skills<br>
→ **[CLI](docs/cli.md)**: terminal reference<br>
→ **[Stores](docs/stores-beta/user-guide.md)**: plan in a separate repo, shared across your team (beta)<br>
→ **[Supported Tools](docs/supported-tools.md)**: tool integrations & install paths<br>
→ **[Concepts](docs/concepts.md)**: how it all fits<br>
→ **[Multi-Language](docs/multi-language.md)**: multi-language support<br>
→ **[Customization](docs/customization.md)**: make it yours<br>
→ **[FAQ](docs/faq.md)** · **[Troubleshooting](docs/troubleshooting.md)** · **[Glossary](docs/glossary.md)**: quick help


## Community schemas

Third-party schema bundles distributed via standalone repositories — these provide opinionated workflows that integrate OpenSpec with other tools, similar to how [github/spec-kit's community extension catalog](https://github.com/github/spec-kit/tree/main/extensions) handles tool integrations.

→ **[Browse the catalog](docs/customization.md#community-schemas)** in the customization docs.


## Why OpenSpec?

AI coding assistants are powerful but unpredictable when requirements live only in chat history. OpenSpec adds a lightweight spec layer so you agree on what to build before any code is written.

- **Agree before you build** — human and AI align on specs before code gets written
- **Stay organized** — each change gets its own folder with proposal, specs, design, and tasks
- **Work fluidly** — update any artifact anytime, no rigid phase gates
- **Use your tools** — works with 30+ AI assistants via slash commands

### How we compare

**vs. [Spec Kit](https://github.com/github/spec-kit)** (GitHub) — Thorough but heavyweight. Rigid phase gates, lots of Markdown, Python setup. OpenSpec is lighter and lets you iterate freely.

**vs. [Kiro](https://kiro.dev)** (AWS) — Powerful but you're locked into their IDE and limited to Claude models. OpenSpec works with the tools you already use.

**vs. nothing** — AI coding without specs means vague prompts and unpredictable results. OpenSpec brings predictability without the ceremony.

## Updating OpenSpec

**Upgrade the package**

```bash
npm install -g @fission-ai/openspec@latest
```

**Refresh agent instructions**

Run this inside each project to regenerate AI guidance and ensure the latest slash commands are active:

```bash
openspec update
```

## Usage Notes

**Model selection**: OpenSpec works best with high-reasoning models. We recommend Codex 5.5 and Opus 4.7 for both planning and implementation.

**Context hygiene**: OpenSpec benefits from a clean context window. Clear your context before starting implementation and maintain good context hygiene throughout your session.

## Contributing

**Small fixes** — Bug fixes, typo corrections, and minor improvements can be submitted directly as PRs.

**Larger changes** — For new features, significant refactors, or architectural changes, please submit an OpenSpec change proposal first so we can align on intent and goals before implementation begins.

When writing proposals, keep the OpenSpec philosophy in mind: we serve a wide variety of users across different coding agents, models, and use cases. Changes should work well for everyone.

**AI-generated code is welcome** — as long as it's been tested and verified. PRs containing AI-generated code should mention the coding agent and model used (e.g., "Generated with Claude Code using claude-opus-4-5-20251101").

### Development

- Install dependencies: `pnpm install`
- Build: `pnpm run build`
- Test: `pnpm test`
- Develop CLI locally: `pnpm run dev` or `pnpm run dev:cli`
- Conventional commits (one-line): `type(scope): subject`

## Other

<details>
<summary><strong>Telemetry</strong></summary>

OpenSpec collects anonymous usage stats.

We collect only command names and version to understand usage patterns. No arguments, paths, content, or PII. Automatically disabled in CI.

**Opt-out (any one is enough):**
- `openspec config set telemetry.enabled false` (global config; unset means on)
- `export OPENSPEC_TELEMETRY=0` or `export DO_NOT_TRACK=1` (env overrides config)

</details>

<details>
<summary><strong>Maintainers & Advisors</strong></summary>

See [MAINTAINERS.md](MAINTAINERS.md) for the list of core maintainers and advisors who help guide the project.

</details>



## License

MIT
