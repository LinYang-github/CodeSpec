import { STORE_SELECTION_GUIDANCE } from './store-selection.js';
import type { CommandTemplate } from '../types.js';
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

### Scenario 的 ERROR 规则

canonical spec.md 和 Current Specification 的每个 Scenario 都必须包含 ERROR 行；一个 Scenario 可以有多条 ERROR，按原顺序保留。分析阶段如果暂时无法确定异常处理，可以保留空的 - **ERROR** 行，表示待人工补写，不得从 THEN 或上下文自动推断。进入 VERIFY 前，Core 必须检查 Delta 和 Current Specification 中的所有 Scenario：ERROR 缺失或为空都必须失败，并要求人工补写；在此之前 Verification 不得通过，Change 不得归档。Verification 证据记录 Requirement/Scenario ID 和命令结果，不替代 ERROR 正文。

`;

export function withOpenSpecWorkflowGuidance(instructions: string): string {
  return `${OPENSPEC_WORKFLOW_GUIDANCE}\n\n${instructions}`;
}

const DEVELOPMENT_ORCHESTRATION = `## 唯一开发入口

所有正常开发请求都从这里进入。先解析当前 canonical workspace 和 Change；不存在 Change 时由 OpenSpec Core 内部执行 createChange() 与 allocateChangeId()，存在 Change 时执行 resolveChange()，不得让用户在多个阶段 Skill 之间选择。

### 领域治理由 OpenSpec Core 负责

Core 内部负责模块解析、Requirement/Scenario ID 分配、captureBaseline()、detectStale()、状态迁移、Traceability、Canonical Spec 校验、delta 应用和事务边界。assessSddLevel()、resolveSddProfile() 与 escalateSddLevel() 也属于 Core 策略；入口只读取其结果，不复制判断规则。

### 工程方法由 Superpowers 负责

- 需求不清或涉及新功能：调用 superpowers:brainstorming。
- 需要多步实现：调用 superpowers:writing-plans，随后按计划串行执行。
- 实现和修复：遵循 superpowers:test-driven-development 的 RED → GREEN → REFACTOR。
- 遇到失败或异常行为：调用 superpowers:systematic-debugging。
- 完成前：调用 superpowers:verification-before-completion；需要审查时使用 code review 技能。

### 路由门禁

1. 运行 openspec context --json，再运行 openspec status --change "<CHG-ID>" --json，读取 metadata、proposal、design、spec、tasks 和 verification 的实际路径。
2. 先由 Core 检查 Change、模块、Requirement、baseline 和 status。若 baseline 为 STALE、存在多 Change 冲突或需要重建基线，立即转交 openspec-rebase-change。
3. 规划阶段只写 canonical Change 规划产物；实现阶段只按 tasks 和 Superpowers 计划修改代码；验证阶段记录 Requirement、Scenario、Task 与命令证据。
4. 完成后刷新 status。只有所有必要验证通过且 Core 报告可归档时，才转交 openspec-archive-change。
5. 任何阶段都不得直接修改 Current Specification；Current Specification 只能由 archive 事务写入。`;

export function getOpenSpecWorkflowSkillTemplate() {
  return {
    name: 'openspec-workflow',
    description: '将 OpenSpec code-spec 工作路由到 canonical Change 工作流。',
    instructions: `${withOpenSpecWorkflowGuidance(DEVELOPMENT_ORCHESTRATION)}\n\n${STORE_SELECTION_GUIDANCE}`,
    license: 'MIT',
    compatibility: 'Requires openspec CLI.',
    metadata: { author: 'openspec', version: '1.0' },
  } as const;
}

export function getOpsxWorkflowCommandTemplate(): CommandTemplate {
  return {
    name: 'OPSX: Workflow',
    description: '统一处理 OpenSpec Change 的开发生命周期',
    category: 'Workflow',
    tags: ['workflow', 'code-spec', 'canonical'],
    content: `${withOpenSpecWorkflowGuidance(`
统一处理一个 OpenSpec Change 的开发请求。

${STORE_SELECTION_GUIDANCE}

根据用户意图路由到分析、规划、实现或验证阶段：工程方法交给 Superpowers，Change、Requirement、Baseline、STALE 和状态事务交给 OpenSpec Core。发现 STALE、多 Change 冲突或需要重建基线时，转交 \`openspec-rebase-change\`；完成且验证通过后，转交 \`openspec-archive-change\`。不要直接修改 Current Specification。
`)}`,
  };
}
