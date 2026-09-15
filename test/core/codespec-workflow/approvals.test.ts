import * as fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

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

function artifactsFor(
  status: 'ANALYZE' | 'DESIGN' | 'PLAN',
  overrides: Partial<Pick<ChangeArtifacts, 'proposal' | 'design' | 'spec' | 'tasks'>> = {}
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
      baseline: { created_at: null, stale: false, modules: {} },
      relations: { depends_on: [], related_to: [], conflicts_with: [], supersedes: [] },
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
        metadata: 'changes/CHG-20260901-001/metadata.yaml', proposal: 'changes/CHG-20260901-001/proposal.md',
        design: 'changes/CHG-20260901-001/design.md', spec: 'changes/CHG-20260901-001/spec.md',
        tasks: 'changes/CHG-20260901-001/tasks.md', verification: 'changes/CHG-20260901-001/verification.md',
      },
      tasks: { total: 1, completed: 0, items: { 'SP-01': { title: 'Implement approval gate', status: 'TODO' } } },
      verification: { requirements_verified: false, tests_passed: false, build_passed: false, lint_passed: false, verified_at: null },
      archive: { ready: false, conflict: false, archived_at: null },
    },
    analysis: null,
    proposal: '# Proposal\n\nScope',
    design: '# Design\n\nApproved design',
    spec: '## ADDED\n\nRequirement',
    tasks: '# Tasks\n\n- [ ] SP-01 Implement approval gate',
    verification: '# Verification',
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
      'tasks: []',
      'moduleDeltas: []',
      'moduleRegistrations:',
      '  upsert: []',
      '  retire: []',
      '',
    ].join('\n'),
  });
  artifacts.analysis = stringifyYaml(analysis);
  artifacts.proposal = '';
  artifacts.metadata.artifacts = {
    ...artifacts.metadata.artifacts,
    analysis: 'changes/CHG-20260901-001/analysis.yaml',
    proposal: undefined,
    tasks: 'changes/CHG-20260901-001/tasks.yaml',
    verification: 'changes/CHG-20260901-001/verification.yaml',
  };
  return artifacts;
}

