import * as fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { approveStage, assertTransitionApproval } from '../../../src/core/codespec-workflow/approvals.js';
import { loadChangeArtifacts } from '../../../src/core/codespec-workflow/artifacts.js';
import { loadWorkspace } from '../../../src/core/codespec-workflow/loaders.js';
import { validateExitGate } from '../../../src/core/codespec-workflow/gates.js';
import { createWorkflowFixture, writeChangeArtifacts } from '../../helpers/codespec-workflow.js';

// Keep actual filesystem behavior; expose configurable methods solely for
// one-shot I/O failure injection during transaction commits.
vi.mock('node:fs/promises', async (importOriginal) => ({ ...await importOriginal<typeof fs>() }));

const spec = '# Orders\n\n- **模块编号：** MOD-001\n- **规格版本：** 1\n\n## MOD-001-REQ-001：Order\n\n#### Scenario: MOD-001-REQ-001-SCN-001 Submit\n- GIVEN ready\n- WHEN submit\n- THEN saved\n- ERROR retry\n\n### 测试用例\n\n#### MOD-001-REQ-001-SCN-001-TC-UI-01：Submit\n- **类型：** UI\n- **自动化测试：** `e2e/order.ts`\n- **测试标识：** `submit`\n- **最近验证：** 待验证\n\n| 步骤 | 用户操作 | 预期结果 |\n| --- | --- | --- |\n| 1 | submit | saved |\n';

async function prepared(legacy = false) {
  const fixture = await createWorkflowFixture();
  afterEach(fixture.cleanup);
  await writeChangeArtifacts(fixture, { spec, metadata: { change: { status: 'VERIFY' } } as never });
  const dir = path.join(fixture.paths.changes, fixture.changeId);
  const file = (name: string) => path.join(dir, name);
  if (!legacy) {
    const metadata = parseYaml(await fs.readFile(file('metadata.yaml'), 'utf8'));
    delete metadata.artifacts.proposal;
    metadata.artifacts.analysis = path.join('changes', fixture.changeId, 'analysis.yaml');
    metadata.artifacts.tasks = path.join('changes', fixture.changeId, 'tasks.yaml');
    metadata.artifacts.verification = path.join('changes', fixture.changeId, 'verification.yaml');
    const modules = [{ module: 'MOD-001', outcome: 'OWNED', reason: 'Orders own feedback' }];
    metadata.modules = { candidates: modules, confirmed: modules, dependencies: [] };
    metadata.requirements = { added: [{ id: 'MOD-001-REQ-001', module: 'MOD-001' }], modified: [], removed: [] };
    await fs.writeFile(file('metadata.yaml'), stringifyYaml(metadata));
    await fs.writeFile(file('analysis.yaml'), stringifyYaml({
      version: 1, change: fixture.changeId, revision: 1, problem: 'Order feedback',
      goals: [{ id: 'GOAL-001', statement: 'Users understand feedback' }], nonGoals: [], scope: { in: ['order feedback'], out: ['new channels'] }, actors: ['customer'], constraints: [], assumptions: [],
      openQuestions: [], acceptanceCriteria: [{ id: 'AC-001', statement: 'Feedback is visible', priority: 'MUST', requirements: ['MOD-001-REQ-001'] }], modules,
      requirements: [{ id: 'MOD-001-REQ-001', action: 'ADDED', reason: 'Add feedback' }],
    }));
    await fs.writeFile(file('tasks.yaml'), stringifyYaml({
      version: 1, changeRevision: 1, tasks: [{
        id: `${fixture.changeId}-TASK-01`, title: 'Order feedback', status: 'PENDING',
        requirements: ['MOD-001-REQ-001'], scenarios: ['MOD-001-REQ-001-SCN-001'],
        testCases: ['MOD-001-REQ-001-SCN-001-TC-UI-01'], plannedFiles: ['src/order.ts'],
        verificationPlan: [{ testCase: 'MOD-001-REQ-001-SCN-001-TC-UI-01', runner: 'vitest', command: 'pnpm test', profile: 'test', services: [], prepare: 'pnpm install', cleanup: 'pnpm cleanup' }],
      }], moduleDeltas: [], moduleRegistrations: { upsert: [], retire: [] },
    }));
    await fs.writeFile(file('verification.yaml'), 'version: 1\nchangeRevision: 1\ntestCases: []\n');
  }
  const workspace = await loadWorkspace(fixture.codespecDir);
  const artifacts = await loadChangeArtifacts(workspace.paths, fixture.changeId);
  for (const stage of legacy ? ['design', 'plan'] as const : ['analyze', 'design', 'plan'] as const) artifacts.metadata = approveStage(artifacts, stage, '2026-09-01T00:00:00.000Z');
  artifacts.metadata.verification = { requirements_verified: true, tests_passed: true, build_passed: true, lint_passed: true, verified_at: '2026-09-01T00:00:00.000Z', evidence_receipt: 'a'.repeat(64), baseline_identity: 'b'.repeat(64) };
  artifacts.metadata.archive.ready = true;
  for (const gate of Object.values(artifacts.metadata.gates)) gate.satisfied = true;
  if (legacy) {
    const { analyze: _analyze, ...approvals } = artifacts.metadata.approvals;
    await fs.writeFile(file('metadata.yaml'), stringifyYaml({ ...artifacts.metadata, approvals }));
  } else await fs.writeFile(file('metadata.yaml'), stringifyYaml(artifacts.metadata));
  const edit = async (name: string, from: string, to: string) => fs.writeFile(file(name), (await fs.readFile(file(name), 'utf8')).replace(from, to));
  return { ...fixture, workspace, file, edit };
}

