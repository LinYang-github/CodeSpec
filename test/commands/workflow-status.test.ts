import { afterEach, describe, expect, it } from 'vitest';
import { createMigrationFixture, snapshotFiles } from '../helpers/change-migration.js';
import { runCLI } from '../helpers/run-cli.js';

describe('canonical migration status', () => {
  it.each([false, true])('reports an exact migration command for five artifacts (batch=%s)', async (all) => {
    const f = await createMigrationFixture();
    afterEach(f.cleanup);
    const before = await snapshotFiles(f.codespecDir);
    const result = await runCLI(['status', ...(all ? ['--all'] : ['--change', f.changeId]), '--json'], { cwd: f.tempDir });
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    const output = JSON.parse(result.stdout);
    const status = all ? output.changes[0] : output;
    expect(status.nextCommand).toBe(`codespec migrate --change ${f.changeId}`);
    expect(status.gateErrors.join(' ')).toMatch(/analysis.yaml/);
    expect(status.gateErrors.join(' ')).toMatch(/rich Requirement delta/);
    expect(await snapshotFiles(f.codespecDir)).toEqual(before);
    const text = await runCLI(['status', ...(all ? ['--all'] : ['--change', f.changeId])], { cwd: f.tempDir });
    expect(text.stdout).toContain(`codespec migrate --change ${f.changeId}`);
  });
});
