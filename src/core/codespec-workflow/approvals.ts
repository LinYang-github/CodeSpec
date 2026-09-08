import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { parse as parseYaml } from 'yaml';

import type { ChangeArtifacts } from './artifacts.js';
import { withChangeIndexLock } from './change-index.js';
import { validateExitGate } from './gates.js';
import type { WorkspaceContext } from './loaders.js';
import type { ApprovalRecord, ApprovalStage, ChangeMetadata, ChangeStatus } from './types.js';
import { hashTaskApprovalContent, parseCurrentTasks, projectCurrentSpecForDesignApproval, projectCurrentSpecForPlanApproval } from './current-change-yaml.js';

export interface ChangeContent {
  design: string;
  spec: string;
  tasks: string;
  verification: string;
}

export interface ApprovalImpact {
  designChanged: boolean;
  planChanged: boolean;
  locatorOnly: boolean;
}

export function createPendingApprovals(revision: number): ChangeMetadata['approvals'] {
  const pending = (): ApprovalRecord => ({ status: 'pending', revision, content_hash: '', approved_at: null });
  return { schema_version: 1, design: pending(), plan: pending() };
}

function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, '\n').trimEnd();
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function taskPlanProjection(tasks: string): unknown {
  try {
    const parsed = parseCurrentTasks(parseYaml(tasks));
    return {
      ...parsed,
      tasks: parsed.tasks.map(({ status: _status, ...task }) => task),
    };
  } catch {
    return normalizeContent(tasks);
  }
}

/**
 * Compares only user-approved fields. Verification execution and locator-only
 * updates intentionally do not invalidate the two approval stages.
 */
export function classifyArtifactChange(before: ChangeContent, after: ChangeContent): ApprovalImpact {
  const designChanged = stable({ design: normalizeContent(before.design), spec: projectCurrentSpecForDesignApproval(before.spec) })
    !== stable({ design: normalizeContent(after.design), spec: projectCurrentSpecForDesignApproval(after.spec) });
  const planChanged = stable({ spec: projectCurrentSpecForPlanApproval(before.spec), tasks: taskPlanProjection(before.tasks) })
    !== stable({ spec: projectCurrentSpecForPlanApproval(after.spec), tasks: taskPlanProjection(after.tasks) });
  const anyArtifactChanged = before.design !== after.design || before.spec !== after.spec || before.tasks !== after.tasks || before.verification !== after.verification;
  return { designChanged, planChanged, locatorOnly: anyArtifactChanged && !designChanged && !planChanged };
}

function hashPayload(stage: ApprovalStage, artifacts: ChangeArtifacts): string {
  const metadata = artifacts.metadata;
  if (!metadata.artifacts.proposal) {
    if (stage === 'plan') {
      return hashTaskApprovalContent({
        design: artifacts.design,
        spec: artifacts.spec,
        tasks: parseCurrentTasks(parseYaml(artifacts.tasks)),
      });
    }
    return createHash('sha256').update(JSON.stringify({
      design: normalizeContent(artifacts.design),
      spec: projectCurrentSpecForDesignApproval(artifacts.spec),
    })).digest('hex');
  }
  const payload = stage === 'design'
    ? {
      proposal: normalizeContent(artifacts.proposal), design: normalizeContent(artifacts.design), spec: normalizeContent(artifacts.spec),
      requirements: metadata.requirements, sdd_level: metadata.change.sdd_level,
    }
    : {
      design: normalizeContent(artifacts.design), spec: normalizeContent(artifacts.spec), tasks: normalizeContent(artifacts.tasks),
      requirements: metadata.requirements, task_items: metadata.tasks.items,
    };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function stageForTarget(target: ChangeStatus): ApprovalStage | null {
  if (target === 'PLAN') return 'design';
  if (target === 'IMPLEMENT') return 'plan';
  return null;
}

function stageLabel(stage: ApprovalStage): string {
  return stage === 'design' ? '设计' : '计划';
}

export function assertTransitionApproval(artifacts: ChangeArtifacts, target: ChangeStatus): void {
  const stage = stageForTarget(target);
  if (!stage) return;
  const approval = artifacts.metadata.approvals?.[stage];
  const label = stageLabel(stage);
  if (!approval || approval.status !== 'approved') throw new Error(`${label}尚未获得用户确认；请展示${label}并等待独立确认。`);
  if (approval.revision !== artifacts.metadata.change.revision) throw new Error(`${label}确认已因 Change revision 变化而失效；请重新确认。`);
  if (approval.content_hash !== hashPayload(stage, artifacts)) throw new Error(`${label}内容已变更，原确认已失效；请重新确认。`);
}

export function approveStage(
  artifacts: ChangeArtifacts,
  stage: ApprovalStage,
  approvedAt = new Date().toISOString()
): ChangeMetadata {
  const current = artifacts.metadata;
  const approval = {
    status: 'approved' as const,
    revision: current.change.revision,
    content_hash: hashPayload(stage, artifacts),
    approved_at: approvedAt,
  };
  return { ...current, approvals: { ...current.approvals, [stage]: approval } };
}

export async function approveChangeStage(
  workspace: WorkspaceContext,
  artifacts: ChangeArtifacts,
  stage: ApprovalStage
): Promise<ChangeMetadata> {
  const expectedStatus = stage === 'design' ? 'DESIGN' : 'PLAN';
  if (artifacts.metadata.change.status !== expectedStatus) {
    throw new Error(`只能在 ${expectedStatus} 状态确认${stageLabel(stage)}。`);
  }
  const gate = await validateExitGate(workspace, artifacts);
  if (!gate.ok) throw new Error(`无法确认${stageLabel(stage)}：阶段门禁未通过：${gate.errors.join('；')}`);

  const next = approveStage(artifacts, stage);
  const metadataPath = path.join(workspace.codespecDir, artifacts.metadata.artifacts.metadata);
  await withChangeIndexLock(workspace.paths, async () => {
    const token = `.approve-${process.pid}-${Date.now()}`;
    const temporaryPath = `${metadataPath}${token}.tmp`;
    try {
      await fs.writeFile(temporaryPath, stringifyYaml(next), 'utf8');
      await fs.rename(temporaryPath, metadataPath);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  });
  return next;
}

export function revokeApprovals(metadata: ChangeMetadata): ChangeMetadata {
  const revoked = (): ApprovalRecord => ({
    status: 'revoked', revision: metadata.change.revision, content_hash: '', approved_at: null,
  });
  return { ...metadata, approvals: { schema_version: 1, design: revoked(), plan: revoked() } };
}
