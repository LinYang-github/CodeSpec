# CodeSpec skills for skills.sh

Install the CodeSpec workflow skills into any [skills.sh](https://skills.sh)-compatible agent:

```bash
npx skills add Fission-AI/CodeSpec
```

The three generated entries are the public CodeSpec surface that `codespec init`
writes into a project:

- `codespec-workflow`: the only normal development entry;
- `codespec-rebase-change`: the only STALE, baseline-recovery, and multi-Change
  conflict entry;
- `codespec-archive-change`: the only Current Specification archive entry.

CodeSpec Core owns Change, Requirement, Baseline, STALE, validation, delta,
conflict, and archive transactions. Superpowers owns engineering method skills
such as brainstorming, planning, TDD, debugging, verification, and review.

The skills drive the `codespec` CLI, so for the full setup (CLI + `codespec/`
project scaffolding + tool integration) run:

```bash
npx codespec@latest init
```

> These files are generated from the skill templates — do not edit by hand. Run
> `pnpm build && pnpm generate:skills` after changing a template;
> `skillssh-parity.test.ts` fails if they drift.
