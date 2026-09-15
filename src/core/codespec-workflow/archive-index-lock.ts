import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { WorkspacePaths } from './paths.js';

interface ArchiveIndexOwner {
  version: 1;
  kind: 'codespec-archive-index-lock';
  transactionId: string;
  pid: number;
}

async function readOwner(file: string): Promise<{ owner: ArchiveIndexOwner; bytes: string } | null> {
  const stat = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  // Existing directory locks belong to other workflows. Never reclaim them.
  if (!stat?.isFile()) return null;
  const bytes = await fs.readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (bytes === null) return null;
  let owner: ArchiveIndexOwner;
  try { owner = JSON.parse(bytes) as ArchiveIndexOwner; } catch { return null; }
  if (owner?.version !== 1 || owner.kind !== 'codespec-archive-index-lock'
    || !/^archive-[A-Za-z0-9._-]+$/u.test(owner.transactionId)
    || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) return null;
  return { owner, bytes };
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** Publish a fully durable owner record atomically. mkdir + owner write has
 * a crash window which leaves an ownerless, permanently busy index lock.
 * A file lock still excludes existing callers that acquire with mkdir.
 */
export async function acquireArchiveIndexLock(paths: WorkspacePaths, transactionId: string): Promise<void> {
  const owner: ArchiveIndexOwner = { version: 1, kind: 'codespec-archive-index-lock', transactionId, pid: process.pid };
  const staged = path.join(paths.archive, '.archive.lock', 'index-owner.json');
  const handle = await fs.open(staged, 'wx');
  try { await handle.writeFile(JSON.stringify(owner), 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
  try { await fs.link(staged, `${paths.changeIndex}.lock`); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Change 索引正忙');
    throw error;
  }
}

/** Release our exact lock, or a recognized archive lock whose owner died.
 * Preserve anything that replaced the inspected lock instead of deleting it.
 */
export async function releaseArchiveIndexLock(paths: WorkspacePaths, ownedTransactionId?: string): Promise<void> {
  const lock = `${paths.changeIndex}.lock`;
  const existing = await readOwner(lock);
  if (!existing) return;
  if (ownedTransactionId !== undefined) {
    if (existing.owner.transactionId !== ownedTransactionId || existing.owner.pid !== process.pid) return;
  } else if (processAlive(existing.owner.pid)) return;

  const displaced = `${lock}.recovery-${randomUUID()}`;
  try { await fs.rename(lock, displaced); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const actual = await readOwner(displaced);
  if (actual?.bytes !== existing.bytes) {
    // The lock was replaced after inspection. Restore it exclusively; if
    // another caller already occupies the path, keep both owner records.
    let restored = false;
    if ((await fs.lstat(displaced)).isFile()) {
      try { await fs.link(displaced, lock); await fs.unlink(displaced); restored = true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    throw new Error(`ARCHIVE CONFLICT: index lock ownership changed; ${restored ? 'replacement owner restored' : `recovery owner preserved at ${displaced}`}`);
  }
  await fs.unlink(displaced);
}
