import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ChangeArtifacts } from './artifacts.js';
import type { WorkspaceContext } from './loaders.js';
import { loadChangeArtifacts } from './loaders.js';
import { validateChangeTraceability, acceptanceCriteriaForTest, type TraceRow } from './traceability.js';
import { parseConfiguration } from './current-spec-yaml.js';
import { parseCurrentTasks, parseCurrentVerification, mergeCurrentVerificationPlans, projectCurrentSpecForPlanApproval, type CurrentVerification } from './current-change-yaml.js';
import { parseAnalysisDocument, projectAnalysisForApproval } from './analysis.js';
import { validateCurrentVerificationPlan } from './current-verification-policy.js';
import { parseChangeMetadata } from './schemas.js';
import { withChangeIndexLock } from './change-index.js';
import { createArchiveJournal, installArchiveJournal, markArchiveJournalCommitted, recoverPendingTransactions } from './transaction-journal.js';
import {
  validateRuntimeConfiguration,
  type ControlledVerificationKind,
} from './verification-policy.js';

export type VerificationKind = 'requirements' | ControlledVerificationKind;
export interface VerificationCommand {
  command: string;
  kind?: VerificationKind;
  requirementIds?: string[];
  scenarioIds?: string[];
  testCase?: string;
  testFile?: string;
  testId?: string;
  profile?: string;
  services?: string[];
  browser?: string;
  cleanupSucceeded?: boolean;
}
export interface VerificationEvidence {
  schema_version: 1;
  change_id: string;
  verified_at: string;
  revision: number;
  status: 'PASS' | 'FAIL';
  requirement_ids: string[];
  scenario_ids: string[];
  baseline_identity: string;
  receipt: string;
  artifact_identity?: string;
  not_applicable?: Partial<Record<ControlledVerificationKind, string>>;
  trace_rows?: TraceRow[];
  commands: Array<{
    command: string;
    kind: VerificationKind;
    exit_code: number;
    output_summary: string;
    started_at: string;
    finished_at: string;
    requirement_ids?: string[];
    scenario_ids?: string[];
  }>;
}

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function verificationArtifactIdentity(artifacts: Pick<ChangeArtifacts, 'analysis' | 'design' | 'spec' | 'tasks' | 'metadata'>): string {
  const tasks = parseCurrentTasks(parseYaml(artifacts.tasks));
  return hash({ analysis: projectAnalysisForApproval(parseAnalysisDocument(parseYaml(artifacts.analysis))),
    revision: artifacts.metadata.change.revision,
    design: artifacts.design.replace(/\r\n/gu, '\n').trimEnd(), spec: projectCurrentSpecForPlanApproval(artifacts.spec),
    tasks: { ...tasks, tasks: tasks.tasks.map(({ status: _status, ...task }) => task) },
  });
}

/** Shared semantic evidence gate for canonical VERIFY and archive consumers. */
function validateCurrentVerificationContent(artifacts: ChangeArtifacts, warnings?: string[]): string[] {
  const tasks = parseCurrentTasks(parseYaml(artifacts.tasks));
  const verification = parseCurrentVerification(parseYaml(artifacts.verification));
  const errors: string[] = [];
  let optionalEvidence: Set<string> | undefined;
  const trace = validateChangeTraceability(artifacts, true);
  errors.push(...trace.issues); warnings?.push(...trace.warnings ?? []);
  if (verification.artifactIdentity !== verificationArtifactIdentity(artifacts)) errors.push('Verification artifact identity is stale; run fresh verification');
  const analysis = parseAnalysisDocument(parseYaml(artifacts.analysis));
  const mustRequirements = new Set<string>(analysis.acceptanceCriteria.filter((ac) => ac.priority === 'MUST').flatMap((ac) => ac.requirements));
  optionalEvidence = new Set(tasks.tasks.flatMap((task) => task.testCases).filter((id) => !mustRequirements.has(id.split('-SCN-')[0])));
  errors.push(...validateCurrentVerificationPlan(tasks, verification, {
    commit: artifacts.metadata.baseline.commit,
    working_tree_fingerprint: artifacts.metadata.baseline.working_tree_fingerprint,
    revision: artifacts.metadata.change.revision,
  }, { optionalEvidence }));
  return errors;
}

