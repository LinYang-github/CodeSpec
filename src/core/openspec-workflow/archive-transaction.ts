import * as fs from 'node:fs/promises';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import type { ChangeArtifacts } from './artifacts.js';
import { loadChangeArtifacts, type WorkspaceContext } from './loaders.js';
import { loadChangeIndex } from './change-index.js';
import { parseDeltaSpec } from './delta-parser.js';
import { detectStaleChanges } from './stale.js';
import type { ArchivePlan as ContractArchivePlan, ChangeMetadata, RequirementDelta } from './types.js';

export interface ArchivePlan extends ContractArchivePlan {
  workspace: WorkspaceContext;
  artifacts: ChangeArtifacts;
  deltas: RequirementDelta[];
  current: Map<string, string>;
}

export interface PreparedArchive {
  plan: ArchivePlan;
  specs: Map<string, string>;
  archivedMetadata: ChangeMetadata;
}

export interface ArchiveResult {
  changeId: string;
  archivedPath: string;
  staleChanges: string[];
  requirementIds: string[];
}

const exists = async (file: string) => fs.access(file).then(() => true).catch(() => false);
const normalize = (value: string) => value.replace(/\r\n/g, '\n').trim();

function requirementBlock(spec: string, id: string): string | undefined {
  const at = spec.indexOf(id);
  if (at < 0) return undefined;
  const start = spec.lastIndexOf('###', at);
  const next = spec.indexOf('\n### ', at + id.length);
  return spec.slice(start < 0 ? at : start, next < 0 ? spec.length : next).trim();
}

function applyDelta(spec: string, delta: RequirementDelta): string {
  const current = requirementBlock(spec, delta.id);
  if (delta.action === 'ADDED') {
    if (current) throw new Error(`ARCHIVE CONFLICT: ${delta.id} already exists in Current`);
    return `${spec.trimEnd()}\n\n${delta.next!.trim()}\n`;
  }
  if (!current || normalize(current) !== normalize(delta.previous!)) {
    throw new Error(`ARCHIVE CONFLICT: ${delta.id} Current does not match Previous`);
  }
  if (delta.action === 'REMOVED') return spec.replace(current, '').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  return spec.replace(current, delta.next!.trim());
}

function ensureArchiveGates(artifacts: ChangeArtifacts): void {
  const m = artifacts.metadata;
  if (m.change.status !== 'ARCHIVE') throw new Error(`Archive requires ARCHIVE state, got ${m.change.status}`);
  if (!m.archive.ready || !m.gates.archive.satisfied) throw new Error('Archive gate is not satisfied');
  if (m.baseline.stale) throw new Error('Archive is blocked: baseline is stale');
  if (m.modules.dependencies.some((d) => !m.relations.depends_on.length)) throw new Error('Archive dependency is unresolved');
  if (m.tasks.completed !== m.tasks.total || Object.values(m.tasks.items).some((t) => t.status !== 'DONE')) throw new Error('Archive requires all Tasks DONE');
  if (!m.verification.verified_at || !m.verification.requirements_verified || !m.verification.tests_passed || !m.verification.build_passed || !m.verification.lint_passed) throw new Error('Archive requires fresh Verification evidence');
  if (!m.archive.conflict && m.relations.conflicts_with.length) throw new Error('Archive has unresolved Change conflicts');
}

export async function preflightArchive(workspace: WorkspaceContext, changeId: string): Promise<ArchivePlan> {
  const artifacts = await loadChangeArtifacts(workspace.paths, changeId);
  ensureArchiveGates(artifacts);
  const deltas = parseDeltaSpec(artifacts.spec).entries;
  const current = new Map<string, string>();
  for (const module of artifacts.metadata.modules.confirmed) {
    const file = path.join(workspace.paths.currentSpecs, module.module, 'spec.md');
    current.set(module.module, await fs.readFile(file, 'utf8').catch(() => ''));
  }
  for (const delta of deltas) {
    if (!current.has(delta.module)) current.set(delta.module, '');
    if (delta.action !== 'ADDED' && !requirementBlock(current.get(delta.module)!, delta.id)) throw new Error(`ARCHIVE CONFLICT: missing ${delta.id}`);
  }
  return { changeId: changeId as ContractArchivePlan['changeId'], ready: true, conflict: false, reasons: [], workspace, artifacts, deltas, current };
}

