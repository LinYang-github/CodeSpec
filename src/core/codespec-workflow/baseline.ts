import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { parse as parseYaml } from 'yaml';
import { parseChangeMetadata } from './schemas.js';
import type { ChangeMetadata } from './types.js';
import type { WorkspaceContext } from './loaders.js';
import { parseAnalysisDocument } from './analysis.js';
import { findCurrentRequirement, hashRequirementSnapshot, parseCurrentSpecification } from './current-spec-model.js';
import { readCurrentState } from './current-state.js';

export interface Baseline {
  created_at: string;
  commit: string | null;
  working_tree_fingerprint: string;
  current_fingerprint: string;
  stale: boolean;
  modules: ChangeMetadata['baseline']['modules'];
}
const active = new Set(['ANALYZE', 'DESIGN', 'PLAN', 'IMPLEMENT', 'VERIFY', 'ARCHIVE']);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const execFileAsync = promisify(execFile);

export function hashAbsentRequirement(id: string): string {
  return digest(`codespec:requirement-absent:v1:${id}`);
}

export async function captureRepositoryBaseline(projectRoot: string): Promise<Pick<Baseline, 'commit' | 'working_tree_fingerprint'>> {
  const [head, status, diff] = await Promise.all([
    execFileAsync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: projectRoot }),
    execFileAsync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: projectRoot }),
    execFileAsync('git', ['diff', '--no-ext-diff', '--binary', 'HEAD', '--'], { cwd: projectRoot }),
  ]);
  const commit = head.stdout.trim();
  if (!/^[0-9a-f]{7,64}$/u.test(commit)) throw new Error('Invalid Git commit');
  const { stdout: untrackedRaw } = await execFileAsync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: projectRoot });
  const untracked = untrackedRaw.split('\0').filter(Boolean).sort();
  const fingerprintInput = createHash('sha256').update(status.stdout).update(diff.stdout);
  for (const relativePath of untracked) {
    const file = path.resolve(projectRoot, relativePath);
    if (path.relative(projectRoot, file).startsWith('..')) throw new Error('Untracked path escapes project root');
    fingerprintInput.update(relativePath).update('\0').update(await fs.readFile(file));
  }
  const fingerprint = fingerprintInput.digest('hex');
  return { commit, working_tree_fingerprint: `sha256:${fingerprint}` };
}
export async function captureBaseline(workspace: WorkspaceContext, metadata: ChangeMetadata, authoredSpecs: Record<string, string> = {}): Promise<Baseline> {
  const repository = await captureRepositoryBaseline(path.dirname(workspace.codespecDir));
  const current = await readCurrentState(workspace);
  const analysis = parseAnalysisDocument(parseYaml(
    await fs.readFile(path.join(workspace.codespecDir, metadata.artifacts.analysis), 'utf8')
  ));
  const modules: Baseline['modules'] = {};
  let entries: Dirent[];
  try { entries = await fs.readdir(workspace.paths.changes, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') entries = []; else throw error; }
  const candidates: ChangeMetadata[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^CHG-\d{8}-\d{3}$/u.test(entry.name)) continue;
    const file = path.join(workspace.paths.changes, entry.name, 'metadata.yaml');
    let candidate: ChangeMetadata;
    try { candidate = parseChangeMetadata(parseYaml(await fs.readFile(file, 'utf8'))); }
    catch (error) { throw new Error(`Cannot assess canonical Change ${entry.name}: ${error instanceof Error ? error.message : String(error)}`); }
    if (candidate.change.id !== entry.name) throw new Error(`Change directory ${entry.name} does not match metadata change.id ${candidate.change.id}`);
    if (active.has(candidate.change.status) && candidate.change.id !== metadata.change.id) candidates.push(candidate);
  }
  for (const selected of analysis.modules) {
    const related = candidates.filter((candidate) => candidate.modules.confirmed.some((item) => item.module === selected.module)).sort((a, b) => b.change.updated_at.localeCompare(a.change.updated_at) || b.change.id.localeCompare(a.change.id));
    const latest_change = related[0]?.change.id ?? null;
    const specPath = path.join(workspace.paths.currentSpecs, selected.module, 'spec.md');
    let content: string;
    if (authoredSpecs[selected.module] !== undefined) content = authoredSpecs[selected.module];
    else { try { content = await fs.readFile(specPath, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') content = ''; else throw error; } }
    const selectedRequirements = analysis.requirements.filter((item) => item.id.startsWith(`${selected.module}-`)).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    if (!selectedRequirements.length) continue;
    const requirement_ids = selectedRequirements.map((item) => item.id);
    const requirements: Record<string, string> = {};
    const currentSpec = content.trim() ? parseCurrentSpecification(content) : undefined;
    if (currentSpec && currentSpec.module !== selected.module) throw new Error(`Current module ${currentSpec.module} does not match ${selected.module}`);
    for (const { id, action } of selectedRequirements) {
      const snapshot = currentSpec && findCurrentRequirement(currentSpec, id);
      if (action === 'ADDED') {
        if (snapshot) throw new Error(`ADDED Requirement ${id} already exists in Current`);
        requirements[id] = hashAbsentRequirement(id);
      } else {
        if (!snapshot) throw new Error(`${action} Requirement ${id} does not exist in Current`);
        requirements[id] = hashRequirementSnapshot(snapshot);
      }
    }
    modules[selected.module] = { outcome: selected.outcome, latest_change, requirement_ids, spec_hash: digest(JSON.stringify(requirements)), requirements };
  }
  return { created_at: new Date().toISOString(), ...repository, current_fingerprint: current.fingerprint, stale: false, modules };
}
