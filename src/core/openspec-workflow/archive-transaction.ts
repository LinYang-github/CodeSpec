import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ChangeArtifacts } from './artifacts.js';
import { loadChangeArtifacts, type WorkspaceContext } from './loaders.js';
import { loadChangeIndex } from './change-index.js';
import { parseDeltaSpec } from './delta-parser.js';
import { detectStaleChanges } from './stale.js';
import { validateRelations } from './relations.js';
import { validateChangeTraceability } from './traceability.js';
import type { ArchivePlan as ContractArchivePlan, ChangeMetadata, RequirementDelta } from './types.js';

export interface ArchivePlan extends ContractArchivePlan {
  workspace: WorkspaceContext;
  artifacts: ChangeArtifacts;
  deltas: RequirementDelta[];
  current: Map<string, string>;
  snapshot: {
    metadata: string;
    current: Map<string, string>;
    index: string;
  };
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
interface ArchiveTestHooks { beforeCommitStep?: (step: string) => void | Promise<void> }
let archiveTestHooks: ArchiveTestHooks | null = null;
export function __setArchiveTestHooksForTests(hooks: ArchiveTestHooks | null): void { archiveTestHooks = hooks; }

const exists = async (file: string) => fs.access(file).then(() => true).catch(() => false);
const normalize = (value: string) => value.replace(/\r\n/g, '\n').trim();
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function requirementBlock(spec: string, id: string): string | undefined {
  const headings = [...spec.matchAll(/^###\s+(MOD-\d{3}-REQ-\d{3})(?:\s+.*)?$/gmu)];
  const heading = headings.find((match) => match[1] === id);
  if (!heading || heading.index === undefined) return undefined;
  const next = headings.find((match) => (match.index ?? 0) > heading.index!);
  return spec.slice(heading.index, next?.index ?? spec.length).trim();
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
  if (m.change.status !== 'ARCHIVE') throw new Error(`归档要求状态为 ARCHIVE，当前为 ${m.change.status}`);
  if (!m.archive.ready || !m.gates.archive.satisfied) throw new Error('归档门禁未满足');
  if (m.archive.conflict) throw new Error('归档前必须先解决冲突');
  if (m.baseline.stale) throw new Error('归档被阻塞：baseline 已过期');
  if (m.tasks.completed !== m.tasks.total || Object.values(m.tasks.items).some((t) => t.status !== 'DONE')) throw new Error('归档要求所有 Task 均为 DONE');
  if (!m.verification.verified_at || !m.verification.requirements_verified || !m.verification.tests_passed || !m.verification.build_passed || !m.verification.lint_passed) throw new Error('归档要求最新的 Verification 证据');
  let evidence: any;
  try { evidence = parseYaml(artifacts.verification); } catch (error) { throw new Error(`Verification 证据无效：${error instanceof Error ? error.message : String(error)}`); }
  const expectedIds = [...m.requirements.added, ...m.requirements.modified, ...m.requirements.removed].map((r) => r.id).sort();
  const expectedScenarios = (() => { try { return parseDeltaSpec(artifacts.spec).entries.flatMap((entry) => entry.scenarios.map((scenario) => scenario.id)); } catch { return []; } })();
  const validCommands = Array.isArray(evidence?.commands) && evidence.commands.length > 0 && evidence.commands.every((command: any) => command && typeof command.command === 'string' && command.command.trim() && command.exit_code === 0 && typeof command.started_at === 'string' && typeof command.finished_at === 'string' && !Number.isNaN(Date.parse(command.started_at)) && !Number.isNaN(Date.parse(command.finished_at)) && Date.parse(command.finished_at) >= Date.parse(command.started_at));
  if (evidence?.schema_version !== 1 || evidence.change_id !== m.change.id || evidence.status !== 'PASS' || evidence.revision !== m.change.revision || evidence.baseline_identity !== digest(m.baseline) || typeof evidence.receipt !== 'string' || !validCommands || !expectedIds.every((id) => evidence.requirement_ids?.includes(id)) || !expectedScenarios.every((id) => evidence.scenario_ids?.includes(id))) throw new Error('归档要求当前修订、baseline、Requirements 和 Scenarios 对应的最新 Verification 证据');
  if (evidence.receipt !== digest({ ...evidence, receipt: undefined }) || m.verification.evidence_receipt !== evidence.receipt || m.verification.baseline_identity !== evidence.baseline_identity) throw new Error('归档要求绑定到元数据且真实有效的 Verification 证据');
  if (m.baseline.created_at && Date.parse(m.baseline.created_at) > Date.parse(m.verification.verified_at)) throw new Error('Verification 证据早于当前 baseline');
  if (m.relations.conflicts_with.length) throw new Error('归档存在未解决的 Change 冲突');
  const trace = validateChangeTraceability(artifacts);
  if (!trace.valid) throw new Error(`归档追踪性门禁失败：${trace.issues.join('; ')}`);
}

export async function preflightArchive(workspace: WorkspaceContext, changeId: string): Promise<ArchivePlan> {
  const artifacts = await loadChangeArtifacts(workspace.paths, changeId);
  ensureArchiveGates(artifacts);
  await validateRelations(workspace, artifacts.metadata);
  const deltas = parseDeltaSpec(artifacts.spec).entries;
  const current = new Map<string, string>();
  for (const module of artifacts.metadata.modules.confirmed) {
    const file = path.join(workspace.paths.currentSpecs, module.module, 'spec.md');
    const moduleDir = path.join(workspace.paths.currentSpecs, module.module);
    try { if ((await fs.lstat(moduleDir)).isSymbolicLink()) throw new Error(`Current specification module path must not be a symlink: ${module.module}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    try {
      const fileStat = await fs.lstat(file);
      if (fileStat.isSymbolicLink()) throw new Error(`Current specification must not be a symlink: ${file}`);
      current.set(module.module, await fs.readFile(file, 'utf8'));
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') current.set(module.module, '');
      else throw error;
    }
  }
  for (const delta of deltas) {
    if (!current.has(delta.module)) current.set(delta.module, '');
    if (delta.action !== 'ADDED' && !requirementBlock(current.get(delta.module)!, delta.id)) throw new Error(`ARCHIVE CONFLICT: missing ${delta.id}`);
  }
  if (await exists(path.join(workspace.paths.archivedChanges, changeId))) throw new Error(`Archive destination already exists: ${changeId}`);
  const metadataPath = path.join(workspace.openspecDir, artifacts.metadata.artifacts.metadata);
  const indexRaw = await fs.readFile(workspace.paths.changeIndex, 'utf8');
  return {
    changeId: changeId as ContractArchivePlan['changeId'], ready: true, conflict: false, reasons: [], workspace, artifacts, deltas, current,
    snapshot: { metadata: await fs.readFile(metadataPath, 'utf8'), current: new Map(current), index: indexRaw },
  };
}

function validatePreparedCurrentSpec(module: string, spec: string): void {
  const ids = [...spec.matchAll(/^###\s+(MOD-\d{3}-REQ-\d{3})(?:\s+.*)?$/gmu)].map((match) => match[1]);
  if (!spec.trim() || (ids.length === 0 && !/^#(?:\s|$)/m.test(spec))) throw new Error(`Archive validation failed: Current spec for ${module} is not a canonical specification document`);
  if (new Set(ids).size !== ids.length) throw new Error(`Archive validation failed: Current spec for ${module} contains duplicate Requirement headings`);
  if (ids.some((id) => !id.startsWith(`${module}-`))) throw new Error(`Archive validation failed: Current spec for ${module} contains a Requirement from another module`);
}

export async function prepareArchive(plan: ArchivePlan): Promise<PreparedArchive> {
  const specs = new Map(plan.current);
  for (const delta of plan.deltas) specs.set(delta.module, applyDelta(specs.get(delta.module) ?? '', delta));
  for (const [module, spec] of specs) validatePreparedCurrentSpec(module, spec);
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
  const lock = path.join(plan.workspace.paths.archive, '.archive.lock');
  const indexLock = `${plan.workspace.paths.changeIndex}.lock`;
  const destinations = [
    ...[...specs.keys()].map((module) => path.join(plan.workspace.paths.currentSpecs, module)),
    archivedPath, plan.workspace.paths.changeIndex, plan.artifacts.changeDir,
    path.join(plan.workspace.paths.archive, 'README.md'), path.join(plan.workspace.paths.archive, 'history.yaml'),
  ];
  const moved: string[] = [];
  const installed: string[] = [];
  let committed = false;
  let rollbackComplete = false;
  let ownsLock = false;
  let ownsIndexLock = false;
  try {
    try { await fs.mkdir(lock); ownsLock = true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('已有归档事务正在进行'); throw error; }
    try { await fs.mkdir(indexLock); ownsIndexLock = true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Change 索引正忙'); throw error; }
    const latestMetadata = await fs.readFile(path.join(plan.workspace.openspecDir, plan.artifacts.metadata.artifacts.metadata), 'utf8');
    const latestIndex = await fs.readFile(plan.workspace.paths.changeIndex, 'utf8');
    const latestCurrent = new Map<string, string>();
    for (const module of specs.keys()) {
      const file = path.join(plan.workspace.paths.currentSpecs, module, 'spec.md');
      const currentDirStat = await fs.lstat(path.dirname(file)).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      });
      if (currentDirStat?.isSymbolicLink() || (await fs.lstat(file).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }))?.isSymbolicLink()) throw new Error(`Current specification must not be a symlink: ${file}`);
      latestCurrent.set(module, await fs.readFile(file, 'utf8').catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
        throw error;
      }));
    }
    if (latestMetadata !== plan.snapshot.metadata || latestIndex !== plan.snapshot.index || [...latestCurrent].some(([module, content]) => content !== plan.snapshot.current.get(module))) {
      throw new Error('归档冲突：预检后工作区发生变化，请重新运行 archive');
    }
    await fs.mkdir(stage, { recursive: true });
    for (const [module, content] of specs) {
      const dir = path.join(stage, 'specs', module); await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, 'spec.md'), content);
    }
    await copyTree(plan.artifacts.changeDir, path.join(stage, 'change'));
    await fs.writeFile(path.join(stage, 'change', 'metadata.yaml'), stringifyYaml(archivedMetadata));
    const index = await loadChangeIndex(plan.workspace.paths);
    const nextIndex = { version: 1, changes: index.entries.filter((entry) => entry.id !== plan.changeId) };
    await fs.writeFile(path.join(stage, 'index.yaml'), stringifyYaml(nextIndex));
    const readExisting = async (file: string) => fs.readFile(file, 'utf8').catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw error;
    });
    const existingReadme = await readExisting(path.join(plan.workspace.paths.archive, 'README.md'));
    const existingHistory = await readExisting(path.join(plan.workspace.paths.archive, 'history.yaml'));
    const archiveRecord = { change: plan.changeId, status: 'ARCHIVED', archived_at: archivedMetadata.archive.archived_at };
    const parsedHistory = existingHistory.trim() ? parseYaml(existingHistory) : { version: 1, records: [] };
    if (!parsedHistory || typeof parsedHistory !== 'object' || Array.isArray(parsedHistory) || (parsedHistory as any).version !== 1 || !Array.isArray((parsedHistory as any).records) || (parsedHistory as any).records.some((record: any) => !record || !/^CHG-\d{8}-\d{3}$/u.test(record.change) || record.status !== 'ARCHIVED' || typeof record.archived_at !== 'string' || Number.isNaN(Date.parse(record.archived_at)))) {
      throw new Error('归档历史必须使用 canonical version 1 records Schema');
    }
    const mergedHistory = { version: 1, records: [...(parsedHistory as any).records, archiveRecord] };
    await fs.writeFile(path.join(stage, 'README.md'), `${existingReadme}${existingReadme && !existingReadme.endsWith('\n') ? '\n' : ''}\n## Archived ${plan.changeId}\n\nStatus: ARCHIVED\n`);
    await fs.writeFile(path.join(stage, 'history.yaml'), stringifyYaml(mergedHistory));
    await fs.mkdir(backup, { recursive: true });
    for (const [i, dest] of destinations.entries()) if (await exists(dest)) { await fs.rename(dest, path.join(backup, String(i))); moved.push(dest); }
    await fs.mkdir(path.dirname(archivedPath), { recursive: true });
    const install = async (step: string, source: string, destination: string) => { await archiveTestHooks?.beforeCommitStep?.(step); await fs.rename(source, destination); installed.push(destination); };
    for (const [module] of specs) await install(`current-spec:${module}`, path.join(stage, 'specs', module), path.join(plan.workspace.paths.currentSpecs, module));
    await install('archived-change', path.join(stage, 'change'), archivedPath);
    await install('change-index', path.join(stage, 'index.yaml'), plan.workspace.paths.changeIndex);
    await install('archive-readme', path.join(stage, 'README.md'), path.join(plan.workspace.paths.archive, 'README.md'));
    await install('archive-history', path.join(stage, 'history.yaml'), path.join(plan.workspace.paths.archive, 'history.yaml'));
    await fs.rm(plan.artifacts.changeDir, { recursive: true, force: true });
    committed = true;
    const staleChanges = await detectStaleChanges(plan.workspace, plan.deltas.map((d) => d.id));
    return { changeId: plan.changeId, archivedPath, staleChanges, requirementIds: plan.deltas.map((d) => d.id) };
  } catch (error) {
    if (committed) throw new Error(`${error instanceof Error ? error.message : String(error)} (archive committed; stale scan requires manual retry)`);
    const rollbackErrors: string[] = [];
    for (const dest of installed) await fs.rm(dest, { recursive: true, force: true }).catch((rollbackError) => rollbackErrors.push(`remove ${dest}: ${String(rollbackError)}`));
    for (let i = destinations.length - 1; i >= 0; i -= 1) {
      const dest = destinations[i]; const old = path.join(backup, String(i));
      if (await exists(old)) {
        try { if (await exists(dest)) throw new Error('destination unexpectedly exists'); await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.rename(old, dest); }
        catch (rollbackError) { rollbackErrors.push(`restore ${dest}: ${String(rollbackError)}`); }
      }
    }
    if (!rollbackErrors.length) rollbackComplete = true;
    const suffix = rollbackErrors.length
      ? ` (rollback incomplete; recovery stage preserved: ${stage}; backup preserved: ${backup}; ${rollbackErrors.join('; ')})`
      : ' (transaction rolled back)';
    throw new Error(`${error instanceof Error ? error.message : String(error)}${suffix}`);
  } finally {
    if (rollbackComplete || committed) { await fs.rm(stage, { recursive: true, force: true }).catch(() => undefined); await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined); }
    if (ownsLock) await fs.rm(lock, { recursive: true, force: true }).catch(() => undefined);
    if (ownsIndexLock) await fs.rm(indexLock, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function archiveChange(workspace: WorkspaceContext, changeId: string): Promise<ArchiveResult> {
  return commitArchive(await prepareArchive(await preflightArchive(workspace, changeId)));
}
