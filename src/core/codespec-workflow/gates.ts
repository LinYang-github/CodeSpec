import type { ChangeArtifacts } from './artifacts.js';
import type { WorkspaceContext } from './loaders.js';
import type { ChangeStatus } from './types.js';
import { validateChangeTraceability } from './traceability.js';
import { validateChangeArchiveImpact } from './archive-impact.js';
import { validateCurrentVerificationArtifacts } from './verification.js';
import { evaluateMinimumSddLevel } from './sdd-level.js';
import { parseCurrentTasks } from './current-change-yaml.js';
import { validateAnalysisAgainstWorkspace } from './analysis-consistency.js';
import { parse as parseYaml } from 'yaml';

export interface GateResult { ok: boolean; errors: string[]; warnings: string[] }
const result = (errors: string[]): GateResult => ({ ok: errors.length === 0, errors, warnings: [] });

function validateSddLevel(artifacts: ChangeArtifacts): string[] {
  const metadata = artifacts.metadata;
  const ownedModuleCount = metadata.modules.confirmed.filter((module) => module.outcome === 'OWNED').length;
  const assessment = evaluateMinimumSddLevel({
    mode: metadata.change.mode,
    scope: metadata.impact.scope,
    ownedModuleCount,
    affectedAreas: metadata.impact.affected_areas,
  });
  const errors: string[] = [];

  if (metadata.change.sdd_level < assessment.minimum) {
    errors.push(
      `metadata 的 SDD Level ${metadata.change.sdd_level} 低于 Core 最低建议 Level ${assessment.minimum}：${assessment.reasons.join('；')}`
    );
  }

  const design = artifacts.design;
  if (!/^##\s+SDD 分级依据\s*$/mu.test(design)) {
    errors.push('设计产物必须包含“SDD 分级依据”章节');
  }
  if (metadata.change.sdd_level === 1 && !/^##\s+设计说明\s*$/mu.test(artifacts.spec)) {
    errors.push('Level 1 的 spec.md 必须内联“设计说明”章节');
  }
  if (metadata.change.sdd_level === 3) {
    const requiredSections = ['架构', '接口契约', '迁移', '回滚', '发布'];
    const missing = requiredSections.filter(
      (title) => !new RegExp(`^##\\s+${title}\\s*$`, 'mu').test(design)
    );
    if (missing.length > 0) {
      errors.push(`Level 3 的 design.md 缺少章节：${missing.join('、')}`);
    }
  }
  return errors;
}

async function validateState(workspace: WorkspaceContext, artifacts: ChangeArtifacts, state: ChangeStatus): Promise<GateResult> {
  const m = artifacts.metadata; const errors: string[] = []; const warnings: string[] = [];
  if (state === 'ANALYZE') {
    errors.push(...await validateAnalysisAgainstWorkspace(workspace, artifacts));
  }
  if (state === 'DESIGN') {
    errors.push(...validateSddLevel(artifacts));
    if (m.modules.confirmed.length === 0) errors.push('必须确认模块');
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
    let currentTasks;
    try { currentTasks = parseCurrentTasks(parseYaml(artifacts.tasks)); }
    catch (error) { errors.push(`任务 YAML 无效：${error instanceof Error ? error.message : String(error)}`); }
    if (currentTasks && currentTasks.changeRevision !== m.change.revision) {
      errors.push(`tasks.yaml.changeRevision 必须等于 metadata.change.revision ${m.change.revision}`);
    }
    if (!currentTasks || currentTasks.tasks.length === 0) errors.push('必须提供具体的任务图');
    if (currentTasks?.tasks.some((task) => !task.title.trim())) errors.push('任务图包含无效或被阻塞的任务');
    try { errors.push(...validateChangeTraceability(artifacts).issues); } catch (error) { errors.push(`追踪关系校验失败：${error instanceof Error ? error.message : String(error)}`); }
  }
  if (state === 'IMPLEMENT') {
    try {
      const tasks = parseCurrentTasks(parseYaml(artifacts.tasks));
      if (tasks.changeRevision !== m.change.revision) errors.push('tasks.yaml.changeRevision 必须等于 metadata.change.revision');
      if (!tasks.tasks.length || tasks.tasks.some((task) => task.status !== 'DONE')) errors.push('全部任务必须为 DONE');
      errors.push(...validateChangeTraceability(artifacts).issues);
    } catch (error) { errors.push(`任务 YAML 无效：${error instanceof Error ? error.message : String(error)}`); }
  }
  if (state === 'VERIFY') {
    errors.push(...await validateCurrentVerificationArtifacts(workspace, artifacts, warnings));
  }
  if (state === 'ARCHIVE') {
    if (m.gates.archive.required && !m.gates.archive.satisfied) errors.push('ARCHIVE 门禁尚未满足');
    if (m.archive.conflict) errors.push('archive conflict 必须为 false');
    errors.push(...await validateCurrentVerificationArtifacts(workspace, artifacts, warnings));
  }
  if (workspace.config?.schema === 'code-spec' && ['DESIGN', 'PLAN', 'IMPLEMENT', 'VERIFY', 'ARCHIVE'].includes(state)) {
    try {
      const check = await validateChangeArchiveImpact(workspace, artifacts);
      errors.push(...check.issues);
    }
    catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  return { ok: !errors.length, errors, warnings };
}

export async function validateExitGate(workspace: WorkspaceContext, artifacts: ChangeArtifacts, target?: ChangeStatus): Promise<GateResult> {
  const state = target ?? artifacts.metadata?.change?.status;
  if (!state) return result(['状态门禁校验需要 canonical Change 产物']);
  return validateState(workspace, artifacts, state);
}

export async function validateEntryGate(workspace: WorkspaceContext, artifacts: ChangeArtifacts, target: ChangeStatus): Promise<GateResult> {
  // Entry validation must not validate the target as if it were already
  // complete. IMPLEMENT is entered before its tasks are done, and VERIFY is
  // entered before fresh evidence exists. The current state's exit gate is
  // the only completion check at this boundary.
  const current = await validateExitGate(workspace, artifacts);
  const entering = result([]);
  return { ...result([...current.errors, ...entering.errors]), warnings: [...current.warnings, ...entering.warnings] };
}
