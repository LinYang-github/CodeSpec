import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { WorkspacePaths } from './paths.js';

interface GateOwner { version: 1; kind: 'codespec-index-lock-mutation'; pid: number; token: string }

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** An append-only generation gate, not another deletable lock path.
 * Two contenders for generation N publish to the same exclusive pathname;
 * the loser must reread the winning owner, never remove or replace it.
 * A dead owner can be followed by N+1 without deleting N. Release is another
 * immutable link to N's owner record. Records are intentionally not GC'd.
 */
export async function withIndexLockMutation<T>(paths: WorkspacePaths, work: () => Promise<T>): Promise<T> {
  const ledger = `${paths.changeIndex}.lock-ledger`;
  await fs.mkdir(ledger, { recursive: true });
  const candidate = path.join(ledger, `.candidate-${randomUUID()}`);
  const owner: GateOwner = { version: 1, kind: 'codespec-index-lock-mutation', pid: process.pid, token: randomUUID() };
  const handle = await fs.open(candidate, 'wx');
  try { await handle.writeFile(JSON.stringify(owner), 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const records = (await fs.readdir(ledger)).filter((name) => /^\d{12,}\.owner$/u.test(name));
      const latest = records.reduce((maximum, name) => Math.max(maximum, Number(name.slice(0, -6))), 0);
      if (!Number.isSafeInteger(latest) || latest >= Number.MAX_SAFE_INTEGER) throw new Error('Index lock generation ledger is invalid');
      if (latest) {
        const previous = path.join(ledger, `${String(latest).padStart(12, '0')}.owner`);
        const bytes = await fs.readFile(previous, 'utf8');
        const existing = JSON.parse(bytes) as GateOwner;
        if (existing?.version !== 1 || existing.kind !== owner.kind || !Number.isSafeInteger(existing.pid) || existing.pid <= 0 || typeof existing.token !== 'string') {
          throw new Error('Index lock generation owner is invalid');
        }
        const released = await fs.readFile(`${previous}.released`, 'utf8').catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (released !== null && released !== bytes) throw new Error('Index lock generation release is invalid');
        if (released === null && isAlive(existing.pid)) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          continue;
        }
      }
      const claim = path.join(ledger, `${String(latest + 1).padStart(12, '0')}.owner`);
      try { await fs.link(candidate, claim); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
        throw error;
      }
      // Publication retains the inode at its immutable generation pathname;
      // the random staging name is no longer needed during the critical work.
      await fs.unlink(candidate);
      try { return await work(); }
      finally { await fs.link(claim, `${claim}.released`); }
    }
    throw new Error('Change 索引正忙：index lock mutation is active');
  } finally {
    await fs.unlink(candidate).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
