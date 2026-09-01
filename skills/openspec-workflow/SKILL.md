---
name: openspec-workflow
description: Route OpenSpec code-spec work through the canonical Change workflow.
allowed-tools: Bash(openspec:*)
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
---


## Canonical OpenSpec workflow

Route code-spec work through the `openspec-workflow` adapter. Resolve or create a canonical Change ID matching `CHG-YYYYMMDD-NNN`; never use a slug Change or legacy `.openspec.yaml` metadata. The Change directory is `openspec/changes/<CHG-ID>/`, and `metadata.yaml` is the status authority.

Carry the Change ID, lifecycle status, baseline, Requirement IDs (`MOD-###-REQ-###`), Scenarios, Task IDs (`SP-##`), and metadata artifact paths through every prompt and command. Keep `tasks.md` as a concise `SP-##` status projection; do not duplicate the detailed Superpowers plan there. Record required Requirement/test/build/lint commands and evidence in the verification artifact.

### Resolve and inject context before acting

Run `openspec context --json` to resolve the canonical workspace. Resolve the Change by explicit `CHG-YYYYMMDD-NNN` ID or bound context, then run `openspec status --change "<CHG-ID>" --json` and load `openspec/changes/<CHG-ID>/metadata.yaml` plus its declared artifact paths. Inject the actual Change ID, status, baseline, affected Requirement IDs and Scenario IDs, Task IDs, prior evidence, and canonical proposal/design/spec/tasks/verification paths into each Superpowers prompt. If context is missing, metadata is absent, or resolution is ambiguous, fail explicitly and stop; never guess or fall back to slug/legacy metadata.

Before planning, implementation, verification, or archive, re-resolve status and artifacts and pass the resulting context to the relevant Superpowers skill. After each material action, refresh status and write traceability/evidence back to the canonical artifact. Required commands must be run from the resolved workspace and recorded verbatim with their results.

Reuse Superpowers methodology unchanged: brainstorming, writing-plans, TDD RED → GREEN, systematic debugging, fresh verification, code review, and branch finishing. If the baseline is stale, route through semantic rebase before continuing.



Use this adapter whenever a Superpowers skill operates on OpenSpec code-spec work.

**Store selection:** If the user names a store (a store is a standalone OpenSpec repo registered on this machine) or the work lives in one, run `openspec store list --json` to discover registered store ids, then pass `--store <id>` on the commands that read or write specs and changes (`new change`, `status`, `instructions`, `list`, `show`, `validate`, `archive`, `doctor`, `context`, `schemas`, `view`). Once selected, treat `--store <id>` as sticky for the rest of the workflow. Every unscoped example of those commands below is shorthand: before running it, append the flag. For example, run `openspec status --change "<name>" --json --store "<id>"`, not the unscoped form shown below. Other commands do not take the flag. Hints printed by commands already carry the flag; keep it on follow-ups. Without a store, commands act on the nearest local `openspec/` root.
