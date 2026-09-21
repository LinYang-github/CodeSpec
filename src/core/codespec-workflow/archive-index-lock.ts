import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { WorkspacePaths } from './paths.js';
import { withIndexLockMutation } from './index-lock-gate.js';

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
    || !/^(?:archive|migrate)-[A-Za-z0-9._-]+$/u.test(owner.transactionId)
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
export async function acquireTransactionIndexLock(paths: WorkspacePaths, transactionId: string): Promise<void> {
  if (!/^(?:archive|migrate)-[A-Za-z0-9._-]+$/u.test(transactionId)) throw new Error('Index lock transaction ID is invalid');
  return withIndexLockMutation(paths, async () => {
    const owner: ArchiveIndexOwner = { version: 1, kind: 'codespec-archive-index-lock', transactionId, pid: process.pid };
    // Archive already owns its outer lock directory. Migration only needs
    // the index lock; its unique stage lives in the durable generation ledger.
    // A crash before publication leaves no lock, and after publication the
    // complete owner record is recoverable even before a journal exists.
    const migration = transactionId.startsWith('migrate-');
    const staged = migration
      ? path.join(`${paths.changeIndex}.lock-ledger`, `.migration-owner-${randomUUID()}`)
      : path.join(paths.transactions, '.archive.lock', 'index-owner.json');
    await fs.mkdir(path.dirname(staged), { recursive: true });
    const handle = await fs.open(staged, 'wx');
    try { await handle.writeFile(JSON.stringify(owner), 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    try { await fs.link(staged, `${paths.changeIndex}.lock`); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Change 索引正忙');
      throw error;
    } finally {
      if (migration) await fs.unlink(staged);
    }
  });
}

// Preserve the established archive API and its staging/locking behavior.
export const acquireArchiveIndexLock = acquireTransactionIndexLock;

/** Release our exact lock, or a recognized archive lock whose owner died.
 * Preserve anything that replaced the inspected lock instead of deleting it.
 * beforeRelease runs under the generation gate, after fresh owner validation.
 * It must not acquire that gate recursively.
 */
export async function releaseTransactionIndexLock(
  paths: WorkspacePaths,
  ownedTransactionId?: string,
  beforeRelease?: (transactionId: string) => Promise<void>,
): Promise<void> {
  const lock = `${paths.changeIndex}.lock`;
  const releasable = (value: Awaited<ReturnType<typeof readOwner>>) => value !== null && (ownedTransactionId === undefined
    ? !processAlive(value.owner.pid)
    : value.owner.transactionId === ownedTransactionId && value.owner.pid === process.pid);
  // This first read is only a non-mutating fast path. All ownership decisions
  // that can remove a lock are repeated inside the shared generation gate.
  if (!releasable(await readOwner(lock))) return;
  return withIndexLockMutation(paths, async () => {
    const existing = await readOwner(lock);
    if (!existing || !releasable(existing)) return;
    await beforeRelease?.(existing.owner.transactionId);

    const displaced = `${lock}.recovery-${randomUUID()}`;
    try { await fs.rename(lock, displaced); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    const actual = await readOwner(displaced);
    if (actual?.bytes !== existing.bytes) {
      // Uncooperative/manual replacement is still preserved. Cooperating
      // workflows cannot replace/reacquire this path while the gate is held.
      let restored = false;
      if ((await fs.lstat(displaced)).isFile()) {
        try { await fs.link(displaced, lock); await fs.unlink(displaced); restored = true; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      }
      throw new Error(`ARCHIVE CONFLICT: index lock ownership changed; ${restored ? 'replacement owner restored' : `recovery owner preserved at ${displaced}`}`);
    }
    await fs.unlink(displaced);
  }, { waitForAvailability: ownedTransactionId !== undefined });
}

export const releaseArchiveIndexLock = releaseTransactionIndexLock;
