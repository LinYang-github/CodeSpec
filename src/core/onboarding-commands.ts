/**
 * Onboarding command hints.
 *
 * The commands shown to a user after setup must be limited to the workflows
 * their profile actually installs, otherwise we advertise slash commands that
 * were correctly never generated.
 *
 * This module decides WHICH hints to show. How each one is spelled for a given
 * tool — command, skill, or a tool-specific skill prefix — is decided by
 * src/utils/command-references.ts at the call site.
 */

import { normalizeWorkflowId, type PublicWorkflowId } from './profiles.js';

export type OnboardingCommand = {
  workflow: PublicWorkflowId;
  command: string;
  description: string;
};

/**
 * Longest description the welcome screen can render. It shows these beside a
 * 24-column art column and only animates at MIN_WIDTH (60) columns or wider; a
 * longer line wraps, and the animation's cursor-up count assumes unwrapped
 * lines. See src/ui/welcome-screen.ts.
 */
export const DESCRIPTION_BUDGET = 17;

/**
 * Ordered onboarding hints. The public surface has one development entry,
 * one recovery entry, and one archive entry. Phase-level commands are not
 * advertised here; they are internal Core routing or Superpowers guidance.
 */
const ONBOARDING_COMMANDS: readonly OnboardingCommand[] = [
  { workflow: 'workflow', command: '/opsx:workflow', description: '开始或继续开发' },
  { workflow: 'rebase', command: '/opsx:rebase', description: '恢复 STALE Change' },
  { workflow: 'archive', command: '/opsx:archive', description: '提交并归档 Change' },
];

/**
 * Returns the onboarding hints for the installed workflows, in lifecycle order.
 * Returns an empty array when none of the public entries are installed.
 */
export function getOnboardingCommands(
  workflows: readonly string[]
): OnboardingCommand[] {
  const installed = new Set(
    workflows
      .map((workflow) => normalizeWorkflowId(workflow))
      .filter((workflow): workflow is PublicWorkflowId => workflow !== null)
  );
  return ONBOARDING_COMMANDS.filter((entry) => installed.has(entry.workflow));
}