export async function prepareArchive(plan: ArchivePlan): Promise<PreparedArchive> {
  const specs = new Map(plan.current);
  for (const delta of plan.deltas) specs.set(delta.module, applyDelta(specs.get(delta.module) ?? '', delta));
  for (const [module, spec] of specs) if (!spec.trim()) throw new Error(`Archive validation failed: empty Current spec for ${module}`);
  const archivedMetadata = structuredClone(plan.artifacts.metadata);
  archivedMetadata.change.status = 'ARCHIVED';
  archivedMetadata.archive.archived_at = new Date().toISOString();
  return { plan, specs, archivedMetadata };
}

async function copyTree(source: string, destination: string): Promise<void> {
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(source, destination, { recursive: true });
}

export async function commitArchive(prepared: PreparedArchive): Promise<ArchiveResult> {
  const { plan, specs, archivedMetadata } = prepared;
  const token = `.archive-${plan.changeId}-${process.pid}-${Date.now()}`;
  const stage = path.join(plan.workspace.paths.archive, token);
  const archivedPath = path.join(plan.workspace.paths.archivedChanges, plan.changeId);
  const backup = path.join(plan.workspace.paths.archive, `${token}-backup`);
  try {
    await fs.mkdir(stage, { recursive: true });
    for (const [module, content] of specs) {
      const dir = path.join(stage, 'specs', module); await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, 'spec.md'), content);
    }
    await copyTree(plan.artifacts.changeDir, path.join(stage, 'change'));
    await fs.writeFile(path.join(stage, 'change', 'metadata.yaml'), stringifyYaml(archivedMetadata));
    const index = await loadChangeIndex(plan.workspace.paths);
    const nextIndex = { version: 1, changes: index.entries.filter((entry) => entry.id !== plan.changeId) };
    await fs.writeFile(path.join(stage, 'index.yaml'), stringifyYaml(nextIndex));
    await fs.mkdir(backup, { recursive: true });
    for (const [module] of specs) { const dest = path.join(plan.workspace.paths.currentSpecs, module); if (await exists(dest)) await fs.rename(dest, path.join(backup, `spec-${module}`)); }
    if (await exists(archivedPath)) throw new Error(`Archive destination already exists: ${archivedPath}`);
    await fs.mkdir(path.dirname(archivedPath), { recursive: true });
    for (const [module] of specs) await fs.rename(path.join(stage, 'specs', module), path.join(plan.workspace.paths.currentSpecs, module));
    await fs.rename(path.join(stage, 'change'), archivedPath);
    await fs.rename(path.join(stage, 'index.yaml'), plan.workspace.paths.changeIndex);
    await fs.rm(plan.artifacts.changeDir, { recursive: true, force: true });
    const staleChanges = await detectStaleChanges(plan.workspace, plan.deltas.map((d) => d.id));
    return { changeId: plan.changeId, archivedPath, staleChanges, requirementIds: plan.deltas.map((d) => d.id) };
  } catch (error) {
    for (const [module] of specs) { const dest = path.join(plan.workspace.paths.currentSpecs, module); if (!(await exists(dest))) { const old = path.join(backup, `spec-${module}`); if (await exists(old)) await fs.rename(old, dest); } }
    throw new Error(`${error instanceof Error ? error.message : String(error)} (rollback attempted; recovery stage: ${stage})`);
  } finally { await fs.rm(stage, { recursive: true, force: true }).catch(() => undefined); await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined); }
}

export async function archiveChange(workspace: WorkspaceContext, changeId: string): Promise<ArchiveResult> {
  return commitArchive(await prepareArchive(await preflightArchive(workspace, changeId)));
}
