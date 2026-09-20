import { parse as parseYaml } from 'yaml';
import type { ChangeArtifacts } from '../../core/codespec-workflow/artifacts.js';
import type { WorkspaceContext } from '../../core/codespec-workflow/loaders.js';
import { parseAnalysisDocument } from '../../core/codespec-workflow/analysis.js';
import { validateAnalysisAgainstWorkspace } from '../../core/codespec-workflow/analysis-consistency.js';
import { isApprovalCurrent } from '../../core/codespec-workflow/approvals.js';
import { validateEntryGate, validateExitGate } from '../../core/codespec-workflow/gates.js';
import { validateChangeTraceability } from '../../core/codespec-workflow/traceability.js';
import { CHANGE_MIGRATION_GUIDANCE } from '../../core/codespec-workflow/change-migration.js';

/** Read-only lifecycle advice shared by status and stage instructions. */
export async function canonicalGuidance(workspace: WorkspaceContext, artifacts: ChangeArtifacts) {
  const { metadata } = artifacts;
  const id = metadata.change.id;
  const state = metadata.change.status;
  const needsMigration = !metadata.artifacts.proposal && artifacts.analysis === null;
  const analysis = artifacts.analysis === null ? null : parseAnalysisDocument(parseYaml(artifacts.analysis));
  const analysisErrors = analysis ? await validateAnalysisAgainstWorkspace(workspace, artifacts) : [];
  const gate = needsMigration
    ? { errors: [`analysis.yaml: 活动五件套 Change 必须显式迁移。${CHANGE_MIGRATION_GUIDANCE}`], warnings: [] }
    : await validateExitGate(workspace, artifacts, state);
  const planEntry = state === 'DESIGN' && isApprovalCurrent('design', artifacts)
    ? await validateEntryGate(workspace, artifacts, 'PLAN') : null;
  const currentCommands = Object.values(metadata.requirements).flat()
    .filter((ref) => !metadata.requirements.added.some((added) => added.id === ref.id))
    .map((ref) => `codespec show ${ref.module} --type spec --requirement ${ref.id} --json`);
  const traceGaps: string[] = [];
  const traceWarnings: string[] = [];
  if (analysis && (planEntry || ['PLAN', 'VERIFY', 'ARCHIVE'].includes(state))) {
    try {
      const trace = validateChangeTraceability(artifacts, !planEntry && state !== 'PLAN');
      traceGaps.push(...trace.issues);
      traceWarnings.push(...trace.warnings ?? []);
    } catch (error) { traceGaps.push(error instanceof Error ? error.message : String(error)); }
  }
  let nextCommand = `codespec status --change ${id} --json`;
  let nextAction = { action: 'inspect_status', path: metadata.artifacts.metadata, description: '查看状态和门禁，按对应产物路径补齐内容。' };
  if (needsMigration) {
    nextCommand = `codespec migrate --change ${id}`;
    nextAction = { action: 'migrate', path: metadata.artifacts.metadata, description: '将活动五件套迁移到 ANALYZE，随后人工补齐需求澄清。' };
  } else if (analysis && state === 'ANALYZE' && analysisErrors.length) {
    nextCommand = `codespec instructions analyze --change ${id} --json`;
    nextAction = { action: 'edit_analysis', path: metadata.artifacts.analysis!, description: '人工修订 analysis.yaml：先检查 design.md 中的 Rebase decision（如有），解决分析冲突、revision 缺项和 OPEN question，确认或拒绝 PROPOSED assumption，再继续审批。此命令只读取指导，不编辑文件；未解决分析冲突时不要重复 rebase。' };
  } else if (metadata.baseline.stale) {
    nextCommand = `codespec rebase --change ${id}`;
    nextAction = { action: 'rebase', path: metadata.artifacts.spec, description: '用 Current 执行 semantic rebase，并按返回的 ANALYZE 或 DESIGN route 继续。' };
  } else if (planEntry && planEntry.errors.length) {
    nextCommand = `codespec instructions design --change ${id} --json`;
    nextAction = { action: 'edit_tasks', path: metadata.artifacts.tasks, description: '人工补齐 tasks.yaml 的任务图和 AC 追踪缺口，并解决列出的 PLAN 入口门禁。此命令只读取指导，不编辑文件；入口满足后才能进入 PLAN。' };
  } else if (gate.errors.length === 0 && ['ANALYZE', 'DESIGN', 'PLAN'].includes(state)) {
    const stage = state === 'ANALYZE' ? 'analyze' : state === 'DESIGN' ? 'design' : 'plan';
    if (!isApprovalCurrent(stage, artifacts)) {
      nextCommand = `codespec approve --change ${id} --stage ${stage}`;
      nextAction = { action: 'request_approval', path: metadata.artifacts.metadata, description: '展示当前阶段产物并等待用户独立确认，再记录审批。' };
    } else {
      const target = state === 'ANALYZE' ? 'DESIGN' : state === 'DESIGN' ? 'PLAN' : 'IMPLEMENT';
      nextCommand = `codespec transition --change ${id} --to ${target} --reason "${stage} approved"`;
      nextAction = { action: 'transition', path: metadata.artifacts.metadata, description: `审批有效，申请进入 ${target}；Core 仍会检查转换门禁。` };
    }
  } else if (gate.errors.length === 0 && ['IMPLEMENT', 'VERIFY'].includes(state)) {
    const target = state === 'IMPLEMENT' ? 'VERIFY' : 'ARCHIVE';
    nextCommand = `codespec transition --change ${id} --to ${target} --reason "${state.toLowerCase()} complete"`;
    nextAction = { action: 'transition', path: metadata.artifacts.metadata, description: `申请进入 ${target}。` };
  } else if (gate.errors.length === 0 && state === 'ARCHIVE') {
    nextCommand = `codespec archive ${id}`;
    nextAction = { action: 'request_archive', path: metadata.artifacts.verification, description: '由用户在交互式终端运行并确认归档。' };
  }
  return {
    analysisSummary: analysis ? {
      path: metadata.artifacts.analysis, problem: analysis.problem, goals: analysis.goals,
      acceptanceCriteria: analysis.acceptanceCriteria, complete: analysisErrors.length === 0,
      approved: isApprovalCurrent('analyze', artifacts),
    } : null,
    openQuestions: analysis?.openQuestions.filter((question) => question.status === 'OPEN') ?? [],
    assumptions: analysis?.assumptions ?? [],
    gateErrors: [...new Set([...gate.errors, ...planEntry?.errors ?? []])], gateWarnings: [...new Set([...gate.warnings, ...planEntry?.warnings ?? [], ...traceWarnings])],
    traceGaps, currentCommands,
    deltaBoundary: { requirementIds: analysis?.requirements.map((requirement) => requirement.id) ?? [], baseline: 'Current', fields: ['Previous', 'New', 'Reason'], actions: ['ADDED', 'MODIFIED', 'REMOVED'] },
    nextCommand, nextAction,
  };
}

