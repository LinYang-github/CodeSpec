import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { withIndexLockMutation } from '../../../src/core/codespec-workflow/index-lock-gate.js';
import { createWorkflowFixture } from '../../helpers/codespec-workflow.js';
import { ensureCliBuilt } from '../../helpers/run-cli.js';
import { withChangeIndexLock } from '../../../src/core/codespec-workflow/change-index.js';
import { acquireArchiveIndexLock, releaseArchiveIndexLock } from '../../../src/core/codespec-workflow/archive-index-lock.js';
import { recoverPendingTransactions } from '../../../src/core/codespec-workflow/transaction-journal.js';

vi.mock('node:fs/promises', async (importOriginal) => ({ ...await importOriginal<typeof import('node:fs/promises')>() }));

describe('immutable index lock mutation generations', () => {
  it.each(['workflow directory', 'archive owner file'])('does not abandon release of an owned %s after ordinary gate contention exceeds the acquisition budget', async (kind) => {
    const fixture = await createWorkflowFixture();
    await ensureCliBuilt();
    const lock = `${fixture.paths.changeIndex}.lock`;
    let child: ReturnType<typeof spawn> | undefined;
    let exited: Promise<unknown> | undefined;
    let waitedPastBudget!: () => void;
    const stillWaiting = new Promise<'waiting'>((resolve) => { waitedPastBudget = () => resolve('waiting'); });
    let armed = false;
    let ownerReads = 0;
    const actualReadFile = fs.readFile;
    vi.spyOn(fs, 'readFile').mockImplementation(async (...args: Parameters<typeof fs.readFile>) => {
      const value = await actualReadFile(...args);
      if (armed && String(args[0]).endsWith('000000000002.owner') && ++ownerReads === 105) waitedPastBudget();
      return value;
    });
    const messages: unknown[] = [];
    const work = async () => {
      child = spawn(process.execPath, ['--input-type=module', '-e', `
        import fs from 'node:fs/promises';
        import { once } from 'node:events';
        import { syncBuiltinESMExports } from 'node:module';
        import { withChangeIndexLock } from ${JSON.stringify(new URL('../../../dist/core/codespec-workflow/change-index.js', import.meta.url).href)};
        const actualMkdir = fs.mkdir;
        let paused = false;
        fs.mkdir = async (...args) => {
          if (!paused && String(args[0]) === ${JSON.stringify(lock)}) {
            paused = true;
            process.send('before-index-mkdir');
            await once(process, 'message');
          }
          return actualMkdir(...args);
        };
        syncBuiltinESMExports();
        try { await withChangeIndexLock(${JSON.stringify(fixture.paths)}, async () => process.send('second-entered')); }
        catch (error) { process.send({ secondError: error.message }); }
        process.disconnect();
      `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      exited = once(child, 'exit');
      child.on('message', (message) => { messages.push(message); });
      expect((await once(child, 'message'))[0]).toBe('before-index-mkdir');
      armed = true;
      return 'first-work-complete';
    };
    const first = (kind === 'workflow directory' ? withChangeIndexLock(fixture.paths, work) : (async () => {
      await acquireArchiveIndexLock(fixture.paths, 'archive-release-contention');
      const value = await work();
      await releaseArchiveIndexLock(fixture.paths, 'archive-release-contention');
      return value;
    })()).then((value) => ({ value }), (error: Error) => ({ error: error.message }));
    try {
      // Count real owner reads, rather than racing a wall-clock sleep. The
      // child keeps the mutation gate until release has exceeded 100 attempts.
      const progress = await Promise.race([stillWaiting, first.then(() => 'settled' as const)]);
      expect(child).toBeDefined();
      child!.send('resume');
      const result = await first;
      await exited;
      await recoverPendingTransactions(fixture.paths);
      const retry = await withChangeIndexLock(fixture.paths, async () => 'retry-entered')
        .then((value) => ({ value }), (error: Error) => ({ error: error.message }));
      expect({ progress, result, retry, secondEntered: messages.includes('second-entered') }).toEqual({
        progress: 'waiting', result: { value: 'first-work-complete' }, retry: { value: 'retry-entered' }, secondEntered: true,
      });
      await expect(fs.access(lock)).rejects.toThrow();
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (exited) await exited;
      await first;
      vi.restoreAllMocks();
      fixture.cleanup();
    }
  }, 20_000);

  it('retains each released generation and never reuses an owner pathname', async () => {
    const fixture = await createWorkflowFixture();
    try {
      await withIndexLockMutation(fixture.paths, async () => undefined);
      const ledger = `${fixture.paths.changeIndex}.lock-ledger`;
      const first = await fs.readFile(path.join(ledger, '000000000001.owner'), 'utf8');
      await withIndexLockMutation(fixture.paths, async () => undefined);
      expect((await fs.readdir(ledger)).sort()).toEqual([
        '000000000001.owner', '000000000001.owner.released', '000000000002.owner', '000000000002.owner.released',
      ]);
      expect(await fs.readFile(path.join(ledger, '000000000001.owner'), 'utf8')).toBe(first);
      for (const generation of ['000000000001', '000000000002']) {
        const owner = path.join(ledger, `${generation}.owner`);
        expect(await fs.readFile(`${owner}.released`, 'utf8')).toBe(await fs.readFile(owner, 'utf8'));
        const identity = await fs.stat(owner);
        const released = await fs.stat(`${owner}.released`);
        expect([released.dev, released.ino]).toEqual([identity.dev, identity.ino]);
      }
    } finally { fixture.cleanup(); }
  });

  it('serializes contenders that both selected the same unpublished generation', async () => {
    const fixture = await createWorkflowFixture();
    let resume!: () => void;
    let selected!: () => void;
    const paused = new Promise<void>((resolve) => { selected = resolve; });
    const resumed = new Promise<void>((resolve) => { resume = resolve; });
    const actualLink = fs.link;
    let first = true;
    vi.spyOn(fs, 'link').mockImplementation(async (...args) => {
      if (first && String(args[1]).endsWith('000000000001.owner')) { first = false; selected(); await resumed; }
      return actualLink(...args);
    });
    const order: string[] = [];
    const slow = withIndexLockMutation(fixture.paths, async () => { order.push('slow'); });
    try {
      await paused;
      await withIndexLockMutation(fixture.paths, async () => { order.push('fast'); });
      resume();
      await slow;
      expect(order).toEqual(['fast', 'slow']);
      const ledger = `${fixture.paths.changeIndex}.lock-ledger`;
      expect((await fs.readdir(ledger)).filter((name) => name.endsWith('.owner')).sort()).toEqual(['000000000001.owner', '000000000002.owner']);
    } finally { resume(); await slow; vi.restoreAllMocks(); fixture.cleanup(); }
  });

  it('protects a live child gate owner and advances past its immutable generation after SIGKILL', async () => {
    const fixture = await createWorkflowFixture();
    await ensureCliBuilt();
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { withIndexLockMutation } from ${JSON.stringify(new URL('../../../dist/core/codespec-workflow/index-lock-gate.js', import.meta.url).href)};
      await withIndexLockMutation(${JSON.stringify(fixture.paths)}, async () => {
        process.send('gate-acquired');
        await new Promise(() => { setInterval(() => {}, 1000); });
      });
    `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    const exited = once(child, 'exit');
    try {
      const message = await once(child, 'message');
      expect(message[0]).toBe('gate-acquired');
      let entered = false;
      await expect(withIndexLockMutation(fixture.paths, async () => { entered = true; })).rejects.toThrow(/索引正忙/);
      expect(entered).toBe(false);
      const ledger = `${fixture.paths.changeIndex}.lock-ledger`;
      const first = await fs.readFile(path.join(ledger, '000000000001.owner'), 'utf8');
      child.kill('SIGKILL');
      await exited;
      await withIndexLockMutation(fixture.paths, async () => { entered = true; });
      expect(entered).toBe(true);
      expect(await fs.readFile(path.join(ledger, '000000000001.owner'), 'utf8')).toBe(first);
      expect((await fs.readdir(ledger)).sort()).toEqual(['000000000001.owner', '000000000002.owner', '000000000002.owner.released']);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
      fixture.cleanup();
    }
  }, 10_000);
});
