import * as fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';

import { validateCurrentVerificationPlan } from '../../../src/core/codespec-workflow/current-verification-policy.js';
import { parseCurrentTasks, parseCurrentVerification } from '../../../src/core/codespec-workflow/current-change-yaml.js';
import { appendLatestVerificationSummary } from '../../../src/core/codespec-workflow/verification.js';
import { validateExitGate } from '../../../src/core/codespec-workflow/gates.js';
import { loadChangeArtifacts } from '../../../src/core/codespec-workflow/loaders.js';
import { createWorkflowFixture } from '../../helpers/codespec-workflow.js';

describe('current verification policy', () => {
  it('keeps only the newest human-readable verification summary in a prepared spec', () => {
    const verification = parseCurrentVerification({
      version: 1,
      testCases: [{
        testCase: 'MOD-002-REQ-001-SCN-001-TC-UI-01', result: 'PASS', testFile: 'e2e/users.spec.ts', testId: 'TC-UI-01',
        command: 'pnpm playwright test', profile: 'test', services: ['user-service'], browser: 'chromium', exitCode: 0,
        gitRevision: '9ec4bf1', treeFingerprint: 'sha256:f4bd3f5c3cdb8f27ab9910f241313c5c3a138f91a7be2534de45fa7b745a4365',
        executedAt: '2026-09-07T10:30:00+08:00', summary: '新用户出现在用户列表', cleanupSucceeded: true,
      }],
    });
    const prepared = appendLatestVerificationSummary('# 用户管理\n\n### 最近验证摘要\n\n- 旧记录\n', verification);

    expect(prepared).toContain('新用户出现在用户列表');
    expect(prepared).not.toContain('旧记录');
    expect(prepared.match(/### 最近验证摘要/gu)).toHaveLength(1);
  });

  it('requires every planned test case to have a successful matching execution record', () => {
    const tasks = parseCurrentTasks({
      version: 1,
      tasks: [{
        id: 'CHG-20260907-001-TASK-01', title: '新增用户', status: 'DONE',
        requirements: ['MOD-002-REQ-001'], scenarios: ['MOD-002-REQ-001-SCN-001'],
        testCases: ['MOD-002-REQ-001-SCN-001-TC-UI-01'], plannedFiles: ['e2e/users.spec.ts'],
        verificationPlan: {
          testCase: 'MOD-002-REQ-001-SCN-001-TC-UI-01', runner: 'playwright', command: 'pnpm playwright test',
          profile: 'test', services: ['user-service'], prepare: 'pnpm dev:test', cleanup: 'pnpm dev:test:stop',
        },
      }], moduleDeltas: [], moduleRegistrations: { upsert: [], retire: [] },
    });
    const verification = parseCurrentVerification({
      version: 1,
      testCases: [{
        testCase: 'MOD-002-REQ-001-SCN-001-TC-UI-01', testFile: 'e2e/users.spec.ts', testId: 'TC-UI-01',
        result: 'PASS', command: 'pnpm playwright test', profile: 'test', services: ['user-service'], browser: 'chromium',
        exitCode: 0, gitRevision: '9ec4bf1',
        treeFingerprint: 'sha256:f4bd3f5c3cdb8f27ab9910f241313c5c3a138f91a7be2534de45fa7b745a4365',
        executedAt: '2026-09-07T10:30:00+08:00', summary: '通过', cleanupSucceeded: true,
      }],
    });

    const baseline = { commit: '9ec4bf1', working_tree_fingerprint: 'sha256:f4bd3f5c3cdb8f27ab9910f241313c5c3a138f91a7be2534de45fa7b745a4365' };
    expect(validateCurrentVerificationPlan(tasks, verification, baseline)).toEqual([]);
    expect(validateCurrentVerificationPlan(tasks, parseCurrentVerification({ version: 1, testCases: [] }), baseline))
      .toContainEqual(expect.stringMatching(/missing verification record/i));
    expect(validateCurrentVerificationPlan(tasks, parseCurrentVerification({
      ...verification,
      testCases: [{ ...verification.testCases[0], exitCode: 1 }],
    }), baseline)).toContainEqual(expect.stringMatching(/exit code/i));
    expect(validateCurrentVerificationPlan(tasks, parseCurrentVerification({
      ...verification,
      testCases: [{ ...verification.testCases[0], result: 'SKIPPED' }],
    }), baseline)).toContainEqual(expect.stringMatching(/skipped|pass/i));
    expect(validateCurrentVerificationPlan(tasks, parseCurrentVerification({
      ...verification,
      testCases: [{ ...verification.testCases[0], profile: 'staging' }],
    }), baseline)).toContainEqual(expect.stringMatching(/profile/i));
    expect(validateCurrentVerificationPlan(tasks, parseCurrentVerification({
      ...verification,
      testCases: [{ ...verification.testCases[0], cleanupSucceeded: false }],
    }), baseline)).toContainEqual(expect.stringMatching(/cleanup/i));
    expect(validateCurrentVerificationPlan(tasks, parseCurrentVerification({
      ...verification,
      testCases: [{ ...verification.testCases[0], treeFingerprint: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
    }), baseline)).toContainEqual(expect.stringMatching(/fingerprint/i));
  });

  it('uses verification.yaml and the runtime configuration snapshot at the VERIFY gate', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const metadata = fixture.metadataAt('VERIFY');
      metadata.gates.verify.satisfied = true;
      metadata.baseline.commit = '9ec4bf1';
      metadata.artifacts = {
        ...metadata.artifacts,
        proposal: undefined,
        tasks: `changes/${fixture.changeId}/tasks.yaml`,
        verification: `changes/${fixture.changeId}/verification.yaml`,
      };
      const changeDir = path.join(fixture.paths.changes, fixture.changeId);
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'metadata.yaml'), stringifyYaml(metadata));
      await fs.writeFile(path.join(changeDir, 'design.md'), '# 用户管理设计\n');
      await fs.writeFile(path.join(changeDir, 'spec.md'), '# 用户管理\n');
      await fs.writeFile(path.join(changeDir, 'tasks.yaml'), stringifyYaml({
        version: 1,
        tasks: [{
          id: `${fixture.changeId}-TASK-01`, title: '新增用户', status: 'DONE',
          requirements: ['MOD-002-REQ-001'], scenarios: ['MOD-002-REQ-001-SCN-001'],
          testCases: ['MOD-002-REQ-001-SCN-001-TC-UI-01'], plannedFiles: ['e2e/users.spec.ts'],
          verificationPlan: {
            testCase: 'MOD-002-REQ-001-SCN-001-TC-UI-01', runner: 'playwright', command: 'pnpm playwright test e2e/users.spec.ts',
            profile: 'test', services: ['users'], prepare: 'pnpm dev:test', cleanup: 'pnpm dev:test:stop',
          },
        }],
        moduleDeltas: [], moduleRegistrations: { upsert: [], retire: [] },
      }));
      await fs.writeFile(path.join(changeDir, 'verification.yaml'), stringifyYaml({
        version: 1,
        testCases: [{
          testCase: 'MOD-002-REQ-001-SCN-001-TC-UI-01', result: 'PASS', testFile: 'e2e/users.spec.ts', testId: 'TC-UI-01',
          command: 'pnpm playwright test e2e/users.spec.ts', profile: 'test', services: ['users'], browser: 'chromium', exitCode: 0,
          gitRevision: '9ec4bf1', treeFingerprint: `sha256:${'0'.repeat(64)}`, executedAt: '2026-09-07T10:30:00+08:00',
          summary: '新用户出现在用户列表', cleanupSucceeded: true,
        }],
      }));
      await fs.writeFile(path.join(fixture.tempDir, '.env.test'), 'USERS_URL=https://users.test.example\n');
      await fs.writeFile(fixture.paths.configuration, stringifyYaml({
        version: 1,
        profiles: [{ id: 'test', services: [{
          id: 'users', hostAlias: '用户服务', endpoint: 'https://users.test.example',
          routeBindings: [{ module: 'MOD-002', path: '/api/users' }],
          source: { kind: 'repo-file', file: '.env.test', format: 'dotenv', key: 'USERS_URL' },
        }] }],
      }));

      const artifacts = await loadChangeArtifacts(fixture.paths, fixture.changeId);
      expect((await validateExitGate(fixture.workspace, artifacts)).errors).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });
});
