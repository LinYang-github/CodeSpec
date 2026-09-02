import { STORE_SELECTION_GUIDANCE } from './store-selection.js';
import type { ChangeMetadata } from '../../openspec-workflow/types.js';

export type WorkflowStage = 'analyze' | 'design' | 'plan' | 'implement' | 'new' | 'continue' | 'propose' | 'apply' | 'verify' | 'archive' | 'ff';

export function renderCanonicalChangeContext(metadata: ChangeMetadata, spec = ''): string {
  const requirements = Object.values(metadata.requirements).flatMap((items) => items.map((item) => item.id));
  const scenarioMatches = [...spec.matchAll(/####\s+Scenario:\s*\[?(SCN-\d{3})\]?\s*[^\n]*/gu)];
  const scenarios = [...new Set(scenarioMatches.map((match) => match[1]))];
  const tasks = Object.entries(metadata.tasks.items).map(([id, task]) => `${id}:${task.status}`);
  return `当前状态：${metadata.change.status}\n\n已解析的 Change 上下文：ID=${metadata.change.id}；status=${metadata.change.status}；mode=${metadata.change.mode}；baseline=${metadata.baseline.stale ? 'STALE' : 'CURRENT'}；Requirements=${requirements.join(',') || 'none'}；Scenarios=${scenarios.join(',') || 'none'}；Tasks=${tasks.join(',') || 'none'}；必需验证命令=requirements,test,build,lint；证据=requirements:${metadata.verification.requirements_verified},tests:${metadata.verification.tests_passed},build:${metadata.verification.build_passed},lint:${metadata.verification.lint_passed}；产物路径：metadata=${metadata.artifacts.metadata}, proposal=${metadata.artifacts.proposal}, design=${metadata.artifacts.design}, spec=${metadata.artifacts.spec}, tasks=${metadata.artifacts.tasks}, verification=${metadata.artifacts.verification}。`;
}

export function getStageAdapterGuidance(stage: WorkflowStage): string {
  const action = stage === 'new' || stage === 'propose' ? 'planning' : stage === 'apply' ? 'implementation' : stage === 'verify' ? 'verification' : stage === 'archive' ? 'archive' : 'resume/forward';
  const methodology = stage === 'analyze' || stage === 'new' || stage === 'propose'
    ? 'feature → brainstorming → planning → TDD; bugfix → systematic-debugging → spec-impact decision → TDD; refactor → design-impact → planning → TDD'
    : 'preserve the Change mode routing above and use the existing Superpowers methodology';
  return `### ${stage} 阶段适配器\n\n当前是 ${action} 阶段。执行前解析 canonical 上下文：运行 \`openspec context --json\`，解析一个明确的 \`CHG-YYYYMMDD-NNN\`（上下文缺失或有歧义时明确停止），然后运行 \`openspec status --change "<CHG-ID>" --json\` 并加载声明的 \`metadata.yaml\` 和产物路径。将解析出的 Change ID、status、mode、baseline hash、Requirement ID、准确的 Scenario ID、Task ID、测试/证据引用、必需验证命令和 canonical 路径注入 ${action} 提示。方法论路由：${methodology}。动作完成后刷新状态，并在 canonical 产物中记录追踪关系。`;
}

export function getUnsupportedStageGuidance(workflowId: string): string {
  return `### 不支持的 canonical 阶段：${workflowId}\n\n此工作流不是 canonical 生命周期阶段适配器。不要从中推断规划、继续、实现、验证或归档行为。保留现有行为，或停止并要求使用明确支持的 canonical 阶段。`;
}

/** Canonical adapter guidance shared by generated OpenSpec workflow skills. */
export const OPENSPEC_WORKFLOW_GUIDANCE = `
## Canonical OpenSpec 工作流

将 code-spec 工作通过 \`openspec-workflow\` 适配器路由。解析或创建匹配 \`CHG-YYYYMMDD-NNN\` 的 canonical Change ID；不要使用 slug Change 或旧版 \`.openspec.yaml\` 元数据。Change 目录为 \`openspec/changes/<CHG-ID>/\`，状态以 \`metadata.yaml\` 为准。

在每次提示和命令中传递 Change ID、生命周期 status、baseline、Requirement ID（\`MOD-###-REQ-###\`）、Scenario、Task ID（\`SP-##\`）和元数据产物路径。\`tasks.md\` 只作为简洁的 \`SP-##\` 状态投影，不要在其中重复详细的 Superpowers 计划。在验证产物中记录必需的 Requirement/test/build/lint 命令及证据。

### 执行前解析并注入上下文

运行 \`openspec context --json\` 解析 canonical workspace。通过明确的 \`CHG-YYYYMMDD-NNN\` ID 或绑定上下文解析 Change，然后运行 \`openspec status --change "<CHG-ID>" --json\` 并加载 \`openspec/changes/<CHG-ID>/metadata.yaml\` 及其声明的产物路径。将实际 Change ID、status、baseline、受影响 Requirement ID 和 Scenario ID、Task ID、已有证据以及 canonical proposal/design/spec/tasks/verification 路径注入每个 Superpowers 提示。上下文缺失、元数据缺失或解析有歧义时，明确失败并停止；不要猜测，也不要回退到 slug/旧版元数据。

在规划、实现、验证或归档前，重新解析 status 和产物，并将结果上下文传给对应的 Superpowers skill。每次有实质动作后刷新状态，并将追踪关系/证据写回 canonical 产物。必需命令必须从解析出的 workspace 执行，并逐字记录命令及结果。

原样复用 Superpowers 方法论：brainstorming、writing-plans、TDD RED → GREEN、systematic debugging、fresh verification、code review 和 branch finishing。baseline 过期时，继续之前先通过 semantic rebase。

`;

export function withOpenSpecWorkflowGuidance(instructions: string): string {
  return `${OPENSPEC_WORKFLOW_GUIDANCE}\n\n${instructions}`;
}

export function getOpenSpecWorkflowSkillTemplate() {
  return {
    name: 'openspec-workflow',
    description: '将 OpenSpec code-spec 工作路由到 canonical Change 工作流。',
    instructions: `${withOpenSpecWorkflowGuidance('当 Superpowers skill 操作 OpenSpec code-spec 工作时，使用此适配器。')}\n\n${STORE_SELECTION_GUIDANCE}`,
    license: 'MIT',
    compatibility: 'Requires openspec CLI.',
    metadata: { author: 'openspec', version: '1.0' },
  } as const;
}
