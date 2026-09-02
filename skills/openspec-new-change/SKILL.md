---
name: openspec-new-change
description: Start a new OpenSpec change using the experimental artifact workflow. Use when the user wants to create a new feature, fix, or modification with a structured step-by-step approach.
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



### new stage adapter

This is the planning stage. Resolve canonical context before acting: run `openspec context --json`, resolve one explicit `CHG-YYYYMMDD-NNN` (fail explicitly on missing or ambiguous context), then run `openspec status --change "<CHG-ID>" --json` and load the declared `metadata.yaml` and artifact paths. Substitute the resolved Change ID, status, mode, baseline hashes, Requirement IDs, exact Scenario IDs, Task IDs, test/evidence references, required verification commands, and canonical paths into the planning prompt. Methodology routing: feature → brainstorming → planning → TDD; bugfix → systematic-debugging → spec-impact decision → TDD; refactor → design-impact → planning → TDD. Refresh status after the action and record traceability in the canonical artifact.

Start a new change using the experimental artifact-driven approach.

**Store selection:** If the user names a store (a store is a standalone OpenSpec repo registered on this machine) or the work lives in one, run `openspec store list --json` to discover registered store ids, then pass `--store <id>` on the commands that read or write specs and changes (`new change`, `change new`, `status`, `instructions`, `list`, `show`, `validate`, `archive`, `doctor`, `context`, `schemas`, `view`, `rebase`, `transition`, `abandon`, `detect-stale`, `allocate-requirements`). Once selected, treat `--store <id>` as sticky for the rest of the workflow. Every unscoped example of those commands below is shorthand: before running it, append the flag. For example, run `openspec status --change "<name>" --json --store "<id>"`, not the unscoped form shown below. Other commands do not take the flag. Hints printed by commands already carry the flag; keep it on follow-ups. Without a store, commands act on the nearest local `openspec/` root.

**Input**: The user's request should include a change name (kebab-case) OR a description of what they want to build.

**Steps**

1. **If no clear input provided, ask what they want to build**

   Ask the user (open-ended, no preset options):
   > "What change do you want to work on? Describe what you want to build or fix."

   From their description, derive a kebab-case name (e.g., "add user authentication" → `add-user-auth`).

   **IMPORTANT**: Do NOT proceed without understanding what the user wants to build.

2. **Determine the workflow schema**

   Use the default schema (omit `--schema`) unless the user explicitly requests a different workflow.

   **Use a different schema only if the user mentions:**
   - A specific schema name → use `--schema <name>`
   - "show workflows" or "what workflows" → run `openspec schemas --json` and let them choose

   **Otherwise**: Omit `--schema` to use the default.

3. **Create the change directory**
   ```bash
   openspec new change "<name>"
   ```
   Add `--schema <name>` only if the user requested a specific workflow.
   This creates a scaffolded change in the planning home resolved by the CLI.

4. **Show the artifact status**
   ```bash
   openspec status --change "<name>" --json
   ```
   Use the returned `planningHome`, `changeRoot`, `artifactPaths`, and `nextSteps` instead of assuming repo-local paths.

5. **Get instructions for the first artifact**
   The first artifact depends on the schema (e.g., `proposal` for spec-driven).
   Check the status output to find the first artifact with status "ready".
   ```bash
   openspec instructions <first-artifact-id> --change "<name>"
   ```
   This outputs the template and context for creating the first artifact.

6. **STOP and wait for user direction**

**Output**

After completing the steps, summarize:
- Change name and location
- Schema/workflow being used and its artifact sequence
- Current status (0/N artifacts complete)
- The template for the first artifact
- Prompt: "Ready to create the first artifact? Just describe what this change is about and I'll draft it, or ask me to continue."

**Guardrails**
- Do NOT create any artifacts yet - just show the instructions
- Do NOT advance beyond showing the first artifact template
- If the name is invalid (not kebab-case), ask for a valid name
- If a change with that name already exists, suggest continuing that change instead
- Pass --schema if using a non-default workflow
