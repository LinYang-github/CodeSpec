import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { stringify as stringifyYaml } from 'yaml';
import type { WorkspaceContext } from './loaders.js';
import { loadChangeArtifacts } from './loaders.js';
import { parseDeltaSpec } from './delta-parser.js';

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

async function publishPair(metadataPath: string, metadata: unknown, verificationPath: string, evidence: VerificationEvidence): Promise<void> {
  const token = `.verification-${process.pid}-${Date.now()}`;
  const metadataTmp = `${metadataPath}.${token}.tmp`; const evidenceTmp = `${verificationPath}.${token}.tmp`;
  const originalMetadata = await fs.readFile(metadataPath, 'utf8'); const originalEvidence = await fs.readFile(verificationPath, 'utf8');
  try {
    await fs.writeFile(evidenceTmp, stringifyYaml(evidence)); await fs.writeFile(metadataTmp, stringifyYaml(metadata));
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
  if (!commands.length) throw new Error('At least one verification command is required');
  const artifacts = await loadChangeArtifacts(workspace.paths, changeId); const metadata = structuredClone(artifacts.metadata);
  if (!['VERIFY', 'ARCHIVE'].includes(metadata.change.status)) throw new Error('Verification evidence requires VERIFY or ARCHIVE state');
  const expectedRequirements = requirementIds(metadata);
  const parsed = parseDeltaSpec(artifacts.spec);
  const expectedScenarios = [...new Set(parsed.entries.flatMap((entry) => entry.scenarios.map((scenario) => scenario.id)))].sort();
  const baselineIdentity = hash(metadata.baseline);
  const evidence: VerificationEvidence = {
    schema_version: 1, change_id: changeId, verified_at: new Date().toISOString(), revision: metadata.change.revision,
    status: 'PASS', requirement_ids: [], scenario_ids: [], baseline_identity: baselineIdentity, receipt: '', commands: [],
  };
  let failed = false;
  for (const item of commands) {
    if (!item.command.trim()) throw new Error('Verification command must not be empty');
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
  if (!failed && !expectedRequirements.every((id) => evidence.requirement_ids.includes(id))) throw new Error(`Verification coverage is missing Requirement ${expectedRequirements.find((id) => !evidence.requirement_ids.includes(id))}`);
  if (!failed && !expectedScenarios.every((id) => evidence.scenario_ids.includes(id))) throw new Error(`Verification coverage is missing Scenario ${expectedScenarios.find((id) => !evidence.scenario_ids.includes(id))}`);
  if (!failed && expectedRequirements.length === 0) throw new Error('Verification evidence must cover at least one Requirement');
  if (!failed && !evidence.commands.some((item) => item.kind === 'test')) throw new Error('Verification evidence requires a test command');
  if (!failed && !evidence.commands.some((item) => item.kind === 'build')) throw new Error('Verification evidence requires a build command');
  if (!failed && !evidence.commands.some((item) => item.kind === 'lint')) throw new Error('Verification evidence requires a lint command');
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
  if (failed) throw new Error(`Verification command failed with exit code ${evidence.commands.at(-1)?.exit_code}`);
  return evidence;
}
