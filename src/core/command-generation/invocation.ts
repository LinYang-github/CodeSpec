/**
 * Command Invocation
 *
 * How a tool spells an CodeSpec command has two parts, and only one of them
 * can be read off the file the adapter writes:
 *
 * - The *name* comes from the file. `.../commands/codespec/<id>.md` is namespaced
 *   by its directory, so the tool registers `codespec:<id>` (Claude Code, Gemini,
 *   Crush, ...). `.../commands/codespec-<id>.md` names the command with the
 *   filename, so the tool registers `codespec-<id>` (Cursor, GitHub Copilot,
 *   OpenCode, ...).
 * - The *prefix* is the tool's own and cannot be derived. Almost every tool
 *   uses `/`; Amazon Q loads these files into its prompt library, which is
 *   invoked with `@` (`@codespec-propose`), so its adapter declares that prefix.
 *
 * Deriving the name from `getFilePath` keeps generated cross-references and
 * onboarding hints in step with the files CodeSpec actually writes. A
 * hand-maintained list drifted before: only OpenCode was rewritten when the
 * hyphen form was introduced (#727), and Cursor still advertised `/codespec:`
 * commands its palette never registered (#1307). Carrying the prefix as
 * adapter metadata rather than inferring it keeps the one tool that does not
 * use a slash from being advertised as if it did.
 */

import path from 'path';
import type { ToolCommandAdapter } from './types.js';

export type CommandInvocationStyle = 'namespaced' | 'flat';

/**
 * Everything needed to spell one of a tool's CodeSpec commands.
 */
export interface CommandInvocation {
  /** How the command file names the command. */
  style: CommandInvocationStyle;
  /** What the user types before the name, e.g. `/` or Amazon Q's `@`. */
  prefix: string;
}

/** The form these docs, command bodies, and skill templates are authored in. */
export const CANONICAL_INVOCATION: CommandInvocation = { style: 'namespaced', prefix: '/' };

/**
 * Classifies a generated command file by the name the tool will answer to.
 *
 * The test is the filename, not the directory: an `codespec-` prefix means the
 * filename is the command. Every other shape is treated as namespaced, which
 * is what all seven `codespec/<id>.*` adapters need. An adapter that neither
 * prefixes the filename nor nests under `codespec/` would land here too — none
 * does, and the registry-wide test in invocation.test.ts fails if one appears.
 *
 * @param commandFilePath - Path returned by an adapter's `getFilePath`
 * @returns 'flat' when the filename carries the `codespec-` prefix, otherwise
 *          'namespaced'
 */
export function getInvocationStyleForPath(commandFilePath: string): CommandInvocationStyle {
  return path.basename(commandFilePath).startsWith('codespec-') ? 'flat' : 'namespaced';
}

/**
 * Resolves how a tool's generated commands are invoked: the name from the
 * files its adapter writes, the prefix from the adapter's own declaration.
 *
 * @param adapter - The tool-specific command adapter
 * @returns The invocation shared by every command that adapter generates
 */
export function getInvocationForAdapter(adapter: ToolCommandAdapter): CommandInvocation {
  return {
    // Any command id works: every adapter applies one naming rule to all of them.
    style: getInvocationStyleForPath(adapter.getFilePath('explore')),
    prefix: adapter.invocationPrefix ?? CANONICAL_INVOCATION.prefix,
  };
}

/**
 * Spells one command the way the tool registers it.
 *
 * @param invocation - The tool's invocation, from getInvocationForAdapter()
 * @param commandId - The command identifier (e.g. 'apply')
 * @returns What the user types, e.g. `/codespec:apply`, `/codespec-apply`, `@codespec-apply`
 */
export function formatCommandInvocation(
  invocation: CommandInvocation,
  commandId: string
): string {
  const separator = invocation.style === 'namespaced' ? ':' : '-';
  return `${invocation.prefix}codespec${separator}${commandId}`;
}

/**
 * Whether a tool's invocation differs from the canonical `/codespec:<id>` that
 * command bodies and skill templates are authored in — that is, whether
 * generated text has to be rewritten for that tool at all.
 */
export function needsInvocationRewrite(invocation: CommandInvocation): boolean {
  return (
    invocation.style !== CANONICAL_INVOCATION.style ||
    invocation.prefix !== CANONICAL_INVOCATION.prefix
  );
}
