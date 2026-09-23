import * as fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  approvalContentHash,
  approveChangeStage,
  approveStage,
  assertTransitionApproval,
  createPendingApprovals,
  classifyArtifactChange,
  isApprovalCurrent,
} from '../../../src/core/codespec-workflow/approvals.js';
import type { ChangeArtifacts } from '../../../src/core/codespec-workflow/artifacts.js';
import { loadChangeArtifacts } from '../../../src/core/codespec-workflow/artifacts.js';
import { loadWorkspace } from '../../../src/core/codespec-workflow/loaders.js';
import { parseChangeMetadata } from '../../../src/core/codespec-workflow/schemas.js';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { createWorkflowFixture, writeChangeArtifacts } from '../../helpers/codespec-workflow.js';
import { richDelta } from '../../helpers/rich-requirement.js';
import { snapshotDirectory } from '../../helpers/fs-snapshot.js';
import { transitionChange } from '../../../src/core/codespec-workflow/state-machine.js';
import { createCurrentArchiveFixture } from '../../helpers/current-archive.js';
import { createCanonicalChange } from '../../../src/core/codespec-workflow/change-manager.js';
import { allocateRequirementIds } from '../../../src/core/codespec-workflow/requirement-allocator.js';

vi.mock('node:fs/promises', async (importOriginal) => ({ ...await importOriginal<typeof fs>() }));
afterEach(() => vi.restoreAllMocks());

async function pendingAnalysis() {
  const fixture = await createCurrentArchiveFixture();
  const workspace = await loadWorkspace(fixture.codespecDir);
  const created = await createCanonicalChange(workspace, { title: 'Approve current analysis', summary: 'Clarify the requested behavior', mode: 'feature' });
  const analysis = analysisDocument({ change: created.changeId,
    modules: [{ module: 'MOD-002', outcome: 'OWNED', reason: 'Owns the requested behavior' }],
    requirements: [{ id: 'MOD-002-REQ-001', action: 'MODIFIED', reason: 'Extend behavior' }],
    acceptanceCriteria: [{ id: 'AC-001', statement: 'Requested behavior is supported', priority: 'MUST', requirements: ['MOD-002-REQ-001'] }],
  });
  await fs.writeFile(path.join(created.changeDir, 'analysis.yaml'), stringifyYaml(analysis));
  return { ...fixture, workspace, ...created, artifacts: await loadChangeArtifacts(fixture.paths, created.changeId) };
}

