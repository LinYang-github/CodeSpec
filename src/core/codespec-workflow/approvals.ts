import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { parse as parseYaml } from 'yaml';

import { loadChangeArtifacts, type ChangeArtifacts } from './artifacts.js';
import { parseAnalysisDocument, projectAnalysisForApproval } from './analysis.js';
import { projectPendingAnalysis } from './analysis-consistency.js';
import { withChangeIndexLock } from './change-index.js';
import { validateExitGate } from './gates.js';
import { loadWorkspace, type WorkspaceContext } from './loaders.js';
import { metadataForPersistence } from './metadata-persistence.js';
import type { ApprovalRecord, ApprovalStage, ChangeMetadata, ChangeStatus } from './types.js';
import { parseCurrentTasks, projectCurrentSpecForDesignApproval, projectCurrentSpecForPlanApproval } from './current-change-yaml.js';
import { parseChangeMetadata } from './schemas.js';
import { createArchiveJournal, installArchiveJournal, markArchiveJournalCommitted, recoverPendingTransactions } from './transaction-journal.js';

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
  return { schema_version: 1, analyze: pending(), design: pending(), plan: pending() };
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

function analysisApprovalPayload(artifacts: ChangeArtifacts): unknown {
  if (artifacts.analysis === null) throw new Error('分析审批需要 analysis.yaml。');
  return projectAnalysisForApproval(parseAnalysisDocument(parseYaml(artifacts.analysis)));
}

function canonicalApprovalPayload(stage: ApprovalStage, artifacts: ChangeArtifacts): unknown {
  const analysis = analysisApprovalPayload(artifacts);
  if (stage === 'analyze') return analysis;
  if (stage === 'design') {
    return {
      analysis,
      design: normalizeContent(artifacts.design),
      spec: projectCurrentSpecForDesignApproval(artifacts.spec),
    };
  }
  const tasks = parseCurrentTasks(parseYaml(artifacts.tasks));
  return {
    analysis,
    design: normalizeContent(artifacts.design),
    spec: projectCurrentSpecForPlanApproval(artifacts.spec),
    tasks: {
      ...tasks,
      tasks: tasks.tasks.map(({ status: _status, ...task }) => task),
    },
  };
}

/** Returns the semantic receipt hash for the requested approval stage. */
export function approvalContentHash(stage: ApprovalStage, artifacts: ChangeArtifacts): string {
  const metadata = artifacts.metadata;
  if (!metadata.artifacts.proposal) {
    return createHash('sha256').update(JSON.stringify(canonicalApprovalPayload(stage, artifacts))).digest('hex');
  }
  if (stage === 'analyze') throw new Error('仅六产物 canonical Change 支持分析审批。');
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

/** Only an unchanged, current user receipt may survive revision regeneration. */
export function isApprovalCurrent(stage: ApprovalStage, artifacts: ChangeArtifacts): boolean {
  const receipt = artifacts.metadata.approvals[stage];
  return receipt?.status === 'approved' && receipt.revision === artifacts.metadata.change.revision &&
    receipt.content_hash === approvalContentHash(stage, artifacts);
}

function stageForTarget(artifacts: ChangeArtifacts, target: ChangeStatus): ApprovalStage | null {
  if (target === 'DESIGN') return artifacts.metadata.artifacts.proposal ? null : 'analyze';
  if (target === 'PLAN') return 'design';
  if (target === 'IMPLEMENT') return 'plan';
  return null;
}

function stageLabel(stage: ApprovalStage): string {
  return stage === 'analyze' ? '分析' : stage === 'design' ? '设计' : '计划';
}

export function assertTransitionApproval(artifacts: ChangeArtifacts, target: ChangeStatus): void {
  const stage = stageForTarget(artifacts, target);
  if (!stage) return;
  const approval = artifacts.metadata.approvals?.[stage];
  const label = stageLabel(stage);
  if (!approval || approval.status !== 'approved') throw new Error(`${label}尚未获得用户确认；请展示${label}并等待独立确认。`);
  if (approval.revision !== artifacts.metadata.change.revision) throw new Error(`${label}确认已因 Change revision 变化而失效；请重新确认。`);
  if (approval.content_hash !== approvalContentHash(stage, artifacts)) throw new Error(`${label}内容已变更，原确认已失效；请重新确认。`);
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
    content_hash: approvalContentHash(stage, artifacts),
    approved_at: approvedAt,
  };
  return { ...current, approvals: { ...current.approvals, [stage]: approval } };
}

