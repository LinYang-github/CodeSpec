# OpenSpec 文档

这里是 OpenSpec 的文档首页。

OpenSpec 让你和 AI 编码助手在写代码前就**对要构建的内容达成一致**。你描述 Change，AI 生成简短的 Spec 和任务清单，你们共同审阅计划，然后再开始实现。

默认 Schema 是 `code-spec`。新的 canonical Change 使用 `CHG-YYYYMMDD-NNN` ID 和 `openspec/archive/` 目录。旧 Change 标识不会被读取，旧文件可以保留。

如果只读两页，请阅读：

1. [Getting Started](getting-started.md): install, initialize, and ship your first change.
2. [How Commands Work](how-commands-work.md): where you type the three public OpenSpec entries in your AI chat, not the terminal.

OpenSpec 有两个入口：在终端运行的 CLI，以及在 AI 对话中使用的 skills。区分两个入口可以避免最常见的使用错误。

> **还不确定要构建什么时，先运行 `/opsx:workflow`。**它会把 brainstorming 和 planning 交给 Superpowers，再进入 CodeSpec Change 流程。

## 选择入口

**第一次使用：**从[快速入门](getting-started.md)开始，再阅读[核心概念](overview.md)。遇到术语或疑问时，查看[FAQ](faq.md)和[术语表](glossary.md)。

**有问题但没有计划：**使用 `/opsx:workflow`，让 Superpowers 在同一个开发入口内完成 brainstorming 和 planning。

**I have a big existing codebase.** You don't document all of it. [Using OpenSpec in an Existing Project](existing-projects.md) shows how to start on real, brownfield code without boiling the ocean.

**只想先运行起来：**阅读[安装](installation.md)，运行 `openspec init`，再读[命令如何工作](how-commands-work.md)。也可以使用[AI 辅助安装提示词](installation.md#install-with-your-ai-assistant)。

**I learn by example.** The [Examples & Recipes](examples.md) page walks through real changes start to finish: a small feature, a bug fix, a refactor, an exploration.

**The AI just drafted a plan — now what?** Read it. [Reviewing a Change](reviewing-changes.md) shows the two-minute pass that catches a wrong turn while it's still cheap, and [Writing Good Specs](writing-specs.md) covers what a plan worth approving is made of.

**I work on a team.** [OpenSpec on a Team](team-workflow.md) shows how a change maps onto a branch and a pull request, and how teammates review a plan before the code.

**从旧工作流迁移：**阅读[迁移指南](migration-guide.md)，了解 `code-spec` 的目录、ID 和兼容边界。

**I want to bend it to my team's process.** [Customization](customization.md) covers project config, custom schemas, and shared context.

**Something's broken.** [Troubleshooting](troubleshooting.md) collects the failures people actually hit, with fixes.

## 文档地图

### 从这里开始

| Doc | What it gives you |
|-----|-------------------|
| [Getting Started](getting-started.md) | Install, initialize, and run your first change end to end |
| [AI entries](commands.md) | Use `workflow`, `rebase`, and `archive` as the three public entries |
| [How Commands Work](how-commands-work.md) | Where slash commands run, what "interactive mode" means, terminal vs chat |
| [Core Concepts at a Glance](overview.md) | The whole mental model on one page: specs, changes, deltas, archive |
| [Installation](installation.md) | npm, pnpm, yarn, bun, Nix, a prompt that hands setup to your AI assistant, and how to verify it worked |

### 日常使用

| Doc | What it gives you |
|-----|-------------------|
| [Workflows](workflows.md) | Common patterns and when to reach for each command |
| [Examples & Recipes](examples.md) | Full walkthroughs of real changes, copy-pasteable |
| [Writing Good Specs](writing-specs.md) | What a strong requirement and scenario look like, and how to right-size a change |
| [Reviewing a Change](reviewing-changes.md) | The two-minute pass on a drafted plan before any code is written |
| [OpenSpec on a Team](team-workflow.md) | How changes fit branches, pull requests, and review |
| [Using OpenSpec in an Existing Project](existing-projects.md) | Adopting OpenSpec on a large brownfield codebase |
| [Editing & Iterating on a Change](editing-changes.md) | Update artifacts, go back, reconcile manual edits |
| [Commands](commands.md) | Reference for every `/opsx:*` slash command |
| [CLI](cli.md) | Reference for every `openspec` terminal command |

### 深入理解

| Doc | What it gives you |
|-----|-------------------|
| [Concepts](concepts.md) | The long-form explanation of specs, changes, artifacts, schemas, and archive |
| [OPSX Workflow](opsx.md) | Why the workflow is fluid instead of phase-locked, plus an architecture deep dive |
| [Glossary](glossary.md) | Every term defined in one place |

### 定制 OpenSpec

| Doc | What it gives you |
|-----|-------------------|
| [Customization](customization.md) | Project config, custom schemas, shared context |
| [Multi-Language](multi-language.md) | Generate artifacts in languages other than English |
| [Supported Tools](supported-tools.md) | The 30+ AI tools OpenSpec integrates with, and where files land |

### 需要帮助时

| Doc | What it gives you |
|-----|-------------------|
| [FAQ](faq.md) | Quick answers to the questions people ask most |
| [Troubleshooting](troubleshooting.md) | Concrete fixes for concrete failures |
| [Migration Guide](migration-guide.md) | Moving from the legacy workflow to OPSX |

### 跨仓库协作（beta）

| Doc | What it gives you |
|-----|-------------------|
| [Stores: User Guide](stores-beta/user-guide.md) | Plan in its own repo when your work spans repos or teams |
| [Agent Contract](agent-contract.md) | The machine-readable CLI surfaces agents drive |

## 三十秒版本

```text
1. Install        npm install -g @fission-ai/openspec@latest
2. Initialize     cd your-project && openspec init
3. Develop        (in your AI chat)  /opsx:workflow add-dark-mode
4. Recover        (in your AI chat)  /opsx:rebase              ← only when STALE
5. Archive        (in your AI chat)  /opsx:archive
```

步骤 1 和 2 在终端中执行，其他步骤在 AI 对话中执行。[命令如何工作](how-commands-work.md)详细说明了这个区别。

## 获取帮助

- **Discord:** [discord.gg/YctCnvvshC](https://discord.gg/YctCnvvshC) for questions, ideas, and help.
- **GitHub Issues:** [github.com/Fission-AI/OpenSpec/issues](https://github.com/Fission-AI/OpenSpec/issues) for bugs and feature requests.
- **`openspec feedback "your message"`** sends feedback straight from your terminal (it opens a GitHub issue).

如果发现文档错误、过期或难以理解，请提交 Issue 或 PR。
