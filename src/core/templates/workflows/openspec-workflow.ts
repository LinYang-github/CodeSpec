import { STORE_SELECTION_GUIDANCE } from './store-selection.js';
import type { ChangeMetadata } from '../../openspec-workflow/types.js';

export type WorkflowStage = 'analyze' | 'design' | 'plan' | 'implement' | 'new' | 'continue' | 'propose' | 'apply' | 'verify' | 'archive' | 'ff';

export function renderCanonicalChangeContext(metadata: ChangeMetadata, spec = ''): string {
  const requirements = Object.values(metadata.requirements).flatMap((items) => items.map((item) => item.id));
  const scenarioMatches = [...spec.matchAll(/####\s+Scenario:\s*\[?(SCN-\d{3})\]?\s*[^\n]*/gu)];
  const scenarios = [...new Set(scenarioMatches.map((match) => match[1]))];
  const tasks = Object.entries(metadata.tasks.items).map(([id, task]) => `${id}:${task.status}`);
  return `Current status: ${metadata.change.status}\n\nResolved Change context: ID=${metadata.change.id}; status=${metadata.change.status}; mode=${metadata.change.mode}; baseline=${metadata.baseline.stale ? 'STALE' : 'CURRENT'}; Requirements=${requirements.join(',') || 'none'}; Scenarios=${scenarios.join(',') || 'none'}; Tasks=${tasks.join(',') || 'none'}; required verification commands=requirements,test,build,lint; evidence=requirements:${metadata.verification.requirements_verified},tests:${metadata.verification.tests_passed},build:${metadata.verification.build_passed},lint:${metadata.verification.lint_passed}; artifacts: metadata=${metadata.artifacts.metadata}, proposal=${metadata.artifacts.proposal}, design=${metadata.artifacts.design}, spec=${metadata.artifacts.spec}, tasks=${metadata.artifacts.tasks}, verification=${metadata.artifacts.verification}.`;
}

export function getStageAdapterGuidance(stage: WorkflowStage): string {
  const action = stage === 'new' || stage === 'propose' ? 'planning' : stage === 'apply' ? 'implementation' : stage === 'verify' ? 'verification' : stage === 'archive' ? 'archive' : 'resume/forward';
  const methodology = stage === 'analyze' || stage === 'new' || stage === 'propose'
    ? 'feature → brainstorming → planning → TDD; bugfix → systematic-debugging → spec-impact decision → TDD; refactor → design-impact → planning → TDD'
    : 'preserve the Change mode routing above and use the existing Superpowers methodology';
  return `### ${stage} stage adapter\n\nThis is the ${action} stage. Resolve canonical context before acting: run \`openspec context --json\`, resolve one explicit \`CHG-YYYYMMDD-NNN\` (fail explicitly on missing or ambiguous context), then run \`openspec status --change "<CHG-ID>" --json\` and load the declared \`metadata.yaml\` and artifact paths. Substitute the resolved Change ID, status, mode, baseline hashes, Requirement IDs, exact Scenario IDs, Task IDs, test/evidence references, required verification commands, and canonical paths into the ${action} prompt. Methodology routing: ${methodology}. Refresh status after the action and record traceability in the canonical artifact.`;
}

export function getUnsupportedStageGuidance(workflowId: string): string {
  return `### Unsupported canonical stage: ${workflowId}\n\nThis workflow is not a canonical lifecycle stage adapter. Do not infer planning, resume, implementation, verification, or archive behavior from it. Preserve its existing behavior or stop and require an explicitly supported canonical stage.`;
}

/** Canonical adapter guidance shared by generated OpenSpec workflow skills. */
export const OPENSPEC_WORKFLOW_GUIDANCE = `
## Canonical OpenSpec workflow

Route code-spec work through the \`openspec-workflow\` adapter. Resolve or create a canonical Change ID matching \`CHG-YYYYMMDD-NNN\`; never use a slug Change or legacy \`.openspec.yaml\` metadata. The Change directory is \`openspec/changes/<CHG-ID>/\`, and \`metadata.yaml\` is the status authority.

Carry the Change ID, lifecycle status, baseline, Requirement IDs (\`MOD-###-REQ-###\`), Scenarios, Task IDs (\`SP-##\`), and metadata artifact paths through every prompt and command. Keep \`tasks.md\` as a concise \`SP-##\` status projection; do not duplicate the detailed Superpowers plan there. Record required Requirement/test/build/lint commands and evidence in the verification artifact.

### Resolve and inject context before acting

Run \`openspec context --json\` to resolve the canonical workspace. Resolve the Change by explicit \`CHG-YYYYMMDD-NNN\` ID or bound context, then run \`openspec status --change "<CHG-ID>" --json\` and load \`openspec/changes/<CHG-ID>/metadata.yaml\` plus its declared artifact paths. Inject the actual Change ID, status, baseline, affected Requirement IDs and Scenario IDs, Task IDs, prior evidence, and canonical proposal/design/spec/tasks/verification paths into each Superpowers prompt. If context is missing, metadata is absent, or resolution is ambiguous, fail explicitly and stop; never guess or fall back to slug/legacy metadata.

Before planning, implementation, verification, or archive, re-resolve status and artifacts and pass the resulting context to the relevant Superpowers skill. After each material action, refresh status and write traceability/evidence back to the canonical artifact. Required commands must be run from the resolved workspace and recorded verbatim with their results.

Reuse Superpowers methodology unchanged: brainstorming, writing-plans, TDD RED → GREEN, systematic debugging, fresh verification, code review, and branch finishing. If the baseline is stale, route through semantic rebase before continuing.

`;

export function withOpenSpecWorkflowGuidance(instructions: string): string {
  return `${OPENSPEC_WORKFLOW_GUIDANCE}\n\n${instructions}`;
}

export function getOpenSpecWorkflowSkillTemplate() {
  return {
    name: 'openspec-workflow',
    description: 'Route OpenSpec code-spec work through the canonical Change workflow.',
    instructions: `${withOpenSpecWorkflowGuidance('Use this adapter whenever a Superpowers skill operates on OpenSpec code-spec work.')}\n\n${STORE_SELECTION_GUIDANCE}`,
    license: 'MIT',
    compatibility: 'Requires openspec CLI.',
    metadata: { author: 'openspec', version: '1.0' },
  } as const;
}
