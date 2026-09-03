import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { WorkspaceContext } from './loaders.js';
import { loadChangeArtifacts } from './loaders.js';
import { parseDeltaSpec } from './delta-parser.js';
import { collectEmptyScenarioErrorIssues } from './scenario-parser.js';

export type VerificationKind = 'requirements' | 'test' | 'build' | 'lint' | 'other';
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
  commands: Array<{
    command: string;
    kind: VerificationKind;
    exit_code: number;
    output_summary: string;
    started_at: string;
    finished_at: string;
  }>;
}

interface VerificationHooks { beforePublish?: (file: string) => void | Promise<void> }
let hooks: VerificationHooks | null = null;
export function __setVerificationTestHooksForTests(value: VerificationHooks | null): void { hooks = value; }

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
  const allCommandsPassed = evidence.commands.length > 0 && evidence.commands.every((command) => command.exit_code === 0);
  const passed = evidence.status === 'PASS';
  const gate = (label: string, satisfied: boolean): string => `- ${satisfied ? '✅' : '❌'} ${label}`;

  return [
    '# 验证证据',
    '',
    '<!-- 本文档由 OpenSpec 生成。机器校验数据区块用于归档校验。 -->',
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
    '## Gate',
    '',
    gate('Requirements fresh verified', passed),
    gate('tests passed', passed && evidence.commands.some((command) => command.kind === 'test' && command.exit_code === 0)),
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
    const evidence = parseYaml(yamlText);
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw new Error('证据必须是对象。');
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

export async function recordFreshVerification(workspace: WorkspaceContext, changeId: string, commands: VerificationCommand[]): Promise<VerificationEvidence> {
  if (!commands.length) throw new Error('至少需要一条验证命令。');
  const artifacts = await loadChangeArtifacts(workspace.paths, changeId); const metadata = structuredClone(artifacts.metadata);
  if (!['VERIFY', 'ARCHIVE'].includes(metadata.change.status)) throw new Error('验证证据要求 Change 处于 VERIFY 或 ARCHIVE 状态。');
  const expectedRequirements = requirementIds(metadata);
  const parsed = parseDeltaSpec(artifacts.spec);
  const errorIssues = parsed.entries.flatMap((entry) => collectEmptyScenarioErrorIssues(entry.id, entry.scenarios, changeId));
  if (errorIssues.length) throw new Error(errorIssues.join('; '));
  const expectedScenarios = [...new Set(parsed.entries.flatMap((entry) => entry.scenarios.map((scenario) => scenario.id)))].sort();
  const baselineIdentity = hash(metadata.baseline);
  const evidence: VerificationEvidence = {
    schema_version: 1, change_id: changeId, verified_at: new Date().toISOString(), revision: metadata.change.revision,
    status: 'PASS', requirement_ids: [], scenario_ids: [], baseline_identity: baselineIdentity, receipt: '', commands: [],
  };
  let failed = false;
  for (const item of commands) {
    if (!item.command.trim()) throw new Error('验证命令不能为空。');
    const kind = item.kind ?? 'other'; const started_at = new Date().toISOString();
    const result = await new Promise<{ status: number; output: string }>((resolve) => {
      const child = spawn(item.command, { shell: true, cwd: workspace.openspecDir }); let output = '';
      child.stdout?.on('data', (data: Buffer) => { output += data.toString(); }); child.stderr?.on('data', (data: Buffer) => { output += data.toString(); });
      child.on('error', () => resolve({ status: 1, output })); child.on('close', (status) => resolve({ status: status ?? 1, output }));
    });
    const finished_at = new Date().toISOString();
    evidence.commands.push({ command: item.command, kind, exit_code: result.status, output_summary: result.output.slice(0, 2000), started_at, finished_at });
    evidence.requirement_ids.push(...(item.requirementIds ?? [])); evidence.scenario_ids.push(...(item.scenarioIds ?? []));
    if (result.status !== 0) { failed = true; break; }
  }
  evidence.requirement_ids = [...new Set(evidence.requirement_ids)].sort(); evidence.scenario_ids = [...new Set(evidence.scenario_ids)].sort();
  if (!failed && !expectedRequirements.every((id) => evidence.requirement_ids.includes(id))) throw new Error(`验证覆盖范围缺少 Requirement ${expectedRequirements.find((id) => !evidence.requirement_ids.includes(id))}`);
  if (!failed && !expectedScenarios.every((id) => evidence.scenario_ids.includes(id))) throw new Error(`验证覆盖范围缺少 Scenario ${expectedScenarios.find((id) => !evidence.scenario_ids.includes(id))}`);
  if (!failed && expectedRequirements.length === 0) throw new Error('验证证据至少要覆盖一个 Requirement');
  if (!failed && !evidence.commands.some((item) => item.kind === 'test')) throw new Error('验证证据必须包含 test 命令');
  if (!failed && !evidence.commands.some((item) => item.kind === 'build')) throw new Error('验证证据必须包含 build 命令');
  if (!failed && !evidence.commands.some((item) => item.kind === 'lint')) throw new Error('验证证据必须包含 lint 命令');
  if (failed) evidence.status = 'FAIL';
  evidence.receipt = hash({ ...evidence, receipt: undefined });
  metadata.verification = {
    ...metadata.verification,
    requirements_verified: evidence.status === 'PASS' && expectedRequirements.every((id) => evidence.requirement_ids.includes(id)),
    tests_passed: evidence.status === 'PASS' && evidence.commands.some((item) => item.kind === 'test'),
    build_passed: evidence.status === 'PASS' && evidence.commands.some((item) => item.kind === 'build'),
    lint_passed: evidence.status === 'PASS' && evidence.commands.some((item) => item.kind === 'lint'),
    verified_at: evidence.status === 'PASS' ? evidence.verified_at : null,
    evidence_receipt: evidence.receipt, baseline_identity: evidence.baseline_identity,
  };
  const metadataPath = path.join(workspace.openspecDir, metadata.artifacts.metadata);
  const verificationPath = path.join(workspace.openspecDir, metadata.artifacts.verification);
  await publishPair(metadataPath, metadata, verificationPath, evidence);
  if (failed) throw new Error(`验证命令失败，退出码为 ${evidence.commands.at(-1)?.exit_code}`);
  return evidence;
}