export async function approveChangeStage(
  workspace: WorkspaceContext,
  artifacts: ChangeArtifacts,
  stage: ApprovalStage
): Promise<ChangeMetadata> {
  const expectedStatus = stage === 'analyze' ? 'ANALYZE' : stage === 'design' ? 'DESIGN' : 'PLAN';
  if (artifacts.metadata.change.status !== expectedStatus) {
    throw new Error(`只能在 ${expectedStatus} 状态确认${stageLabel(stage)}。`);
  }
  return withChangeIndexLock(workspace.paths, async () => {
    const currentWorkspace = await loadWorkspace(workspace.codespecDir);
    if (!isDeepStrictEqual(currentWorkspace.paths, workspace.paths)) throw new Error('Approval conflict: workspace paths changed; reload before approval');
    const fresh = await loadChangeArtifacts(currentWorkspace.paths, artifacts.changeId);
    if (!isDeepStrictEqual(fresh, artifacts)) throw new Error('Approval conflict: stale Change artifacts; reload before approval');
    if (fresh.metadata.change.status !== expectedStatus) throw new Error(`只能在 ${expectedStatus} 状态确认${stageLabel(stage)}。`);
    const metadataPath = path.join(currentWorkspace.codespecDir, fresh.metadata.artifacts.metadata);
    const originalMetadata = await fs.readFile(metadataPath, 'utf8');
    if (!isDeepStrictEqual(parseChangeMetadata(parseYaml(originalMetadata)), fresh.metadata)) throw new Error('Approval conflict: metadata changed during load');
    const originals = new Map<string, string>([[currentWorkspace.paths.changeIndex, await fs.readFile(currentWorkspace.paths.changeIndex, 'utf8')]]);
    for (const name of ['analysis', 'proposal', 'design', 'spec', 'tasks', 'verification'] as const) {
      const relative = fresh.metadata.artifacts[name];
      if (relative) originals.set(path.join(currentWorkspace.codespecDir, relative), fresh[name]!);
    }
    const checkInputs = async () => {
      for (const [file, before] of originals) {
        if (await fs.readFile(file, 'utf8') !== before) throw new Error(`Approval conflict: input changed during approval: ${file}`);
      }
    };
    const candidate = stage === 'analyze' ? projectPendingAnalysis(fresh) : fresh;
    const gate = await validateExitGate(currentWorkspace, candidate);
    if (!gate.ok) throw new Error(`无法确认${stageLabel(stage)}：阶段门禁未通过：${gate.errors.join('；')}`);
    const next = approveStage(candidate, stage);
    let journal: Awaited<ReturnType<typeof createArchiveJournal>> | undefined;
    let committed = false;
    try {
      await checkInputs();
      journal = await createArchiveJournal({
        paths: currentWorkspace.paths, transactionId: `approve-${fresh.changeId}-${randomUUID()}`, ownerPid: process.pid,
        files: [{ target: metadataPath, before: originalMetadata, after: stringifyYaml(metadataForPersistence(next)) }],
      });
      await installArchiveJournal(journal, checkInputs);
      await checkInputs();
      await markArchiveJournalCommitted(journal);
      committed = true;
      await recoverPendingTransactions(currentWorkspace.paths, journal.transactionId);
    } catch (error) {
      if (committed) throw new Error(`${String(error)} (approval committed; recovery requires retry)`);
      if (journal) {
        try { await recoverPendingTransactions(currentWorkspace.paths, journal.transactionId); }
        catch (failure) { throw new AggregateError([error, failure], `Approval failed: ${String(error)}; rollback conflict or incomplete recovery: ${String(failure)}`); }
      }
      throw error;
    }
    return next;
  });
}

export function revokeApprovals(metadata: ChangeMetadata, stages: readonly ApprovalStage[] = ['analyze', 'design', 'plan']): ChangeMetadata {
  const revoked = (): ApprovalRecord => ({
    status: 'revoked', revision: metadata.change.revision, content_hash: '', approved_at: null,
  });
  const approvals = { ...metadata.approvals };
  for (const stage of stages) approvals[stage] = revoked();
  return { ...metadata, approvals };
}
