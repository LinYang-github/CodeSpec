/**
 * Agent Skill Templates
 *
 * Compatibility facade that re-exports split workflow template modules.
 */

export type { SkillTemplate, CommandTemplate } from './types.js';

// Legacy template exports remain source-compatible for CLI and migration tests;
// they are intentionally not registered by the public generator.
export { getExploreSkillTemplate, getCodespecExploreCommandTemplate } from './workflows/explore.js';
export { getNewChangeSkillTemplate, getCodespecNewCommandTemplate } from './workflows/new-change.js';
export { getContinueChangeSkillTemplate, getCodespecContinueCommandTemplate } from './workflows/continue-change.js';
export { getApplyInstructions, getApplyChangeSkillTemplate, getCodespecApplyCommandTemplate } from './workflows/apply-change.js';
export { getUpdateChangeSkillTemplate, getCodespecUpdateCommandTemplate } from './workflows/update-change.js';
export { getFfChangeSkillTemplate, getCodespecFfCommandTemplate } from './workflows/ff-change.js';
export { getSyncSpecsSkillTemplate, getCodespecSyncCommandTemplate } from './workflows/sync-specs.js';
export { getArchiveChangeSkillTemplate, getCodespecArchiveCommandTemplate } from './workflows/archive-change.js';
export { getBulkArchiveChangeSkillTemplate, getCodespecBulkArchiveCommandTemplate } from './workflows/bulk-archive-change.js';
export { getVerifyChangeSkillTemplate, getCodespecVerifyCommandTemplate } from './workflows/verify-change.js';
export { getOnboardSkillTemplate, getCodespecOnboardCommandTemplate } from './workflows/onboard.js';
export { getCodespecProposeSkillTemplate, getCodespecProposeCommandTemplate } from './workflows/propose.js';
export { getFeedbackSkillTemplate } from './workflows/feedback.js';
export { getRebaseChangeSkillTemplate, getCodespecRebaseCommandTemplate } from './workflows/rebase-change.js';
export { CODESPEC_WORKFLOW_GUIDANCE, getCodeSpecWorkflowSkillTemplate, getCodespecWorkflowCommandTemplate, getStageAdapterGuidance, getUnsupportedStageGuidance, renderCanonicalChangeContext, withCodeSpecWorkflowGuidance } from './workflows/codespec-workflow.js';