export function renderCanonicalGuidance(guidance: Awaited<ReturnType<typeof canonicalGuidance>>): string {
  const lines = [`下一步：${guidance.nextCommand}`, `操作：${guidance.nextAction.description}`, `路径（相对 codespec/）：${guidance.nextAction.path}`];
  if (guidance.analysisSummary) lines.push(`分析：${guidance.analysisSummary.problem}；complete=${guidance.analysisSummary.complete}；approved=${guidance.analysisSummary.approved}`);
  for (const question of guidance.openQuestions) lines.push(`OPEN ${question.id}：${question.question}`);
  for (const assumption of guidance.assumptions) lines.push(`${assumption.status} ${assumption.id}：${assumption.statement}`);
  if (guidance.currentCommands.length) lines.push('Current 精确读取：', ...guidance.currentCommands);
  lines.push(`Delta 边界：spec.md 只列受影响 Requirement：${guidance.deltaBoundary.requirementIds.join(', ') || '尚未确认'}。Current 是唯一 baseline；Previous 为完整当前快照，New 为完整目标状态，Reason 说明 action。不要复制整个 Current 或 archive 文本。`);
  for (const error of guidance.gateErrors) lines.push(`门禁阻塞：${error}`);
  for (const gap of guidance.traceGaps) lines.push(`AC 追踪缺口：${gap}`);
  for (const warning of guidance.gateWarnings) lines.push(`警告：${warning}`);
  return lines.join('\n');
}
