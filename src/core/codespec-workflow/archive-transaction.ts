import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ChangeArtifacts } from './artifacts.js';
import { loadChangeArtifacts, type WorkspaceContext } from './loaders.js';
import { loadChangeIndex } from './change-index.js';
import { planStaleChanges } from './stale.js';
import { validateRelations } from './relations.js';
import { appendLatestVerificationSummary, validateCurrentVerificationArtifacts } from './verification.js';
import { parseCurrentTasks, parseCurrentVerification } from './current-change-yaml.js';
import { readCurrentDeltaBaseline, validateCurrentArchivePreflight } from './current-archive-preflight.js';
import { createArchiveJournal, installArchiveJournal, markArchiveJournalCommitted, recoverPendingTransactions } from './transaction-journal.js';
import { acquireArchiveIndexLock, releaseArchiveIndexLock } from './archive-index-lock.js';
import { mergeCurrentModuleDeltas } from './current-archive-merge.js';
import { inspectCurrentModuleState, readCurrentModuleFiles } from './current-module-state.js';
import { buildArchiveProjection, currentSpecDeltaBaseline, projectCurrentSpecDelta, type ArchiveProjection } from './archive-projection.js';
import { validateCurrentSpecDeltaAgainstCurrent, type CurrentSpecDeltaDocument } from './current-spec-delta.js';
import { parseBusinessRegistry, parseConfiguration, parseModuleInterface } from './current-spec-yaml.js';
import { parseCurrentSpecification, validateCurrentSpecification } from './current-spec-model.js';
import { assertTransitionApproval } from './approvals.js';
import { isUiChange, runUiArchiveGate } from './ui-archive-gate.js';
import type { UiArchiveGateResult } from './ui-archive-gate.js';
import { fingerprintCurrentFiles } from './current-state.js';
import {
  validateChangeArchiveImpact,
  type ArchiveImpact,
} from './archive-impact.js';
import type { ArchivePlan as ContractArchivePlan } from './types.js';

export interface ArchivePlan extends ContractArchivePlan {
  workspace: WorkspaceContext;
  artifacts: ChangeArtifacts;
  current: Map<string, string>;
  archiveImpact: ArchiveImpact;
  richDelta: CurrentSpecDeltaDocument;
  snapshot: {
    metadata: string;
    current: Map<string, string>;
    index: string;
    trees: Map<string, string>;
    verification: string;
  };
}

export interface PreparedArchive {
  plan: ArchivePlan;
  specs: Map<string, string>;
  projection?: ArchiveProjection;
  affectedModules?: string[];
}

export interface ArchiveResult {
  changeId: string;
  archivedPath: string;
  staleChanges: string[];
  requirementIds: string[];
}

interface ArchiveTestHooks { beforeCommitStep?: (step: string) => void | Promise<void> }
export type UiArchiveGateRunner = (workspace: WorkspaceContext, artifacts: ChangeArtifacts) => Promise<UiArchiveGateResult>;
let archiveTestHooks: ArchiveTestHooks | null = null;
export function __setArchiveTestHooksForTests(hooks: ArchiveTestHooks | null): void { archiveTestHooks = hooks; }

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const readOptional = async (file: string): Promise<string | null> => fs.readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
  if (error.code === 'ENOENT') return null;
  throw error;
});

async function validateCurrentEngineeringFiles(
  workspace: WorkspaceContext,
  specification: ReturnType<typeof parseCurrentSpecification>,
): Promise<void> {
  const projectRoot = path.dirname(workspace.codespecDir);
  for (const file of specification.engineeringFiles) {
    if (file.path.includes('\0') || file.path.includes('\\') || path.isAbsolute(file.path) || file.path.split('/').includes('..')) {
      throw new Error(`工程文件路径必须是仓库内相对 POSIX 路径：${file.path}`);
    }
    const target = path.resolve(projectRoot, file.path);
    const relative = path.relative(projectRoot, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`工程文件路径越界：${file.path}`);
    let cursor = target;
    while (true) {
      const stat = await fs.lstat(cursor).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!stat) {
        if (file.change !== '删除') throw new Error(`工程文件不存在：${file.path}`);
        if (cursor === projectRoot) break;
        cursor = path.dirname(cursor);
        continue;
      }
      if (stat.isSymbolicLink()) throw new Error(`工程文件不得经过软链接：${file.path}`);
      if (cursor === projectRoot) break;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw new Error(`工程文件路径越界：${file.path}`);
      cursor = parent;
    }
    if (file.change !== '删除') {
      const stat = await fs.lstat(target);
      if (!stat.isFile()) throw new Error(`工程文件必须是普通文件：${file.path}`);
    }
  }
}

