import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import type { ChangeArtifacts } from './artifacts.js';
import type { WorkspaceContext } from './loaders.js';
import { loadChangeArtifacts } from './loaders.js';
import { parseDeltaSpec } from './delta-parser.js';
import { collectEmptyScenarioErrorIssues } from './scenario-parser.js';
import { validateChangeArchiveImpact, validateArchiveRegressionEvidence } from './archive-impact.js';
import { validateTraceRows, type TraceRow } from './traceability.js';
import {
  requiredVerificationKinds,
  resolveControlledVerificationCommands,
  type ControlledVerificationKind,
} from './verification-policy.js';

export type VerificationKind = 'requirements' | ControlledVerificationKind;
export interface VerificationCommand {
  command: string;
  kind?: VerificationKind;
  requirementIds?: string[];
  scenarioIds?: string[];
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

interface VerificationHooks { beforePublish?: (file: string) => void | Promise<void> }
let hooks: VerificationHooks | null = null;
export function __setVerificationTestHooksForTests(value: VerificationHooks | null): void { hooks = value; }

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const verificationArtifactIdentity = (artifacts: Pick<ChangeArtifacts, 'proposal' | 'design' | 'spec' | 'tasks'>): string =>
  hash({ proposal: artifacts.proposal, design: artifacts.design, spec: artifacts.spec, tasks: artifacts.tasks });

const verificationKindSchema = z.enum([
  'requirements', 'unit', 'typecheck', 'build', 'lint', 'bdd', 'integration',
  'archive-regression', 'security', 'performance', 'migration',
]);
const traceRowSchema = z.object({
  requirement_id: z.string().regex(/^MOD-\d{3}-REQ-\d{3}$/u),
  scenario_id: z.string().regex(/^SCN-\d{3}$/u),
  task_id: z.string().trim().min(1),
  test_id: z.string().trim().min(1),
  evidence_id: z.string().trim().min(1),
  result: z.enum(['PASS', 'FAIL']),
  code_reference: z.string().trim().min(1).optional(),
}).strict();
const evidenceSchema = z.object({
  schema_version: z.literal(1), change_id: z.string().regex(/^CHG-\d{8}-\d{3}$/u),
  verified_at: z.string().datetime(), revision: z.number().int().positive(), status: z.enum(['PASS', 'FAIL']),
  requirement_ids: z.array(z.string().regex(/^MOD-\d{3}-REQ-\d{3}$/u)),
  scenario_ids: z.array(z.string().regex(/^SCN-\d{3}$/u)),
  baseline_identity: z.string().regex(/^[a-f0-9]{64}$/u),
  receipt: z.string().regex(/^[a-f0-9]{64}$/u),
  artifact_identity: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  not_applicable: z.partialRecord(verificationKindSchema.exclude(['requirements']), z.string().trim().min(1)).optional(),
  trace_rows: z.array(traceRowSchema).optional(),
  commands: z.array(z.object({
    command: z.string().trim().min(1), kind: verificationKindSchema,
    exit_code: z.number().int(), output_summary: z.string(),
    started_at: z.string().datetime(), finished_at: z.string().datetime(),
    requirement_ids: z.array(z.string().regex(/^MOD-\d{3}-REQ-\d{3}$/u)).optional(),
    scenario_ids: z.array(z.string().regex(/^SCN-\d{3}$/u)).optional(),
  }).strict()),
}).strict();

export function validateVerificationEvidence(artifacts: ChangeArtifacts): string[] {
  const errors: string[] = [];
  try {
    const evidence = parseVerificationDocument(artifacts.verification);
    const metadata = artifacts.metadata;
    if (evidence.change_id !== metadata.change.id || evidence.revision !== metadata.change.revision ||
      evidence.status !== 'PASS' || evidence.baseline_identity !== hash(metadata.baseline)) {
      errors.push('Verification 必须对应当前 Change revision 和 baseline，且状态为 PASS');
    }
    if (evidence.receipt !== hash({ ...evidence, receipt: undefined }) ||
      metadata.verification.evidence_receipt !== evidence.receipt ||
      metadata.verification.baseline_identity !== evidence.baseline_identity) errors.push('Verification receipt 与元数据绑定不匹配');
    if (evidence.artifact_identity !== verificationArtifactIdentity(artifacts)) errors.push('Change 产物已改变或未绑定证据，必须重新验证');
    if (evidence.verified_at !== metadata.verification.verified_at ||
      (metadata.baseline.created_at && Date.parse(metadata.baseline.created_at) > Date.parse(evidence.verified_at))) errors.push('Verification 时间与元数据或 baseline 不匹配');
    if (!evidence.commands.length || evidence.commands.some((command) => command.exit_code !== 0 || Date.parse(command.finished_at) < Date.parse(command.started_at))) errors.push('Verification 命令必须真实完成且退出码为 0');
    for (const kind of requiredVerificationKinds({
      level: metadata.change.sdd_level,
      affectedAreas: metadata.impact.affected_areas,
      archiveAffected: false,
    })) {
      if (!evidence.commands.some((command) => command.kind === kind && command.exit_code === 0) && !evidence.not_applicable?.[kind]) {
        errors.push(`Verification 缺少 ${kind} 命令`);
      }
    }
    for (const id of requirementIds(metadata)) if (!evidence.requirement_ids.includes(id)) errors.push(`Verification 缺少 Requirement ${id}`);
    for (const entry of parseDeltaSpec(artifacts.spec).entries) for (const scenario of entry.scenarios) {
      if (!evidence.scenario_ids.includes(scenario.id)) errors.push(`Verification 缺少 Scenario ${entry.id}/${scenario.id}`);
    }
    if (evidence.trace_rows) {
      errors.push(...validateTraceRows(evidence.trace_rows, parseDeltaSpec(artifacts.spec).entries.map((entry) => ({
        requirementId: entry.id,
        scenarioIds: entry.scenarios.map((scenario) => scenario.id),
      }))));
      if (metadata.change.sdd_level === 3 && evidence.trace_rows.some((row) => !row.code_reference)) {
        errors.push('Level 3 的 Trace Row 必须包含 code_reference');
      }
    } else if (metadata.change.sdd_level === 3) {
      errors.push('Level 3 Verification 缺少追踪矩阵');
    }
  } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  return errors;
}
const requirementIds = (metadata: { requirements: Record<string, Array<{ id: string }>> }) =>
  [...new Set(Object.values(metadata.requirements).flat().map((item) => item.id))].sort();

const markdownCell = (value: string): string => value.replace(/\|/gu, '\\|').replace(/\r?\n/gu, '<br>');
const markdownCode = (value: string): string => value.replace(/`/gu, '\\`');

export function renderVerificationMarkdown(evidence: VerificationEvidence): string {
  const requirements = evidence.requirement_ids.length
    ? evidence.requirement_ids.map((id) => `| \`${markdownCell(id)}\` |`).join('\n')
    : '| - |';
  const scenarios = evidence.scenario_ids.length
    ? evidence.scenario_ids.map((id) => `| \`${markdownCell(id)}\` |`).join('\n')
    : '| - |';
  const commands = evidence.commands.length
    ? evidence.commands.map((command) => `| \`${markdownCell(markdownCode(command.command))}\` | ${command.kind} | ${command.exit_code} | ${markdownCell(command.output_summary) || '-'} | ${command.started_at} → ${command.finished_at} |`).join('\n')
    : '| - | - | - | - | - |';
  const traceRows = evidence.trace_rows?.length
    ? evidence.trace_rows.map((row) => `| \`${markdownCell(row.requirement_id)}\` | \`${markdownCell(row.scenario_id)}\` | \`${markdownCell(row.task_id)}\` | \`${markdownCell(row.test_id)}\` | \`${markdownCell(row.evidence_id)}\` | ${row.result} | ${row.code_reference ? `\`${markdownCell(row.code_reference)}\`` : '-'} |`).join('\n')
    : '| - | - | - | - | - | - |';
  const allCommandsPassed = evidence.commands.length > 0 && evidence.commands.every((command) => command.exit_code === 0);
  const inapplicable = Object.entries(evidence.not_applicable ?? {});
  const passed = evidence.status === 'PASS';
  const gate = (label: string, satisfied: boolean): string => `- ${satisfied ? '✅' : '❌'} ${label}`;

  return [
    '# 验证证据',
    '',
    '<!-- 本文档由 CodeSpec 生成。机器校验数据区块用于归档校验。 -->',
    '',
    '## 验证结果',
    '',
    `- 变更：\`${markdownCode(evidence.change_id)}\``,
    `- 状态：**${evidence.status}**`,
    `- 修订：${evidence.revision}`,
    `- 验证时间：${evidence.verified_at}`,
    `- Baseline：\`${evidence.baseline_identity}\``,
    `- Receipt：\`${evidence.receipt}\``,
    '',
    '## Requirement 覆盖',
    '',
    '| Requirement ID |',
    '| --- |',
    requirements,
    '',
    '## Scenario 覆盖',
    '',
    '| Scenario ID |',
    '| --- |',
    scenarios,
    '',
    '## 命令记录',
    '',
    '| 命令 | 类型 | Exit status | 结果摘要 | 时间 |',
    '| --- | --- | ---: | --- | --- |',
    commands,
    '',
    '## 追踪矩阵',
    '',
    '| Requirement | Scenario | Task | Test | Evidence | Result | Code reference |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    traceRows,
    ...(inapplicable.length ? [
      '', '## 不适用的验证类别', '',
      ...inapplicable.map(([kind, reason]) => `- ${kind}：${reason}`),
    ] : []),
    '',
    '## Gate',
    '',
    gate('Requirements fresh verified', passed),
    gate('unit tests passed', passed && evidence.commands.some((command) => command.kind === 'unit' && command.exit_code === 0)),
    gate('typecheck passed', passed && evidence.commands.some((command) => command.kind === 'typecheck' && command.exit_code === 0)),
    gate('build passed', passed && evidence.commands.some((command) => command.kind === 'build' && command.exit_code === 0)),
    gate('lint passed', passed && evidence.commands.some((command) => command.kind === 'lint' && command.exit_code === 0)),
    gate('所有已记录命令均通过', allCommandsPassed),
    '',
    '## 机器校验数据',
    '',
    '```yaml',
    stringifyYaml(evidence).trimEnd(),
    '```',
    '',
  ].join('\n');
}

export function parseVerificationDocument(content: string): VerificationEvidence {
  const blocks = [...content.matchAll(/^```yaml\s*\n([\s\S]*?)\n```\s*$/gmu)];
  if (blocks.length > 1) throw new Error('Verification 文档只能包含一个机器校验数据区块。');
  const document = content.trim();
  const yamlText = blocks[0]?.[1] ?? (/^schema_version:\s*1(?:\s|$)/u.test(document) ? document : null);
  if (!yamlText) throw new Error('Verification 文档缺少机器校验数据区块。');
  try {
    const evidence: unknown = parseYaml(yamlText);
    evidenceSchema.parse(evidence);
    // Keep the serialized key order used by the existing receipt contract.
    return evidence as VerificationEvidence;
  } catch (error) {
    throw new Error(`Verification 证据无效：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function publishPair(metadataPath: string, metadata: unknown, verificationPath: string, evidence: VerificationEvidence): Promise<void> {
  const token = `.verification-${process.pid}-${Date.now()}`;
  const metadataTmp = `${metadataPath}.${token}.tmp`; const evidenceTmp = `${verificationPath}.${token}.tmp`;
  const originalMetadata = await fs.readFile(metadataPath, 'utf8'); const originalEvidence = await fs.readFile(verificationPath, 'utf8');
  try {
    await fs.writeFile(evidenceTmp, renderVerificationMarkdown(evidence)); await fs.writeFile(metadataTmp, stringifyYaml(metadata));
    await hooks?.beforePublish?.(evidenceTmp);
    await fs.rename(evidenceTmp, verificationPath);
    await hooks?.beforePublish?.(metadataPath);
    await fs.rename(metadataTmp, metadataPath);
  } catch (error) {
    await fs.writeFile(verificationPath, originalEvidence).catch(() => undefined);
    await fs.writeFile(metadataPath, originalMetadata).catch(() => undefined);
    await fs.rm(evidenceTmp, { force: true }).catch(() => undefined); await fs.rm(metadataTmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

const taskIdPattern = /\bSP-\d+(?:[.-]\d+)*\b/gu;
const testReferencePattern = /(?<!\S)(?:[\w@.-]+\/)*[\w.-]+\.(?:test|spec)\.[cm]?[jt]sx?(?!\S)/gu;
const codeReferencePattern = /\bcode:([^\s]+)/u;

function traceRowsForVerification(artifacts: ChangeArtifacts, changeId: string, revision: number): TraceRow[] {
  const rows: TraceRow[] = [];
  const evidenceId = `verification:${changeId}:${revision}`;
  for (const entry of parseDeltaSpec(artifacts.spec).entries) {
    for (const scenario of entry.scenarios) {
      const line = artifacts.tasks.split(/\r?\n/u).find((candidate) => candidate.includes(entry.id) && candidate.includes(scenario.id));
      const taskId = line?.match(taskIdPattern)?.[0];
      const testId = line?.match(testReferencePattern)?.[0];
      const codeReference = line?.match(codeReferencePattern)?.[1];
      if (taskId && testId) {
        rows.push({ requirement_id: entry.id, scenario_id: scenario.id, task_id: taskId, test_id: testId, evidence_id: evidenceId, result: 'PASS', ...(codeReference ? { code_reference: codeReference } : {}) });
      }
    }
  }
  return rows;
}

async function validateCodeReferences(workspace: WorkspaceContext, rows: readonly TraceRow[], required: boolean): Promise<void> {
  for (const row of rows) {
    if (!row.code_reference) {
      if (required) throw new Error(`Level 3 的 Scenario ${row.scenario_id} 缺少 code_reference`);
      continue;
    }
    const referencePath = row.code_reference.split(':')[0].split('#')[0];
    if (!referencePath || path.isAbsolute(referencePath) || referencePath.split(/[\\/]+/u).includes('..')) {
      throw new Error(`code_reference 必须是仓库内相对路径：${row.code_reference}`);
    }
    const projectRoot = path.dirname(workspace.codespecDir);
    const resolved = path.resolve(projectRoot, referencePath);
    const relative = path.relative(projectRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`code_reference 必须位于仓库内：${row.code_reference}`);
    let cursor = resolved;
    while (true) {
      const stat = await fs.lstat(cursor).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!stat) throw new Error(`code_reference 文件不存在：${row.code_reference}`);
      if (stat.isSymbolicLink()) throw new Error(`code_reference 不得经过软链接：${row.code_reference}`);
      if (cursor === projectRoot) break;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw new Error(`code_reference 路径越界：${row.code_reference}`);
      cursor = parent;
    }
    if (!(await fs.lstat(resolved)).isFile()) throw new Error(`code_reference 必须指向文件：${row.code_reference}`);
  }
}

export async function recordFreshVerification(workspace: WorkspaceContext, changeId: string, commands: VerificationCommand[]): Promise<VerificationEvidence> {
  if (!commands.length) throw new Error('至少需要一条验证命令。');
  const artifacts = await loadChangeArtifacts(workspace.paths, changeId); const metadata = structuredClone(artifacts.metadata);
  if (!['VERIFY', 'ARCHIVE'].includes(metadata.change.status)) throw new Error('验证证据要求 Change 处于 VERIFY 或 ARCHIVE 状态。');
  const expectedRequirements = requirementIds(metadata);
  const parsed = parseDeltaSpec(artifacts.spec);
  const errorIssues = parsed.entries.flatMap((entry) => collectEmptyScenarioErrorIssues(entry.id, entry.scenarios, changeId));
  if (errorIssues.length) throw new Error(errorIssues.join('; '));
  const impactCheck = workspace.config.schema === 'code-spec' ? await validateChangeArchiveImpact(workspace, artifacts) : null;
  if (impactCheck?.issues.length) throw new Error(impactCheck.issues.join('; '));
  const requiredKinds = requiredVerificationKinds({
    level: metadata.change.sdd_level,
    affectedAreas: metadata.impact.affected_areas,
    archiveAffected: impactCheck?.impact.outcome === 'affected',
  });
  const notApplicable: Partial<Record<ControlledVerificationKind, string>> = {};
  if (workspace.config.verification?.commands) {
    for (const configured of resolveControlledVerificationCommands(workspace.config.verification.commands, {
      level: metadata.change.sdd_level,
      affectedAreas: metadata.impact.affected_areas,
      archiveAffected: impactCheck?.impact.outcome === 'affected',
    })) {
      if ('notApplicableReason' in configured) {
        if (configured.kind === 'archive-regression') throw new Error('受影响归档的 archive-regression 不能标为不适用。');
        if (commands.some((item) => item.kind === configured.kind)) {
          throw new Error(`受控验证类别 ${configured.kind} 已标为不适用，不能再执行替代命令。`);
        }
        notApplicable[configured.kind] = configured.notApplicableReason;
        continue;
      }
      const supplied = commands.find((item) => item.kind === configured.kind);
      if (!supplied || supplied.command !== configured.command) {
        throw new Error(`workspace 受控验证类别 ${configured.kind} 必须执行 config.yaml 中声明的命令。`);
      }
    }
  }
  const expectedScenarios = [...new Set(parsed.entries.flatMap((entry) => entry.scenarios.map((scenario) => scenario.id)))].sort();
  const baselineIdentity = hash(metadata.baseline);
  const traceRows = traceRowsForVerification(artifacts, changeId, metadata.change.revision);
  const traceIssues = validateTraceRows(traceRows, parsed.entries.map((entry) => ({
    requirementId: entry.id,
    scenarioIds: entry.scenarios.map((scenario) => scenario.id),
  })));
  if (traceIssues.length) throw new Error(traceIssues.join('; '));
  await validateCodeReferences(workspace, traceRows, metadata.change.sdd_level === 3);
  const evidence: VerificationEvidence = {
    schema_version: 1, change_id: changeId, verified_at: new Date().toISOString(), revision: metadata.change.revision,
    status: 'PASS', requirement_ids: [], scenario_ids: [], baseline_identity: baselineIdentity, receipt: '', commands: [], not_applicable: notApplicable,
    artifact_identity: verificationArtifactIdentity(artifacts), trace_rows: traceRows,
  };
  const metadataPath = path.join(workspace.codespecDir, metadata.artifacts.metadata);
  const verificationPath = path.join(workspace.codespecDir, metadata.artifacts.verification);
  const metadataSnapshot = await fs.readFile(metadataPath, 'utf8');
  const verificationSnapshot = await fs.readFile(verificationPath, 'utf8');
  let failed = false;
  for (const item of commands) {
    if (!item.command.trim()) throw new Error('验证命令不能为空。');
    const kind = verificationKindSchema.parse(item.kind ?? 'other'); const started_at = new Date().toISOString();
    const result = await new Promise<{ status: number; output: string }>((resolve) => {
      const child = spawn(item.command, { shell: true, cwd: workspace.codespecDir }); let output = '';
      child.stdout?.on('data', (data: Buffer) => { output += data.toString(); }); child.stderr?.on('data', (data: Buffer) => { output += data.toString(); });
      child.on('error', () => resolve({ status: 1, output })); child.on('close', (status) => resolve({ status: status ?? 1, output }));
    });
    const finished_at = new Date().toISOString();
    evidence.commands.push({ command: item.command, kind, exit_code: result.status, output_summary: result.output.slice(0, 2000), started_at, finished_at,
      requirement_ids: [...new Set(item.requirementIds ?? [])], scenario_ids: [...new Set(item.scenarioIds ?? [])] });
    evidence.requirement_ids.push(...(item.requirementIds ?? [])); evidence.scenario_ids.push(...(item.scenarioIds ?? []));
    if (result.status !== 0) { failed = true; break; }
  }
  let latestArtifacts: ChangeArtifacts;
  try {
    latestArtifacts = await loadChangeArtifacts(workspace.paths, changeId);
  } catch (error) {
    throw new Error(`验证期间 Change 产物无法重新读取，请重新验证：${error instanceof Error ? error.message : String(error)}`);
  }
  const metadataAfterCommands = await fs.readFile(metadataPath, 'utf8');
  const verificationAfterCommands = await fs.readFile(verificationPath, 'utf8');
  if (metadataAfterCommands !== metadataSnapshot || verificationAfterCommands !== verificationSnapshot ||
    verificationArtifactIdentity(latestArtifacts) !== evidence.artifact_identity ||
    latestArtifacts.metadata.change.revision !== metadata.change.revision ||
    hash(latestArtifacts.metadata.baseline) !== baselineIdentity) {
    throw new Error('验证期间 Change 产物或 revision/baseline 发生变化，请重新验证');
  }
  evidence.requirement_ids = [...new Set(evidence.requirement_ids)].sort(); evidence.scenario_ids = [...new Set(evidence.scenario_ids)].sort();
  if (!failed && !expectedRequirements.every((id) => evidence.requirement_ids.includes(id))) throw new Error(`验证覆盖范围缺少 Requirement ${expectedRequirements.find((id) => !evidence.requirement_ids.includes(id))}`);
  if (!failed && !expectedScenarios.every((id) => evidence.scenario_ids.includes(id))) throw new Error(`验证覆盖范围缺少 Scenario ${expectedScenarios.find((id) => !evidence.scenario_ids.includes(id))}`);
  if (!failed && expectedRequirements.length === 0) throw new Error('验证证据至少要覆盖一个 Requirement');
  if (!failed) {
    for (const kind of requiredKinds) {
      if (!evidence.commands.some((item) => item.kind === kind && item.exit_code === 0) && !evidence.not_applicable?.[kind]) {
        throw new Error(`验证证据必须包含 ${kind} 命令`);
      }
    }
  }
  if (!failed && impactCheck) {
    const issues = validateArchiveRegressionEvidence(impactCheck.impact, evidence);
    if (issues.length) throw new Error(issues.join('; '));
  }
  if (failed) evidence.status = 'FAIL';
  evidence.receipt = hash({ ...evidence, receipt: undefined });
  metadata.verification = {
    ...metadata.verification,
    requirements_verified: evidence.status === 'PASS' && expectedRequirements.every((id) => evidence.requirement_ids.includes(id)),
    tests_passed: evidence.status === 'PASS' && evidence.commands.some((item) => item.kind === 'unit'),
    build_passed: evidence.status === 'PASS' && evidence.commands.some((item) => item.kind === 'build'),
    lint_passed: evidence.status === 'PASS' && evidence.commands.some((item) => item.kind === 'lint'),
    verified_at: evidence.status === 'PASS' ? evidence.verified_at : null,
    evidence_receipt: evidence.receipt, baseline_identity: evidence.baseline_identity,
  };
  await publishPair(metadataPath, metadata, verificationPath, evidence);
  if (failed) throw new Error(`验证命令失败，退出码为 ${evidence.commands.at(-1)?.exit_code}`);
  return evidence;
}
