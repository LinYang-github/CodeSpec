# OpenSpec skills for skills.sh

Install the OpenSpec workflow skills into any [skills.sh](https://skills.sh)-compatible agent:

```bash
npx skills add Fission-AI/OpenSpec
```

The three generated entries are the public OpenSpec surface that `openspec init`
writes into a project:

- `openspec-workflow`: the only normal development entry;
- `openspec-rebase-change`: the only STALE, baseline-recovery, and multi-Change
  conflict entry;
- `openspec-archive-change`: the only Current Specification archive entry.

OpenSpec Core owns Change, Requirement, Baseline, STALE, validation, delta,
conflict, and archive transactions. Superpowers owns engineering method skills
such as brainstorming, planning, TDD, debugging, verification, and review.

The skills drive the `openspec` CLI, so for the full setup (CLI + `openspec/`
project scaffolding + tool integration) run:

```bash
npx openspec@latest init
```

> These files are generated from the skill templates — do not edit by hand. Run
> `pnpm build && pnpm generate:skills` after changing a template;
> `skillssh-parity.test.ts` fails if they drift.
