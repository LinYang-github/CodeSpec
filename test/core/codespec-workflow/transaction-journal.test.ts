import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createArchiveJournal,
  installArchiveJournal,
  markArchiveJournalCommitted,
  recoverPendingTransactions,
} from '../../../src/core/codespec-workflow/transaction-journal.js';
import type { WorkspacePaths } from '../../../src/core/codespec-workflow/paths.js';
import { loadWorkspace } from '../../../src/core/codespec-workflow/loaders.js';
import { createWorkflowFixture } from '../../helpers/codespec-workflow.js';
import { acquireArchiveIndexLock, releaseArchiveIndexLock } from '../../../src/core/codespec-workflow/archive-index-lock.js';
import { withChangeIndexLock } from '../../../src/core/codespec-workflow/change-index.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { parse, stringify } from 'yaml';
import { ensureCliBuilt } from '../../helpers/run-cli.js';

const temporaryDirectories: string[] = [];

// Interleave real author writes with real filesystem operations. No disk
// operation is replaced with an in-memory success/failure result.
vi.mock('node:fs/promises', async (importOriginal) => ({ ...await importOriginal<typeof import('node:fs/promises')>() }));

function pathsFor(root: string): WorkspacePaths {
  const codespecDir = path.join(root, 'codespec');
  return {
    codespecDir,
    business: path.join(codespecDir, 'business.yaml'),
    configuration: path.join(codespecDir, 'configuration.yaml'),
    changes: path.join(codespecDir, 'changes'),
    changeIndex: path.join(codespecDir, 'changes', 'index.yaml'),
    currentSpecs: path.join(codespecDir, 'specs'),
    transactions: path.join(codespecDir, '.transactions'),
  };
}

async function setupTarget(): Promise<{ paths: WorkspacePaths; target: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-journal-'));
  temporaryDirectories.push(root);
  const paths = pathsFor(root);
  const target = path.join(paths.currentSpecs, 'MOD-001', 'spec.md');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, 'before\n');
  return { paths, target };
}

