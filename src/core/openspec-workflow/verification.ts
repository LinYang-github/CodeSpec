import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { stringify as stringifyYaml } from 'yaml';
import type { WorkspaceContext } from './loaders.js';
import { loadChangeArtifacts } from './loaders.js';

export interface VerificationCommand { command: string; requirementIds?: string[]; scenarioIds?: string[] }
export interface VerificationEvidence {
  verified_at: string; requirement_ids: string[]; scenario_ids: string[];
  commands: Array<{ command: string; exit_status: number; output_summary: string; started_at: string; finished_at: string }>;
}

export async function recordFreshVerification(workspace: WorkspaceContext, changeId: string, commands: VerificationCommand[]): Promise<VerificationEvidence> {
  if (!commands.length) throw new Error('At least one verification command is required');
  const evidence: VerificationEvidence = { verified_at: new Date().toISOString(), requirement_ids: [], scenario_ids: [], commands: [] };
  for (const item of commands) {
    const started_at = new Date().toISOString();
    const result = await new Promise<{ status: number; output: string }>((resolve) => {
      const child = spawn(item.command, { shell: true, cwd: workspace.openspecDir });
      let output = ''; child.stdout?.on('data', (data: Buffer) => { output += data.toString(); }); child.stderr?.on('data', (data: Buffer) => { output += data.toString(); });
      child.on('close', (status: number | null) => resolve({ status: status ?? 1, output }));
    });
    const finished_at = new Date().toISOString();
    evidence.commands.push({ command: item.command, exit_status: result.status, output_summary: result.output.slice(0, 2000), started_at, finished_at });
    evidence.requirement_ids.push(...(item.requirementIds ?? [])); evidence.scenario_ids.push(...(item.scenarioIds ?? []));
    if (result.status !== 0) throw new Error(`Verification command failed: ${item.command}`);
  }
  evidence.requirement_ids = [...new Set(evidence.requirement_ids)]; evidence.scenario_ids = [...new Set(evidence.scenario_ids)];
  const artifacts = await loadChangeArtifacts(workspace.paths, changeId);
  const verificationPath = path.join(workspace.openspecDir, artifacts.metadata.artifacts.verification);
  await fs.writeFile(verificationPath, stringifyYaml(evidence));
  return evidence;
}
