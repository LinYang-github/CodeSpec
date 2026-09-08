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
import { appendLatestVerificationSummary, parseVerificationDocument, validateCurrentVerificationArtifacts, validateVerificationEvidence } from './verification.js';
import { validateCurrentSpec } from './current-spec-parser.js';
import { collectEmptyScenarioErrorIssues } from './scenario-parser.js';
import {
  validateChangeArchiveImpact,
  validateArchiveRegressionEvidence,
  validateArchiveImpactMappings,
  type ArchiveImpact,
} from './archive-impact.js';
import type { ArchivePlan as ContractArchivePlan, ChangeMetadata, RequirementDelta } from './types.js';

export interface ArchivePlan extends ContractArchivePlan {
  workspace: WorkspaceContext;
  artifacts: ChangeArtifacts;
  deltas: RequirementDelta[];
  current: Map<string, string>;
  archiveImpact: ArchiveImpact;
  snapshot: {
    metadata: string;
    current: Map<string, string>;
    index: string;
    trees: Map<string, string>;
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

async function processAlive(pid: number): Promise<boolean> {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

async function acquireArchiveLock(lock: string): Promise<void> {
  try {
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
    if (await treeDigest(file) !== expected) throw new Error('归档冲突：预检后工作区发生变化，请重新运行 archive');
  }
}

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
  const deltaErrors = parseDeltaSpec(artifacts.spec).entries.flatMap((entry) => collectEmptyScenarioErrorIssues(entry.id, entry.scenarios, m.change.id));
  if (deltaErrors.length) throw new Error(deltaErrors.join('; '));
  const evidenceIssues = validateVerificationEvidence(artifacts);
  if (evidenceIssues.length) throw new Error(evidenceIssues.join('; '));
  if (m.relations.conflicts_with.length) throw new Error('归档存在未解决的 Change 冲突');
  const trace = validateChangeTraceability(artifacts);
  if (!trace.valid) throw new Error(`归档追踪性门禁失败：${trace.issues.join('; ')}`);
}

export async function preflightArchive(workspace: WorkspaceContext, changeId: string): Promise<ArchivePlan> {
  const artifacts = await loadChangeArtifacts(workspace.paths, changeId);
  ensureArchiveGates(artifacts);
  if (!artifacts.metadata.artifacts.proposal) {
    const errors = await validateCurrentVerificationArtifacts(workspace, artifacts);
    if (errors.length) throw new Error(`当前 Change 验证预检失败：${errors.join('; ')}`);
  }
  const { impact: archiveImpact, deltas, current, issues: impactIssues } = await validateChangeArchiveImpact(workspace, artifacts);
  if (impactIssues.length) throw new Error(`归档影响映射校验失败：${impactIssues.join('; ')}`);
  const regressionIssues = validateArchiveRegressionEvidence(archiveImpact, parseVerificationDocument(artifacts.verification));
  if (regressionIssues.length) throw new Error(regressionIssues.join('; '));
  await validateRelations(workspace, artifacts.metadata);
  for (const [module, content] of current) {
    const issues = validateCurrentSpec(content, module);
    if (issues.length) throw new Error(`Current Specification ${module} 校验失败：${issues.join('; ')}`);
  }
  if (await exists(path.join(workspace.paths.archivedChanges, changeId))) throw new Error(`Archive destination already exists: ${changeId}`);
  const metadataPath = path.join(workspace.codespecDir, artifacts.metadata.artifacts.metadata);
  const indexRaw = await fs.readFile(workspace.paths.changeIndex, 'utf8');
  const trees = new Map<string, string>();
  for (const file of [
    artifacts.changeDir,
    ...[...current.keys()].map((module) => path.join(workspace.paths.currentSpecs, module)),
    path.join(workspace.paths.archive, 'README.md'),
    path.join(workspace.paths.archive, 'history.yaml'),
  ]) trees.set(file, await treeDigest(file));
  return {
    changeId: changeId as ContractArchivePlan['changeId'], ready: true, conflict: false, reasons: [], workspace, artifacts, deltas, current, archiveImpact,
    snapshot: { metadata: await fs.readFile(metadataPath, 'utf8'), current: new Map(current), index: indexRaw, trees },
  };
}

function validatePreparedCurrentSpec(module: string, spec: string): void {
  const ids = [...spec.matchAll(/^###\s+(MOD-\d{3}-REQ-\d{3})(?:\s+.*)?$/gmu)].map((match) => match[1]);
  if (!spec.trim() || (ids.length === 0 && !/^#(?:\s|$)/m.test(spec))) throw new Error(`Archive validation failed: Current spec for ${module} is not a canonical specification document`);
  if (new Set(ids).size !== ids.length) throw new Error(`Archive validation failed: Current spec for ${module} contains duplicate Requirement headings`);
  if (ids.some((id) => !id.startsWith(`${module}-`))) throw new Error(`Archive validation failed: Current spec for ${module} contains a Requirement from another module`);
}

export async function prepareArchive(plan: ArchivePlan): Promise<PreparedArchive> {
  const changedModules = new Set(plan.deltas.map((delta) => delta.module));
  const specs = new Map([...plan.current].filter(([module]) => changedModules.has(module as RequirementDelta['module'])));
  for (const delta of plan.deltas) specs.set(delta.module, applyDelta(specs.get(delta.module) ?? '', delta));
  if (!plan.artifacts.metadata.artifacts.proposal) {
    const verification = parseCurrentVerification(parseYaml(plan.artifacts.verification));
    for (const [module, spec] of specs) specs.set(module, appendLatestVerificationSummary(spec, verification));
  }
  for (const [module, spec] of specs) {
    validatePreparedCurrentSpec(module, spec);
    const issues = validateCurrentSpec(spec, module);
    if (issues.length) throw new Error(`Archive validation failed: Current Specification ${module}：${issues.join('; ')}`);
  }
  const mappingIssues = validateArchiveImpactMappings(plan.archiveImpact, plan.current, specs);
  if (mappingIssues.length) throw new Error(`归档影响映射校验失败：${mappingIssues.join('; ')}`);
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
    await acquireArchiveLock(lock); ownsLock = true;
    try { await fs.mkdir(indexLock); ownsIndexLock = true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Change 索引正忙'); throw error; }
    const latestMetadata = await fs.readFile(path.join(plan.workspace.codespecDir, plan.artifacts.metadata.artifacts.metadata), 'utf8');
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
    await checkTreeSnapshots(plan.snapshot.trees);
    await fs.mkdir(stage, { recursive: true });
    for (const [module, content] of specs) {
      const dir = path.join(stage, 'specs', module);
      const source = path.join(plan.workspace.paths.currentSpecs, module);
      if (await exists(source)) await copyTree(source, dir);
      else await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'spec.md'), content);
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
    const parsedHistory = existingHistory.trim() ? parseYaml(existingHistory) : { version: 1, records: [] };
    if (!parsedHistory || typeof parsedHistory !== 'object' || Array.isArray(parsedHistory) || (parsedHistory as any).version !== 1 || !Array.isArray((parsedHistory as any).records) || (parsedHistory as any).records.some((record: any) => !record || !/^CHG-\d{8}-\d{3}$/u.test(record.change) || record.status !== 'ARCHIVED' || typeof record.archived_at !== 'string' || Number.isNaN(Date.parse(record.archived_at)))) {
      throw new Error('归档历史必须使用 canonical version 1 records Schema');
    }
    const priorSpecs = (parsedHistory as { records: Array<{ current_specs?: Array<{ module: string; revision: number }> }> }).records.flatMap((record) => record.current_specs ?? []);
    if (priorSpecs.some((spec) => !spec || !/^MOD-\d{3}$/u.test(spec.module) || !Number.isSafeInteger(spec.revision) || spec.revision < 1)) throw new Error('归档历史包含无效的 Current Specification revision');
    const archiveRecord = {
      change: plan.changeId,
      status: 'ARCHIVED',
      archived_at: archivedMetadata.archive.archived_at,
      change_revision: plan.artifacts.metadata.change.revision,
      archive_impact: plan.archiveImpact,
      evidence_id: parseVerificationDocument(plan.artifacts.verification).receipt,
      current_specs: [...specs].map(([module, content]) => ({
        module,
        revision: Math.max(0, ...priorSpecs.filter((spec) => spec.module === module).map((spec) => spec.revision)) + 1,
        content_hash: createHash('sha256').update(content).digest('hex'),
      })),
    };
    const mergedHistory = { version: 1, records: [...(parsedHistory as any).records, archiveRecord] };
    await fs.writeFile(path.join(stage, 'README.md'), `${existingReadme}${existingReadme && !existingReadme.endsWith('\n') ? '\n' : ''}\n## Archived ${plan.changeId}\n\nStatus: ARCHIVED\n`);
    await fs.writeFile(path.join(stage, 'history.yaml'), stringifyYaml(mergedHistory));
    await checkTreeSnapshots(plan.snapshot.trees);
    if (await fs.readFile(plan.workspace.paths.changeIndex, 'utf8') !== plan.snapshot.index) {
      throw new Error('归档冲突：预检后 Change 索引发生变化，请重新运行 archive');
    }
    if (await exists(archivedPath)) throw new Error(`Archive destination already exists: ${plan.changeId}`);
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