describe('archive transaction journal', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
  });

  it.each([false, true])('recovers a journal published after its empty snapshot before releasing the dead owner (committed=%s)', async (committed) => {
    const { paths, target } = await setupTarget();
    await ensureCliBuilt();
    await fs.mkdir(paths.changes, { recursive: true });
    await fs.mkdir(paths.transactions, { recursive: true });
    const transactionId = `archive-snapshot-race-${committed ? 'committed' : 'pending'}`;
    const directory = path.join(paths.transactions, transactionId);
    const lock = `${paths.changeIndex}.lock`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { acquireTransactionIndexLock } from ${JSON.stringify(new URL('../../../dist/core/codespec-workflow/archive-index-lock.js', import.meta.url).href)};
      import { createArchiveJournal, installArchiveJournal, markArchiveJournalCommitted } from ${JSON.stringify(new URL('../../../dist/core/codespec-workflow/transaction-journal.js', import.meta.url).href)};
      const paths = ${JSON.stringify(paths)};
      await acquireTransactionIndexLock(paths, ${JSON.stringify(transactionId)});
      process.send('locked');
      await new Promise((resolve) => process.once('message', resolve));
      const journal = await createArchiveJournal({ paths, transactionId: ${JSON.stringify(transactionId)}, ownerPid: process.pid,
        files: [{ target: ${JSON.stringify(target)}, before: 'before\\n', after: 'after\\n' }],
      });
      await installArchiveJournal(journal);
      if (${committed}) await markArchiveJournalCommitted(journal);
      process.exit(77);
    `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    const exited = once(child, 'exit');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 10_000);
    try {
      const locked = await Promise.race([once(child, 'message'), exited.then(() => { throw new Error(`Child exited before owner publication: ${stderr}`); })]);
      expect(locked[0]).toBe('locked');
      // Take the old empty snapshot first, then deliberately allow the real
      // owner to publish and install its journal before returning that snapshot.
      const readdir = fs.readdir;
      let snapshotTaken = false;
      vi.spyOn(fs, 'readdir').mockImplementation(async (...args) => {
        const entries = await readdir(...args);
        if (String(args[0]) === paths.transactions && !snapshotTaken) {
          snapshotTaken = true;
          expect(entries.filter((entry) => !entry.name.startsWith('.'))).toEqual([]);
          child.send('publish-and-crash');
          expect((await exited)[0], stderr).toBe(77);
          expect(await fs.readFile(target, 'utf8')).toBe('after\n');
          await expect(fs.access(directory)).resolves.toBeUndefined();
        }
        return entries;
      });
      // Observe the actual release syscall. The journal must already be
      // reconciled before the index lock is removed, even within its gate.
      const rename = fs.rename;
      let releasedAfterRecovery = false;
      vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
        if (String(args[0]) === lock) {
          expect(await fs.readFile(target, 'utf8')).toBe(committed ? 'after\n' : 'before\n');
          await expect(fs.access(directory)).rejects.toThrow();
          releasedAfterRecovery = true;
        }
        return rename(...args);
      });
      await recoverPendingTransactions(paths);
      expect(releasedAfterRecovery).toBe(true);
      await expect(fs.access(directory)).rejects.toThrow();
      await expect(fs.access(lock)).rejects.toThrow();
      await withChangeIndexLock(paths, async () => {
        expect(await fs.readFile(target, 'utf8')).toBe(committed ? 'after\n' : 'before\n');
        await expect(fs.access(directory)).rejects.toThrow();
      });
    } finally { clearTimeout(timeout); if (child.exitCode === null) child.kill('SIGKILL'); await exited; }
  });

  it('restores every target to its pre-archive bytes when recovery finds no commit marker', async () => {
    const { paths, target } = await setupTarget();
    await createArchiveJournal({
      paths,
      transactionId: 'archive-CHG-20260907-001',
      files: [{ target, before: 'before\n', after: 'after\n' }],
    });
    await fs.writeFile(target, 'after\n');

    await recoverPendingTransactions(paths);

    await expect(fs.readFile(target, 'utf8')).resolves.toBe('before\n');
    await expect(fs.access(path.join(paths.transactions, 'archive-CHG-20260907-001'))).rejects.toThrow();
  });

  it('preserves author edits while rolling back other transaction-owned files', async () => {
    const { paths, target } = await setupTarget();
    const analysis = path.join(paths.changes, 'CHG-20260907-001', 'analysis.yaml');
    await fs.mkdir(path.dirname(analysis), { recursive: true });
    await fs.writeFile(analysis, 'analysis before\n');
    const journal = await createArchiveJournal({
      paths, transactionId: 'archive-CHG-20260907-001',
      files: [{ target, before: 'before\n', after: 'after\n' }, { target: analysis, before: 'analysis before\n', after: null }],
    });
    await installArchiveJournal(journal);
    await fs.writeFile(analysis, 'author edited analysis\n');
    await expect(recoverPendingTransactions(paths)).rejects.toThrow(/conflict|ownership/i);
    expect(await fs.readFile(target, 'utf8')).toBe('before\n');
    expect(await fs.readFile(analysis, 'utf8')).toBe('author edited analysis\n');
    await expect(fs.access(journal.directory)).resolves.toBeUndefined();
  });

  it('does not recover a live archive owned by another caller', async () => {
    const { paths, target } = await setupTarget();
    const journal = await createArchiveJournal({
      paths, transactionId: 'archive-live', ownerPid: process.pid,
      files: [{ target, before: 'before\n', after: 'after\n' }],
    });
    await installArchiveJournal(journal);
    await expect(recoverPendingTransactions(paths)).rejects.toThrow(/active|busy/i);
    expect(await fs.readFile(target, 'utf8')).toBe('after\n');
    await recoverPendingTransactions(paths, journal.transactionId);
    expect(await fs.readFile(target, 'utf8')).toBe('before\n');
  });

  it('preserves an author edit made while rollback stages the restored value', async () => {
    const { paths, target } = await setupTarget();
    const journal = await createArchiveJournal({
      paths, transactionId: 'archive-recovery-stage-race',
      files: [{ target, before: 'before\n', after: 'after\n' }],
    });
    await installArchiveJournal(journal);
    const originalOpen = fs.open;
    let edited = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (!edited && String(args[0]).startsWith(path.join(journal.directory, 'recovery'))) {
        edited = true;
        await fs.writeFile(target, 'author edit during rollback staging\n');
      }
      return handle;
    });

    await expect(recoverPendingTransactions(paths)).rejects.toThrow(/ARCHIVE CONFLICT.*recovery journal preserved/);

    expect(edited).toBe(true);
    expect(await fs.readFile(target, 'utf8')).toBe('author edit during rollback staging\n');
    await expect(fs.access(journal.directory)).resolves.toBeUndefined();
    // Retrying must not silently discard the displaced author bytes either.
    await expect(recoverPendingTransactions(paths)).rejects.toThrow(/ARCHIVE CONFLICT/);
    expect(await fs.readFile(target, 'utf8')).toBe('author edit during rollback staging\n');
  });

  it.each(['rolled-back', 'committed'])('retains the original open inode for writes after final recovery checks and journal cleanup (%s)', async (outcome) => {
    const { paths, target } = await setupTarget();
    const journal = await createArchiveJournal({
      paths, transactionId: 'archive-open-handle-at-cleanup',
      files: [{ target, before: 'before\n', after: 'after\n' }],
    });
    if (outcome === 'rolled-back') await fs.writeFile(target, 'after\n');
    const author = await fs.open(target, 'r+');
    const identity = await author.stat();
    if (outcome === 'committed') { await installArchiveJournal(journal); await markArchiveJournalCommitted(journal); }
    const originalRm = fs.rm;
    let edited = false;
    vi.spyOn(fs, 'rm').mockImplementation(async (...args) => {
      if (String(args[0]) === journal.directory) {
        edited = true;
        await author.write('author write at cleanup\n', 0, 'utf8');
        await author.truncate(Buffer.byteLength('author write at cleanup\n'));
        await author.sync();
      }
      return originalRm(...args);
    });
    try {
      await recoverPendingTransactions(paths);
      expect(edited).toBe(true);
      expect(await fs.readFile(target, 'utf8')).toBe(outcome === 'rolled-back' ? 'before\n' : 'after\n');
      const escrow = path.join(paths.transactions, '.recovery-escrow', journal.transactionId);
      const phase = outcome === 'rolled-back' ? 'recovery' : 'installation';
      const retained = path.join(escrow, phase, '0', 'displaced');
      expect(await fs.readFile(retained, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      })).toBe('author write at cleanup\n');
      const savedIdentity = await fs.stat(retained);
      expect([savedIdentity.dev, savedIdentity.ino]).toEqual([identity.dev, identity.ino]);
      // A last-read/check delay is insufficient: the writer may resume even
      // after recovery has returned and the ephemeral journal is gone.
      await author.write('author write after recovery returned\n', 0, 'utf8');
      await author.truncate(Buffer.byteLength('author write after recovery returned\n'));
      await author.sync();
      expect(await fs.readFile(retained, 'utf8')).toBe('author write after recovery returned\n');
      expect(parse(await fs.readFile(path.join(escrow, 'manifest.yaml'), 'utf8'))).toMatchObject({
        version: 1, transactionId: journal.transactionId, outcome, cleanupPolicy: 'manual-only',
        retained: [{ phase, target: 'specs/MOD-001/spec.md', file: `${phase}/0/displaced` }],
      });
      await recoverPendingTransactions(paths);
      expect(await fs.readFile(retained, 'utf8')).toBe('author write after recovery returned\n');
      await expect(fs.access(journal.directory)).rejects.toThrow();
    } finally { await author.close(); }
  });

  it('rejects an unsafe escrow transaction identity before recovering any bytes', async () => {
    const { paths, target } = await setupTarget();
    const journal = await createArchiveJournal({
      paths, transactionId: 'archive-invalid-escrow-identity', files: [{ target, before: 'before\n', after: 'after\n' }],
    });
    await installArchiveJournal(journal);
    const manifestPath = path.join(journal.directory, 'journal.yaml');
    const manifest = parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.transactionId = '../../escaped-escrow';
    await fs.writeFile(manifestPath, stringify(manifest));
    await expect(recoverPendingTransactions(paths)).rejects.toThrow(/journal.*invalid|malformed/i);
    expect(await fs.readFile(target, 'utf8')).toBe('after\n');
    await expect(fs.access(path.join(paths.codespecDir, 'escaped-escrow'))).rejects.toThrow();
    await expect(fs.access(journal.directory)).resolves.toBeUndefined();
  });

  it('serializes simultaneous recovery of the same abandoned journal before either can displace files', async () => {
    const { paths, target } = await setupTarget();
    const journal = await createArchiveJournal({
      paths, transactionId: 'archive-parallel-recovery', files: [{ target, before: 'before\n', after: 'after\n' }],
    });
    await fs.writeFile(target, 'after\n');
    let reached!: () => void;
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => { reached = resolve; });
    const resumed = new Promise<void>((resolve) => { resume = resolve; });
    const originalRename = fs.rename;
    let first = true;
    vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
      if (first && String(args[0]) === target) { first = false; reached(); await resumed; }
      return originalRename(...args);
    });
    const firstRecovery = recoverPendingTransactions(paths).then(() => 'recovered', () => 'conflict');
    try {
      await paused;
      const second = await recoverPendingTransactions(paths).then(() => 'recovered', () => 'busy');
      resume();
      expect(await firstRecovery).toBe('recovered');
      expect(second).toBe('busy');
      expect(await fs.readFile(target, 'utf8')).toBe('before\n');
      expect(await fs.readFile(path.join(paths.transactions, '.recovery-escrow', journal.transactionId, 'recovery', '0', 'displaced'), 'utf8')).toBe('after\n');
      await expect(fs.access(journal.directory)).rejects.toThrow();
    } finally { resume(); await firstRecovery; }
  }, 10_000);

  it('preserves an author edit made while forward installation stages the new value', async () => {
    const { paths, target } = await setupTarget();
    const journal = await createArchiveJournal({
      paths, transactionId: 'archive-forward-stage-race',
      files: [{ target, before: 'before\n', after: 'after\n' }],
    });
    const originalOpen = fs.open;
    let edited = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (!edited && String(args[0]) !== target) {
        edited = true;
        await fs.writeFile(target, 'author edit during forward staging\n');
      }
      return handle;
    });

    await expect(installArchiveJournal(journal)).rejects.toThrow(/ARCHIVE CONFLICT/);

    expect(edited).toBe(true);
    expect(await fs.readFile(target, 'utf8')).toBe('author edit during forward staging\n');
    await expect(recoverPendingTransactions(paths)).rejects.toThrow(/ARCHIVE CONFLICT/);
    expect(await fs.readFile(target, 'utf8')).toBe('author edit during forward staging\n');
    await expect(fs.access(journal.directory)).resolves.toBeUndefined();
  });

  it('does not clobber an author file created at the final rollback installation boundary', async () => {
    const { paths, target } = await setupTarget();
    const journal = await createArchiveJournal({
      paths, transactionId: 'archive-recovery-install-race',
      files: [{ target, before: 'before\n', after: 'after\n' }],
    });
    await installArchiveJournal(journal);
    const originalRename = fs.rename;
    const originalLink = fs.link;
    let edited = false;
    const editAtInstall = async (destination: unknown) => {
      if (!edited && String(destination) === target) {
        edited = true;
        await fs.writeFile(target, 'author file at install boundary\n');
      }
    };
    vi.spyOn(fs, 'rename').mockImplementation(async (...args) => { await editAtInstall(args[1]); return originalRename(...args); });
    vi.spyOn(fs, 'link').mockImplementation(async (...args) => { await editAtInstall(args[1]); return originalLink(...args); });

    await expect(recoverPendingTransactions(paths)).rejects.toThrow(/ARCHIVE CONFLICT.*recovery journal preserved/);

    expect(edited).toBe(true);
    expect(await fs.readFile(target, 'utf8')).toBe('author file at install boundary\n');
    await expect(fs.access(journal.directory)).resolves.toBeUndefined();
  });

  it.each([
    ['recovery', 'displacement'], ['recovery', 'installation'],
    ['forward installation', 'displacement'], ['forward installation', 'installation'],
  ])('replays %s interrupted immediately after %s without losing the saved inode', async (phase, boundary) => {
    const { paths, target } = await setupTarget();
    const journal = await createArchiveJournal({
      paths, transactionId: `archive-recovery-interrupted-${boundary}`,
      files: [{ target, before: 'before\n', after: 'after\n' }],
    });
    if (phase === 'recovery') await installArchiveJournal(journal);
    const originalRename = fs.rename;
    const originalLink = fs.link;
    if (boundary === 'displacement') {
      vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
        await originalRename(...args);
        if (String(args[0]) === target) throw new Error('interrupted after displacement');
      });
    } else {
      vi.spyOn(fs, 'link').mockImplementation(async (...args) => {
        await originalLink(...args);
        if (String(args[1]) === target) throw new Error('interrupted after installation');
      });
    }

    await expect(phase === 'recovery' ? recoverPendingTransactions(paths) : installArchiveJournal(journal)).rejects.toThrow(`interrupted after ${boundary}`);
    expect(await fs.readFile(path.join(journal.directory, phase === 'recovery' ? 'recovery' : 'installation', '0', 'displaced'), 'utf8')).toBe(phase === 'recovery' ? 'after\n' : 'before\n');
    vi.restoreAllMocks();
    await recoverPendingTransactions(paths);
    expect(await fs.readFile(target, 'utf8')).toBe('before\n');
    await expect(fs.access(journal.directory)).rejects.toThrow();
  });

  it('preserves an author replacement while rollback removes a transaction-created file', async () => {
    const { paths, target } = await setupTarget();
    await fs.unlink(target);
    const journal = await createArchiveJournal({
      paths, transactionId: 'archive-recovery-delete-race',
      files: [{ target, before: null, after: 'after\n' }],
    });
    await installArchiveJournal(journal);
    const originalRename = fs.rename;
    vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
      await originalRename(...args);
      if (String(args[0]) === target) await fs.writeFile(target, 'author replacement during rollback deletion\n');
    });

    await expect(recoverPendingTransactions(paths)).rejects.toThrow(/ARCHIVE CONFLICT/);
    expect(await fs.readFile(target, 'utf8')).toBe('author replacement during rollback deletion\n');
    await expect(fs.access(journal.directory)).resolves.toBeUndefined();
  });

  it('retries recovery after interruption leaves an incomplete private stage file', async () => {
    const { paths, target } = await setupTarget();
    const journal = await createArchiveJournal({
      paths, transactionId: 'archive-partial-recovery-stage',
      files: [{ target, before: 'before\n', after: 'after\n' }],
    });
    await installArchiveJournal(journal);
    const originalOpen = fs.open;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (!String(args[0]).startsWith(path.join(journal.directory, 'recovery'))) return handle;
      await handle.writeFile('partial stage');
      await handle.sync();
      await handle.close();
      throw new Error('interrupted while staging');
    });

    await expect(recoverPendingTransactions(paths)).rejects.toThrow('interrupted while staging');
    vi.restoreAllMocks();
    await expect(recoverPendingTransactions(paths)).resolves.toBeUndefined();
    expect(await fs.readFile(target, 'utf8')).toBe('before\n');
    await expect(fs.access(journal.directory)).rejects.toThrow();
  });

  it('preserves a live archive index owner even when there is no pending journal', async () => {
    const { paths } = await setupTarget();
    await fs.mkdir(paths.changes, { recursive: true });
    await acquireArchiveIndexLock(paths, 'archive-live-index');
    const lock = `${paths.changeIndex}.lock`;
    const owner = await fs.readFile(lock, 'utf8');

    await recoverPendingTransactions(paths);
    await releaseArchiveIndexLock(paths, 'archive-not-the-owner');
    expect(await fs.readFile(lock, 'utf8')).toBe(owner);
    await releaseArchiveIndexLock(paths, 'archive-live-index');
    await expect(fs.access(lock)).rejects.toThrow();
  });

  it.each(['directory', 'unrecognized file'])('never reclaims an index lock owned by a different workflow (%s)', async (kind) => {
    const { paths } = await setupTarget();
    await fs.mkdir(paths.changes, { recursive: true });
    const lock = `${paths.changeIndex}.lock`;
    if (kind === 'directory') await fs.mkdir(lock);
    else await fs.writeFile(lock, 'another workflow owns this lock\n');

    await recoverPendingTransactions(paths);
    await expect(fs.access(lock)).resolves.toBeUndefined();
  });

  it('preserves a replacement live owner that appears during index lock release', async () => {
    const { paths } = await setupTarget();
    await fs.mkdir(paths.changes, { recursive: true });
    await acquireArchiveIndexLock(paths, 'archive-old-index');
    const lock = `${paths.changeIndex}.lock`;
    const replacement = JSON.stringify({ ...JSON.parse(await fs.readFile(lock, 'utf8')), transactionId: 'archive-new-live-owner' });
    const originalRename = fs.rename;
    vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
      if (String(args[0]) === lock) await fs.writeFile(lock, replacement);
      return originalRename(...args);
    });

    await expect(releaseArchiveIndexLock(paths, 'archive-old-index')).rejects.toThrow(/index lock ownership changed/);
    expect(await fs.readFile(lock, 'utf8')).toBe(replacement);
  });

  it('serializes two stale recyclers with live reacquisition so a third workflow never enters the live lock', async () => {
    const { paths } = await setupTarget();
    await fs.mkdir(paths.changes, { recursive: true });
    const child = spawn(process.execPath, ['-e', 'process.exit(0)']);
    const deadPid = child.pid!;
    await once(child, 'exit');
    const lock = `${paths.changeIndex}.lock`;
    await fs.writeFile(lock, JSON.stringify({ version: 1, kind: 'codespec-archive-index-lock', transactionId: 'archive-dead', pid: deadPid }));
    let reached!: () => void;
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => { reached = resolve; });
    const resumed = new Promise<void>((resolve) => { resume = resolve; });
    const originalRename = fs.rename;
    let first = true;
    let liveAcquired = false;
    let thirdEntered = false;
    vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
      if (String(args[0]) !== lock || !first) return originalRename(...args);
      first = false;
      reached();
      await resumed;
      await originalRename(...args);
      if (liveAcquired) {
        await withChangeIndexLock(paths, async () => { thirdEntered = true; }).catch(() => undefined);
      }
    });
    const slow = releaseArchiveIndexLock(paths).then(() => 'released', () => 'conflict');
    try {
      await paused;
      const other = await releaseArchiveIndexLock(paths).then(() => 'released', () => 'busy');
      if (other === 'released') {
        await acquireArchiveIndexLock(paths, 'archive-live-reacquired');
        liveAcquired = true;
      }
      resume();
      await slow;
      if (!liveAcquired) await acquireArchiveIndexLock(paths, 'archive-live-reacquired');
      await releaseArchiveIndexLock(paths); // Retry observes the new live generation.
      expect(thirdEntered).toBe(false);
      expect(other).toBe('busy');
      expect(JSON.parse(await fs.readFile(lock, 'utf8')).transactionId).toBe('archive-live-reacquired');
      await releaseArchiveIndexLock(paths, 'archive-live-reacquired');
    } finally { resume(); await slow; }
  }, 10_000);

  it('finishes every target from staged bytes when recovery finds a durable commit marker', async () => {
    const { paths, target } = await setupTarget();
    const journal = await createArchiveJournal({
      paths,
      transactionId: 'archive-CHG-20260907-001',
      files: [{ target, before: 'before\n', after: 'after\n' }],
    });
    await markArchiveJournalCommitted(journal);

    await recoverPendingTransactions(paths);

    await expect(fs.readFile(target, 'utf8')).resolves.toBe('after\n');
    await expect(fs.access(path.join(paths.transactions, 'archive-CHG-20260907-001'))).rejects.toThrow();
  });

  it('installs staged bytes before commit without deleting the recovery journal', async () => {
    const { paths, target } = await setupTarget();
    const journal = await createArchiveJournal({
      paths,
      transactionId: 'archive-CHG-20260907-001',
      files: [{ target, before: 'before\n', after: 'after\n' }],
    });

    await installArchiveJournal(journal);

    await expect(fs.readFile(target, 'utf8')).resolves.toBe('after\n');
    await expect(fs.access(journal.directory)).resolves.toBeUndefined();
  });

  it('recovers pending transactions before a workspace is loaded for another command', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const target = path.join(fixture.paths.currentSpecs, 'MOD-001', 'spec.md');
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, 'before\n');
      await createArchiveJournal({
        paths: fixture.paths,
        transactionId: 'archive-CHG-20260907-001',
        files: [{ target, before: 'before\n', after: 'after\n' }],
      });
      await fs.writeFile(target, 'after\n');

      await loadWorkspace(fixture.codespecDir);

      await expect(fs.readFile(target, 'utf8')).resolves.toBe('before\n');
    } finally {
      fixture.cleanup();
    }
  });
});
