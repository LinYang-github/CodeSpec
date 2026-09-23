import { afterEach, describe, expect, it } from 'vitest';
import { runCLI } from '../helpers/run-cli.js';
import { parse, stringify } from 'yaml';
import { createGuidanceFixture } from '../helpers/workflow-guidance.js';
import { createPendingApprovals } from '../../src/core/codespec-workflow/approvals.js';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { captureBaseline } from '../../src/core/codespec-workflow/baseline.js';
import { loadWorkspace } from '../../src/core/codespec-workflow/loaders.js';

async function snapshotFiles(directory: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const [key, value] of Object.entries(await snapshotFiles(target))) snapshot[path.join(entry.name, key)] = value;
    } else snapshot[entry.name] = await fs.readFile(target, 'utf8');
  }
  return snapshot;
}

describe('canonical lifecycle guidance', () => {
  it('advances explicitly reconfirmed assumption baselines through DESIGN without a rebase loop', async () => {
    const f = await createGuidanceFixture('ANALYZE');
    try {
      const analysis = parse(f.artifacts.analysis!);
      analysis.assumptions = [{ id: 'ASSUMPTION-001', statement: '当前行为适用于本次需求', status: 'CONFIRMED', requirements: ['MOD-002-REQ-001'] }];
      f.artifacts.analysis = stringify(analysis);
      f.artifacts.metadata.approvals.analyze = createPendingApprovals(1).analyze;
      await f.save();
      f.artifacts.metadata.baseline = await captureBaseline(await loadWorkspace(f.codespecDir), f.artifacts.metadata);
      await f.save();
      const run = async (args: string[]) => {
        const result = await runCLI(args, { cwd: f.tempDir });
        expect(result.exitCode, result.stdout + result.stderr).toBe(0);
        return result;
      };
      await run(['approve', '--change', f.changeId, '--stage', 'analyze']);
      await run(['transition', '--change', f.changeId, '--to', 'DESIGN', '--reason', 'analyze approved']);
      const current = path.join(f.paths.currentSpecs, 'MOD-002', 'spec.md');
      await fs.writeFile(current, (await fs.readFile(current, 'utf8')).replace('支持 A+B', '支持 A+B（漂移）'));
      const metadataPath = path.join(f.artifacts.changeDir, 'metadata.yaml');
      const markStale = async () => {
        const metadata = parse(await fs.readFile(metadataPath, 'utf8'));
        metadata.baseline.stale = true;
        await fs.writeFile(metadataPath, stringify(metadata));
      };
      await markStale();
      await run(['rebase', '--change', f.changeId]);
      expect(parse(await fs.readFile(metadataPath, 'utf8')).change).toMatchObject({ status: 'ANALYZE', revision: 2 });
      analysis.revision = 2;
      analysis.assumptions[0].statement = '已核对漂移后的 Current，确认该假设仍成立';
      await fs.writeFile(path.join(f.artifacts.changeDir, 'analysis.yaml'), stringify(analysis));
      await run(['approve', '--change', f.changeId, '--stage', 'analyze']);
      await run(['transition', '--change', f.changeId, '--to', 'DESIGN', '--reason', 'reconfirmed assumption']);
      const status = JSON.parse((await run(['status', '--change', f.changeId, '--json'])).stdout);
      expect(status.nextAction.action).not.toBe('rebase');
      const confirmed = parse(await fs.readFile(metadataPath, 'utf8'));
      expect(confirmed.change).toMatchObject({ status: 'DESIGN', revision: 2 });
      expect(confirmed.baseline.stale).toBe(false);
      expect(confirmed.baseline.modules['MOD-002'].requirements['MOD-002-REQ-001']).not.toBe(f.artifacts.metadata.baseline.modules['MOD-002'].requirements['MOD-002-REQ-001']);
      // A subsequent, genuinely unreviewed drift must still require rebase.
      await fs.writeFile(current, (await fs.readFile(current, 'utf8')).replace('（漂移）', '（再次漂移）'));
      await markStale();
      expect(JSON.parse((await run(['status', '--change', f.changeId, '--json'])).stdout).nextAction.action).toBe('rebase');
      await run(['rebase', '--change', f.changeId]);
      expect(parse(await fs.readFile(metadataPath, 'utf8')).change).toMatchObject({ status: 'ANALYZE', revision: 3 });
    } finally { f.cleanup(); }
  });

  it('approves repaired ANALYZE rebase intent without repeating the revision loop', async () => {
    const f = await createGuidanceFixture('DESIGN');
    try {
      f.artifacts.metadata.baseline.stale = true;
      await f.save();
      const currentModule = path.join(f.paths.currentSpecs, 'MOD-002');
      const original = await snapshotFiles(currentModule);
      await fs.rm(currentModule, { recursive: true });
      const rebase = await runCLI(['rebase', '--change', f.changeId], { cwd: f.tempDir });
      expect(rebase.exitCode, rebase.stdout + rebase.stderr).toBe(0);
      await fs.mkdir(currentModule, { recursive: true });
      await Promise.all(Object.entries(original).map(async ([relativePath, content]) => {
        const target = path.join(currentModule, relativePath);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content);
      }));
      const analysisPath = path.join(f.artifacts.changeDir, 'analysis.yaml');
      const analysis = parse(await fs.readFile(analysisPath, 'utf8'));
      analysis.revision = 2;
      analysis.problem = '重新确认 Current 恢复后仍需新增能力';
      await fs.writeFile(analysisPath, stringify(analysis));
      const status = await runCLI(['status', '--change', f.changeId, '--json'], { cwd: f.tempDir });
      expect(status.exitCode, status.stdout + status.stderr).toBe(0);
      const guidance = JSON.parse(status.stdout);
      expect(guidance.analysisSummary).toMatchObject({ complete: true, approved: false });
      expect(guidance.nextCommand).toBe(`codespec approve --change ${f.changeId} --stage analyze`);
      const approval = await runCLI(guidance.nextCommand.split(' ').slice(1), { cwd: f.tempDir });
      expect(approval.exitCode, approval.stdout + approval.stderr).toBe(0);
      const approved = JSON.parse((await runCLI(['status', '--change', f.changeId, '--json'], { cwd: f.tempDir })).stdout);
      expect(approved.nextAction.action).toBe('transition');
      const transition = await runCLI(['transition', '--change', f.changeId, '--to', 'DESIGN', '--reason', 'analyze approved'], { cwd: f.tempDir });
      expect(transition.exitCode, transition.stdout + transition.stderr).toBe(0);
      expect(parse(await fs.readFile(path.join(f.artifacts.changeDir, 'metadata.yaml'), 'utf8')).change).toMatchObject({ revision: 2, status: 'DESIGN' });
    } finally { f.cleanup(); }
  });

  it('keeps an ANALYZE rebase conflict on the analysis editing route', async () => {
    const f = await createGuidanceFixture('DESIGN');
    try {
      f.artifacts.metadata.baseline.stale = true;
      await f.save();
      await fs.rm(path.join(f.paths.currentSpecs, 'MOD-002'), { recursive: true });
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
