import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import type { WorkspacePaths } from './paths.js';
import { releaseArchiveIndexLock } from './archive-index-lock.js';
import { withIndexLockMutation } from './index-lock-gate.js';
import { assertPathWithoutSymlinks } from './path-safety.js';

interface JournalEntry {
  target: string;
  before: string | null;
  after: string | null;
  beforeChecksum: string | null;
  afterChecksum: string | null;
}

interface JournalManifest {
  version: 1;
  transactionId: string;
  entries: JournalEntry[];
  cleanupEmptyAfterCommit?: string[];
  createdDirectories?: string[];
  ownerPid?: number;
}

export interface JournalInput {
  paths: WorkspacePaths;
  transactionId: string;
  files: Array<{ target: string; before: string | null; after: string | null }>;
  cleanupEmptyAfterCommit?: string[];
  ownerPid?: number;
}

export interface ArchiveJournal {
  paths: WorkspacePaths;
  transactionId: string;
  directory: string;
  manifest: JournalManifest;
}

const checksum = (value: string | null): string | null => value === null
  ? null
  : `sha256:${createHash('sha256').update(value).digest('hex')}`;

function relativeTarget(paths: WorkspacePaths, target: string): string {
  const relative = path.relative(paths.codespecDir, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Journal target must remain inside codespecDir: ${target}`);
  }
  return relative.split(path.sep).join('/');
}

function resolveTarget(paths: WorkspacePaths, relative: string): string {
  const target = path.resolve(paths.codespecDir, relative);
  relativeTarget(paths, target);
  return target;
}

async function readTarget(file: string): Promise<string | null> {
  return fs.readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
}

async function removeEmptyDirectory(directory: string): Promise<void> {
  await fs.rmdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code ?? '')) throw error;
  });
}

async function writeDurable(file: string, value: string, flags = 'w'): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const handle = await fs.open(file, flags);
  try {
    await handle.writeFile(value, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function linkWithoutReplacing(source: string, target: string): Promise<boolean> {
  try { await fs.link(source, target); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

/** Preserve the displaced inode until the entire recovery has succeeded.
 * A check followed by rename-over-target is not an ownership check: an
 * author can write during staging. Rename the old target out of the way,
 * inspect those actual bytes, and publish the staged inode without clobbering
 * any file created in the meantime. Both files survive interrupted recovery.
 */
async function installOwnedEntry(paths: WorkspacePaths, directory: string, entry: JournalEntry, index: number, mode: 'install' | 'rollback' | 'commit'): Promise<boolean> {
  const target = resolveTarget(paths, entry.target);
  await assertPathWithoutSymlinks(paths.codespecDir, target);
  const desired = mode === 'rollback' ? entry.before : entry.after;
  const recovery = path.join(directory, mode === 'install' ? 'installation' : 'recovery', String(index));
  const displaced = path.join(recovery, 'displaced');
  const staged = path.join(recovery, `desired-${randomUUID()}`);
  let preserved = await readTarget(displaced);
  const current = await readTarget(target);
  const owned = (value: string | null) => value === entry.before || (mode !== 'install' && value === entry.after);
  const installedBefore = mode === 'install' ? null : await readTarget(path.join(directory, 'installation', String(index), 'displaced'));

  if (installedBefore !== null && installedBefore !== entry.before) {
    if (current === null) await linkWithoutReplacing(path.join(directory, 'installation', String(index), 'displaced'), target);
    return false;
  }

  if (preserved !== null && !owned(preserved)) {
    // This may be a retry after a crash between displacement and restoration.
    if (current === null) await linkWithoutReplacing(displaced, target);
    return false;
  }
  if (current === desired) return true;
  // Forward installation can itself have been interrupted after displacement
  // and before publishing the after-value. That absence is journal-owned.
  const interruptedInstallation = current === null && installedBefore !== null;
  if (preserved === null ? !owned(current) && !interruptedInstallation : current !== null) return false;

  await fs.mkdir(recovery, { recursive: true });
  if (desired !== null) {
    // Use a new inode on each attempt. An earlier stage can be partial after
    // interruption, or already linked into the workspace and edited there.
    await writeDurable(staged, desired, 'wx');
  }
  if (preserved === null && current !== null) {
    await fs.rename(target, displaced).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    preserved = await readTarget(displaced);
    if (preserved !== current) {
      if (preserved !== null) await linkWithoutReplacing(displaced, target);
      return false;
    }
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (desired !== null && !await linkWithoutReplacing(staged, target)) return false;
  return await readTarget(target) === desired && (preserved === null || await readTarget(displaced) === preserved);
}

/** Preserve original inodes indefinitely, including writes through handles
 * opened before displacement and resumed after our final ownership check.
 * No timeout or final read can prove those handles no longer exist. This
 * diagnostic escrow is separate from business inputs and pending journals;
 * normal recovery/archive never garbage-collects it.
 */
async function retainDisplacedInodes(paths: WorkspacePaths, directory: string, manifest: JournalManifest, committed: boolean): Promise<void> {
  const escrow = path.join(paths.transactions, '.recovery-escrow', manifest.transactionId);
  const retained: Array<{ phase: string; target: string; file: string; expectedChecksum: string | null }> = [];
  for (const [index, entry] of manifest.entries.entries()) {
    for (const phase of ['installation', 'recovery']) {
      const relative = `${phase}/${index}/displaced`;
      const displaced = path.join(directory, relative);
      const identity = await fs.stat(displaced).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!identity) continue;
      const saved = path.join(escrow, relative);
      await fs.mkdir(path.dirname(saved), { recursive: true });
      if (!await linkWithoutReplacing(displaced, saved)) {
        const existing = await fs.stat(saved);
        if (existing.dev !== identity.dev || existing.ino !== identity.ino) throw new Error(`ARCHIVE CONFLICT: recovery escrow inode differs: ${saved}`);
      }
      retained.push({ phase, target: entry.target, file: relative, expectedChecksum: phase === 'installation' ? entry.beforeChecksum : committed ? entry.beforeChecksum : entry.afterChecksum });
    }
  }
  if (retained.length) {
    await writeDurable(path.join(escrow, 'manifest.yaml'), stringifyYaml({
      version: 1, transactionId: manifest.transactionId, outcome: committed ? 'committed' : 'rolled-back',
      cleanupPolicy: 'manual-only', reason: 'Displaced inodes may still receive author writes through previously opened handles.', retained,
    }));
  }
}

function assertManifest(value: unknown): JournalManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Archive journal is malformed');
  const manifest = value as Partial<JournalManifest>;
  if (manifest.version !== 1 || typeof manifest.transactionId !== 'string' || !Array.isArray(manifest.entries)) {
    throw new Error('Archive journal is malformed');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(manifest.transactionId)) throw new Error('Archive journal transaction ID is invalid');
  for (const entry of manifest.entries) {
    if (!entry || typeof entry.target !== 'string'
      || ![null, 'string'].includes(entry.before === null ? null : typeof entry.before)
      || ![null, 'string'].includes(entry.after === null ? null : typeof entry.after)
      || checksum(entry.before) !== entry.beforeChecksum || checksum(entry.after) !== entry.afterChecksum) {
      throw new Error('Archive journal checksum is invalid');
    }
  }
  for (const list of [manifest.cleanupEmptyAfterCommit, manifest.createdDirectories]) {
    if (list !== undefined && (!Array.isArray(list) || list.some((target) => typeof target !== 'string'))) throw new Error('Archive journal directory list is invalid');
  }
  if (manifest.ownerPid !== undefined && (!Number.isInteger(manifest.ownerPid) || manifest.ownerPid <= 0)) throw new Error('Archive journal owner is invalid');
  return manifest as JournalManifest;
}

export async function createArchiveJournal(input: JournalInput): Promise<ArchiveJournal> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(input.transactionId)) throw new Error('Archive journal transaction ID is invalid');
  const directory = path.join(input.paths.transactions, input.transactionId);
  if (await fs.access(directory).then(() => true).catch(() => false)) throw new Error(`Archive journal already exists: ${input.transactionId}`);
  const targets = new Set<string>();
  for (const file of input.files) await assertPathWithoutSymlinks(input.paths.codespecDir, file.target);
  for (const target of input.cleanupEmptyAfterCommit ?? []) {
    await assertPathWithoutSymlinks(input.paths.codespecDir, target);
  }
  const entries = input.files.map((file) => {
    const target = relativeTarget(input.paths, file.target);
    if (targets.has(target)) throw new Error(`Archive journal contains duplicate target: ${target}`);
    targets.add(target);
    return { target, before: file.before, after: file.after, beforeChecksum: checksum(file.before), afterChecksum: checksum(file.after) };
  });
  const cleanupEmptyAfterCommit = (input.cleanupEmptyAfterCommit ?? []).map((target) => relativeTarget(input.paths, target));
  const createdDirectories = new Set<string>();
  for (const file of input.files) {
    let parent = path.dirname(file.target);
    while (parent !== path.resolve(input.paths.codespecDir) && !await fs.access(parent).then(() => true).catch(() => false)) {
      createdDirectories.add(relativeTarget(input.paths, parent));
      parent = path.dirname(parent);
    }
  }
  const manifest: JournalManifest = {
    version: 1, transactionId: input.transactionId, entries, cleanupEmptyAfterCommit,
    createdDirectories: [...createdDirectories].sort((left, right) => right.split('/').length - left.split('/').length),
    ...(input.ownerPid === undefined ? {} : { ownerPid: input.ownerPid }),
  };
  await fs.mkdir(directory, { recursive: true });
  await writeDurable(path.join(directory, 'journal.yaml'), stringifyYaml(manifest));
  return { paths: input.paths, transactionId: input.transactionId, directory, manifest };
}

export async function markArchiveJournalCommitted(journal: ArchiveJournal): Promise<void> {
  await writeDurable(path.join(journal.directory, 'COMMITTED'), `${journal.transactionId}\n`);
}

/** Installs staged after-values while retaining the journal for crash recovery. */
export async function installArchiveJournal(journal: ArchiveJournal, beforeInstall?: (target: string) => void | Promise<void>): Promise<void> {
  for (const entry of journal.manifest.entries) {
    if (await readTarget(resolveTarget(journal.paths, entry.target)) !== entry.before) {
      throw new Error(`ARCHIVE CONFLICT: ${entry.target} changed before installation`);
    }
  }
  for (const [index, entry] of journal.manifest.entries.entries()) {
    const target = resolveTarget(journal.paths, entry.target);
    await beforeInstall?.(target);
    if (await readTarget(target) !== entry.before) throw new Error(`ARCHIVE CONFLICT: ${entry.target} changed before installation`);
    if (entry.before !== entry.after && !await installOwnedEntry(journal.paths, journal.directory, entry, index, 'install')) {
      throw new Error(`ARCHIVE CONFLICT: ${entry.target} changed during installation; recovery journal preserved`);
    }
  }
  for (const entry of journal.manifest.entries) {
    if (await readTarget(resolveTarget(journal.paths, entry.target)) !== entry.after) {
      throw new Error(`ARCHIVE CONFLICT: ${entry.target} changed during installation`);
    }
  }
}

async function recoverJournal(paths: WorkspacePaths, directory: string, ownedTransactionId?: string): Promise<void> {
  const manifest = assertManifest(parseYaml(await fs.readFile(path.join(directory, 'journal.yaml'), 'utf8')));
  const ownsJournal = manifest.transactionId === ownedTransactionId && manifest.ownerPid === process.pid;
  if (manifest.ownerPid && !ownsJournal) {
    let alive = true;
    try { process.kill(manifest.ownerPid, 0); }
    catch (error) { alive = (error as NodeJS.ErrnoException).code === 'EPERM'; }
    if (alive) throw new Error(`Archive transaction is active: ${manifest.transactionId}`);
  }
  const committed = await fs.access(path.join(directory, 'COMMITTED')).then(() => true).catch(() => false);
  const conflicts: string[] = [];
  for (const [index, entry] of manifest.entries.entries()) {
    if (!await installOwnedEntry(paths, directory, entry, index, committed ? 'commit' : 'rollback')) conflicts.push(entry.target);
  }
  await retainDisplacedInodes(paths, directory, manifest, committed);
  for (const [index, entry] of manifest.entries.entries()) {
    const preserved = await readTarget(path.join(directory, 'recovery', String(index), 'displaced'));
    const installedBefore = await readTarget(path.join(directory, 'installation', String(index), 'displaced'));
    if (await readTarget(resolveTarget(paths, entry.target)) !== (committed ? entry.after : entry.before)
      || (preserved !== null && preserved !== entry.before && preserved !== entry.after)
      || (installedBefore !== null && installedBefore !== entry.before)) {
      if (!conflicts.includes(entry.target)) conflicts.push(entry.target);
    }
  }
  if (conflicts.length) {
    if (ownsJournal) {
      delete manifest.ownerPid;
      await writeDurable(path.join(directory, 'journal.yaml'), stringifyYaml(manifest));
    }
    throw new Error(`ARCHIVE CONFLICT: transaction ownership lost for ${conflicts.join(', ')}; recovery journal preserved`);
  }
  if (committed) {
    for (const relative of manifest.cleanupEmptyAfterCommit ?? []) await removeEmptyDirectory(resolveTarget(paths, relative));
  } else {
    for (const relative of manifest.createdDirectories ?? []) await removeEmptyDirectory(resolveTarget(paths, relative));
  }
  await fs.rm(directory, { recursive: true, force: true });
}

/** Recovers interrupted archive transactions before any workspace operation proceeds. */
export async function recoverPendingTransactions(paths: WorkspacePaths, ownedTransactionId?: string): Promise<void> {
  const entries = await fs.readdir(paths.transactions, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries.filter((item) => !item.name.startsWith('.')).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) throw new Error(`Archive transaction entry must be a directory: ${entry.name}`);
    await withIndexLockMutation(paths, async () => {
      const directory = path.join(paths.transactions, entry.name);
      const pending = await fs.stat(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      // Another completed recovery may have removed this journal since the
      // initial listing. Never run two displacement passes concurrently.
      if (pending) await recoverJournal(paths, directory, ownedTransactionId);
    });
  }
  // The initial directory snapshot may predate the owner's journal. Once
  // that owner is proven dead under the generation gate, its journal set
  // cannot grow. Recheck its exact transaction before releasing the index
  // to another writer. Call the ungated recovery primitive here so recovery
  // and release share one gate without recursively acquiring it.
  await releaseArchiveIndexLock(paths, undefined, async (transactionId) => {
    const directory = path.join(paths.transactions, transactionId);
    const pending = await fs.stat(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (pending) await recoverJournal(paths, directory, ownedTransactionId);
  });
}