/** Validates the v1 execution record, its approved task plan, and runtime configuration snapshot. */
export async function validateCurrentVerificationArtifacts(
  workspace: WorkspaceContext,
  artifacts: ChangeArtifacts,
  warnings?: string[],
): Promise<string[]> {
  try {
    const tasks = parseCurrentTasks(parseYaml(artifacts.tasks));
    const errors = validateCurrentVerificationContent(artifacts, warnings);
    try {
      const configuration = parseConfiguration(parseYaml(await fs.readFile(workspace.paths.configuration, 'utf8')));
      for (const task of tasks.tasks) {
        for (const plan of task.verificationPlan) {
          const profile = configuration.profiles.find((candidate) => candidate.id === plan.profile);
          if (!profile) {
            errors.push(`Verification profile is not configured: ${plan.profile}`);
            continue;
          }
          for (const serviceId of plan.services) {
            if (!profile.services.some((service) => service.id === serviceId)) {
              errors.push(`Verification service is not configured for profile ${profile.id}: ${serviceId}`);
            }
          }
        }
      }
      errors.push(...await validateRuntimeConfiguration(path.dirname(workspace.codespecDir), configuration));
    } catch (error) {
      errors.push(`运行配置快照无效：${error instanceof Error ? error.message : String(error)}`);
    }
    return errors;
  } catch (error) {
    return [`验证 YAML 无效：${error instanceof Error ? error.message : String(error)}`];
  }
}

/** Keeps only the latest human-readable execution summary in an archived module spec. */
export function appendLatestVerificationSummary(spec: string, verification: CurrentVerification): string {
  const latest = [...verification.testCases].sort((left, right) => right.executedAt.localeCompare(left.executedAt));
  const summary = [
    '### 最近验证摘要',
    '',
    ...(latest.length
      ? latest.map((record) => `- \`${record.testCase}\`：${record.result}；${record.summary}；${record.executedAt}`)
      : ['- 暂无验证记录']),
  ].join('\n');
  const marker = '\n### 最近验证摘要\n';
  const existingSummary = spec.indexOf(marker);
  const base = existingSummary < 0 ? spec : spec.slice(0, existingSummary);
  return `${base.trimEnd()}\n\n${summary}\n`;
}

async function runVerificationCommand(command: string, cwd: string): Promise<{ status: number; output: string }> {
  const child = spawn(command, { shell: true, cwd });
  let output = '';
  child.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
  child.stderr?.on('data', (data: Buffer) => { output += data.toString(); });
  return new Promise((resolve) => {
    child.on('error', () => resolve({ status: 1, output }));
    child.on('close', (status) => resolve({ status: status ?? 1, output }));
  });
}