async function validateCurrentModuleLayout(workspace: WorkspaceContext, moduleIds: readonly string[]): Promise<void> {
  const allowed = new Set(['spec.md', 'interface.yaml', 'api.yaml']);
  for (const moduleId of moduleIds) {
    const directory = path.join(workspace.paths.currentSpecs, moduleId);
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      if (!allowed.has(entry.name)) {
        throw new Error(`当前模块目录 ${moduleId} 只能包含 spec.md、interface.yaml、api.yaml：${entry.name}`);
      }
      if (entry.isSymbolicLink()) throw new Error(`当前模块文件不得是软链接：${moduleId}/${entry.name}`);
      if (!entry.isFile()) throw new Error(`当前模块文件必须是普通文件：${moduleId}/${entry.name}`);
    }
  }
}

/** Existing module sources cannot be reconstructed by an archive. */
async function validateCurrentArchiveSources(workspace: WorkspaceContext): Promise<void> {
  const retiredArchive = path.join(workspace.codespecDir, 'archive');
  const retiredArchiveStat = await fs.lstat(retiredArchive).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (retiredArchiveStat) {
    throw new Error(`已废弃的 codespec/archive/ 目录仍然存在，请先明确清理后再归档：${retiredArchive}`);
  }
  const business = parseBusinessRegistry(parseYaml(await fs.readFile(workspace.paths.business, 'utf8')));
  await validateCurrentModuleLayout(workspace, business.modules.map((module) => module.id));
  for (const module of business.modules) {
    await inspectCurrentModuleState(workspace.paths.currentSpecs, module.id);
  }
}

async function processAlive(pid: number): Promise<boolean> {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

async function acquireArchiveLock(lock: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(lock), { recursive: true });
    await fs.mkdir(lock);
    try { await fs.writeFile(path.join(lock, '.owner.json'), JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })); }
    catch (error) { await fs.rm(lock, { recursive: true, force: true }); throw error; }
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  let owner: { pid?: unknown } | null = null;
  try { owner = JSON.parse(await fs.readFile(path.join(lock, '.owner.json'), 'utf8')) as { pid?: unknown }; }
  catch { /* A lock without an owner marker is kept conservative and remains busy. */ }
  if (typeof owner?.pid !== 'number' || !Number.isInteger(owner.pid) || owner.pid <= 0 || await processAlive(owner.pid)) {
    throw new Error('已有归档事务正在进行');
  }
  await fs.rm(lock, { recursive: true, force: true });
  await fs.mkdir(lock);
  await fs.writeFile(path.join(lock, '.owner.json'), JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
}

async function treeDigest(file: string): Promise<string> {
  const stat = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat) return 'missing';
  if (stat.isSymbolicLink()) throw new Error(`Archive input must not be a symlink: ${file}`);
  if (stat.isFile()) return createHash('sha256').update(await fs.readFile(file)).digest('hex');
  if (!stat.isDirectory()) throw new Error(`Archive input must be a regular file or directory: ${file}`);
  const entries = await fs.readdir(file);
  return digest(await Promise.all(entries.sort().map(async (name) => [name, await treeDigest(path.join(file, name))])));
}

