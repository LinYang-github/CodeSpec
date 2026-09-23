import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { parseChangeMetadata } from './schemas.js';
import type { BusinessModuleId, ChangeId, ChangeMetadata } from './types.js';

export interface RequirementWorkspace { paths: { currentSpecs: string; changes: string } }
const active = new Set(['ANALYZE', 'DESIGN', 'PLAN', 'IMPLEMENT', 'VERIFY', 'ARCHIVE']);
const changePattern = /^CHG-\d{8}-\d{3}$/u;

async function withLock<T>(directory: string, work: () => Promise<T>): Promise<T> {
  const lock = path.join(directory, '.requirement-allocation.lock');
  await fs.mkdir(directory, { recursive: true });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { await fs.mkdir(lock); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (attempt === 99) throw new Error('Requirement 分配锁正忙');
    }
  }
  try { return await work(); } finally { await fs.rm(lock, { recursive: true, force: true }); }
}

async function collectFileIds(directory: string, moduleId: BusinessModuleId, used: Set<number>): Promise<void> {
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectFileIds(full, moduleId, used);
    else if (entry.isFile()) {
      const content = await fs.readFile(full, 'utf8');
      for (const match of content.matchAll(new RegExp(`${moduleId}-REQ-(\\d{3})`, 'gu'))) used.add(Number(match[1]));
    }
  }
}

async function collectActiveMetadata(workspace: RequirementWorkspace, used: Set<number>, targetId?: ChangeId): Promise<ChangeMetadata | undefined> {
  let entries;
  try { entries = await fs.readdir(workspace.paths.changes, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  let target: ChangeMetadata | undefined;
  for (const entry of entries) {
    if (!entry.isDirectory() || !changePattern.test(entry.name)) continue;
    const directory = path.join(workspace.paths.changes, entry.name);
    const metadataPath = path.join(directory, 'metadata.yaml');
    let metadata: ChangeMetadata;
    try { metadata = parseChangeMetadata(parseYaml(await fs.readFile(metadataPath, 'utf8'))); }
    catch (error) { throw new Error(`Cannot parse canonical active Change metadata ${metadataPath}: ${error instanceof Error ? error.message : String(error)}`); }
    if (metadata.change.id !== entry.name) throw new Error(`Change directory ${entry.name} does not match metadata change.id ${metadata.change.id}`);
    if (targetId && metadata.change.id === targetId) target = metadata;
    if (!active.has(metadata.change.status)) continue;
    for (const item of Object.values(metadata.requirements).flat()) {
      const match = item.id.match(new RegExp(`^${moduleIdEscape(item.module)}-REQ-(\\d{3})$`, 'u'));
      if (match) used.add(Number(match[1]));
    }
  }
  return target;
}

function moduleIdEscape(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function allocate(workspace: RequirementWorkspace, targetId: ChangeId | undefined, moduleId: BusinessModuleId, count: number): Promise<string[]> {
  if (!Number.isInteger(count) || count < 1) throw new Error('Requirement 分配数量必须是正整数');
  return withLock(workspace.paths.changes, async () => {
    const used = new Set<number>();
    await collectFileIds(workspace.paths.currentSpecs, moduleId, used);
    const target = await collectActiveMetadata(workspace, used, targetId);
    if (targetId && !target) throw new Error(`需求预留未找到 canonical Change ${targetId}`);
    const ids: string[] = [];
    for (let n = Math.max(0, ...used) + 1; ids.length < count; n += 1) if (!used.has(n)) { used.add(n); ids.push(`${moduleId}-REQ-${String(n).padStart(3, '0')}`); }
    if (target) {
      target.requirements.added.push(...ids.map((id) => ({ id: id as `${BusinessModuleId}-REQ-${string}`, module: moduleId })));
      const metadataPath = path.join(workspace.paths.changes, target.change.id, 'metadata.yaml');
      const temporary = `${metadataPath}.${process.pid}.tmp`;
      await fs.writeFile(temporary, stringifyYaml(target));
      await fs.rename(temporary, metadataPath);
    }
    return ids;
  });
}

export function allocateRequirementIds(workspace: RequirementWorkspace, moduleId: BusinessModuleId, count: number): Promise<string[]>;
export function allocateRequirementIds(workspace: RequirementWorkspace, changeId: ChangeId, moduleId: BusinessModuleId, count: number): Promise<string[]>;
export function allocateRequirementIds(workspace: RequirementWorkspace, arg2: BusinessModuleId | ChangeId, arg3: BusinessModuleId | number, arg4?: number): Promise<string[]> {
  const targetId = arg4 === undefined ? undefined : arg2 as ChangeId;
  const moduleId = (arg4 === undefined ? arg2 : arg3) as BusinessModuleId;
  const count = (arg4 === undefined ? arg3 : arg4) as number;
  return allocate(workspace, targetId, moduleId, count);
}
