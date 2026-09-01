import type { ChangeArtifacts } from './artifacts.js';
import type { WorkspaceContext } from './loaders.js';
import type { ChangeStatus } from './types.js';
import { validateChangeTraceability } from './traceability.js';

export interface GateResult { ok: boolean; errors: string[]; warnings: string[] }
const result = (errors: string[]): GateResult => ({ ok: errors.length === 0, errors, warnings: [] });

function validateState(workspace: WorkspaceContext, artifacts: ChangeArtifacts, state: ChangeStatus): GateResult {
  const m = artifacts.metadata; const errors: string[] = [];
  if (state === 'ANALYZE') {
    if (!/summary/i.test(artifacts.proposal) || !/goals?/i.test(artifacts.proposal) || !/scope/i.test(artifacts.proposal)) errors.push('proposal summary, goals, and scope sections are required');
    if (!m.impact.summary.trim()) errors.push('proposal summary is required');
    if (m.modules.candidates.length === 0) errors.push('module candidates are required');
    if (m.gates.analyze.required && !m.gates.analyze.satisfied) errors.push('analyze gate is not satisfied');
  }
  if (state === 'DESIGN') {
    if (m.modules.confirmed.length === 0) errors.push('confirmed modules are required');
    if (m.gates.design.required && !m.gates.design.satisfied) errors.push('design gate is not satisfied');
    const confirmed = new Set(m.modules.confirmed.map((x) => x.module));
    const refs = [...m.requirements.added, ...m.requirements.modified, ...m.requirements.removed];
    for (const ref of refs) if (!confirmed.has(ref.module)) errors.push(`Requirement ${ref.id} has no confirmed module`);
    const requirementIds = refs.map((x) => x.id);
    if (requirementIds.some((id) => !artifacts.design.includes(id))) errors.push('design Requirement consistency is not satisfied');
  }
  if (state === 'PLAN') {
    if (m.tasks.total === 0 || Object.keys(m.tasks.items).length === 0) errors.push('a concrete task graph is required');
    if (m.gates.plan.required && !m.gates.plan.satisfied) errors.push('plan gate is not satisfied');
    if (Object.values(m.tasks.items).some((item) => !item.title?.trim() || item.status === 'BLOCKED')) errors.push('task graph contains invalid or blocked tasks');
    try { errors.push(...validateChangeTraceability(artifacts).issues); } catch (error) { errors.push(`traceability validation failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (state === 'IMPLEMENT') {
    if (m.tasks.total === 0 || m.tasks.completed !== m.tasks.total || Object.values(m.tasks.items).some((item) => item.status !== 'DONE')) errors.push('all tasks must be DONE');
    if (m.gates.implement.required && !m.gates.implement.satisfied) errors.push('implement gate is not satisfied');
  }
  if (state === 'VERIFY') {
    if (m.gates.verify.required && !m.gates.verify.satisfied) errors.push('verify gate is not satisfied');
    if (!m.verification.verified_at || !/PASS|status|exit_code|exit_status/i.test(artifacts.verification)) errors.push('fresh verification evidence details are required');
    try { errors.push(...validateChangeTraceability(artifacts).issues); } catch (error) { errors.push(`traceability validation failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (state === 'ARCHIVE') {
    if (m.gates.archive.required && !m.gates.archive.satisfied) errors.push('archive gate is not satisfied');
    if (m.archive.conflict) errors.push('archive conflict must be false');
    if (!m.verification.verified_at || !m.verification.requirements_verified || !m.verification.tests_passed || !m.verification.build_passed || !m.verification.lint_passed) errors.push('fresh requirements, tests, build, and lint evidence is required');
    try { errors.push(...validateChangeTraceability(artifacts).issues); } catch (error) { errors.push(`traceability validation failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return result(errors);
}

export function validateExitGate(workspace: WorkspaceContext, artifacts: ChangeArtifacts, target?: ChangeStatus): GateResult {
  const state = target ?? artifacts.metadata?.change?.status;
  if (!state) return result(['Canonical Change artifacts are required for gate validation']);
  return validateState(workspace, artifacts, state);
}

export function validateEntryGate(workspace: WorkspaceContext, artifacts: ChangeArtifacts, target: ChangeStatus): GateResult {
  const current = validateExitGate(workspace, artifacts);
  const entering = validateState(workspace, artifacts, target);
  return result([...current.errors, ...entering.errors]);
}
