import { describe, expect, it } from 'vitest';

import {
  approveChangeStage,
  approveStage,
  assertTransitionApproval,
  classifyArtifactChange,
} from '../../../src/core/codespec-workflow/approvals.js';
import type { ChangeArtifacts } from '../../../src/core/codespec-workflow/artifacts.js';
import { loadChangeArtifacts } from '../../../src/core/codespec-workflow/artifacts.js';
import { loadWorkspace } from '../../../src/core/codespec-workflow/loaders.js';
import { createWorkflowFixture, writeChangeArtifacts } from '../../helpers/codespec-workflow.js';

function artifactsFor(
  status: 'DESIGN' | 'PLAN',
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
    proposal: '# Proposal\n\nScope',
    design: '# Design\n\nApproved design',
    spec: '## ADDED\n\nRequirement',
    tasks: '# Tasks\n\n- [ ] SP-01 Implement approval gate',
    verification: '# Verification',
    ...overrides,
  };
}

describe('workflow approvals', () => {
  it('classifies semantic task-plan changes separately from locator-only changes', () => {
    const before = {
      design: '# 设计\n',
      spec: [
        '# 用户管理', '', '- **模块编号：** MOD-002', '- **规格版本：** 1', '',
        '## MOD-002-REQ-001：新增用户', '',
        '#### Scenario: MOD-002-REQ-001-SCN-001 提交新增用户',
        '- GIVEN 已登录', '- WHEN 提交新增用户', '- THEN 用户出现在列表', '- ERROR 用户已存在', '',
        '### 测试用例', '', '#### MOD-002-REQ-001-SCN-001-TC-UI-01：新增用户',
        '- **类型：** UI', '- **自动化测试：** `e2e/users.spec.ts`', '- **测试标识：** `add-user`', '- **最近验证：** 待验证', '',
        '| 步骤 | 用户操作 | 预期结果 |', '| --- | --- | --- |', '| 1 | 点击新增用户 | 打开表单 |', '',
        '### 当前模块工程文件', '', '| 文件 | 作用 | 关联需求 / 场景 / 测试用例 |', '| --- | --- | --- |', '| `src/pages/Users.tsx` | 用户页面 | `MOD-002-REQ-001-SCN-001-TC-UI-01` |', '',
      ].join('\n'),
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
      spec: [
        '# 用户管理', '', '- **模块编号：** MOD-002', '- **规格版本：** 1', '',
        '## MOD-002-REQ-001：新增用户', '', '#### Scenario: MOD-002-REQ-001-SCN-001 提交新增用户',
        '- GIVEN 已登录', '- WHEN 提交新增用户', '- THEN 用户出现在列表', '- ERROR 用户已存在', '',
        '### 测试用例', '', '#### MOD-002-REQ-001-SCN-001-TC-UI-01：新增用户',
        '- **类型：** UI', '- **自动化测试：** `e2e/users.spec.ts`', '- **测试标识：** `data-testid=add-user`', '- **最近验证：** 待验证', '',
        '| 步骤 | 用户操作 | 预期结果 |', '| --- | --- | --- |', '| 1 | 点击新增用户 | 打开表单 |', '',
        '### 当前模块工程文件', '', '| 文件 | 作用 | 关联需求 / 场景 / 测试用例 |', '| --- | --- | --- |', '| `src/pages/Users.tsx` | 用户页面 | `MOD-002-REQ-001-SCN-001-TC-UI-01` |', '',
      ].join('\n'),
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
      proposal: undefined,
      tasks: 'changes/CHG-20260901-001/tasks.yaml',
      verification: 'changes/CHG-20260901-001/verification.yaml',
    };

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
      spec: '# 用户管理\n\n- **模块编号：** MOD-002\n- **规格版本：** 1\n',
      tasks: [
        'version: 1', 'tasks:', '  - id: CHG-20260901-001-TASK-01', '    title: 新增用户页面', '    status: PENDING',
        '    requirements: [MOD-002-REQ-001]', '    scenarios: [MOD-002-REQ-001-SCN-001]', '    testCases: [MOD-002-REQ-001-SCN-001-TC-UI-01]',
        '    plannedFiles: [src/pages/UserManagementPage.tsx]', '    verificationPlan:', '      testCase: MOD-002-REQ-001-SCN-001-TC-UI-01', '      runner: playwright', '      command: pnpm playwright test', '      profile: test', '      services: [user-service]', '      prepare: pnpm dev:test', '      cleanup: pnpm dev:test:stop',
        'moduleDeltas: []', 'moduleRegistrations: { upsert: [], retire: [] }', '',
      ].join('\n'),
    });
    current.metadata.artifacts = { ...current.metadata.artifacts, proposal: undefined, tasks: 'changes/CHG-20260901-001/tasks.yaml', verification: 'changes/CHG-20260901-001/verification.yaml' };

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
