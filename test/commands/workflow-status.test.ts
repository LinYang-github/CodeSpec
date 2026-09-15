import { afterEach, describe, expect, it } from 'vitest';
import { createMigrationFixture, snapshotFiles } from '../helpers/change-migration.js';
import { runCLI } from '../helpers/run-cli.js';
import { parse, stringify } from 'yaml';
import { createGuidanceFixture } from '../helpers/workflow-guidance.js';
import { createPendingApprovals } from '../../src/core/codespec-workflow/approvals.js';
import path from 'node:path';
import { registerStore } from '../../src/core/store/registry.js';
import { getGlobalDataDir } from '../../src/core/global-config.js';

describe('canonical migration status', () => {
  it('accepts a selected root on the executable migration entry', async () => {
    const f = await createMigrationFixture();
    try {
      const env = { XDG_DATA_HOME: path.join(f.tempDir, 'data'), XDG_CONFIG_HOME: path.join(f.tempDir, 'config') };
      await registerStore({ id: 'guidance-store', localPath: f.tempDir, globalDataDir: getGlobalDataDir({ env }) });
      const status = await runCLI(['status', '--change', f.changeId, '--store', 'guidance-store', '--json'], { cwd: f.tempDir, env });
      const command = JSON.parse(status.stdout).nextCommand;
      expect(command).toBe(`codespec migrate --change ${f.changeId} --store guidance-store`);
      const result = await runCLI([...command.split(' ').slice(1), '--json'], { cwd: f.tempDir, env });
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ fromArtifacts: 5, toArtifacts: 6, route: 'ANALYZE' });
    } finally { f.cleanup(); }
  });
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

describe('canonical lifecycle guidance', () => {
  it('reports reviewable analysis and an executable approval then transition command', async () => {
    const f = await createGuidanceFixture();
    try {
      f.artifacts.metadata.approvals.analyze = createPendingApprovals(1).analyze;
      await f.save();
      const get = async () => {
        const result = await runCLI(['status', '--change', f.changeId, '--json'], { cwd: f.tempDir });
        expect(result.exitCode, result.stdout + result.stderr).toBe(0);
        return JSON.parse(result.stdout);
      };
      const status = await get();
      expect(status.analysisSummary).toMatchObject({ complete: true, approved: false, problem: '支持新增能力' });
      expect(status.openQuestions).toEqual([]);
      expect(status.assumptions).toEqual([]);
      expect(status.gateErrors).toEqual([]);
      expect(status.nextCommand).toBe(`codespec approve --change ${f.changeId} --stage analyze`);
      const approval = await runCLI(status.nextCommand.split(' ').slice(1), { cwd: f.tempDir });
      expect(approval.exitCode, approval.stdout + approval.stderr).toBe(0);
      const approved = await get();
      expect(approved.analysisSummary.approved).toBe(true);
      expect(approved.nextCommand).toBe(`codespec transition --change ${f.changeId} --to DESIGN --reason "analyze approved"`);
      const transition = await runCLI(['transition', '--change', f.changeId, '--to', 'DESIGN', '--reason', 'analyze approved'], { cwd: f.tempDir });
      expect(transition.exitCode, transition.stdout + transition.stderr).toBe(0);
    } finally { f.cleanup(); }
  });

  it('separates human question editing from the executable read-only next command', async () => {
    const f = await createGuidanceFixture();
    try {
      const analysis = parse(f.artifacts.analysis!);
      analysis.openQuestions = [{ id: 'QUESTION-001', question: '失败时如何处理？', status: 'OPEN' }];
      analysis.assumptions = [{ id: 'ASSUMPTION-001', statement: '接口可用', status: 'PROPOSED', requirements: [] }];
      f.artifacts.analysis = stringify(analysis);
      await f.save();
      const result = await runCLI(['status', '--change', f.changeId, '--json'], { cwd: f.tempDir });
      const output = JSON.parse(result.stdout);
      expect(output.openQuestions).toEqual(analysis.openQuestions);
      expect(output.assumptions).toEqual(analysis.assumptions);
      expect(output.nextAction).toMatchObject({ action: 'edit_analysis', path: f.artifacts.metadata.artifacts.analysis });
      expect(output.nextCommand).toBe(`codespec instructions analyze --change ${f.changeId} --json`);
      const next = await runCLI(output.nextCommand.split(' ').slice(1), { cwd: f.tempDir });
      expect(next.exitCode, next.stdout + next.stderr).toBe(0);
      expect(JSON.parse(next.stdout).nextAction.action).toBe('edit_analysis');
    } finally { f.cleanup(); }
  });

  it('routes STALE to semantic rebase', async () => {
    const f = await createGuidanceFixture('DESIGN');
    try {
      f.artifacts.metadata.baseline.stale = true;
      await f.save();
      const result = await runCLI(['status', '--change', f.changeId, '--json'], { cwd: f.tempDir });
      expect(JSON.parse(result.stdout).nextCommand).toBe(`codespec rebase --change ${f.changeId}`);
    } finally { f.cleanup(); }
  });
});