afterEach(() => vi.restoreAllMocks());

describe('semantic revision transaction', () => {
  it.each([
    ['analysis.yaml', 'Order feedback', 'Localized feedback', 'ANALYZE', ['analyze', 'design', 'plan']],
    ['design.md', '# Design', '# Revised design', 'DESIGN', ['design', 'plan']],
    ['spec.md', 'THEN saved', 'THEN queued', 'DESIGN', ['design', 'plan']],
    ['tasks.yaml', 'title: Order feedback', 'title: Localized feedback', 'PLAN', ['plan']],
  ] as const)('routes changed %s and atomically invalidates downstream conclusions', async (name, from, to, route, invalidatedApprovals) => {
    const fixture = await prepared();
    await fixture.edit(name, from, to);
    const { reviseChange } = await import('../../../src/core/codespec-workflow/revision.js');
    expect(await reviseChange(fixture.workspace, fixture.changeId, 'scope changed')).toEqual({
      changeId: fixture.changeId, previousRevision: 1, revision: 2, route, invalidatedApprovals,
    });
    const artifacts = await loadChangeArtifacts(fixture.paths, fixture.changeId);
    expect(artifacts.metadata.change).toMatchObject({ revision: 2, status: route });
    expect(parseYaml(artifacts.analysis!).revision).toBe(2);
    expect(parseYaml(artifacts.tasks).changeRevision).toBe(route === 'PLAN' ? 2 : 1);
    for (const stage of invalidatedApprovals) expect(artifacts.metadata.approvals[stage]).toMatchObject({ status: 'revoked', revision: 2, content_hash: '', approved_at: null });
    expect(artifacts.metadata.verification).toEqual({ requirements_verified: false, tests_passed: false, build_passed: false, lint_passed: false, verified_at: null });
    expect(artifacts.metadata.archive.ready).toBe(false);
    expect(artifacts.metadata.gates.verify.satisfied).toBe(false);
    expect(artifacts.metadata.baseline.modules['MOD-001'].requirement_ids).toEqual(['MOD-001-REQ-001']);
    expect(artifacts.metadata.baseline.modules['MOD-001'].requirements).toEqual({
      'MOD-001-REQ-001': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    });
    expect(parseYaml(artifacts.verification)).toEqual({ version: 1, testCases: [] });
    expect(parseYaml(await fs.readFile(fixture.paths.changeIndex, 'utf8')).changes[0]).toMatchObject({ id: fixture.changeId, status: route });
    if (route !== 'ANALYZE') {
      expect(() => assertTransitionApproval(artifacts, 'DESIGN')).not.toThrow();
      expect(artifacts.metadata.approvals.analyze.approved_at).toBe('2026-09-01T00:00:00.000Z');
    }
    if (route === 'PLAN') {
      expect(() => assertTransitionApproval(artifacts, 'PLAN')).not.toThrow();
      expect(artifacts.metadata.approvals.design.approved_at).toBe('2026-09-01T00:00:00.000Z');
    }
    await expect(reviseChange(fixture.workspace, fixture.changeId, 'repeat')).rejects.toThrow(/no semantic|语义/i);
  });

  it('chooses the earliest stale approved authority when multiple artifacts changed', async () => {
    const fixture = await prepared();
    await fixture.edit('analysis.yaml', 'Order feedback', 'Different scope');
    await fixture.edit('tasks.yaml', 'title: Order feedback', 'title: New implementation');
    const { reviseChange } = await import('../../../src/core/codespec-workflow/revision.js');
    expect((await reviseChange(fixture.workspace, fixture.changeId, 'both changed')).route).toBe('ANALYZE');
  });

  it('routes an analysis revision even when downstream task content is not parseable', async () => {
    const fixture = await prepared();
    await fixture.edit('analysis.yaml', 'Order feedback', 'Different scope');
    await fs.writeFile(fixture.file('tasks.yaml'), 'unfinished downstream task plan');
    const { reviseChange } = await import('../../../src/core/codespec-workflow/revision.js');
    expect((await reviseChange(fixture.workspace, fixture.changeId, 'scope changed')).route).toBe('ANALYZE');
    expect(await fs.readFile(fixture.file('tasks.yaml'), 'utf8')).toBe('unfinished downstream task plan');
  });

  it('detects edits during staging and preserves the concurrent author change', async () => {
    const fixture = await prepared();
    await fixture.edit('tasks.yaml', 'title: Order feedback', 'title: New plan');
    const metadataBefore = await fs.readFile(fixture.file('metadata.yaml'), 'utf8');
    const real = fs.writeFile;
    let injected = false;
    vi.spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
      if (!injected && String(args[0]).endsWith('.tmp')) {
        injected = true;
        await real(fixture.file('spec.md'), 'concurrent spec edit');
      }
      return real(...args);
    });
    const { reviseChange } = await import('../../../src/core/codespec-workflow/revision.js');
    await expect(reviseChange(fixture.workspace, fixture.changeId, 'replan')).rejects.toThrow(/冲突|changed|conflict/i);
    expect(await fs.readFile(fixture.file('metadata.yaml'), 'utf8')).toBe(metadataBefore);
    expect(await fs.readFile(fixture.file('spec.md'), 'utf8')).toBe('concurrent spec edit');
  });

  it.each([
    ['tasks.yaml', 'status: PENDING', 'status: DONE'],
    ['verification.yaml', 'testCases: []', 'testCases: [] # fresh evidence'],
    ['spec.md', 'e2e/order.ts', 'e2e/order-new.ts'],
    ['spec.md', '待验证', 'PASS'],
  ])('does not revise execution/evidence/locator-only changes in %s', async (name, from, to) => {
    const fixture = await prepared();
    await fixture.edit(name, from, to);
    const before = await fs.readFile(fixture.file('metadata.yaml'), 'utf8');
    const { reviseChange } = await import('../../../src/core/codespec-workflow/revision.js');
    await expect(reviseChange(fixture.workspace, fixture.changeId, 'updated')).rejects.toThrow(/no semantic|语义/i);
    expect(await fs.readFile(fixture.file('metadata.yaml'), 'utf8')).toBe(before);
  });

  it.each(['writeFile', 'rename'] as const)('rolls back every artifact when any %s step fails', async (operation) => {
    const fixture = await prepared();
    await fixture.edit('tasks.yaml', 'title: Order feedback', 'title: New plan');
    const files = ['metadata.yaml', 'analysis.yaml', 'tasks.yaml', 'verification.yaml'].map(fixture.file).concat(fixture.paths.changeIndex);
    const before = await Promise.all(files.map((file) => fs.readFile(file, 'utf8')));
    const { reviseChange } = await import('../../../src/core/codespec-workflow/revision.js');
    const real = fs[operation];
    for (let failure = 1; failure <= 5; failure++) {
      let count = 0;
      const spy = vi.spyOn(fs, operation).mockImplementation((async (...args: Parameters<typeof real>) => {
        if (++count === failure) throw new Error('injected transaction failure');
        return (real as Function)(...args);
      }) as typeof real);
      await expect(reviseChange(fixture.workspace, fixture.changeId, 'replan')).rejects.toThrow('injected transaction failure');
      spy.mockRestore();
      expect(await Promise.all(files.map((file) => fs.readFile(file, 'utf8')))).toEqual(before);
      expect((await fs.readdir(path.dirname(fixture.file('metadata.yaml')))).filter((file) => file.endsWith('.tmp'))).toEqual([]);
      expect((await fs.readdir(fixture.paths.changes)).filter((file) => file.endsWith('.tmp') || file.endsWith('.lock'))).toEqual([]);
    }
  });

  it('preserves legacy proposal-bearing metadata and markdown artifacts', async () => {
    const fixture = await prepared(true);
    await fixture.edit('design.md', '# Design', '# Revised');
    const { reviseChange } = await import('../../../src/core/codespec-workflow/revision.js');
    expect((await reviseChange(fixture.workspace, fixture.changeId, 'design changed')).route).toBe('DESIGN');
    const persisted = parseYaml(await fs.readFile(fixture.file('metadata.yaml'), 'utf8'));
    expect(persisted.approvals).not.toHaveProperty('analyze');
    expect(persisted.artifacts.proposal).toContain('proposal.md');
    expect(await fs.readFile(fixture.file('verification.md'), 'utf8')).toBe('# Verification\n');
    expect(await fs.readFile(fixture.file('tasks.md'), 'utf8')).toBe('# Tasks\n');
  });

  it.each(['', '   '])('rejects empty reasons without writing', async (reason) => {
    const fixture = await prepared();
    await fixture.edit('design.md', '# Design', '# Revised');
    const { reviseChange } = await import('../../../src/core/codespec-workflow/revision.js');
    await expect(reviseChange(fixture.workspace, fixture.changeId, reason)).rejects.toThrow(/reason|原因/i);
  });

  it.each(['ARCHIVED', 'ABANDONED'])('rejects revision of terminal state %s', async (status) => {
    const fixture = await prepared();
    await fixture.edit('metadata.yaml', 'status: VERIFY', `status: ${status}`);
    await fixture.edit('design.md', '# Design', '# Revised');
    const { reviseChange } = await import('../../../src/core/codespec-workflow/revision.js');
    await expect(reviseChange(fixture.workspace, fixture.changeId, 'changed')).rejects.toThrow(/ARCHIVED|ABANDONED|终态/i);
  });

  it('requires current tasks changeRevision at the canonical PLAN gate while allowing historical parsing', async () => {
    const fixture = await prepared();
    const artifacts = await loadChangeArtifacts(fixture.paths, fixture.changeId);
    artifacts.metadata.change.status = 'PLAN';
    artifacts.tasks = artifacts.tasks.replace('changeRevision: 1\n', '');
    const missing = await validateExitGate(fixture.workspace, artifacts);
    expect(missing.errors.join('\n')).toMatch(/changeRevision/);
    artifacts.tasks += 'changeRevision: 2\n';
    expect((await validateExitGate(fixture.workspace, artifacts)).errors.join('\n')).toMatch(/changeRevision.*1/);
    artifacts.tasks = artifacts.tasks.replace('changeRevision: 2', 'changeRevision: 1');
    expect((await validateExitGate(fixture.workspace, artifacts)).errors.join('\n')).not.toMatch(/changeRevision|任务 YAML 无效/);
  });
});
