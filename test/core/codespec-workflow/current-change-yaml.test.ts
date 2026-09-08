import { describe, expect, it } from 'vitest';

import {
  hashTaskApprovalContent,
  parseCurrentTasks,
  parseCurrentVerification,
} from '../../../src/core/codespec-workflow/current-change-yaml.js';

const tasks = {
  version: 1,
  tasks: [{
    id: 'CHG-20260907-001-TASK-01',
    title: '实现新增用户页面',
    status: 'PENDING',
    requirements: ['MOD-002-REQ-001'],
    scenarios: ['MOD-002-REQ-001-SCN-001'],
    testCases: ['MOD-002-REQ-001-SCN-001-TC-UI-01'],
    plannedFiles: ['src/pages/UserManagementPage.tsx'],
    verificationPlan: {
      testCase: 'MOD-002-REQ-001-SCN-001-TC-UI-01',
      runner: 'playwright',
      command: 'pnpm playwright test e2e/user-management/add-user.spec.ts',
      profile: 'test',
      services: ['user-service'],
      prepare: 'pnpm dev:test',
      cleanup: 'pnpm dev:test:stop',
    },
  }],
  moduleDeltas: [],
  moduleRegistrations: { upsert: [], retire: [] },
};

describe('current Change YAML contracts', () => {
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
      testCases: [{
        testCase: 'MOD-002-REQ-001-SCN-001-TC-UI-01',
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
});