/** Records v1 execution evidence directly into verification.yaml. */
async function recordFreshCurrentVerification(
  workspace: WorkspaceContext,
  artifacts: ChangeArtifacts,
  commands: VerificationCommand[],
): Promise<VerificationEvidence> {
  const metadata = structuredClone(artifacts.metadata);
  const tasks = parseCurrentTasks(parseYaml(artifacts.tasks));
  const artifactIdentity = verificationArtifactIdentity(artifacts);
  const issues = validateChangeTraceability(artifacts).issues;
  if (issues.length) throw new Error(issues.join('; '));
  const plans = mergeCurrentVerificationPlans(tasks);
  if (!plans.length) throw new Error('当前 Change 没有可执行的 verificationPlan。');

  const supplied = new Map<string, VerificationCommand>();
  for (const command of commands) {
    const key = command.testCase ?? command.command;
    if (supplied.has(key)) throw new Error(`重复的当前规格验证命令：${key}`);
    supplied.set(key, command);
  }
  const baselineCommit = metadata.baseline.commit ?? '0000000';
  const baselineFingerprint = metadata.baseline.working_tree_fingerprint;
  const records: Array<Record<string, unknown>> = [];
  let failed = false;
  for (const plan of plans) {
    const command = supplied.get(plan.testCase) ?? supplied.get(plan.command);
    if (!command) throw new Error(`缺少 ${plan.testCase} 的验证命令。`);
    if (command.command !== plan.command) throw new Error(`验证命令与任务计划不一致：${plan.testCase}`);
    const executedAt = new Date().toISOString();
    const result = await runVerificationCommand(command.command, path.dirname(workspace.codespecDir));
    const record = {
      testCase: plan.testCase,
      acceptanceCriteria: acceptanceCriteriaForTest(tasks, parseAnalysisDocument(parseYaml(artifacts.analysis)), plan.testCase),
      result: result.status === 0 ? 'PASS' : 'FAIL',
      testFile: command.testFile ?? tasks.tasks.find((task) => task.verificationPlan.some((candidate) => candidate.testCase === plan.testCase))?.plannedFiles[0] ?? 'unknown',
      testId: command.testId ?? plan.testCase,
      command: plan.command,
      profile: command.profile ?? plan.profile,
      services: command.services ?? plan.services,
      browser: command.browser ?? 'not-applicable',
      exitCode: result.status,
      gitRevision: baselineCommit,
      treeFingerprint: baselineFingerprint,
      executedAt,
      summary: result.output.slice(0, 2000) || (result.status === 0 ? '验证通过' : '验证失败'),
      cleanupSucceeded: command.cleanupSucceeded ?? result.status === 0,
    };
    records.push(record);
    if (result.status !== 0) failed = true;
  }

  const latestArtifacts = await loadChangeArtifacts(workspace.paths, artifacts.changeId);
  if (
    latestArtifacts.analysis !== artifacts.analysis ||
    latestArtifacts.design !== artifacts.design ||
    latestArtifacts.spec !== artifacts.spec ||
    latestArtifacts.tasks !== artifacts.tasks ||
    latestArtifacts.verification !== artifacts.verification ||
    !isDeepStrictEqual(latestArtifacts.metadata, artifacts.metadata)
  ) {
    throw new Error('验证期间 Change 产物或 revision/baseline 发生变化，请重新验证');
  }
  const parsedVerification = parseCurrentVerification({ version: 1, changeRevision: metadata.change.revision, artifactIdentity, testCases: records });
  const nextVerification = stringifyYaml(parsedVerification);
  const errors = await validateCurrentVerificationArtifacts(workspace, { ...artifacts, verification: nextVerification });
  if (errors.length) throw new Error(`当前规格验证未通过：${errors.join('; ')}`);

  const metadataPath = path.join(workspace.codespecDir, metadata.artifacts.metadata);
  const verificationPath = path.join(workspace.codespecDir, metadata.artifacts.verification);
  metadata.verification = {
    ...metadata.verification,
    requirements_verified: !failed,
    tests_passed: !failed,
    build_passed: !failed,
    lint_passed: !failed,
    verified_at: failed ? null : new Date().toISOString(),
  };
  await recoverPendingTransactions(workspace.paths);
  await withChangeIndexLock(workspace.paths, async () => {
    const originalMetadata = await fs.readFile(metadataPath, 'utf8');
    const originalVerification = await fs.readFile(verificationPath, 'utf8');
    if (!isDeepStrictEqual(parseChangeMetadata(parseYaml(originalMetadata)), latestArtifacts.metadata)
      || originalVerification !== latestArtifacts.verification) {
      throw new Error('验证发布前 Change 已发生变化，请重新验证');
    }
    let journal: Awaited<ReturnType<typeof createArchiveJournal>> | undefined;
    let committed = false;
    try {
      journal = await createArchiveJournal({
        paths: workspace.paths,
        transactionId: `verify-${artifacts.changeId}-${randomUUID()}`,
        ownerPid: process.pid,
        files: [
          { target: verificationPath, before: originalVerification, after: nextVerification },
          { target: metadataPath, before: originalMetadata, after: stringifyYaml(metadata) },
        ],
      });
      await installArchiveJournal(journal);
      await markArchiveJournalCommitted(journal);
      committed = true;
      await recoverPendingTransactions(workspace.paths, journal.transactionId);
    } catch (error) {
      if (committed) throw new Error(`${String(error)} (verification committed; recovery requires retry)`);
      if (journal) await recoverPendingTransactions(workspace.paths, journal.transactionId);
      throw error;
    }
  });
  if (failed) throw new Error('验证命令失败，当前规格验证未通过。');
  return {
    schema_version: 1,
    change_id: artifacts.changeId,
    verified_at: metadata.verification.verified_at ?? new Date().toISOString(),
    revision: metadata.change.revision,
    status: 'PASS',
    requirement_ids: [...new Set(tasks.tasks.flatMap((task) => task.requirements))].sort(),
    scenario_ids: [...new Set(tasks.tasks.flatMap((task) => task.scenarios))].sort(),
    baseline_identity: baselineFingerprint,
    receipt: hash(parsedVerification),
    artifact_identity: artifactIdentity,
    trace_rows: validateChangeTraceability({ ...artifacts, verification: nextVerification }, true).traceRows,
    commands: parsedVerification.testCases.map((record) => ({
      command: record.command,
      kind: 'requirements' as const,
      exit_code: record.exitCode,
      output_summary: record.summary,
      started_at: record.executedAt,
      finished_at: record.executedAt,
    })),
  };
}

export async function recordFreshVerification(workspace: WorkspaceContext, changeId: string, commands: VerificationCommand[]): Promise<VerificationEvidence> {
  if (!commands.length) throw new Error('至少需要一条验证命令。');
  const artifacts = await loadChangeArtifacts(workspace.paths, changeId); const metadata = structuredClone(artifacts.metadata);
  if (!['VERIFY', 'ARCHIVE'].includes(metadata.change.status)) throw new Error('验证证据要求 Change 处于 VERIFY 或 ARCHIVE 状态。');
  return recordFreshCurrentVerification(workspace, artifacts, commands);
}
