import { describe, expect, it } from 'vitest';

import {
  hashTaskApprovalContent,
  parseTasksDocument,
  parseCurrentTasks,
  parseCurrentVerification,
  mergeCurrentVerificationPlans,
} from '../../../src/core/codespec-workflow/current-change-yaml.js';

const tasks = {
  version: 1,
  changeRevision: 1,
  tasks: [{
    id: 'CHG-20260907-001-TASK-01',
    title: '实现新增用户页面',
    status: 'PENDING',
    acceptanceCriteria: ['AC-001'],
    requirements: ['MOD-002-REQ-001'],
    scenarios: ['MOD-002-REQ-001-SCN-001'],
    testCases: ['MOD-002-REQ-001-SCN-001-TC-UI-01'],
    plannedFiles: ['src/pages/UserManagementPage.tsx'],
    verificationPlan: [{
      testCase: 'MOD-002-REQ-001-SCN-001-TC-UI-01',
      runner: 'playwright',
      command: 'pnpm playwright test e2e/user-management/add-user.spec.ts',
      profile: 'test',
      services: ['user-service'],
      prepare: 'pnpm dev:test',
      cleanup: 'pnpm dev:test:stop',
    }],
  }],
  moduleDeltas: [],
  moduleRegistrations: { upsert: [], retire: [] },
};

