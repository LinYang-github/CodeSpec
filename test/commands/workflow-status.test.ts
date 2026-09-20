import { afterEach, describe, expect, it } from 'vitest';
import { createMigrationFixture, snapshotFiles } from '../helpers/change-migration.js';
import { runCLI } from '../helpers/run-cli.js';
import { parse, stringify } from 'yaml';
import { createGuidanceFixture } from '../helpers/workflow-guidance.js';
import { createPendingApprovals } from '../../src/core/codespec-workflow/approvals.js';
import path from 'node:path';
import * as fs from 'node:fs/promises';
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
  it('keeps an ANALYZE rebase conflict on the analysis editing route', async () => {
    const f = await createGuidanceFixture('DESIGN');
    try {
      f.artifacts.metadata.baseline.stale = true;
      await f.save();
      await fs.unlink(path.join(f.paths.currentSpecs, 'MOD-002', 'spec.md'));
      const rebase = await runCLI(['rebase', '--change', f.changeId], { cwd: f.tempDir });
      expect(rebase.exitCode, rebase.stdout + rebase.stderr).toBe(0);
      const rebased = parse(await fs.readFile(path.join(f.artifacts.changeDir, 'metadata.yaml'), 'utf8'));
      expect(rebased.change).toMatchObject({ status: 'ANALYZE', revision: 2 });
      expect(rebased.baseline.stale).toBe(true);
      expect(parse(await fs.readFile(path.join(f.artifacts.changeDir, 'analysis.yaml'), 'utf8')).revision).toBe(1);
      expect(await fs.readFile(path.join(f.artifacts.changeDir, 'design.md'), 'utf8')).toContain('Rebase decision (revision 2)');
      for (const args of [['status'], ['instructions', 'analyze']]) {
        const result = await runCLI([...args, '--change', f.changeId, '--json'], { cwd: f.tempDir });
        expect(result.exitCode, result.stdout + result.stderr).toBe(0);
        const guidance = JSON.parse(result.stdout);
        expect(guidance.nextAction).toMatchObject({ action: 'edit_analysis', path: f.artifacts.metadata.artifacts.analysis });
        expect(guidance.gateErrors.length).toBeGreaterThan(0);
        const before = await snapshotFiles(f.codespecDir);
        const next = await runCLI(guidance.nextCommand.split(' ').slice(1), { cwd: f.tempDir });
        expect(next.exitCode, next.stdout + next.stderr).toBe(0);
        expect(await snapshotFiles(f.codespecDir)).toEqual(before);
      }
    } finally { f.cleanup(); }
  });

  it.each([false, true])('enters PLAN after approved DESIGN, then reports missing tasks in PLAN (empty tasks=%s)', async (empty) => {
    const f = await createGuidanceFixture('DESIGN');
    try {
      if (empty) {
        const tasks = parse(f.artifacts.tasks!);
        tasks.tasks = [];
        f.artifacts.tasks = stringify(tasks);
        await f.save();
      }
      let nextCommand = '';
      for (const args of [['status'], ['instructions', 'design']]) {
        const result = await runCLI([...args, '--change', f.changeId, '--json'], { cwd: f.tempDir });
        expect(result.exitCode, result.stdout + result.stderr).toBe(0);
        const guidance = JSON.parse(result.stdout);
        expect(guidance.nextAction.action).toBe('transition');
        expect(guidance.traceGaps).toEqual([]);
        expect(guidance.gateErrors).toEqual([]);
        nextCommand = guidance.nextCommand;
      }
      const argv = nextCommand.match(/"[^"]*"|\S+/g)!.slice(1).map((part: string) => part.replace(/^"|"$/g, ''));
      const next = await runCLI(argv, { cwd: f.tempDir });
      expect(next.exitCode, next.stdout + next.stderr).toBe(0);
      if (empty) for (const args of [['status'], ['instructions', 'plan']]) {
        const result = await runCLI([...args, '--change', f.changeId, '--json'], { cwd: f.tempDir });
        expect(result.exitCode, result.stdout + result.stderr).toBe(0);
        const guidance = JSON.parse(result.stdout);
        expect(guidance.nextAction).toMatchObject({ action: 'edit_tasks', path: f.artifacts.metadata.artifacts.tasks });
        expect(guidance.traceGaps.join(' ')).toContain('AC-001');
        expect(guidance.gateErrors.length).toBeGreaterThan(0);
        const before = await snapshotFiles(f.codespecDir);
        const instructions = await runCLI(guidance.nextCommand.split(' ').slice(1), { cwd: f.tempDir });
        expect(instructions.exitCode).toBe(0);
        expect(await snapshotFiles(f.codespecDir)).toEqual(before);
      }
    } finally { f.cleanup(); }
  });

  it('reports reviewable analysis and an executable approval then transition command', async () => {
    const f = await createGuidanceFixture();
    try {
      f.artifacts.metadata.approvals.analyze = createPendingApprovals(1).analyze;
      f.artifacts.metadata.modules = { candidates: [], confirmed: [], dependencies: [] };
      f.artifacts.metadata.requirements = { added: [], modified: [], removed: [] };
      await f.save();
      const beforeStatus = await snapshotFiles(f.codespecDir);
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
      const instructions = await runCLI(['instructions', 'analyze', '--change', f.changeId, '--json'], { cwd: f.tempDir });
      expect(instructions.exitCode).toBe(0);
      expect(JSON.parse(instructions.stdout).analysisSummary.complete).toBe(true);
      expect(await snapshotFiles(f.codespecDir)).toEqual(beforeStatus);
      const approval = await runCLI(status.nextCommand.split(' ').slice(1), { cwd: f.tempDir });
      expect(approval.exitCode, approval.stdout + approval.stderr).toBe(0);
      const metadata = parse(await fs.readFile(path.join(f.artifacts.changeDir, 'metadata.yaml'), 'utf8'));
      expect(metadata.requirements).toEqual({ added: [], modified: [{ id: 'MOD-002-REQ-001', module: 'MOD-002' }], removed: [] });
      expect(metadata.modules.confirmed).toEqual(parse(f.artifacts.analysis!).modules);
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