describe('approval transaction ownership', () => {
  it('approves analysis for a registered module before its first archive without creating Current files', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const workspace = await loadWorkspace(fixture.codespecDir);
      const created = await createCanonicalChange(workspace, { title: 'First module feature', summary: 'Add the first accepted behavior', mode: 'feature' });
      const moduleDirectory = path.join(fixture.paths.currentSpecs, 'MOD-001');
      await fs.rm(moduleDirectory, { recursive: true });
      const [requirementId] = await allocateRequirementIds(workspace, created.changeId, 'MOD-001', 1);
      const analysis = analysisDocument({
        change: created.changeId,
        modules: [{ module: 'MOD-001', outcome: 'OWNED', reason: 'Owns the first behavior' }],
        requirements: [{ id: requirementId, action: 'ADDED', reason: 'Add the first behavior' }],
        acceptanceCriteria: [{ id: 'AC-001', statement: 'First behavior is supported', priority: 'MUST', requirements: [requirementId] }],
      });
      await fs.writeFile(path.join(created.changeDir, 'analysis.yaml'), stringifyYaml(analysis));

      const approved = await approveChangeStage(workspace, await loadChangeArtifacts(fixture.paths, created.changeId), 'analyze');
      expect(approved.approvals.analyze.status).toBe('approved');
      expect(approved.requirements.added).toEqual([{ id: requirementId, module: 'MOD-001' }]);
      await expect(fs.access(moduleDirectory)).rejects.toThrow();
    } finally { fixture.cleanup(); }
  });

  it('rejects an unreserved ADDED Requirement before publishing the derived projection', async () => {
    const f = await pendingAnalysis();
    try {
      const analysis = parseYaml(f.artifacts.analysis!);
      analysis.requirements = [{ id: 'MOD-002-REQ-999', action: 'ADDED', reason: 'new behavior' }];
      analysis.acceptanceCriteria[0].requirements = ['MOD-002-REQ-999'];
      await fs.writeFile(path.join(f.changeDir, 'analysis.yaml'), stringifyYaml(analysis));
      const before = await fs.readFile(f.metadataPath, 'utf8');
      await expect(approveChangeStage(f.workspace, await loadChangeArtifacts(f.paths, f.changeId), 'analyze')).rejects.toThrow(/MOD-002-REQ-999.*reserv|reserv.*MOD-002-REQ-999/i);
      expect(await fs.readFile(f.metadataPath, 'utf8')).toBe(before);
    } finally { f.cleanup(); }
  });

  it('approves sequential ADDED IDs reserved by this Change', async () => {
    const f = await pendingAnalysis();
    try {
      const ids = await allocateRequirementIds(f.workspace, f.changeId, 'MOD-002', 2);
      expect(ids).toEqual(['MOD-002-REQ-003', 'MOD-002-REQ-004']);
      const analysis = parseYaml(f.artifacts.analysis!);
      analysis.requirements = ids.map((id) => ({ id, action: 'ADDED', reason: 'new behavior' }));
      analysis.acceptanceCriteria[0].requirements = ids;
      await fs.writeFile(path.join(f.changeDir, 'analysis.yaml'), stringifyYaml(analysis));
      const approved = await approveChangeStage(f.workspace, await loadChangeArtifacts(f.paths, f.changeId), 'analyze');
      expect(approved.approvals.analyze.status).toBe('approved');
      expect(approved.requirements.added.map(({ id }) => id)).toEqual(ids);
    } finally { f.cleanup(); }
  });

  it('rejects an ADDED ID reserved by another active Change', async () => {
    const f = await pendingAnalysis();
    try {
      const other = await createCanonicalChange(f.workspace, { title: 'Other author', summary: 'Own new behavior', mode: 'feature' });
      const [id] = await allocateRequirementIds(f.workspace, other.changeId, 'MOD-002', 1);
      const analysis = parseYaml(f.artifacts.analysis!);
      analysis.requirements = [{ id, action: 'ADDED', reason: 'claim another author ID' }];
      analysis.acceptanceCriteria[0].requirements = [id];
      await fs.writeFile(path.join(f.changeDir, 'analysis.yaml'), stringifyYaml(analysis));
      const before = await fs.readFile(f.metadataPath, 'utf8');
      await expect(approveChangeStage(f.workspace, await loadChangeArtifacts(f.paths, f.changeId), 'analyze')).rejects.toThrow(/reserved exclusively/);
      expect(await fs.readFile(f.metadataPath, 'utf8')).toBe(before);
    } finally { f.cleanup(); }
  });

  it.each(['analysis.yaml', 'design.md', 'spec.md', 'tasks.yaml', 'verification.yaml'])('rejects a caller with stale %s before publishing any approval', async (name) => {
    const f = await pendingAnalysis();
    try {
      const file = path.join(f.changeDir, name);
      const author = `${await fs.readFile(file, 'utf8')}\n# Author update\n`;
      await fs.writeFile(file, author);
      const metadata = await fs.readFile(f.metadataPath, 'utf8');
      const index = await fs.readFile(f.paths.changeIndex, 'utf8');
      await expect(approveChangeStage(f.workspace, f.artifacts, 'analyze')).rejects.toThrow(/stale|conflict/i);
      expect(await fs.readFile(f.metadataPath, 'utf8')).toBe(metadata);
      expect(await fs.readFile(f.paths.changeIndex, 'utf8')).toBe(index);
      expect(await fs.readFile(file, 'utf8')).toBe(author);
    } finally { f.cleanup(); }
  });

  it('rejects a stale caller after another approval and real transition without splitting metadata from the index', async () => {
    const f = await pendingAnalysis();
    try {
      await approveChangeStage(f.workspace, f.artifacts, 'analyze');
      await transitionChange(f.workspace, await loadChangeArtifacts(f.paths, f.changeId), 'DESIGN', 'Analysis approved');
      const metadata = await fs.readFile(f.metadataPath, 'utf8');
      const index = await fs.readFile(f.paths.changeIndex, 'utf8');
      await expect(approveChangeStage(f.workspace, f.artifacts, 'analyze')).rejects.toThrow(/stale|changed|冲突|ANALYZE/i);
      expect(await fs.readFile(f.metadataPath, 'utf8')).toBe(metadata);
      expect(await fs.readFile(f.paths.changeIndex, 'utf8')).toBe(index);
      expect(parseYaml(metadata).change.status).toBe('DESIGN');
      expect(parseYaml(index).changes[0].status).toBe('DESIGN');
    } finally { f.cleanup(); }
  });

  it('serializes competing pending approvals and rejects the stale snapshot', async () => {
    const f = await pendingAnalysis();
    try {
      const results = await Promise.allSettled([approveChangeStage(f.workspace, f.artifacts, 'analyze'), approveChangeStage(f.workspace, f.artifacts, 'analyze')]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      const saved = await loadChangeArtifacts(f.paths, f.changeId);
      expect(isApprovalCurrent('analyze', saved)).toBe(true);
      expect(saved.metadata.requirements.modified).toEqual([{ id: 'MOD-002-REQ-001', module: 'MOD-002' }]);
      expect(parseYaml(await fs.readFile(f.paths.changeIndex, 'utf8')).changes[0].status).toBe(saved.metadata.change.status);
    } finally { f.cleanup(); }
  });

  it('preserves an author metadata save at the install boundary and reports a recovery conflict', async () => {
    const f = await pendingAnalysis();
    try {
      const author = stringifyYaml({ ...f.artifacts.metadata, change: { ...f.artifacts.metadata.change, title: 'Author saved during approval' } });
      const index = await fs.readFile(f.paths.changeIndex, 'utf8');
      const rename = fs.rename;
      let injected = false;
      vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
        if (!injected && (from === f.metadataPath || to === f.metadataPath)) { injected = true; await fs.writeFile(f.metadataPath, author); }
        return rename(from, to);
      });
      await expect(approveChangeStage(f.workspace, f.artifacts, 'analyze')).rejects.toThrow(/conflict|冲突|ownership/i);
      expect(injected).toBe(true);
      expect(await fs.readFile(f.metadataPath, 'utf8')).toBe(author);
      expect(await fs.readFile(f.paths.changeIndex, 'utf8')).toBe(index);
    } finally { f.cleanup(); }
  });

  it('retains the old metadata inode after success for late writes through an already-open author handle', async () => {
    const f = await pendingAnalysis();
    const handle = await fs.open(f.metadataPath, 'r+');
    try {
      await approveChangeStage(f.workspace, f.artifacts, 'analyze');
      const saved = await fs.readFile(f.metadataPath, 'utf8');
      const author = 'late author bytes after approval\n';
      await handle.truncate(0);
      await handle.write(author, 0, 'utf8');
      const escrow = path.join(f.paths.transactions, '.recovery-escrow');
      const transactions = await fs.readdir(escrow);
      expect(transactions).toHaveLength(1);
      const root = path.join(escrow, transactions[0]);
      const manifest = parseYaml(await fs.readFile(path.join(root, 'manifest.yaml'), 'utf8'));
      expect(manifest).toMatchObject({ outcome: 'committed', cleanupPolicy: 'manual-only' });
      const retained = manifest.retained.find((entry: { target: string; phase: string }) => entry.target.endsWith('/metadata.yaml') && entry.phase === 'installation');
      expect(await fs.readFile(path.join(root, retained.file), 'utf8')).toBe(author);
      expect(await fs.readFile(f.metadataPath, 'utf8')).toBe(saved);
      expect((await fs.readdir(f.paths.transactions)).filter((name) => !name.startsWith('.'))).toEqual([]);
    } finally { await handle.close(); f.cleanup(); }
  });

  it('does not replace an author file recreated after metadata displacement', async () => {
    const f = await pendingAnalysis();
    try {
      const author = stringifyYaml({ ...f.artifacts.metadata, change: { ...f.artifacts.metadata.change, title: 'New author inode' } });
      const rename = fs.rename;
      let injected = false;
      vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
        await rename(from, to);
        if (!injected && from === f.metadataPath) { injected = true; await fs.writeFile(f.metadataPath, author); }
      });
      await expect(approveChangeStage(f.workspace, f.artifacts, 'analyze')).rejects.toThrow(/rollback conflict|ownership/i);
      expect(injected).toBe(true);
      expect(await fs.readFile(f.metadataPath, 'utf8')).toBe(author);
      expect((await fs.readdir(f.paths.transactions)).filter((name) => !name.startsWith('.'))).toHaveLength(1);
      const escrow = path.join(f.paths.transactions, '.recovery-escrow');
      expect(await fs.readdir(escrow)).toHaveLength(1);
    } finally { f.cleanup(); }
  });

  it('rolls back projected fields and the receipt together when the commit marker cannot be persisted', async () => {
    const f = await pendingAnalysis();
    try {
      const metadata = await fs.readFile(f.metadataPath, 'utf8');
      const index = await fs.readFile(f.paths.changeIndex, 'utf8');
      const open = fs.open;
      vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
        if (path.basename(String(args[0])) === 'COMMITTED') throw new Error('injected approval commit failure');
        return open(...args);
      });
      await expect(approveChangeStage(f.workspace, f.artifacts, 'analyze')).rejects.toThrow(/injected approval commit failure/);
      expect(await fs.readFile(f.metadataPath, 'utf8')).toBe(metadata);
      expect(await fs.readFile(f.paths.changeIndex, 'utf8')).toBe(index);
      expect((await fs.readdir(f.paths.transactions)).filter((name) => !name.startsWith('.'))).toEqual([]);
    } finally { f.cleanup(); }
  });

  it.each(['analysis', 'Current'])('rolls back the receipt and baseline when %s changes while metadata is being published', async (input) => {
    const f = await pendingAnalysis();
    try {
      const metadata = await fs.readFile(f.metadataPath, 'utf8');
      const analysisPath = input === 'analysis' ? path.join(f.changeDir, 'analysis.yaml') : path.join(f.paths.currentSpecs, 'MOD-002', 'spec.md');
      const author = `${await fs.readFile(analysisPath, 'utf8')}\n<!-- concurrent author change -->\n`;
      const link = fs.link;
      let injected = false;
      vi.spyOn(fs, 'link').mockImplementation(async (from, to) => {
        await link(from, to);
        if (!injected && to === f.metadataPath) { injected = true; await fs.writeFile(analysisPath, author); }
      });
      await expect(approveChangeStage(f.workspace, f.artifacts, 'analyze')).rejects.toThrow(/input changed.*(?:analysis.yaml|spec.md)/);
      expect(injected).toBe(true);
      expect(await fs.readFile(f.metadataPath, 'utf8')).toBe(metadata);
      expect(await fs.readFile(analysisPath, 'utf8')).toBe(author);
      expect((await fs.readdir(f.paths.transactions)).filter((name) => !name.startsWith('.'))).toEqual([]);
    } finally { f.cleanup(); }
  });
});

