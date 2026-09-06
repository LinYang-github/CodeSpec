/**
 * Command Reference Utilities
 *
 * Utilities for transforming command references to tool-specific formats.
 */

// Type-only imports: a value import would close a module cycle
// (command-generation imports this file). Callers resolve the concrete
// capability and invocation style and pass them in.
import type { CommandSurfaceCapability } from '../core/command-surface.js';
import type { CommandInvocation } from '../core/command-generation/invocation.js';
// Value import of a pure, dependency-free helper: invocation.ts imports only
// `path` and a type, so this does not close the cycle the note above guards.
import {
  formatCommandInvocation,
  needsInvocationRewrite,
} from '../core/command-generation/invocation.js';

/**
 * Rewrites the canonical `/codespec:<command>` references that command bodies and
 * skill templates are authored with into the form one tool actually registers
 * — `/codespec-<command>` for tools that name the command by filename,
 * `@codespec-<command>` for Amazon Q's prompt library.
 *
 * Only known command ids are rewritten, matching how
 * `transformToSkillReferences` leaves unrecognized references alone, so a
 * mistyped or invented `/codespec:<something>` is left as written rather than
 * silently reshaped into a command that does not exist either.
 *
 * @param text - The text containing command references
 * @param invocation - The tool's invocation, from resolveCommandInvocation()
 * @returns Text with command references spelled the tool's way
 *
 * @example
 * transformCommandInvocations('/codespec:new', { style: 'flat', prefix: '/' }) // '/codespec-new'
 * transformCommandInvocations('/codespec:new', { style: 'flat', prefix: '@' }) // '@codespec-new'
 */
export function transformCommandInvocations(
  text: string,
  invocation: CommandInvocation
): string {
  return text.replace(/\/codespec:([a-z-]+)/g, (match, commandId: string) =>
    commandId in COMMAND_TO_SKILL_NAME
      ? formatCommandInvocation(invocation, commandId)
      : match
  );
}

/**
 * Maps command short names to their skill names.
 * Keep in sync with WORKFLOW_TO_SKILL_DIR, which exists in both
 * src/core/profile-sync-drift.ts (exported) and src/core/init.ts (local copy).
 */
const COMMAND_TO_SKILL_NAME: Record<string, string> = {
  'workflow': 'codespec-workflow',
  'rebase': 'codespec-rebase-change',
  'explore': 'codespec-explore',
  'new': 'codespec-new-change',
  'continue': 'codespec-continue-change',
  'apply': 'codespec-apply-change',
  'update': 'codespec-update-change',
  'ff': 'codespec-ff-change',
  'sync': 'codespec-sync-specs',
  'archive': 'codespec-archive-change',
  'bulk-archive': 'codespec-bulk-archive-change',
  'verify': 'codespec-verify-change',
  'onboard': 'codespec-onboard',
  'propose': 'codespec-propose',
};

/**
 * Tools whose skill invocation uses a non-default prefix. The default is `/`
 * (e.g. `/codespec-propose`); Kimi Code invokes skills as `/skill:<name>` and
 * Codex CLI as `$<name>` — a `/<name>` form Codex does not recognize
 * (see docs/supported-tools.md).
 */
const SKILL_INVOCATION_PREFIX: Record<string, string> = {
  kimi: '/skill:',
  codex: '$',
};

/**
 * Tools that have no slash-command surface at all: skills are matched
 * automatically or invoked by natural-language prompts, never by typing a
 * `/<name>` command. Rovo Dev CLI is such a tool — `/skills` only manages
 * skills, and any `/codespec-*` form would be a dead command (see
 * docs/supported-tools.md). References for these tools are spelled as prose
 * ("the codespec-propose skill") so generated content never tells the user to
 * type a command their CLI does not register.
 */
const NATURAL_LANGUAGE_SKILL_TOOLS = new Set<string>(['rovodev']);

/**
 * Whether a tool references skills by natural language rather than a slash
 * command (see NATURAL_LANGUAGE_SKILL_TOOLS).
 */
export function usesNaturalLanguageSkillReferences(toolId: string): boolean {
  return NATURAL_LANGUAGE_SKILL_TOOLS.has(toolId);
}

function replaceCommandsWithNaturalLanguageSkillReferences(text: string): string {
  return text.replace(/\/codespec:([a-z-]+)/g, (match, commandId: string) => {
    const skillName = COMMAND_TO_SKILL_NAME[commandId];
    return skillName === undefined ? match : `the ${skillName} skill`;
  });
}

function replaceCommandsWithSkillReferences(text: string, prefix: string): string {
  return text.replace(/\/codespec:([a-z-]+)/g, (match, commandId: string) => {
    const skillName = COMMAND_TO_SKILL_NAME[commandId];
    return skillName === undefined ? match : `${prefix}${skillName}`;
  });
}

/**
 * Keeps Codex's `$<name>` spelling first while making its canonical shared
 * `.agents` tree usable by agents that invoke the same skills with `/<name>`.
 */
