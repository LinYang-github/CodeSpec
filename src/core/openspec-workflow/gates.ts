import type { ChangeArtifacts } from './artifacts.js';
import type { WorkspaceContext } from './loaders.js';
import type { ChangeStatus } from './types.js';
import { validateChangeTraceability } from './traceability.js';
import { parseDeltaSpec } from './delta-parser.js';
import { collectEmptyScenarioErrorIssues } from './scenario-parser.js';

export interface GateResult { ok: boolean; errors: string[]; warnings: string[] }
const result = (errors: string[]): GateResult => ({ ok: errors.length === 0, errors, warnings: [] });

function validateDeltaScenarioErrors(spec: string, changeId?: string): string[] {
  if (!/^##\s+(?:ADDED|MODIFIED|REMOVED)\b/mu.test(spec)) return [];
  try {
    return parseDeltaSpec(spec).entries.flatMap((entry) => collectEmptyScenarioErrorIssues(entry.id, entry.scenarios, changeId));
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

function validateState(workspace: WorkspaceContext, artifacts: ChangeArtifacts, state: ChangeStatus): GateResult {
  const m = artifacts.metadata; const errors: string[] = [];
  errors.push(...validateDeltaScenarioErrors(artifacts.spec, m.change.id));
  if (state === 'ANALYZE') {
    if (!/summary/i.test(artifacts.proposal) || !/goals?/i.test(artifacts.proposal) || !/scope/i.test(artifacts.proposal)) errors.push('proposal 必须包含 summary、goals 和 scope 部分');
    if (!m.impact.summary.trim()) errors.push('必须填写 proposal summary');
    if (m.modules.candidates.length === 0) errors.push('必须提供模块候选项');
    if (m.gates.analyze.required && !m.gates.analyze.satisfied) errors.push('ANALYZE 门禁尚未满足');
  }
  if (state === 'DESIGN') {
    if (m.modules.confirmed.length === 0) errors.push('必须确认模块');
    if (m.gates.design.required && !m.gates.design.satisfied) errors.push('DESIGN 门禁尚未满足');
    const owners = m.modules.confirmed.filter((x) => x.outcome === 'OWNED');
    const confirmed = new Set(owners.map((x) => x.module));
    const refs = [...m.requirements.added, ...m.requirements.modified, ...m.requirements.removed];
    for (const ref of refs) {
      if (!confirmed.has(ref.module) || owners.filter((owner) => owner.module === ref.module).length !== 1) errors.push(`Requirement ${ref.id} 没有唯一确认的 OWNED 模块`);
      if (!ref.id.startsWith(`${ref.module}-`)) errors.push(`Requirement ${ref.id} 不属于模块 ${ref.module}`);
    }
    const requirementIds = refs.map((x) => x.id);
    if (requirementIds.some((id) => !artifacts.design.includes(id))) errors.push('DESIGN 中的 Requirement 一致性尚未满足');
  }
  if (state === 'PLAN') {
    if (m.tasks.total === 0 || Object.keys(m.tasks.items).length === 0) errors.push('必须提供具体的任务图');
    if (m.gates.plan.required && !m.gates.plan.satisfied) errors.push('PLAN 门禁尚未满足');
    if (Object.values(m.tasks.items).some((item) => !item.title?.trim() || item.status === 'BLOCKED')) errors.push('任务图包含无效或被阻塞的任务');
    try { errors.push(...validateChangeTraceability(artifacts).issues); } catch (error) { errors.push(`追踪关系校验失败：${error instanceof Error ? error.message : String(error)}`); }
  }
  if (state === 'IMPLEMENT') {
    if (m.tasks.total === 0 || m.tasks.completed !== m.tasks.total || Object.values(m.tasks.items).some((item) => item.status !== 'DONE')) errors.push('全部任务必须为 DONE');
    if (m.gates.implement.required && !m.gates.implement.satisfied) errors.push('IMPLEMENT 门禁尚未满足');
  }
  if (state === 'VERIFY') {
    if (m.gates.verify.required && !m.gates.verify.satisfied) errors.push('VERIFY 门禁尚未满足');
    if (!m.verification.requirements_verified) errors.push('缺少 Requirement 验证证据');
    if (!m.verification.tests_passed) errors.push('缺少测试验证证据');
    if (!m.verification.build_passed) errors.push('缺少构建验证证据');
    if (!m.verification.lint_passed) errors.push('缺少 lint 验证证据');
    if (!m.verification.verified_at || !/PASS|status|exit_code|exit_status/i.test(artifacts.verification)) errors.push('必须提供最新的详细验证证据');
    try { errors.push(...validateChangeTraceability(artifacts).issues); } catch (error) { errors.push(`追踪关系校验失败：${error instanceof Error ? error.message : String(error)}`); }
  }
  if (state === 'ARCHIVE') {
    if (m.gates.archive.required && !m.gates.archive.satisfied) errors.push('ARCHIVE 门禁尚未满足');
    if (m.archive.conflict) errors.push('archive conflict 必须为 false');
    if (!m.verification.verified_at || !m.verification.requirements_verified || !m.verification.tests_passed || !m.verification.build_passed || !m.verification.lint_passed) errors.push('必须提供最新的 Requirement、测试、构建和 lint 证据');
    try { errors.push(...validateChangeTraceability(artifacts).issues); } catch (error) { errors.push(`追踪关系校验失败：${error instanceof Error ? error.message : String(error)}`); }
  }
  return result(errors);
}

export function validateExitGate(workspace: WorkspaceContext, artifacts: ChangeArtifacts, target?: ChangeStatus): GateResult {
  const state = target ?? artifacts.metadata?.change?.status;
  if (!state) return result(['状态门禁校验需要 canonical Change 产物']);
  return validateState(workspace, artifacts, state);
}

export function validateEntryGate(workspace: WorkspaceContext, artifacts: ChangeArtifacts, target: ChangeStatus): GateResult {
  // Entry validation must not validate the target as if it were already
  // complete. IMPLEMENT is entered before its tasks are done, and VERIFY is
  // entered before fresh evidence exists. The current state's exit gate is
  // the only completion check at this boundary.
  const current = validateExitGate(workspace, artifacts);
  // PLAN is the one target whose entry has a meaningful precondition: its
  // task graph and traceability must exist before implementation can begin.
  // IMPLEMENT/VERIFY/ARCHIVE are completion states reached after their own
  // preceding state's exit gate, so validating them here would make entry
  // circular (tasks/evidence are produced after entry).
  const entering = target === 'PLAN' ? validateState(workspace, artifacts, target) : result([]);
  return result([...current.errors, ...entering.errors]);
}
