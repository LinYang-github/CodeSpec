import type { ChangeArtifacts } from './artifacts.js';
import type { WorkspaceContext } from './loaders.js';
import type { ChangeStatus } from './types.js';

export interface GateResult { ok: boolean; errors: string[]; warnings: string[] }
const result = (errors: string[]): GateResult => ({ ok: errors.length === 0, errors, warnings: [] });

export function validateExitGate(_workspace: WorkspaceContext, artifacts: ChangeArtifacts, target: ChangeStatus): GateResult {
  const m = artifacts.metadata;
  const errors: string[] = [];
  if (target === 'ANALYZE') {
    if (!/summary/i.test(artifacts.proposal) || !/goals?/i.test(artifacts.proposal) || !/scope/i.test(artifacts.proposal)) errors.push('proposal summary, goals, and scope sections are required');
    if (!m.impact.summary.trim()) errors.push('proposal summary is required');
    if (m.modules.candidates.length === 0) errors.push('module candidates are required');
    if (!m.gates.analyze.satisfied) errors.push('analyze gate is not satisfied');
  }
  if (target === 'DESIGN') {
    if (m.modules.confirmed.length === 0) errors.push('confirmed modules are required');
    if (!m.gates.design.satisfied) errors.push('design gate is not satisfied');
    const confirmed = new Set(m.modules.confirmed.map((x) => x.module));
    for (const ref of [...m.requirements.added, ...m.requirements.modified, ...m.requirements.removed]) if (!confirmed.has(ref.module)) errors.push(`Requirement ${ref.id} has no confirmed module`);
    const requirementIds = m.requirements.added.concat(m.requirements.modified, m.requirements.removed).map((x) => x.id);
    if (requirementIds.length > 0 && requirementIds.some((id) => !artifacts.design.includes(id))) errors.push('design Requirement consistency is not satisfied');
  }
  if (target === 'PLAN') {
    if (m.tasks.total === 0 || Object.keys(m.tasks.items).length === 0) errors.push('a concrete task graph is required');
    if (!m.gates.plan.satisfied) errors.push('plan gate is not satisfied');
    if (Object.values(m.tasks.items).some((item) => !item.title?.trim() || item.status === 'BLOCKED')) errors.push('task graph contains invalid or blocked tasks');
  }
  if (target === 'IMPLEMENT') {
    if (m.tasks.total === 0 || m.tasks.completed !== m.tasks.total) errors.push('all tasks must be DONE');
    if (!m.gates.implement.satisfied) errors.push('implement gate is not satisfied');
  }
  if (target === 'VERIFY') {
    if (!m.gates.verify.satisfied) errors.push('verify gate is not satisfied');
    if (!m.verification.verified_at || !/test|build|lint|requirement/i.test(artifacts.verification)) errors.push('fresh verification evidence details are required');
  }
  return result(errors);
}

export function validateEntryGate(workspace: WorkspaceContext, artifacts: ChangeArtifacts, target: ChangeStatus): GateResult {
  const errors: string[] = [];
  if (target === 'ARCHIVE' && (!artifacts.metadata.verification.requirements_verified || !artifacts.metadata.verification.tests_passed || !artifacts.metadata.verification.build_passed || !artifacts.metadata.verification.lint_passed)) {
    errors.push('fresh requirements, tests, build, and lint evidence is required');
  }
  const exit = validateExitGate(workspace, artifacts, target);
  errors.push(...exit.errors);
  return result(errors);
}
