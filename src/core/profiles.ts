/**
 * Profile System
 *
 * Defines workflow profiles that control which workflows are installed.
 * Profiles determine WHICH workflows; delivery (in global config) determines HOW.
 */

import type { Profile } from './global-config.js';

/**
 * Public workflow entries generated for AI tools.
 *
 * The legacy workflow ids remain below for CLI and migration compatibility;
 * only these three ids are allowed to reach public Skill/command generation.
 */
export const PUBLIC_WORKFLOWS = ['workflow', 'rebase', 'archive'] as const;
export type PublicWorkflowId = (typeof PUBLIC_WORKFLOWS)[number];

const LEGACY_TO_PUBLIC_WORKFLOW: Record<string, PublicWorkflowId> = {
  workflow: 'workflow',
  propose: 'workflow',
  explore: 'workflow',
  new: 'workflow',
  continue: 'workflow',
  apply: 'workflow',
  update: 'workflow',
  ff: 'workflow',
  verify: 'workflow',
  onboard: 'workflow',
  rebase: 'rebase',
  sync: 'archive',
  archive: 'archive',
  'bulk-archive': 'archive',
};

/** Converts a legacy workflow id into one of the three public entries. */
export function normalizeWorkflowId(workflow: string): PublicWorkflowId | null {
  return LEGACY_TO_PUBLIC_WORKFLOW[workflow] ?? null;
}

function isLegacyDefaultCoreSelection(workflows: readonly string[]): boolean {
  if (workflows.length !== CORE_WORKFLOWS.length) return false;
  const selected = new Set(workflows);
  return CORE_WORKFLOWS.every((workflow) => selected.has(workflow));
}

/**
 * Resolves the public generation surface for a profile without exposing the
 * legacy phase-by-phase workflow ids to AI tools.
 */
export function getPublicProfileWorkflows(
  profile: Profile,
  customWorkflows?: readonly string[]
): readonly PublicWorkflowId[] {
  if (profile !== 'custom') return PUBLIC_WORKFLOWS;

  // A pre-three-entry config can be marked `custom` by the profile migration
  // even when it contains the complete legacy default Core selection. Treat
  // that exact set as the new default so upgrades do not silently omit the
  // dedicated rebase entry. Other custom subsets remain user-controlled.
  if (customWorkflows && isLegacyDefaultCoreSelection(customWorkflows)) {
    return PUBLIC_WORKFLOWS;
  }

  const normalized: PublicWorkflowId[] = [];
  for (const workflow of customWorkflows ?? []) {
    const publicWorkflow = normalizeWorkflowId(workflow);
    if (publicWorkflow && !normalized.includes(publicWorkflow)) {
      normalized.push(publicWorkflow);
    }
  }
  return normalized;
}

/**
 * Core workflows included in the 'core' profile.
 * These provide the streamlined experience for new users.
 */
export const CORE_WORKFLOWS = ['propose', 'explore', 'apply', 'update', 'sync', 'archive'] as const;

/**
 * All available workflows in the system.
 */
export const ALL_WORKFLOWS = [
  'propose',
  'explore',
  'new',
  'continue',
  'apply',
  'update',
  'ff',
  'sync',
  'archive',
  'bulk-archive',
  'verify',
  'onboard',
] as const;

export type WorkflowId = (typeof ALL_WORKFLOWS)[number];
export type CoreWorkflowId = (typeof CORE_WORKFLOWS)[number];

/**
 * Resolves which workflows should be active for a given profile configuration.
 *
 * - 'core' profile always returns CORE_WORKFLOWS
 * - 'custom' profile returns the provided customWorkflows and required dependencies
 */
export function getProfileWorkflows(
  profile: Profile,
  customWorkflows?: string[]
): readonly string[] {
  if (profile === 'custom') {
    const workflows = customWorkflows ?? [];
    // A migrated or newly written config may already use the public surface.
    // Keep it canonical instead of reintroducing the internal `sync` phase as
    // a visible dependency of the archive entry.
    if (workflows.some((workflow) => workflow === 'workflow' || workflow === 'rebase')) {
      return getPublicProfileWorkflows('custom', workflows);
    }
    const syncDependentIndex = workflows.findIndex(
      (workflow) => workflow === 'archive' || workflow === 'bulk-archive'
    );

    if (syncDependentIndex !== -1 && !workflows.includes('sync')) {
      return [
        ...workflows.slice(0, syncDependentIndex),
        'sync',
        ...workflows.slice(syncDependentIndex),
      ];
    }

    return workflows;
  }
  return CORE_WORKFLOWS;
}
