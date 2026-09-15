import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { withIndexLockMutation } from '../../../src/core/codespec-workflow/index-lock-gate.js';
import { createWorkflowFixture } from '../../helpers/codespec-workflow.js';
import { ensureCliBuilt } from '../../helpers/run-cli.js';

vi.mock('node:fs/promises', async (importOriginal) => ({ ...await importOriginal<typeof import('node:fs/promises')>() }));

describe('immutable index lock mutation generations', () => {
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
