import * as fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowFixture } from '../../helpers/codespec-workflow.js';
import { detectStaleChanges } from '../../../src/core/codespec-workflow/stale.js';
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

vi.mock('node:fs/promises', async (importOriginal) => ({ ...await importOriginal<typeof fs>() }));
afterEach(() => vi.restoreAllMocks());

async function canonicalRebase(action: 'ADDED' | 'MODIFIED' | 'REMOVED' = 'MODIFIED', assumption = false) {
  const fixture = await createWorkflowFixture();
  afterEach(fixture.cleanup);
  const dir = path.join(fixture.paths.changes, fixture.changeId);
  const file = (name: string) => path.join(dir, name);
  await fs.mkdir(dir, { recursive: true });
  const metadata = fixture.metadataAt('VERIFY');
  delete metadata.artifacts.proposal;
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

  it('refuses supplied archive or full-module content as canonical Current input', async () => {
    const fixture = await canonicalRebase();
    const archivePath = path.join(fixture.paths.archive, 'old-spec.md');
    await fs.writeFile(archivePath, currentMarkdown.replace('THEN 用户出现在列表', 'THEN archive-only intent'));
    const before = await fs.readFile(fixture.file('metadata.yaml'), 'utf8');
    await expect(rebaseChange(fixture.workspace, fixture.changeId, [archivePath])).rejects.toThrow(/Current|configured/i);
    expect(await fs.readFile(fixture.file('metadata.yaml'), 'utf8')).toBe(before);
  });

  it.each(['writeFile', 'rename'] as const)('rolls back all artifacts and index at every %s failure', async (operation) => {
    const fixture = await canonicalRebase();
    await fs.writeFile(fixture.currentPath, currentMarkdown.replace('THEN 用户出现在列表', 'THEN 用户出现在筛选列表'));
    const files = ['metadata.yaml', 'analysis.yaml', 'spec.md', 'design.md', 'tasks.yaml', 'verification.yaml'].map(fixture.file).concat(fixture.paths.changeIndex);
    const before = await Promise.all(files.map((file) => fs.readFile(file, 'utf8')));
    const real = fs[operation];
    for (let failure = 1; failure <= 6; failure++) {
      let count = 0;
      const spy = vi.spyOn(fs, operation).mockImplementation((async (...args: Parameters<typeof real>) => {
        if (++count === failure) throw new Error('injected rebase failure');
        return (real as Function)(...args);
      }) as typeof real);
      await expect(rebaseChange(fixture.workspace, fixture.changeId)).rejects.toThrow('injected rebase failure');
      spy.mockRestore();
      expect(await Promise.all(files.map((file) => fs.readFile(file, 'utf8')))).toEqual(before);
      expect((await fs.readdir(path.dirname(fixture.file('metadata.yaml')))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    }
  });

  it('rolls back ANALYZE routing if the index commit fails', async () => {
    const fixture = await canonicalRebase('ADDED');
    await fs.writeFile(fixture.currentPath, currentMarkdown);
    const files = ['metadata.yaml', 'analysis.yaml', 'spec.md', 'design.md', 'tasks.yaml', 'verification.yaml'].map(fixture.file).concat(fixture.paths.changeIndex);
    const before = await Promise.all(files.map((file) => fs.readFile(file, 'utf8')));
    const real = fs.rename;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === fixture.paths.changeIndex) throw new Error('index replacement failed');
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
    const real = fs.rename;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      await real(from, to);
      if (to === fixture.file('metadata.yaml')) await fs.writeFile(targetPath, 'concurrent author edit');
    });
    await expect(rebaseChange(fixture.workspace, fixture.changeId)).rejects.toThrow(/conflict/i);
    expect(await fs.readFile(targetPath, 'utf8')).toBe('concurrent author edit');
    expect(await Promise.all(files.map((file) => fs.readFile(file, 'utf8')))).toEqual(before);
  });

  it('reports rollback ownership conflicts without overwriting newer author edits', async () => {
    const fixture = await canonicalRebase();
    const real = fs.rename;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === fixture.file('verification.yaml')) {
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

describe('stale changes and rebase', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  it('preserves all inline design sections once and invalidates downstream gate approvals on Level 1 rebase', async () => {
    const fixture = await createWorkflowFixture(); cleanups.push(fixture.cleanup);
    const metadata = fixture.metadataAt('VERIFY');
    metadata.change.sdd_level = 1; delete metadata.artifacts.design;
    metadata.baseline.stale = true;
    metadata.modules.confirmed = [{ module: 'MOD-002', outcome: 'OWNED', reason: 'payment' }];
    metadata.requirements.added = [{ id: 'MOD-002-REQ-006', module: 'MOD-002' }];
    for (const gate of Object.values(metadata.gates)) gate.satisfied = true;
    const dir = path.join(fixture.paths.changes, fixture.changeId); await fs.mkdir(dir, { recursive: true });
    const sections = [
      '## 设计说明\nKeep the human design.\n',
      '## SDD 分级依据\nKeep the level rationale.\n',
      '## 归档影响分析\n```yaml\noutcome: none\nreferences: []\nverification: []\n```\n',
    ];
    await fs.writeFile(path.join(dir, 'metadata.yaml'), stringifyYaml(metadata));
    await Promise.all(['proposal.md', 'tasks.md', 'verification.md'].map((file) => fs.writeFile(path.join(dir, file), '# authored artifact\n')));
    await fs.writeFile(path.join(dir, 'spec.md'), sections.join('\n') +
      '\n## ADDED\n### MOD-002-REQ-006 payment\n**New**\nNew rule\n#### Scenario: SCN-001 payment\n- **GIVEN** account\n- **WHEN** paying\n- **THEN** accepted\n- **ERROR** refused\n');
    await rebaseChange(fixture.workspace, fixture.changeId);
    const spec = await fs.readFile(path.join(dir, 'spec.md'), 'utf8');
    for (const section of sections) expect(spec).toContain(section.trim());
    expect(parseDeltaSpec(spec).entries).toHaveLength(1);
    const updated = parseYaml(await fs.readFile(path.join(dir, 'metadata.yaml'), 'utf8'));
    expect(updated.gates.analyze.satisfied).toBe(true);
    for (const key of ['design', 'plan', 'implement', 'verify', 'archive']) expect(updated.gates[key].satisfied).toBe(false);
    expect(updated.approvals.design).toMatchObject({ status: 'revoked', revision: 2, content_hash: '', approved_at: null });
    expect(updated.approvals.plan).toMatchObject({ status: 'revoked', revision: 2, content_hash: '', approved_at: null });
    expect(updated.approvals).not.toHaveProperty('analyze');
  });

  it('marks only a Requirement-overlapping Change stale after archive', async () => {
    const fixture = await createWorkflowFixture(); cleanups.push(fixture.cleanup);
    const metadata = fixture.metadataAt('VERIFY');
    metadata.modules.confirmed = [{ module: 'MOD-002', outcome: 'OWNED', reason: 'payment' }];
    metadata.requirements.modified = [{ id: 'MOD-002-REQ-006', module: 'MOD-002' }];
    const dir = path.join(fixture.paths.changes, fixture.changeId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'metadata.yaml'), stringifyYaml(metadata));
    expect(await detectStaleChanges(fixture.workspace, ['MOD-002-REQ-006'])).toEqual([fixture.changeId]);
  });

  it('increments revision and returns a stale Change to DESIGN after semantic rebase', async () => {
    const fixture = await createWorkflowFixture(); cleanups.push(fixture.cleanup);
    const metadata = fixture.metadataAt('VERIFY');
    metadata.change.revision = 1; metadata.baseline.stale = true;
    metadata.modules.confirmed = [{ module: 'MOD-002', outcome: 'OWNED', reason: 'payment' }];
    metadata.requirements.modified = [{ id: 'MOD-002-REQ-006', module: 'MOD-002' }];
    const dir = path.join(fixture.paths.changes, fixture.changeId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'proposal.md'), '# Proposal\nsummary goals scope\n');
    await fs.writeFile(path.join(dir, 'design.md'), '# Design\nMOD-002-REQ-006\n');
    await fs.writeFile(path.join(dir, 'tasks.md'), '# Tasks\n- [x] SP-01 MOD-002-REQ-006 SCN-002 test\n');
    await fs.writeFile(path.join(dir, 'verification.md'), '# Verification\n');
    await fs.writeFile(path.join(dir, 'spec.md'), '## MODIFIED\n### MOD-002-REQ-006 payment\n**Previous**\nOld\n#### Scenario: SCN-001 old\n- **GIVEN** old\n- **WHEN** pay\n- **THEN** old\n- **ERROR** old-error\n**New**\nNew\n#### Scenario: SCN-002 new\n- **GIVEN** new\n- **WHEN** pay\n- **THEN** new\n- **ERROR** new-error-one\n- **ERROR** new-error-two\n**Reason**\nchange\n');
    await fs.writeFile(path.join(dir, 'metadata.yaml'), stringifyYaml(metadata));
    await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
    await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), '### MOD-002-REQ-006 payment\nOld\n');
    await fs.mkdir(`${fixture.paths.changeIndex}.lock`);
    await expect(rebaseChange(fixture.workspace, fixture.changeId, fixture.latestSpecs)).rejects.toThrow(/Change 索引正忙/);
    await fs.rm(`${fixture.paths.changeIndex}.lock`, { recursive: true, force: true });
    const result = await rebaseChange(fixture.workspace, fixture.changeId, fixture.latestSpecs);
    expect(result.change.revision).toBe(2);
    expect(result.change.status).toBe('DESIGN');
    expect(result.baseline.stale).toBe(false);
  });

  it('does not stale an unrelated active Change and captures hashes', async () => {
    const fixture = await createWorkflowFixture(); cleanups.push(fixture.cleanup);
    const metadata = fixture.metadataAt('VERIFY'); metadata.modules.confirmed = [{ module: 'MOD-002', outcome: 'OWNED', reason: 'x' }];
    metadata.requirements.modified = [{ id: 'MOD-002-REQ-006', module: 'MOD-002' }];
    await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true }); await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), '### MOD-002-REQ-006\nA');
    const baseline = await captureBaseline(fixture.workspace, metadata);
    expect(baseline.modules['MOD-002'].spec_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(baseline.modules['MOD-002'].requirements['MOD-002-REQ-006']).toMatch(/^[a-f0-9]{64}$/);
    await fs.mkdir(path.join(fixture.paths.changes, fixture.changeId), { recursive: true });
    await fs.writeFile(path.join(fixture.paths.changes, fixture.changeId, 'metadata.yaml'), stringifyYaml(metadata));
    const other = fixture.metadataAt('VERIFY'); other.change.id = 'CHG-20260901-002'; other.requirements.modified = [{ id: 'MOD-001-REQ-001', module: 'MOD-001' }];
    await fs.mkdir(path.join(fixture.paths.changes, other.change.id), { recursive: true }); await fs.writeFile(path.join(fixture.paths.changes, other.change.id, 'metadata.yaml'), stringifyYaml(other));
    expect(await detectStaleChanges(fixture.workspace, ['MOD-002-REQ-006'])).toEqual([fixture.changeId]);
  });

  it('writes merged content and hashes that authored content', async () => {
    const fixture = await createWorkflowFixture(); cleanups.push(fixture.cleanup);
    const metadata = fixture.metadataAt('VERIFY'); metadata.baseline.stale = true;
    metadata.modules.confirmed = [{ module: 'MOD-002', outcome: 'OWNED', reason: 'x' }];
    metadata.requirements.modified = [{ id: 'MOD-002-REQ-006', module: 'MOD-002' }];
    const dir = path.join(fixture.paths.changes, fixture.changeId); await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'metadata.yaml'), stringifyYaml(metadata));
    await Promise.all(['proposal.md', 'design.md', 'tasks.md', 'verification.md'].map((name) => fs.writeFile(path.join(dir, name), '# artifact\n')));
    await fs.writeFile(path.join(dir, 'spec.md'), '## MODIFIED\n### MOD-002-REQ-006 payment\n**Previous**\nOld\n#### Scenario: SCN-001 old\n- **GIVEN** old\n- **WHEN** pay\n- **THEN** old\n- **ERROR** old-error\n**New**\nNew\n#### Scenario: SCN-002 new\n- **GIVEN** new\n- **WHEN** pay\n- **THEN** new\n- **ERROR** new-error-one\n- **ERROR** new-error-two\n**Reason**\nchange\n');
    await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
    await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), '### MOD-002-REQ-006\nCurrent\n');
    const result = await rebaseChange(fixture.workspace, fixture.changeId, ['### MOD-002-REQ-006\nMerged\n']);
    const merged = await fs.readFile(path.join(dir, 'spec.md'), 'utf8');
    expect(merged).toContain('Merged');
    expect(merged).toMatch(/- \*\*ERROR\*\* new-error-one\n- \*\*ERROR\*\* new-error-two/);
    expect(result.baseline.modules['MOD-002'].spec_hash).toBe(createHash('sha256').update('### MOD-002-REQ-006\nMerged\n').digest('hex'));
    expect(result.baseline.modules['MOD-002'].requirements['MOD-002-REQ-006']).toBe(createHash('sha256').update('### MOD-002-REQ-006\nMerged').digest('hex'));
  });
});