function artifactsFor(
  status: 'ANALYZE' | 'DESIGN' | 'PLAN',
  overrides: Partial<Pick<ChangeArtifacts, 'analysis' | 'design' | 'spec' | 'tasks'>> = {}
): ChangeArtifacts {
  return {
    changeId: 'CHG-20260901-001',
    changeDir: '/tmp/codespec/changes/CHG-20260901-001',
    metadata: {
      schema_version: 1,
      change: {
        id: 'CHG-20260901-001', revision: 1, title: 'Approval gate', mode: 'feature', sdd_level: 2, status,
        created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
      },
      impact: { summary: 'Require explicit approval', mode: 'feature', scope: 'single-module', affected_areas: [] },
      baseline: { created_at: null, current_fingerprint: '0000000000000000000000000000000000000000000000000000000000000000', stale: false, modules: {} },
      gates: {
        analyze: { required: true, satisfied: true }, design: { required: true, satisfied: true },
        plan: { required: true, satisfied: true }, implement: { required: true, satisfied: true },
        verify: { required: true, satisfied: false }, archive: { required: true, satisfied: false },
      },
      approvals: {
        schema_version: 1,
        analyze: { status: 'pending', revision: 1, content_hash: '', approved_at: null },
        design: { status: 'pending', revision: 1, content_hash: '', approved_at: null },
        plan: { status: 'pending', revision: 1, content_hash: '', approved_at: null },
      },
      modules: { candidates: [], confirmed: [], dependencies: [] },
      requirements: { added: [], modified: [], removed: [] },
      artifacts: {
        analysis: 'changes/CHG-20260901-001/analysis.yaml', metadata: 'changes/CHG-20260901-001/metadata.yaml',
        design: 'changes/CHG-20260901-001/design.md', spec: 'changes/CHG-20260901-001/spec.md',
        tasks: 'changes/CHG-20260901-001/tasks.yaml', verification: 'changes/CHG-20260901-001/verification.yaml',
      },
      tasks: { total: 1, completed: 0, items: { 'SP-01': { title: 'Implement approval gate', status: 'TODO' } } },
      verification: { requirements_verified: false, tests_passed: false, build_passed: false, lint_passed: false, verified_at: null },
      archive: { ready: false, conflict: false },
    },
    analysis: stringifyYaml(analysisDocument()),
    design: '# Design\n\nApproved design',
    spec: '## ADDED\n\nRequirement',
    tasks: 'version: 1\nchangeRevision: 1\ntasks: []\nmoduleDeltas: []\nmoduleRegistrations: { upsert: [], retire: [] }\n',
    verification: 'version: 1\nchangeRevision: 1\ntestCases: []\n',
    ...overrides,
  };
}

function analysisDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    change: 'CHG-20260901-001',
    revision: 1,
    problem: 'Display a useful payment failure reason',
    goals: [{ id: 'GOAL-001', statement: 'Users understand payment failures' }],
    nonGoals: [{ id: 'NON-GOAL-001', statement: 'Do not add payment methods' }],
    scope: { in: ['payment failure feedback'], out: ['new payment channels'] },
    actors: ['customer'],
    constraints: [],
    assumptions: [],
    openQuestions: [],
    acceptanceCriteria: [{ id: 'AC-001', statement: 'Failure reason is visible', priority: 'MUST', requirements: ['MOD-001-REQ-001'] }],
    modules: [{ module: 'MOD-001', outcome: 'OWNED', reason: 'Orders own the customer feedback' }],
    requirements: [{ id: 'MOD-001-REQ-001', action: 'ADDED', reason: 'Add payment failure feedback' }],
    ...overrides,
  };
}

it('requires approval status, matching revision and semantic hash before carrying authority', () => {
  const artifacts = canonicalArtifacts();
  expect(isApprovalCurrent('analyze', artifacts)).toBe(false);
  artifacts.metadata = approveStage(artifacts, 'analyze');
  expect(isApprovalCurrent('analyze', artifacts)).toBe(true);
  artifacts.metadata.change.revision = 2;
  expect(isApprovalCurrent('analyze', artifacts)).toBe(false);
  artifacts.metadata.change.revision = 1;
  artifacts.analysis = artifacts.analysis!.replace('Display a useful payment failure reason', 'Different intent');
  expect(isApprovalCurrent('analyze', artifacts)).toBe(false);
});

