import * as fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowFixture } from '../../helpers/codespec-workflow.js';
import { rebaseChange } from '../../../src/core/codespec-workflow/rebase.js';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { parseDeltaSpec } from '../../../src/core/codespec-workflow/delta-parser.js';
import { captureBaseline } from '../../../src/core/codespec-workflow/baseline.js';
import { createHash } from 'node:crypto';
import { currentMarkdown, requirementMarkdown, richDelta } from '../../helpers/rich-requirement.js';
import { loadChangeArtifacts, loadWorkspace } from '../../../src/core/codespec-workflow/loaders.js';
import { approveStage, assertTransitionApproval } from '../../../src/core/codespec-workflow/approvals.js';
import { parseCurrentSpecDelta } from '../../../src/core/codespec-workflow/current-spec-delta.js';
import { parseAnalysisDocument } from '../../../src/core/codespec-workflow/analysis.js';
import { projectAnalysisMetadata } from '../../../src/core/codespec-workflow/analysis-consistency.js';
import { recoverPendingTransactions } from '../../../src/core/codespec-workflow/transaction-journal.js';

vi.mock('node:fs/promises', async (importOriginal) => ({ ...await importOriginal<typeof fs>() }));
afterEach(() => vi.restoreAllMocks());

async function canonicalRebase(action: 'ADDED' | 'MODIFIED' | 'REMOVED' = 'MODIFIED', assumption = false) {
  const fixture = await createWorkflowFixture({ v1: true });
  afterEach(fixture.cleanup);
  const dir = path.join(fixture.paths.changes, fixture.changeId);
  const file = (name: string) => path.join(dir, name);
  await fs.mkdir(dir, { recursive: true });
  const metadata = fixture.metadataAt('VERIFY');
  for (const name of ['analysis', 'tasks', 'verification'] as const) metadata.artifacts[name] = path.join('changes', fixture.changeId, `${name}.yaml`);
  const analysis = parseAnalysisDocument({
    version: 1, change: fixture.changeId, revision: 1, problem: 'Create users',
    goals: [{ id: 'GOAL-001', statement: 'Manage users' }], nonGoals: [],
    scope: { in: ['users'], out: ['billing'] }, actors: [], constraints: [], openQuestions: [],
    assumptions: assumption ? [{ id: 'ASSUMPTION-001', statement: 'Current supports creation', status: 'CONFIRMED', requirements: ['MOD-002-REQ-006'] }] : [],
    acceptanceCriteria: [{ id: 'AC-001', statement: 'Creation works', priority: 'MUST', requirements: ['MOD-002-REQ-006'] }],
    modules: [{ module: 'MOD-002', outcome: 'OWNED', reason: 'User module' }],
    requirements: [{ id: 'MOD-002-REQ-006', action, reason: 'Manage users' }],
  });
  Object.assign(metadata, projectAnalysisMetadata(analysis));
  await fs.writeFile(file('analysis.yaml'), stringifyYaml(analysis));
  await fs.writeFile(file('spec.md'), richDelta(action));
  await fs.writeFile(file('design.md'), '# Design\n\nUser design\n');
  await fs.writeFile(file('tasks.yaml'), 'version: 1\nchangeRevision: 1\ntasks: []\nmoduleDeltas: []\nmoduleRegistrations:\n  upsert: []\n  retire: []\n');
  await fs.writeFile(file('verification.yaml'), 'version: 1\nchangeRevision: 1\ntestCases: []\n');
  const currentPath = path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md');
  await fs.mkdir(path.dirname(currentPath), { recursive: true });
  await fs.writeFile(currentPath, action === 'ADDED' ? currentMarkdown.replace(requirementMarkdown, '') : currentMarkdown);
  await fs.writeFile(file('metadata.yaml'), stringifyYaml(metadata));
  const workspace = await loadWorkspace(fixture.codespecDir);
  metadata.baseline = await captureBaseline(workspace, metadata);
  metadata.baseline.stale = true;
  await fs.writeFile(file('metadata.yaml'), stringifyYaml(metadata));
  const artifacts = await loadChangeArtifacts(fixture.paths, fixture.changeId);
  for (const stage of ['analyze', 'design', 'plan'] as const) artifacts.metadata = approveStage(artifacts, stage, '2026-09-01T00:00:00.000Z');
  artifacts.metadata.verification = { requirements_verified: true, tests_passed: true, build_passed: true, lint_passed: true, verified_at: '2026-09-01T00:00:00.000Z', evidence_receipt: 'a'.repeat(64) };
  artifacts.metadata.archive.ready = true;
  await fs.writeFile(file('metadata.yaml'), stringifyYaml(artifacts.metadata));
  const edit = async (name: string, from: string, to: string) => fs.writeFile(file(name), (await fs.readFile(file(name), 'utf8')).replace(from, to));
  return { ...fixture, workspace, file, currentPath, edit };
}