describe('current Change YAML contracts', () => {
  it('merges shared plans with reordered services without mutating task definitions', () => {
    const first = { ...tasks.tasks[0], verificationPlan: [{ ...tasks.tasks[0].verificationPlan[0], services: ['users', 'auth'] }] };
    const second = { ...first, id: 'CHG-20260907-001-TASK-02', verificationPlan: [{ ...first.verificationPlan[0], services: ['auth', 'users'] }] };
    const parsed = parseCurrentTasks({ ...tasks, tasks: [first, second] });
    const merged = mergeCurrentVerificationPlans(parsed);
    expect(merged).toHaveLength(1);
    expect(merged[0].services).toEqual(['auth', 'users']);
    expect(parsed.tasks[0].verificationPlan[0].services).toEqual(['users', 'auth']);
  });

  it.each(['runner', 'command', 'startup', 'profile', 'services', 'browser', 'prepare', 'cleanup'])('rejects conflicting shared plan field %s', (field) => {
    const second = { ...tasks.tasks[0], id: 'CHG-20260907-001-TASK-02', verificationPlan: [{ ...tasks.tasks[0].verificationPlan[0], [field]: field === 'services' ? ['different-service'] : 'different-definition' }] };
    expect(() => mergeCurrentVerificationPlans(parseCurrentTasks({ ...tasks, tasks: [tasks.tasks[0], second] }))).toThrow(/Conflicting verification plan.*MOD-002-REQ-001-SCN-001-TC-UI-01/);
  });
  it('accepts AC references and rejects duplicate trace references', () => {
    const canonical = { ...tasks, changeRevision: 1, tasks: [{ ...tasks.tasks[0], acceptanceCriteria: ['AC-001'] }] };
    expect(parseCurrentTasks(canonical).tasks[0].acceptanceCriteria).toEqual(['AC-001']);
    for (const field of ['acceptanceCriteria', 'requirements', 'scenarios', 'testCases'] as const) {
      const task = canonical.tasks[0];
      expect(() => parseCurrentTasks({ ...canonical, tasks: [{ ...task, [field]: [task[field][0], task[field][0]] }] })).toThrow(/duplicate/i);
    }
  });
  it('exposes tasks.yaml through the document contract alias', () => {
    expect(parseTasksDocument(tasks)).toEqual(parseCurrentTasks(tasks));
  });
  it('parses a machine-mergeable task plan and ignores execution status in its approval hash', () => {
    const parsed = parseCurrentTasks(tasks);
    expect(parsed.tasks[0]?.status).toBe('PENDING');
    expect(hashTaskApprovalContent({ design: '# 设计', spec: '# 用户管理', tasks: parsed }))
      .toBe(hashTaskApprovalContent({
        design: '# 设计',
        spec: '# 用户管理',
        tasks: parseCurrentTasks({ ...tasks, tasks: [{ ...tasks.tasks[0], status: 'IN_PROGRESS' }] }),
      }));
  });

  it('records complete actual E2E execution evidence', () => {
    expect(parseCurrentVerification({
      version: 1,
      changeRevision: 1,
      testCases: [{
        testCase: 'MOD-002-REQ-001-SCN-001-TC-UI-01',
        acceptanceCriteria: ['AC-001'],
        result: 'PASS',
        testFile: 'e2e/user-management/add-user.spec.ts',
        testId: 'TC-UI-01',
        command: 'pnpm playwright test e2e/user-management/add-user.spec.ts',
        profile: 'test',
        services: ['user-service'],
        browser: 'chromium',
        exitCode: 0,
        gitRevision: '9ec4bf1',
        treeFingerprint: 'sha256:f4bd3f5c3cdb8f27ab9910f241313c5c3a138f91a7be2534de45fa7b745a4365',
        executedAt: '2026-09-07T10:30:00+08:00',
        summary: '新用户出现在用户列表中',
        cleanupSucceeded: true,
      }],
    }).testCases[0]?.browser).toBe('chromium');
  });

  it('accepts multi-case verification plans and canonical evidence fields', () => {
    const parsed = parseCurrentTasks({
      ...tasks,
      tasks: [{ ...tasks.tasks[0], verificationPlan: [tasks.tasks[0].verificationPlan[0], {
        ...tasks.tasks[0].verificationPlan[0],
        testCase: 'MOD-002-REQ-001-SCN-001-TC-UI-02',
      }] }],
    });
    expect(parsed.tasks[0]?.verificationPlan).toHaveLength(2);

    const verification = parseCurrentVerification({
      version: 1,
      changeRevision: 1,
      testCases: [{
        testCase: 'MOD-002-REQ-001-SCN-001-TC-UI-01', acceptanceCriteria: ['AC-001'], result: 'PASS',
        testFile: 'e2e/users.spec.ts', testId: 'TC-UI-01',
        command: 'pnpm playwright test', profile: 'test', services: ['user-service'], browser: 'chromium',
        exitCode: 0, gitRevision: '9ec4bf1', treeFingerprint: 'sha256:f4bd3f5c3cdb8f27ab9910f241313c5c3a138f91a7be2534de45fa7b745a4365',
        executedAt: '2026-09-07T10:30:00+08:00', summary: '通过', cleanupSucceeded: true,
      }],
    });
    expect(verification.testCases[0]).toMatchObject({
      testCase: 'MOD-002-REQ-001-SCN-001-TC-UI-01',
      gitRevision: '9ec4bf1',
      treeFingerprint: 'sha256:f4bd3f5c3cdb8f27ab9910f241313c5c3a138f91a7be2534de45fa7b745a4365',
    });
  });

  it('keeps startup and browser execution details in a UI verification plan', () => {
    const parsed = parseCurrentTasks({
      ...tasks,
      tasks: [{
        ...tasks.tasks[0],
        verificationPlan: [{
          ...tasks.tasks[0].verificationPlan[0],
          startup: 'pnpm dev --host 127.0.0.1',
          browser: 'chromium',
        }],
      }],
    });
    expect(parsed.tasks[0]?.verificationPlan[0]).toMatchObject({
      startup: 'pnpm dev --host 127.0.0.1',
      browser: 'chromium',
    });
  });

  it('preserves the current Change revision on verification documents', () => {
    expect(parseCurrentVerification({ version: 1, changeRevision: 7, testCases: [] }).changeRevision).toBe(7);
  });

  it('requires machine-mergeable module deltas to use typed relation and configuration records', () => {
    expect(() => parseCurrentTasks({
      ...tasks,
      moduleDeltas: [{
        module: 'MOD-002',
        interfaces: { upsert: [{ id: 'not-a-relation' }], remove: [] },
        configurationChanges: { upsert: [], remove: [] },
      }],
    })).toThrow(/relation|kind|fromModule/i);
  });

  it('normalizes the flat service shape used by the v1 design contract', () => {
    const parsed = parseCurrentTasks({
      ...tasks,
      moduleDeltas: [{
        module: 'MOD-002',
        interfaces: { upsert: [], remove: [] },
        configurationChanges: {
          upsert: [{
            profile: 'test',
            service: 'user-service',
            hostAlias: 'user-service-test',
            endpoint: 'https://users.test.example',
            routeBindings: [{ module: 'MOD-002', path: '/api/users' }],
            source: { kind: 'repo-file', file: '.env.test', format: 'dotenv', key: 'USER_SERVICE_URL' },
          }],
          remove: [],
        },
      }],
    });
    expect(parsed.moduleDeltas[0]?.configurationChanges.upsert[0]?.service.id).toBe('user-service');
  });

  it('rejects duplicate task IDs and duplicate module-delta relation IDs', () => {
    expect(() => parseCurrentTasks({
      ...tasks,
      tasks: [tasks.tasks[0], { ...tasks.tasks[0], title: '重复任务' }],
    })).toThrow(/duplicate|unique/i);

    const relation = {
      id: 'REL-CHG-20260907-001-04',
      kind: 'http' as const,
      fromModule: 'MOD-001',
      toModule: 'MOD-002',
      path: '/api/users',
      method: 'POST',
      input: '用户管理请求',
      output: '用户资料',
      errors: '参数不合法时不创建用户',
      requirements: ['MOD-002-REQ-001'],
      scenarios: ['MOD-002-REQ-001-SCN-001'],
    };
    expect(() => parseCurrentTasks({
      ...tasks,
      moduleDeltas: [
        { module: 'MOD-002', interfaces: { upsert: [relation], remove: [] }, configurationChanges: { upsert: [], remove: [] } },
        { module: 'MOD-001', interfaces: { upsert: [relation], remove: [] }, configurationChanges: { upsert: [], remove: [] } },
      ],
    })).toThrow(/duplicate|unique/i);
  });

  it('rejects unsafe planned file paths', () => {
    expect(() => parseCurrentTasks({
      ...tasks,
      tasks: [{ ...tasks.tasks[0], plannedFiles: ['../outside.ts'] }],
    })).toThrow(/repository-relative/i);
    expect(() => parseCurrentTasks({
      ...tasks,
      tasks: [{ ...tasks.tasks[0], plannedFiles: ['/tmp/outside.ts'] }],
    })).toThrow(/repository-relative/i);
  });
});