async function checkTreeSnapshots(trees: ReadonlyMap<string, string>): Promise<void> {
  for (const [file, expected] of trees) {
    try {
      if (await treeDigest(file) !== expected) throw new Error('changed after preflight; rerun archive');
    } catch (error) {
      throw new Error(`ARCHIVE CONFLICT: ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** Compare captured bytes before any semantic reread can hide the changed path. */
async function checkCanonicalSnapshots(plan: ArchivePlan): Promise<string | null> {
  const { workspace, artifacts, richDelta } = plan;
  const currentPath = path.join(workspace.paths.currentSpecs, richDelta.module, 'spec.md');
  let live: string | null;
  try { live = await readCurrentDeltaBaseline(workspace, richDelta.module); }
  catch (error) { throw new Error(`ARCHIVE CONFLICT: ${currentPath}: ${String(error)}`); }
  if ((live ?? '') !== plan.snapshot.current.get(richDelta.module)) throw new Error(`ARCHIVE CONFLICT: ${currentPath} changed or disappeared after its preflight read`);
  const snapshots = new Map<string, string>([[workspace.paths.changeIndex, plan.snapshot.index]]);
  for (const key of ['metadata', 'analysis', 'design', 'spec', 'tasks', 'verification'] as const) {
    snapshots.set(path.join(workspace.codespecDir, artifacts.metadata.artifacts[key]),
      key === 'metadata' ? plan.snapshot.metadata : key === 'verification' ? plan.snapshot.verification : artifacts[key]);
  }
  for (const [file, expected] of snapshots) {
    let raw: string;
    try { raw = await fs.readFile(file, 'utf8'); }
    catch (error) { throw new Error(`ARCHIVE CONFLICT: ${file}: ${String(error)}`); }
    if (raw !== expected) throw new Error(`ARCHIVE CONFLICT: ${file} changed after its preflight read`);
  }
  return live;
}

function ensureArchiveGates(artifacts: ChangeArtifacts): void {
  const m = artifacts.metadata;
  if (m.change.status !== 'ARCHIVE') throw new Error(`归档要求状态为 ARCHIVE，当前为 ${m.change.status}`);
  if (!m.archive.ready || !m.gates.archive.satisfied) throw new Error('归档门禁未满足');
  if (m.archive.conflict) throw new Error('归档前必须先解决冲突');
  if (m.baseline.stale) throw new Error('归档被阻塞：baseline 已过期');
  for (const target of ['DESIGN', 'PLAN', 'IMPLEMENT'] as const) assertTransitionApproval(artifacts, target);
  const tasks = parseCurrentTasks(parseYaml(artifacts.tasks));
  const verification = parseCurrentVerification(parseYaml(artifacts.verification));
  if (tasks.changeRevision !== m.change.revision || verification.changeRevision !== m.change.revision) {
    throw new Error('tasks.yaml/verification.yaml Change revision must equal metadata.change.revision');
  }
  const preflightErrors = validateCurrentArchivePreflight({
    designApproved: m.approvals.design.status === 'approved' && m.approvals.design.revision === m.change.revision,
    planApproved: m.approvals.plan.status === 'approved' && m.approvals.plan.revision === m.change.revision,
    taskStatuses: tasks.tasks.map((task) => task.status),
    verificationErrors: [],
  });
  if (preflightErrors.length) throw new Error(`当前 Change 归档预检失败：${preflightErrors.join('; ')}`);
}

export async function preflightArchive(workspace: WorkspaceContext, changeId: string, verificationOverride?: string): Promise<ArchivePlan> {
  const metadataRaw = await fs.readFile(path.join(workspace.paths.changes, changeId, 'metadata.yaml'), 'utf8');
  const loaded = await loadChangeArtifacts(workspace.paths, changeId);
  const artifacts = verificationOverride === undefined ? loaded : { ...loaded, verification: verificationOverride };
  await validateCurrentArchiveSources(workspace);
  const { impact: archiveImpact, richDelta, current, issues: impactIssues } = await validateChangeArchiveImpact(workspace, artifacts);
  if (impactIssues.length) {
    const conflicts = impactIssues.filter((issue) => issue.startsWith('ARCHIVE CONFLICT:'));
    if (richDelta && conflicts.length) throw new Error([...conflicts, ...impactIssues.filter((issue) => !issue.startsWith('ARCHIVE CONFLICT:'))].join('; '));
    throw new Error(`归档影响映射校验失败：${impactIssues.join('; ')}`);
  }
  ensureArchiveGates(artifacts);
  const errors = await validateCurrentVerificationArtifacts(workspace, artifacts);
  if (errors.length) throw new Error(`当前 Change 验证预检失败：${errors.join('; ')}`);
  if (!richDelta) throw new Error('归档仅支持六件套 Current Change');
  await validateRelations(workspace);
  const indexRaw = await fs.readFile(workspace.paths.changeIndex, 'utf8');
  const trees = new Map<string, string>();
  for (const file of [
    artifacts.changeDir,
    ...[...current.keys()].map((module) => path.join(workspace.paths.currentSpecs, module)),
    ...(richDelta ? [workspace.paths.currentSpecs, workspace.paths.business, workspace.paths.configuration] : []),
  ]) trees.set(file, await treeDigest(file));
  return {
    changeId: changeId as ContractArchivePlan['changeId'], ready: true, conflict: false, reasons: [], workspace, artifacts, current, archiveImpact, richDelta,
    snapshot: { metadata: metadataRaw, current: new Map(current), index: indexRaw, trees, verification: loaded.verification },
  };
}

export async function prepareArchive(plan: ArchivePlan): Promise<PreparedArchive> {
  return prepareCurrentArchive(plan);
}

async function prepareCurrentArchive(plan: ArchivePlan): Promise<PreparedArchive> {
  const { workspace, artifacts, richDelta: delta } = plan;
  if (!delta) throw new Error('Canonical archive requires a rich delta');
  const tasks = parseCurrentTasks(parseYaml(artifacts.tasks));
  const business = parseBusinessRegistry(parseYaml(await fs.readFile(workspace.paths.business, 'utf8')));
  const configuration = parseConfiguration(parseYaml(await fs.readFile(workspace.paths.configuration, 'utf8')));
  const interfaces = new Map<string, ReturnType<typeof parseModuleInterface>>();
  for (const module of business.modules) {
    const current = await readCurrentModuleFiles(workspace.paths.currentSpecs, module.id);
    if (current) interfaces.set(module.id, parseModuleInterface(parseYaml(current.interface)));
  }
  const merged = mergeCurrentModuleDeltas({ business, interfaces, configuration, moduleDeltas: tasks.moduleDeltas, moduleRegistrations: tasks.moduleRegistrations });
  await validateCurrentModuleLayout(workspace, merged.business.modules.map((module) => module.id));
  const allowed = new Set(['metadata.yaml', 'analysis.yaml', 'spec.md', 'design.md', 'tasks.yaml', 'verification.yaml']);
  for (const filename of await fs.readdir(artifacts.changeDir)) {
    if (!allowed.has(filename)) throw new Error(`当前 Change 只能包含六个 canonical 产物：${filename}`);
  }
  const target = merged.business.modules.find((module) => module.id === delta.module);
  if (!target) throw new Error(`当前 Change spec.md 引用了未注册模块：${delta.module}`);
  if (target.status === 'RETIRED') throw new Error(`当前 Change 不能归档到已退役模块：${delta.module}`);
  const specification = projectCurrentSpecDelta(plan.current.get(delta.module) || null, delta);
  const specIssues = validateCurrentSpecification(parseCurrentSpecification(specification));
  if (specIssues.length) throw new Error(`当前 Change 合并后的 spec.md 校验失败：${specIssues.join('; ')}`);
  await validateCurrentEngineeringFiles(workspace, { ...currentSpecDeltaBaseline(null, delta), engineeringFiles: delta.engineeringFiles });
  const verification = parseCurrentVerification(parseYaml(artifacts.verification));
  const specs = new Map<string, string>();
  for (const module of merged.business.modules) {
    if (module.id === delta.module) {
      specs.set(module.id, appendLatestVerificationSummary(specification, verification));
    } else if (interfaces.has(module.id)) {
      specs.set(module.id, (await readCurrentModuleFiles(workspace.paths.currentSpecs, module.id))!.spec);
    }
  }
  const projection = buildArchiveProjection({ specs, business: merged.business, interfaces: merged.interfaces, configuration: merged.configuration });
  const affectedModules: string[] = [];
  for (const [module, document] of projection.modules) {
    for (const [filename, content] of Object.entries({ 'spec.md': document.spec, 'interface.yaml': document.interface, 'api.yaml': document.api })) {
      if (await readOptional(path.join(workspace.paths.currentSpecs, module, filename)) !== content) {
        affectedModules.push(module);
        break;
      }
    }
  }
  return {
    plan, specs, projection, affectedModules,
  };
}

async function commitArchive(prepared: PreparedArchive): Promise<ArchiveResult> {
  return commitCurrentArchive(prepared);
}

function archiveSnapshotIdentity(plan: ArchivePlan): string {
  const entries = (values: ReadonlyMap<string, string>) => [...values.entries()].sort(([left], [right]) => left.localeCompare(right));
  return digest({
    metadata: plan.snapshot.metadata,
    verification: plan.snapshot.verification,
    index: plan.snapshot.index,
    current: entries(plan.snapshot.current),
    trees: entries(plan.snapshot.trees),
  });
}

/** Commits exactly the plan the user confirmed, refreshing UI evidence without adopting changed inputs. */
export async function commitConfirmedArchive(
  prepared: PreparedArchive,
  uiArchiveGate: UiArchiveGateRunner = runUiArchiveGate,
): Promise<ArchiveResult> {
  const confirmed = prepared.plan;
  if (!isUiChange(confirmed.artifacts)) return commitArchive(prepared);
  await checkCanonicalSnapshots(confirmed);
  await checkTreeSnapshots(confirmed.snapshot.trees);
  const gate = await uiArchiveGate(confirmed.workspace, confirmed.artifacts);
  const refreshed = await preflightArchive(confirmed.workspace, confirmed.changeId, stringifyYaml(gate.verification));
  if (archiveSnapshotIdentity(refreshed) !== archiveSnapshotIdentity(confirmed)) {
    throw new Error('ARCHIVE CONFLICT: 归档确认后输入已变化，请重新预检并确认');
  }
  return commitArchive(await prepareArchive(refreshed));
}

async function commitCurrentArchive(prepared: PreparedArchive): Promise<ArchiveResult> {
  const { plan, projection } = prepared;
  const { workspace, artifacts, richDelta: delta } = plan;
  if (!projection || !delta) throw new Error('Canonical archive projection is missing');
  const archivedPath = path.join(workspace.paths.currentSpecs, delta.module);
  const lock = path.join(workspace.paths.transactions, '.archive.lock');
  const transactionId = `archive-${plan.changeId}-${process.pid}-${Date.now()}`;
  let ownsLock = false;
  let ownsIndexLock = false;
  let journal: Awaited<ReturnType<typeof createArchiveJournal>> | undefined;
  let committed = false;
  try {
    await acquireArchiveLock(lock); ownsLock = true;
    await acquireArchiveIndexLock(workspace.paths, transactionId); ownsIndexLock = true;
    // Re-read Current under the archive lock; Previous is never validated
    // against an archived Change or a previously prepared projection.
    const live = await checkCanonicalSnapshots(plan);
    const conflicts = validateCurrentSpecDeltaAgainstCurrent(currentSpecDeltaBaseline(live, delta), delta);
    if (conflicts.length) throw new Error(conflicts.join('; '));
    await checkTreeSnapshots(plan.snapshot.trees);
    if (await fs.readFile(workspace.paths.changeIndex, 'utf8') !== plan.snapshot.index) throw new Error(`ARCHIVE CONFLICT: ${workspace.paths.changeIndex} changed after preflight`);
    const files: Array<{ target: string; before: string | null; after: string | null }> = [];
    const add = async (target: string, after: string | null) => { files.push({ target, before: await readOptional(target), after }); };
    const steps = new Map<string, string>();
    for (const [module, document] of projection.modules) {
      for (const [filename, content] of Object.entries({ 'spec.md': document.spec, 'interface.yaml': document.interface, 'api.yaml': document.api })) {
        const target = path.join(workspace.paths.currentSpecs, module, filename);
        await add(target, content);
        steps.set(target, `current-${filename.split('.')[0]}:${module}`);
      }
    }
    await add(workspace.paths.business, projection.business);
    await add(workspace.paths.configuration, projection.configuration);
    const artifactFiles = ['metadata.yaml', 'analysis.yaml', 'design.md', 'spec.md', 'tasks.yaml', 'verification.yaml'];
    const index = await loadChangeIndex(workspace.paths);
    const projectedCurrent = new Map<string, string>([
      ['business.yaml', projection.business],
      ['configuration.yaml', projection.configuration],
    ]);
    for (const [module, document] of projection.modules) {
      projectedCurrent.set(path.posix.join('specs', module, 'spec.md'), document.spec);
      projectedCurrent.set(path.posix.join('specs', module, 'interface.yaml'), document.interface);
      projectedCurrent.set(path.posix.join('specs', module, 'api.yaml'), document.api);
    }
    const staleAt = new Date().toISOString();
    const staleUpdates = await planStaleChanges(workspace, fingerprintCurrentFiles(projectedCurrent), plan.changeId, staleAt);
    for (const update of staleUpdates) {
      files.push({ target: update.file, before: update.before, after: update.after });
      steps.set(update.file, `stale-change:${update.changeId}`);
    }
    const staleById = new Map(staleUpdates.map((update) => [update.changeId, update.updatedAt]));
    await add(workspace.paths.changeIndex, stringifyYaml({
      version: 1,
      changes: index.entries
        .filter((entry) => entry.id !== plan.changeId)
        .map((entry) => staleById.has(entry.id) ? { ...entry, updated_at: staleById.get(entry.id)! } : entry),
    }));
    steps.set(workspace.paths.changeIndex, 'change-index');
    // Source deletion is journalled file by file. Only an empty Change
    // directory is removed after commit, preserving concurrent author files.
    for (const filename of artifactFiles) await add(path.join(artifacts.changeDir, filename), null);
    await checkCanonicalSnapshots(plan);
    await checkTreeSnapshots(plan.snapshot.trees);
    if (await fs.readFile(workspace.paths.changeIndex, 'utf8') !== plan.snapshot.index) throw new Error(`ARCHIVE CONFLICT: ${workspace.paths.changeIndex} changed after preflight`);
    journal = await createArchiveJournal({
      paths: workspace.paths, transactionId, files,
      cleanupEmptyAfterCommit: [artifacts.changeDir], ownerPid: process.pid,
    });
    await installArchiveJournal(journal, async (target) => { await archiveTestHooks?.beforeCommitStep?.(steps.get(target) ?? 'active-change'); });
    await markArchiveJournalCommitted(journal);
    committed = true;
    await recoverPendingTransactions(workspace.paths, journal.transactionId);
    const requirementIds = delta.requirements.map((entry) => entry.id);
    return { changeId: plan.changeId, archivedPath, requirementIds, staleChanges: staleUpdates.map((update) => update.changeId) };
  } catch (error) {
    if (committed) throw new Error(`${error instanceof Error ? error.message : String(error)} (archive committed; recovery or stale scan requires retry)`);
    if (journal) {
      try { await recoverPendingTransactions(workspace.paths, journal.transactionId); }
      catch (recoveryError) { throw new Error(`${error instanceof Error ? error.message : String(error)} (rollback incomplete; ${String(recoveryError)})`); }
    }
    throw new Error(`${error instanceof Error ? error.message : String(error)} (transaction rolled back)`);
  } finally {
    try { if (ownsIndexLock) await releaseArchiveIndexLock(workspace.paths, transactionId); }
    finally { if (ownsLock) await fs.rm(lock, { recursive: true, force: true }).catch(() => undefined); }
  }
}

export async function archiveChange(workspace: WorkspaceContext, changeId: string): Promise<ArchiveResult> {
  await recoverPendingTransactions(workspace.paths);
  const artifacts = await loadChangeArtifacts(workspace.paths, changeId);
  let verificationOverride: string | undefined;
  if (isUiChange(artifacts)) {
    const gate = await runUiArchiveGate(workspace, artifacts);
    verificationOverride = stringifyYaml(gate.verification);
  }
  return commitArchive(await prepareArchive(await preflightArchive(workspace, changeId, verificationOverride)));
}