describe('rich semantic rebase', () => {
  it('rejects a partial Current module before changing the stale Change', async () => {
    const fixture = await canonicalRebase();
    const metadataBefore = await fs.readFile(fixture.file('metadata.yaml'), 'utf8');
    await fs.unlink(path.join(fixture.paths.currentSpecs, 'MOD-001', 'interface.yaml'));

    await expect(rebaseChange(fixture.workspace, fixture.changeId)).rejects.toThrow(/MOD-001.*interface\.yaml/);

    expect(await fs.readFile(fixture.file('metadata.yaml'), 'utf8')).toBe(metadataBefore);
  });

  it.each(['displacement', 'publication'])('preserves author edits at the actual forward %s syscall', async (boundary) => {
    const fixture = await canonicalRebase();
    const target = fixture.file('spec.md');
    const metadataBefore = await fs.readFile(fixture.file('metadata.yaml'), 'utf8');
    const realRename = fs.rename;
    const realLink = fs.link;
    let edited = false;
    const edit = async () => {
      if (!edited) { edited = true; await fs.writeFile(target, 'author edit at final forward syscall'); }
    };
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === target || (boundary === 'displacement' && from === target)) await edit();
      return realRename(from, to);
    });
    vi.spyOn(fs, 'link').mockImplementation(async (from, to) => {
      if (boundary === 'publication' && to === target) await edit();
      return realLink(from, to);
    });
    const outcome = await rebaseChange(fixture.workspace, fixture.changeId).catch((error: unknown) => error);
    expect(edited).toBe(true);
    expect(await fs.readFile(target, 'utf8')).toBe('author edit at final forward syscall');
    expect(outcome).toBeInstanceOf(Error);
    expect(await fs.readFile(fixture.file('metadata.yaml'), 'utf8')).toBe(metadataBefore);
  });

  it('retains late writes through a pre-rebase handle in discoverable manual-only escrow', async () => {
    const fixture = await canonicalRebase();
    const target = fixture.file('spec.md');
    const handle = await fs.open(target, 'r+');
    const identity = await handle.stat();
    try {
      await rebaseChange(fixture.workspace, fixture.changeId);
      const businessSpec = await fs.readFile(target, 'utf8');
      await handle.truncate(0);
      await handle.writeFile('late author write after rebase returned');
      await handle.sync();
      expect((await handle.stat()).nlink).toBeGreaterThan(0);
      const escrowRoot = path.join(fixture.paths.transactions, '.recovery-escrow');
      const directories = await fs.readdir(escrowRoot);
      const escrow = path.join(escrowRoot, directories.find((name) => name.startsWith('rebase-'))!);
      const manifest = parseYaml(await fs.readFile(path.join(escrow, 'manifest.yaml'), 'utf8'));
      expect(manifest).toMatchObject({ version: 1, outcome: 'committed', cleanupPolicy: 'manual-only' });
      const retained = manifest.retained.find((entry: { target: string }) => entry.target === path.relative(fixture.codespecDir, target).split(path.sep).join('/'));
      const saved = path.join(escrow, retained.file);
      const savedIdentity = await fs.stat(saved);
      expect([savedIdentity.dev, savedIdentity.ino]).toEqual([identity.dev, identity.ino]);
      expect(await fs.readFile(saved, 'utf8')).toBe('late author write after rebase returned');
      expect(await fs.readFile(target, 'utf8')).toBe(businessSpec);
      expect((await fs.readdir(path.dirname(target))).sort()).toEqual(['analysis.yaml', 'design.md', 'metadata.yaml', 'spec.md', 'tasks.yaml', 'verification.yaml']);
      await handle.close();
      await recoverPendingTransactions(fixture.paths);
      expect(await fs.readFile(saved, 'utf8')).toBe('late author write after rebase returned');
      expect((await fs.readdir(fixture.paths.transactions)).filter((name) => !name.startsWith('.'))).toEqual([]);
    } finally { await handle.close(); }
  });

  it('preserves author edits at the actual rollback replacement syscall', async () => {
    const fixture = await canonicalRebase();
    const target = fixture.file('metadata.yaml');
    const realRename = fs.rename;
    const realLink = fs.link;
    const realWrite = fs.writeFile;
    let rollingBack = false;
    let edited = false;
    const edit = async () => {
      if (!edited) { edited = true; await realWrite(target, 'author metadata at rollback syscall'); }
    };
    const failInstallation = (to: unknown) => {
      if (!rollingBack && to === fixture.file('verification.yaml')) { rollingBack = true; throw new Error('verification installation failed'); }
    };
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      failInstallation(to);
      if (rollingBack && (from === target || to === target)) await edit();
      return realRename(from, to);
    });
    vi.spyOn(fs, 'link').mockImplementation(async (from, to) => {
      failInstallation(to);
      if (rollingBack && to === target) await edit();
      return realLink(from, to);
    });
    vi.spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
      if (rollingBack && args[0] === target) await edit();
      return realWrite(...args);
    });
    const outcome = await rebaseChange(fixture.workspace, fixture.changeId).catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(Error);
    expect(edited).toBe(true);
    expect(await fs.readFile(target, 'utf8')).toBe('author metadata at rollback syscall');
    expect((outcome as Error).message).toMatch(/verification installation failed.*rollback/i);
  });

  it('refreshes only the affected Previous and carries current analyze authority to DESIGN', async () => {
    const fixture = await canonicalRebase();
    const before = parseCurrentSpecDelta(await fs.readFile(fixture.file('spec.md'), 'utf8'));
    await fs.writeFile(fixture.currentPath, currentMarkdown.replace('THEN 用户出现在列表', 'THEN 用户出现在筛选列表'));
    const result = await rebaseChange(fixture.workspace, fixture.changeId);
    expect(result.decision).toMatchObject({ strategy: 'semantic-rebase', route: 'DESIGN', decisions: [{ requirement_id: 'MOD-002-REQ-006', action: 'MODIFIED', outcome: 'REFRESHED', previous_hash: expect.stringMatching(/^[a-f0-9]{64}$/), current_hash: expect.stringMatching(/^[a-f0-9]{64}$/) }] });
    expect(result.decision.current_specs).toEqual([fixture.currentPath]);
    const after = await loadChangeArtifacts(fixture.paths, fixture.changeId);
    const delta = parseCurrentSpecDelta(after.spec);
    expect(delta.requirements).toHaveLength(1);
    expect(delta.requirements[0].previous?.scenarios[0].then).toEqual(['用户出现在筛选列表']);
    expect(delta.requirements[0].next).toEqual(before.requirements[0].next);
    expect(delta.requirements[0].reason).toBe(before.requirements[0].reason);
    expect(after.spec + after.design).not.toContain('MOD-002-REQ-007');
    expect(after.metadata.baseline.modules['MOD-002'].requirement_ids).toEqual(['MOD-002-REQ-006']);
    expect(after.metadata.change).toMatchObject({ revision: 2, status: 'DESIGN' });
    expect(parseYaml(after.analysis!).revision).toBe(2);
    expect(parseYaml(after.tasks).changeRevision).toBe(1);
    expect(() => assertTransitionApproval(after, 'DESIGN')).not.toThrow();
    expect(after.metadata.approvals.analyze.approved_at).toBe('2026-09-01T00:00:00.000Z');
    for (const stage of ['design', 'plan'] as const) expect(after.metadata.approvals[stage].status).toBe('revoked');
    expect(after.metadata.verification).not.toHaveProperty('evidence_receipt');
    expect(parseYaml(after.verification)).toEqual({ version: 1, testCases: [] });
    expect(parseYaml(await fs.readFile(fixture.paths.changeIndex, 'utf8')).changes[0].status).toBe('DESIGN');
  });

  it.each(['ADDED', 'MODIFIED', 'REMOVED'] as const)('routes invalidated %s disposition to ANALYZE without changing intent', async (action) => {
    const fixture = await canonicalRebase(action);
    await fs.writeFile(fixture.currentPath, action === 'ADDED' ? currentMarkdown : currentMarkdown.replace(requirementMarkdown, ''));
    const original = await fs.readFile(fixture.file('spec.md'), 'utf8');
    const result = await rebaseChange(fixture.workspace, fixture.changeId);
    expect(result.decision.route).toBe('ANALYZE');
    expect(result.decision.decisions[0]).toMatchObject({ requirement_id: 'MOD-002-REQ-006', action, outcome: 'ANALYSIS_CONFLICT' });
    const artifacts = await loadChangeArtifacts(fixture.paths, fixture.changeId);
    expect(artifacts.metadata.change.revision).toBe(2);
    for (const stage of ['analyze', 'design', 'plan'] as const) expect(artifacts.metadata.approvals[stage].status).toBe('revoked');
    expect(artifacts.spec).toBe(original);
    expect(parseYaml(artifacts.tasks).changeRevision).toBe(1);
    expect(parseYaml(artifacts.verification)).toEqual({ version: 1, testCases: [] });
    expect(artifacts.metadata.baseline.stale).toBe(true);
  });

  it('routes confirmed assumption Requirement drift to ANALYZE', async () => {
    const fixture = await canonicalRebase('MODIFIED', true);
    await fs.writeFile(fixture.currentPath, currentMarkdown.replace('THEN 用户出现在列表', 'THEN 需要人工审批'));
    const result = await rebaseChange(fixture.workspace, fixture.changeId);
    expect(result.decision.route).toBe('ANALYZE');
    expect(result.decision.reason).toContain('ASSUMPTION-001');
  });

  it('routes changed Current module ownership to ANALYZE', async () => {
    const fixture = await canonicalRebase();
    await fs.writeFile(fixture.currentPath, currentMarkdown.replaceAll('MOD-002', 'MOD-001'));
    const result = await rebaseChange(fixture.workspace, fixture.changeId);
    expect(result.decision.route).toBe('ANALYZE');
    expect(result.decision.reason).toContain('OWNED module MOD-002');
  });

  it('routes an acceptance criterion whose Requirement mapping no longer resolves to ANALYZE', async () => {
    const fixture = await canonicalRebase();
    const artifacts = await loadChangeArtifacts(fixture.paths, fixture.changeId);
    const analysis = parseYaml(artifacts.analysis!);
    analysis.acceptanceCriteria[0].requirements = ['MOD-002-REQ-007'];
    artifacts.analysis = stringifyYaml(analysis);
    // A stored receipt alone does not establish a valid AC/delta mapping.
    artifacts.metadata = approveStage(artifacts, 'analyze');
    await fs.writeFile(fixture.file('analysis.yaml'), artifacts.analysis!);
    await fs.writeFile(fixture.file('metadata.yaml'), stringifyYaml(artifacts.metadata));
    const result = await rebaseChange(fixture.workspace, fixture.changeId);
    expect(result.decision.route).toBe('ANALYZE');
    expect(result.decision.reason).toContain('AC-001');
  });

  it('does not invalidate confirmed assumptions for unrelated Current Requirement drift', async () => {
    const fixture = await canonicalRebase('MODIFIED', true);
    await fs.writeFile(fixture.currentPath, currentMarkdown.replace('THEN 显示状态', 'THEN 无关变更'));
    expect((await rebaseChange(fixture.workspace, fixture.changeId)).decision.route).toBe('DESIGN');
  });

  it('uses absence markers for still-valid ADDED Requirements', async () => {
    const fixture = await canonicalRebase('ADDED');
    const result = await rebaseChange(fixture.workspace, fixture.changeId);
    expect(result.decision).toMatchObject({ route: 'DESIGN', decisions: [{ action: 'ADDED', previous_hash: null, current_hash: null, outcome: 'REFRESHED' }] });
    expect(result.baseline.modules['MOD-002'].requirement_ids).toEqual(['MOD-002-REQ-006']);
    expect(result.baseline.modules['MOD-002'].requirements?.['MOD-002-REQ-006']).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    ['metadata.yaml', 'outcome: OWNED', 'outcome: DEPENDENCY'],
    ['analysis.yaml', 'problem: Create users', 'problem: Different intent'],
    ['receipt', '', ''],
    ['spec.md', '## MODIFIED', '## REMOVED'],
  ])('rejects invalid authority or disposition in %s without minting a new approval', async (name, from, to) => {
    const fixture = await canonicalRebase();
    if (name === 'receipt') {
      const metadata = parseYaml(await fs.readFile(fixture.file('metadata.yaml'), 'utf8'));
      metadata.approvals.analyze = { status: 'pending', revision: 1, content_hash: '', approved_at: null };
      await fs.writeFile(fixture.file('metadata.yaml'), stringifyYaml(metadata));
    } else if (name === 'spec.md') await fs.writeFile(fixture.file(name), richDelta('REMOVED'));
    else await fixture.edit(name, from, to);
    const result = await rebaseChange(fixture.workspace, fixture.changeId);
    expect(result.decision.route).toBe('ANALYZE');
    const artifacts = await loadChangeArtifacts(fixture.paths, fixture.changeId);
    expect(artifacts.metadata.approvals.analyze.status).toBe('revoked');
    expect(parseYaml(artifacts.tasks).changeRevision).toBe(1);
  });

  it('routes a target already satisfied in Current to ANALYZE instead of creating a no-op delta', async () => {
    const fixture = await canonicalRebase();
    await fs.writeFile(fixture.currentPath, currentMarkdown.replace('THEN 用户出现在列表', 'THEN 用户出现在列表顶部'));
    expect((await rebaseChange(fixture.workspace, fixture.changeId)).decision.route).toBe('ANALYZE');
  });

  it.each(['open', 'rename', 'link'] as const)('rolls back all artifacts and index at every installation %s failure', async (operation) => {
    const fixture = await canonicalRebase();
    await fs.writeFile(fixture.currentPath, currentMarkdown.replace('THEN 用户出现在列表', 'THEN 用户出现在筛选列表'));
    const files = ['metadata.yaml', 'analysis.yaml', 'spec.md', 'design.md', 'tasks.yaml', 'verification.yaml'].map(fixture.file).concat(fixture.paths.changeIndex);
    const before = await Promise.all(files.map((file) => fs.readFile(file, 'utf8')));
    const real = fs[operation];
    for (let failure = 1; failure <= 6; failure++) {
      let count = 0;
      const spy = vi.spyOn(fs, operation).mockImplementation((async (...args: Parameters<typeof real>) => {
        const installation = path.join(fixture.paths.transactions, '');
        const source = String(args[0]);
        const destination = String(args[1]);
        const isInstall = operation === 'rename'
          ? destination.startsWith(installation) && destination.includes(`${path.sep}installation${path.sep}`)
          : source.startsWith(installation) && source.includes(`${path.sep}installation${path.sep}`);
        if (isInstall && ++count === failure) throw new Error('injected rebase failure');
        return (real as Function)(...args);
      }) as typeof real);
      await expect(rebaseChange(fixture.workspace, fixture.changeId)).rejects.toThrow('injected rebase failure');
      spy.mockRestore();
      expect(await Promise.all(files.map((file) => fs.readFile(file, 'utf8')))).toEqual(before);
      expect((await fs.readdir(path.dirname(fixture.file('metadata.yaml')))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
      expect((await fs.readdir(fixture.paths.transactions)).filter((name) => !name.startsWith('.'))).toEqual([]);
    }
  });

  it('rolls back ANALYZE routing if the index commit fails', async () => {
    const fixture = await canonicalRebase('ADDED');
    await fs.writeFile(fixture.currentPath, currentMarkdown);
    const files = ['metadata.yaml', 'analysis.yaml', 'spec.md', 'design.md', 'tasks.yaml', 'verification.yaml'].map(fixture.file).concat(fixture.paths.changeIndex);
    const before = await Promise.all(files.map((file) => fs.readFile(file, 'utf8')));
    const real = fs.link;
    let failed = false;
    vi.spyOn(fs, 'link').mockImplementation(async (from, to) => {
      if (!failed && to === fixture.paths.changeIndex) { failed = true; throw new Error('index replacement failed'); }
      return real(from, to);
    });
    await expect(rebaseChange(fixture.workspace, fixture.changeId)).rejects.toThrow('index replacement failed');
    expect(await Promise.all(files.map((file) => fs.readFile(file, 'utf8')))).toEqual(before);
  });

  it.each(['Current', 'tasks'])('preserves concurrent %s edits and restores committed artifacts', async (target) => {
    const fixture = await canonicalRebase();
    const files = ['metadata.yaml', 'analysis.yaml', 'spec.md', 'design.md', 'verification.yaml'].map(fixture.file).concat(fixture.paths.changeIndex);
    const before = await Promise.all(files.map((file) => fs.readFile(file, 'utf8')));
    const targetPath = target === 'Current' ? fixture.currentPath : fixture.file('tasks.yaml');
    const real = fs.link;
    vi.spyOn(fs, 'link').mockImplementation(async (from, to) => {
      await real(from, to);
      if (to === fixture.file('metadata.yaml')) await fs.writeFile(targetPath, 'concurrent author edit');
    });
    await expect(rebaseChange(fixture.workspace, fixture.changeId)).rejects.toThrow(/conflict/i);
    expect(await fs.readFile(targetPath, 'utf8')).toBe('concurrent author edit');
    expect(await Promise.all(files.map((file) => fs.readFile(file, 'utf8')))).toEqual(before);
  });

  it('reports rollback ownership conflicts without overwriting newer author edits', async () => {
    const fixture = await canonicalRebase();
    const real = fs.link;
    let failed = false;
    vi.spyOn(fs, 'link').mockImplementation(async (from, to) => {
      if (!failed && to === fixture.file('verification.yaml')) {
        failed = true;
        await fs.writeFile(fixture.file('metadata.yaml'), 'author metadata edit');
        throw new Error('verification replacement failed');
      }
      await real(from, to);
    });
    const failure = await rebaseChange(fixture.workspace, fixture.changeId).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as Error).message).toMatch(/verification replacement failed.*rollback conflict/);
    expect(await fs.readFile(fixture.file('metadata.yaml'), 'utf8')).toBe('author metadata edit');
  });
});