function canonicalArtifacts(
  status: 'ANALYZE' | 'DESIGN' | 'PLAN' = 'ANALYZE',
  analysis = analysisDocument(),
): ChangeArtifacts {
  const artifacts = artifactsFor(status, {
    spec: richDelta().replaceAll('MOD-002', 'MOD-001').replaceAll('REQ-006', 'REQ-001'),
    tasks: [
      'version: 1',
      'changeRevision: 1',
      'tasks: []',
      'moduleDeltas: []',
      'moduleRegistrations:',
      '  upsert: []',
      '  retire: []',
      '',
    ].join('\n'),
  });
  artifacts.analysis = stringifyYaml(analysis);
  artifacts.metadata.artifacts = {
    ...artifacts.metadata.artifacts,
    analysis: 'changes/CHG-20260901-001/analysis.yaml',
    tasks: 'changes/CHG-20260901-001/tasks.yaml',
    verification: 'changes/CHG-20260901-001/verification.yaml',
  };
  return artifacts;
}

describe('workflow approvals', () => {
  it('creates and requires all three pending approval receipts', () => {
    expect(createPendingApprovals(3)).toEqual({
      schema_version: 1,
      analyze: { status: 'pending', revision: 3, content_hash: '', approved_at: null },
      design: { status: 'pending', revision: 3, content_hash: '', approved_at: null },
      plan: { status: 'pending', revision: 3, content_hash: '', approved_at: null },
    });

    const metadata = artifactsFor('DESIGN').metadata;
    const { analyze: _analyze, ...twoReceipts } = metadata.approvals;
    expect(() => parseChangeMetadata({ ...metadata, approvals: twoReceipts })).toThrow(/analyze/i);
  });

  it('hashes canonical analyze approval by semantic analysis rather than YAML layout', () => {
    const original = canonicalArtifacts();
    const reformatted = canonicalArtifacts('ANALYZE', {
      ...analysisDocument(),
      actors: ['customer'],
      goals: [{ statement: 'Users understand payment failures', id: 'GOAL-001' }],
    });

    expect(approvalContentHash('analyze', original)).toBe(approvalContentHash('analyze', reformatted));
  });

  it('invalidates all three canonical approval payloads when analysis semantics change', () => {
    const original = canonicalArtifacts();
    const changed = canonicalArtifacts('ANALYZE', analysisDocument({ problem: 'Display a localized payment failure reason' }));

    for (const stage of ['analyze', 'design', 'plan'] as const) {
      expect(approvalContentHash(stage, changed)).not.toBe(approvalContentHash(stage, original));
    }
  });

  it('invalidates design and plan payloads, but not analyze, when design or delta semantics change', () => {
    const original = canonicalArtifacts();
    const changed = { ...canonicalArtifacts(), design: '# Design\n\nA different error-mapping strategy', spec: original.spec.replace('THEN 用户出现在列表', 'THEN 显示支付失败原因') };

    expect(approvalContentHash('analyze', changed)).toBe(approvalContentHash('analyze', original));
    expect(approvalContentHash('design', changed)).not.toBe(approvalContentHash('design', original));
    expect(approvalContentHash('plan', changed)).not.toBe(approvalContentHash('plan', original));
  });

  it('keeps plan approval valid for task status changes but invalidates it for task definition changes', () => {
    const original = canonicalArtifacts('PLAN');
    const statusOnly = { ...original, tasks: original.tasks.replace('tasks: []', [
      'tasks:',
      '  - id: CHG-20260901-001-TASK-01',
      '    title: Add payment failure feedback',
      '    status: PENDING',
      '    acceptanceCriteria: [AC-001]',
      '    requirements: [MOD-001-REQ-001]',
      '    scenarios: [MOD-001-REQ-001-SCN-001]',
      '    testCases: [MOD-001-REQ-001-SCN-001-TC-UI-01]',
      '    plannedFiles: [src/payment-feedback.ts]',
      '    verificationPlan:',
      '      - testCase: MOD-001-REQ-001-SCN-001-TC-UI-01',
      '        runner: vitest',
      '        command: pnpm vitest run',
      '        profile: test',
      '        services: []',
      '        prepare: pnpm install',
      '        cleanup: pnpm cleanup',
    ].join('\n')) };
    const executionUpdate = { ...statusOnly, tasks: statusOnly.tasks.replace('status: PENDING', 'status: IN_PROGRESS') };
    const definitionUpdate = { ...statusOnly, tasks: statusOnly.tasks.replace('title: Add payment failure feedback', 'title: Add localized payment failure feedback') };

    expect(approvalContentHash('plan', executionUpdate)).toBe(approvalContentHash('plan', statusOnly));
    expect(approvalContentHash('plan', definitionUpdate)).not.toBe(approvalContentHash('plan', statusOnly));
  });

  it('blocks canonical ANALYZE to DESIGN without a current analyze receipt', () => {
    const artifacts = canonicalArtifacts('ANALYZE');
    expect(() => assertTransitionApproval(artifacts, 'DESIGN')).toThrow(/分析.*确认/i);

    const approved = { ...artifacts, metadata: approveStage(artifacts, 'analyze', '2026-09-07T00:00:00.000Z') };
    expect(() => assertTransitionApproval({
      ...approved,
      analysis: stringifyYaml(analysisDocument({ problem: 'Changed analysis decision' })),
    }, 'DESIGN')).toThrow(/分析.*变更|重新确认/i);
  });

  it('records analyze approval only from ANALYZE after the canonical analysis gate passes', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const analysis = analysisDocument();
      const changeDir = path.join(fixture.paths.changes, fixture.changeId);
      await writeChangeArtifacts(fixture, {
        metadata: {
          artifacts: {
            analysis: path.join('changes', fixture.changeId, 'analysis.yaml'),
            tasks: path.join('changes', fixture.changeId, 'tasks.yaml'),
            verification: path.join('changes', fixture.changeId, 'verification.yaml'),
          },
          modules: { candidates: [], confirmed: [], dependencies: [] },
          requirements: { added: [], modified: [], removed: [] },
        } as never,
      });
      await fs.writeFile(path.join(changeDir, 'analysis.yaml'), stringifyYaml(analysis));
      await fs.writeFile(path.join(changeDir, 'tasks.yaml'), 'version: 1\nchangeRevision: 1\ntasks: []\nmoduleDeltas: []\nmoduleRegistrations: { upsert: [], retire: [] }\n');
      await fs.writeFile(path.join(changeDir, 'verification.yaml'), 'version: 1\nchangeRevision: 1\ntestCases: []\n');
      const workspace = await loadWorkspace(fixture.codespecDir);
      await allocateRequirementIds(workspace, fixture.changeId as `CHG-${string}`, 'MOD-001', 1);
      const artifacts = await loadChangeArtifacts(workspace.paths, fixture.changeId);

      await expect(approveChangeStage(workspace, {
        ...artifacts,
        metadata: { ...artifacts.metadata, change: { ...artifacts.metadata.change, status: 'DESIGN' } },
      }, 'analyze')).rejects.toThrow(/只能在 ANALYZE/i);
      await fs.writeFile(path.join(changeDir, 'analysis.yaml'), stringifyYaml({ ...analysis, openQuestions: [{ id: 'QUESTION-001', question: 'Unresolved scope?', status: 'OPEN' }] }));
      const before = snapshotDirectory(changeDir);
      const originalIndex = await fs.readFile(fixture.paths.changeIndex, 'utf8');
      await expect(approveChangeStage(workspace, await loadChangeArtifacts(workspace.paths, fixture.changeId), 'analyze')).rejects.toThrow(/OPEN|openQuestions/);
      expect(snapshotDirectory(changeDir)).toEqual(before);
      expect(await fs.readFile(fixture.paths.changeIndex, 'utf8')).toBe(originalIndex);
      await fs.writeFile(path.join(changeDir, 'analysis.yaml'), artifacts.analysis!);
      await expect(approveChangeStage(workspace, artifacts, 'analyze')).resolves.toMatchObject({
        modules: { candidates: analysis.modules, confirmed: analysis.modules, dependencies: [] },
        requirements: { added: [{ id: 'MOD-001-REQ-001', module: 'MOD-001' }], modified: [], removed: [] },
        approvals: { analyze: { status: 'approved', revision: 1, content_hash: expect.stringMatching(/^[a-f0-9]{64}$/) } },
      });
      const persisted = parseYaml(await fs.readFile(path.join(changeDir, 'metadata.yaml'), 'utf8')) as {
        approvals: Record<string, unknown>;
      };
      expect(persisted.approvals.analyze).toMatchObject({ status: 'approved' });
      const approved = await loadChangeArtifacts(workspace.paths, fixture.changeId);
      approved.metadata.modules.confirmed = [];
      await fs.writeFile(path.join(changeDir, 'metadata.yaml'), stringifyYaml(approved.metadata));
      const tampered = await loadChangeArtifacts(workspace.paths, fixture.changeId);
      const afterTampering = snapshotDirectory(changeDir);
      await expect(transitionChange(workspace, tampered, 'DESIGN', 'Approved analysis')).rejects.toThrow(/metadata.modules/);
      await expect(approveChangeStage(workspace, tampered, 'analyze')).rejects.toThrow(/metadata.modules/);
      expect(snapshotDirectory(changeDir)).toEqual(afterTampering);
      expect(await fs.readFile(fixture.paths.changeIndex, 'utf8')).toBe(originalIndex);
    } finally {
      fixture.cleanup();
    }
  });

  it('classifies semantic task-plan changes separately from locator-only changes', () => {
    const before = {
      design: '# 设计\n',
      spec: richDelta().replaceAll('REQ-006', 'REQ-001'),
      tasks: [
        'version: 1', 'changeRevision: 1', 'tasks:', '  - id: CHG-20260901-001-TASK-01', '    title: 新增用户页面', '    status: PENDING', '    acceptanceCriteria: [AC-001]',
        '    requirements: [MOD-002-REQ-001]', '    scenarios: [MOD-002-REQ-001-SCN-001]', '    testCases: [MOD-002-REQ-001-SCN-001-TC-UI-01]',
        '    plannedFiles: [src/pages/Users.tsx]', '    verificationPlan:', '      - testCase: MOD-002-REQ-001-SCN-001-TC-UI-01', '        runner: playwright', '        command: pnpm playwright test', '        profile: test', '        services: [user-service]', '        prepare: pnpm dev:test', '        cleanup: pnpm dev:test:stop',
        'moduleDeltas: []', 'moduleRegistrations: { upsert: [], retire: [] }', '',
      ].join('\n'),
      verification: 'version: 1\nchangeRevision: 1\ntestCases: []\n',
    };

    expect(classifyArtifactChange(before, {
      ...before,
      tasks: before.tasks.replace('src/pages/Users.tsx]', 'src/pages/Users.tsx, src/components/UserForm.tsx]'),
    })).toMatchObject({ designChanged: false, planChanged: true, locatorOnly: false });
    expect(classifyArtifactChange(before, {
      ...before,
      spec: before.spec.replace('e2e/users.spec.ts', 'e2e/user-management.spec.ts'),
    })).toMatchObject({ designChanged: false, planChanged: false, locatorOnly: true });
  });

  it('blocks DESIGN to PLAN when design approval is missing', () => {
    expect(() => assertTransitionApproval(artifactsFor('DESIGN'), 'PLAN'))
      .toThrow(/设计.*确认/i);
  });

  it('blocks PLAN to IMPLEMENT after the approved plan changes', () => {
    const planned = artifactsFor('PLAN');
    const approved = approveStage(planned, 'plan', '2026-09-07T00:00:00.000Z');
    const tasks = parseYaml(planned.tasks);
    tasks.tasks.push({
      id: 'CHG-20260901-001-TASK-01', title: 'Additional work', status: 'PENDING',
      acceptanceCriteria: ['AC-001'], requirements: ['MOD-001-REQ-001'],
      scenarios: ['MOD-001-REQ-001-SCN-001'], testCases: ['MOD-001-REQ-001-SCN-001-TC-UI-01'],
      plannedFiles: ['src/payment-feedback.ts'],
      verificationPlan: [{
        testCase: 'MOD-001-REQ-001-SCN-001-TC-UI-01', runner: 'vitest', command: 'pnpm vitest run',
        profile: 'test', services: [], prepare: 'pnpm install', cleanup: 'pnpm cleanup',
      }],
    });
    const changedPlan = {
      ...planned,
      metadata: approved,
      tasks: stringifyYaml(tasks),
    };

    expect(() => assertTransitionApproval(changedPlan, 'IMPLEMENT'))
      .toThrow(/计划.*确认|已变更|重新确认/i);
  });

  it('keeps a current-format task approval valid when only execution status changes', () => {
    const current = artifactsFor('PLAN', {
      design: '# 设计\n',
      spec: richDelta().replaceAll('REQ-006', 'REQ-001'),
      tasks: [
        'version: 1',
        'changeRevision: 1',
        'tasks:',
        '  - id: CHG-20260901-001-TASK-01',
        '    title: 新增用户页面',
        '    status: PENDING',
        '    acceptanceCriteria: [AC-001]',
        '    requirements: [MOD-002-REQ-001]',
        '    scenarios: [MOD-002-REQ-001-SCN-001]',
        '    testCases: [MOD-002-REQ-001-SCN-001-TC-UI-01]',
        '    plannedFiles: [src/pages/UserManagementPage.tsx]',
        '    verificationPlan:',
        '      - testCase: MOD-002-REQ-001-SCN-001-TC-UI-01',
        '        runner: playwright',
        '        command: pnpm playwright test',
        '        profile: test',
        '        services: [user-service]',
        '        prepare: pnpm dev:test',
        '        cleanup: pnpm dev:test:stop',
        'moduleDeltas: []',
        'moduleRegistrations: { upsert: [], retire: [] }',
        '',
      ].join('\n'),
    });
    current.metadata.artifacts = {
      ...current.metadata.artifacts,
      analysis: 'changes/CHG-20260901-001/analysis.yaml',
      tasks: 'changes/CHG-20260901-001/tasks.yaml',
      verification: 'changes/CHG-20260901-001/verification.yaml',
    };
    current.analysis = stringifyYaml(analysisDocument());

    const approved = approveStage(current, 'plan', '2026-09-07T00:00:00.000Z');
    expect(() => assertTransitionApproval({
      ...current,
      metadata: approved,
      tasks: current.tasks.replace('status: PENDING', 'status: IN_PROGRESS'),
    }, 'IMPLEMENT')).not.toThrow();
  });

  it('keeps a current-format task approval valid when only an automation locator changes', () => {
    const current = artifactsFor('PLAN', {
      design: '# 设计\n',
      spec: richDelta().replaceAll('REQ-006', 'REQ-001'),
      tasks: [
        'version: 1', 'changeRevision: 1', 'tasks:', '  - id: CHG-20260901-001-TASK-01', '    title: 新增用户页面', '    status: PENDING', '    acceptanceCriteria: [AC-001]',
        '    requirements: [MOD-002-REQ-001]', '    scenarios: [MOD-002-REQ-001-SCN-001]', '    testCases: [MOD-002-REQ-001-SCN-001-TC-UI-01]',
        '    plannedFiles: [src/pages/UserManagementPage.tsx]', '    verificationPlan:', '      - testCase: MOD-002-REQ-001-SCN-001-TC-UI-01', '        runner: playwright', '        command: pnpm playwright test', '        profile: test', '        services: [user-service]', '        prepare: pnpm dev:test', '        cleanup: pnpm dev:test:stop',
        'moduleDeltas: []', 'moduleRegistrations: { upsert: [], retire: [] }', '',
      ].join('\n'),
    });
    current.metadata.artifacts = { ...current.metadata.artifacts, analysis: 'changes/CHG-20260901-001/analysis.yaml', tasks: 'changes/CHG-20260901-001/tasks.yaml', verification: 'changes/CHG-20260901-001/verification.yaml' };
    current.analysis = stringifyYaml(analysisDocument());

    const approved = approveStage(current, 'plan', '2026-09-07T00:00:00.000Z');
    expect(() => assertTransitionApproval({
      ...current,
      metadata: approved,
      spec: current.spec.replace('data-testid=add-user', 'data-testid=create-user'),
    }, 'IMPLEMENT')).not.toThrow();
  });

  it('refuses to persist an approval before the current stage exit gate passes', async () => {
    const fixture = await createWorkflowFixture();
    try {
      await writeChangeArtifacts(fixture, { metadata: { change: { status: 'DESIGN' } } });
      const workspace = await loadWorkspace(fixture.codespecDir);
      const artifacts = await loadChangeArtifacts(workspace.paths, fixture.changeId);

      await expect(approveChangeStage(workspace, artifacts, 'design'))
        .rejects.toThrow(/门禁|SDD|模块/i);
    } finally {
      fixture.cleanup();
    }
  });
});