describe('workflow approvals', () => {
  it('creates three pending approval receipts and normalizes legacy two-receipt metadata in memory', () => {
    expect(createPendingApprovals(3)).toEqual({
      schema_version: 1,
      analyze: { status: 'pending', revision: 3, content_hash: '', approved_at: null },
      design: { status: 'pending', revision: 3, content_hash: '', approved_at: null },
      plan: { status: 'pending', revision: 3, content_hash: '', approved_at: null },
    });

    const legacy = artifactsFor('DESIGN').metadata;
    const parsed = parseChangeMetadata({
      ...legacy,
      approvals: {
        schema_version: 1,
        design: legacy.approvals.design,
        plan: legacy.approvals.plan,
      },
    });

    expect(parsed.approvals.analyze).toEqual({ status: 'pending', revision: 1, content_hash: '', approved_at: null });
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
      '    requirements: [MOD-001-REQ-001]',
      '    scenarios: [MOD-001-REQ-001-SCN-001]',
      '    testCases: [MOD-001-REQ-001-SCN-001-TC-UI-01]',
      '    plannedFiles: [src/payment-feedback.ts]',
      '    verificationPlan:',
      '      testCase: MOD-001-REQ-001-SCN-001-TC-UI-01',
      '      runner: vitest',
      '      command: pnpm vitest run',
      '      profile: test',
      '      services: []',
      '      prepare: pnpm install',
      '      cleanup: pnpm cleanup',
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
            proposal: undefined,
            tasks: path.join('changes', fixture.changeId, 'tasks.yaml'),
            verification: path.join('changes', fixture.changeId, 'verification.yaml'),
          },
          modules: {
            candidates: analysis.modules as never,
            confirmed: analysis.modules as never,
            dependencies: [],
          },
          requirements: {
            added: [{ id: 'MOD-001-REQ-001', module: 'MOD-001' }], modified: [], removed: [],
          },
        } as never,
      });
      await fs.writeFile(path.join(changeDir, 'analysis.yaml'), stringifyYaml(analysis));
      await fs.writeFile(path.join(changeDir, 'tasks.yaml'), 'version: 1\ntasks: []\nmoduleDeltas: []\nmoduleRegistrations: { upsert: [], retire: [] }\n');
      await fs.writeFile(path.join(changeDir, 'verification.yaml'), 'version: 1\ntestCases: []\n');
      const workspace = await loadWorkspace(fixture.codespecDir);
      const artifacts = await loadChangeArtifacts(workspace.paths, fixture.changeId);

      await expect(approveChangeStage(workspace, {
        ...artifacts,
        metadata: { ...artifacts.metadata, change: { ...artifacts.metadata.change, status: 'DESIGN' } },
      }, 'analyze')).rejects.toThrow(/只能在 ANALYZE/i);
      await expect(approveChangeStage(workspace, artifacts, 'analyze')).resolves.toMatchObject({
        approvals: { analyze: { status: 'approved', revision: 1, content_hash: expect.stringMatching(/^[a-f0-9]{64}$/) } },
      });
      const persisted = parseYaml(await fs.readFile(path.join(changeDir, 'metadata.yaml'), 'utf8')) as {
        approvals: Record<string, unknown>;
      };
      expect(persisted.approvals.analyze).toMatchObject({ status: 'approved' });
    } finally {
      fixture.cleanup();
    }
  });

  it('keeps legacy metadata two-stage after recording a design approval', async () => {
    const fixture = await createWorkflowFixture({ configOverrides: { schema: 'spec-driven' } });
    try {
      await writeChangeArtifacts(fixture, {
        metadata: {
          change: { status: 'DESIGN' },
          gates: { design: { required: true, satisfied: true } },
          modules: {
            candidates: [{ module: 'MOD-001', outcome: 'OWNED', reason: 'Orders own feedback' }],
            confirmed: [{ module: 'MOD-001', outcome: 'OWNED', reason: 'Orders own feedback' }],
            dependencies: [],
          },
          requirements: { added: [{ id: 'MOD-001-REQ-001', module: 'MOD-001' }], modified: [], removed: [] },
        },
        design: '# Design\n\n## SDD 分级依据\n\nMOD-001-REQ-001\n',
      });
      const workspace = await loadWorkspace(fixture.codespecDir);
      const artifacts = await loadChangeArtifacts(workspace.paths, fixture.changeId);

      await approveChangeStage(workspace, artifacts, 'design');

      const persisted = parseYaml(await fs.readFile(path.join(fixture.paths.changes, fixture.changeId, 'metadata.yaml'), 'utf8')) as {
        approvals: Record<string, unknown>;
      };
      expect(persisted.approvals.design).toMatchObject({ status: 'approved' });
      expect(persisted.approvals).not.toHaveProperty('analyze');
    } finally {
      fixture.cleanup();
    }
  });

  it('classifies semantic task-plan changes separately from locator-only changes', () => {
    const before = {
      design: '# 设计\n',
      spec: richDelta().replaceAll('REQ-006', 'REQ-001'),
      tasks: [
        'version: 1', 'tasks:', '  - id: CHG-20260901-001-TASK-01', '    title: 新增用户页面', '    status: PENDING',
        '    requirements: [MOD-002-REQ-001]', '    scenarios: [MOD-002-REQ-001-SCN-001]', '    testCases: [MOD-002-REQ-001-SCN-001-TC-UI-01]',
        '    plannedFiles: [src/pages/Users.tsx]', '    verificationPlan:', '      testCase: MOD-002-REQ-001-SCN-001-TC-UI-01', '      runner: playwright', '      command: pnpm playwright test', '      profile: test', '      services: [user-service]', '      prepare: pnpm dev:test', '      cleanup: pnpm dev:test:stop',
        'moduleDeltas: []', 'moduleRegistrations: { upsert: [], retire: [] }', '',
      ].join('\n'),
      verification: 'version: 1\ntestCases: []\n',
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
    const changedPlan = {
      ...planned,
      metadata: approved,
      tasks: `${planned.tasks}\n- [ ] SP-02 Additional work`,
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
        'tasks:',
        '  - id: CHG-20260901-001-TASK-01',
        '    title: 新增用户页面',
        '    status: PENDING',
        '    requirements: [MOD-002-REQ-001]',
        '    scenarios: [MOD-002-REQ-001-SCN-001]',
        '    testCases: [MOD-002-REQ-001-SCN-001-TC-UI-01]',
        '    plannedFiles: [src/pages/UserManagementPage.tsx]',
        '    verificationPlan:',
        '      testCase: MOD-002-REQ-001-SCN-001-TC-UI-01',
        '      runner: playwright',
        '      command: pnpm playwright test',
        '      profile: test',
        '      services: [user-service]',
        '      prepare: pnpm dev:test',
        '      cleanup: pnpm dev:test:stop',
        'moduleDeltas: []',
        'moduleRegistrations: { upsert: [], retire: [] }',
        '',
      ].join('\n'),
    });
    current.metadata.artifacts = {
      ...current.metadata.artifacts,
      analysis: 'changes/CHG-20260901-001/analysis.yaml',
      proposal: undefined,
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
        'version: 1', 'tasks:', '  - id: CHG-20260901-001-TASK-01', '    title: 新增用户页面', '    status: PENDING',
        '    requirements: [MOD-002-REQ-001]', '    scenarios: [MOD-002-REQ-001-SCN-001]', '    testCases: [MOD-002-REQ-001-SCN-001-TC-UI-01]',
        '    plannedFiles: [src/pages/UserManagementPage.tsx]', '    verificationPlan:', '      testCase: MOD-002-REQ-001-SCN-001-TC-UI-01', '      runner: playwright', '      command: pnpm playwright test', '      profile: test', '      services: [user-service]', '      prepare: pnpm dev:test', '      cleanup: pnpm dev:test:stop',
        'moduleDeltas: []', 'moduleRegistrations: { upsert: [], retire: [] }', '',
      ].join('\n'),
    });
    current.metadata.artifacts = { ...current.metadata.artifacts, analysis: 'changes/CHG-20260901-001/analysis.yaml', proposal: undefined, tasks: 'changes/CHG-20260901-001/tasks.yaml', verification: 'changes/CHG-20260901-001/verification.yaml' };
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