export function transformToCodexCompatibleSkillReferences(text: string): string {
  return text.replace(/\/codespec:([a-z-]+)/g, (match, commandId: string) => {
    const skillName = COMMAND_TO_SKILL_NAME[commandId];
    return skillName === undefined
      ? match
      : `$${skillName} (Codex) or /${skillName} (other agents)`;
  });
}

/**
 * Transforms command references to skill references using the default `/`
 * invocation prefix. Converts `/codespec:<command>` patterns to
 * `/codespec-<skill>` so that generated skills do not reference commands
 * that were never generated. Used for channels that are not tied to one
 * tool (e.g. the skills.sh distribution); tool-targeted generation should
 * go through getSkillReferenceTransformer instead.
 *
 * Unknown command references are left unchanged.
 *
 * @param text - The text containing command references
 * @returns Text with command references transformed to skill references
 *
 * @example
 * transformToSkillReferences('/codespec:apply') // returns '/codespec-apply-change'
 * transformToSkillReferences('Use /codespec:archive next') // returns 'Use /codespec-archive-change next'
 */
export function transformToSkillReferences(text: string): string {
  return replaceCommandsWithSkillReferences(text, '/');
}

/**
 * Returns the skill-reference transformer for a specific tool, honoring the
 * tool's documented skill invocation syntax (e.g. Kimi Code's
 * `/skill:codespec-propose`). Tools with no slash surface (e.g. Rovo Dev) get
 * natural-language references ("the codespec-propose skill"); everything else
 * falls back to the default `/codespec-*` form.
 *
 * @param toolId - The AI tool identifier (e.g. 'kimi', 'vibe', 'rovodev')
 * @returns A transformer converting `/codespec:*` references to skill invocations
 */
export function getSkillReferenceTransformer(toolId: string): (text: string) => string {
  if (usesNaturalLanguageSkillReferences(toolId)) {
    return replaceCommandsWithNaturalLanguageSkillReferences;
  }
  const prefix = SKILL_INVOCATION_PREFIX[toolId];
  if (prefix === undefined) {
    return transformToSkillReferences;
  }
  return (text: string) => replaceCommandsWithSkillReferences(text, prefix);
}

/**
 * Selects the command-reference transformer for a skill generation target.
 *
 * Skill references are used whenever the tool ends up without `/codespec:*`
 * commands — because delivery is skills-only, because the tool has no command
 * surface at all (capability 'none', e.g. Kimi Code or Mistral Vibe), or
 * because the tool invokes skills directly and CodeSpec generates no command
 * files for it (capability 'skills-invocable', i.e. Codex) — so those skills
 * never point at commands that were not generated.
 *
 * When commands are generated, the spelling follows the tool's invocation: a
 * `flat` adapter names the command by filename (`.cursor/commands/codespec-apply.md`
 * → `/codespec-apply`), a `namespaced` adapter puts it in an `codespec/` directory
 * (`.claude/commands/codespec/apply.md` → `/codespec:apply`), and a non-slash prefix
 * wraps it further (`.amazonq/prompts/codespec-apply.md` → `@codespec-apply`). Passing
 * the invocation in keeps this module free of a hand-maintained tool list —
 * the list drifted and left 16 tools advertising commands their palettes never
 * registered (#727, #1307).
 *
 * Devin is the one tool that takes skill references even though its commands
 * are generated: only Devin Desktop reads `.devin/workflows/`, so a workflow
 * reference is dead text for anyone on Devin Local, while the `/codespec-*`
 * skills work on both agents. Under commands-only delivery there are no Devin
 * skills to point at, so it falls through to the invocation rewrite below and
 * gets the `/codespec-<id>` form its workflow filenames register.
 *
 * @param toolId - The AI tool identifier (e.g. 'claude', 'opencode', 'pi')
 * @param delivery - The configured delivery mode
 * @param capability - The tool's command surface capability
 * @param invocation - How the tool's generated commands are invoked, from
 *        resolveCommandInvocation(); undefined for tools with no command
 *        adapter. Required rather than optional so a caller that forgets it
 *        fails to compile instead of silently getting the canonical form.
 * @returns The transformer to pass to generateSkillContent, or undefined when
 *          the tool already answers to the canonical `/codespec:<id>`
 */
export function getTransformerForTool(
  toolId: string,
  delivery: 'both' | 'skills' | 'commands',
  capability: CommandSurfaceCapability,
  invocation: CommandInvocation | undefined
): ((text: string) => string) | undefined {
  if (delivery === 'skills' || capability !== 'adapter-backed') {
    return toolId === 'codex'
      ? transformToCodexCompatibleSkillReferences
      : getSkillReferenceTransformer(toolId);
  }
  if (toolId === 'devin' && delivery === 'both') {
    return getSkillReferenceTransformer(toolId);
  }
  if (invocation !== undefined && needsInvocationRewrite(invocation)) {
    return (text: string) => transformCommandInvocations(text, invocation);
  }
  return undefined;
}
