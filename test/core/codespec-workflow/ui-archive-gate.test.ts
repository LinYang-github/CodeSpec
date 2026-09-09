import { describe, expect, it, vi } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';

import { runUiArchiveGate } from '../../../src/core/codespec-workflow/ui-archive-gate.js';
import type { ChangeArtifacts } from '../../../src/core/codespec-workflow/artifacts.js';
import type { WorkspaceContext } from '../../../src/core/codespec-workflow/loaders.js';
import { createWorkflowFixture } from '../../helpers/codespec-workflow.js';

function artifactsFor(fixture: Awaited<ReturnType<typeof createWorkflowFixture>>, tasks: unknown): ChangeArtifacts {
  const metadata = fixture.metadataAt('ARCHIVE');
  metadata.impact.affected_areas = ['ui'];
  metadata.artifacts.proposal = undefined;
  return {
    changeId: fixture.changeId,
    changeDir: fixture.paths.changes,
    metadata,
    proposal: '',
    design: '# Design\n',
    spec: '# Spec\n',
    tasks: stringifyYaml(tasks),
    verification: 'version: 1\ntestCases: []\n',
  };
}

function uiTasks(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    tasks: [{
      id: 'CHG-20260907-001-TASK-01',
      title: '运行 UI E2E',
      status: 'DONE',
      requirements: ['MOD-002-REQ-001'],
      scenarios: ['MOD-002-REQ-001-SCN-001'],
      testCases: ['MOD-002-REQ-001-SCN-001-TC-UI-01'],
      plannedFiles: ['src/pages/UserManagementPage.tsx'],
      verificationPlan: {
        testCase: 'MOD-002-REQ-001-SCN-001-TC-UI-01',
        runner: 'playwright',
        startup: 'pnpm dev',
        command: 'pnpm playwright test',
        profile: 'local',
        services: [],
        browser: 'chromium',
        prepare: 'pnpm e2e:prepare',
        cleanup: 'pnpm e2e:cleanup',
        ...overrides,
      },
    }],
    moduleDeltas: [],
    moduleRegistrations: { upsert: [], retire: [] },
  };
}

function workspaceFor(fixture: Awaited<ReturnType<typeof createWorkflowFixture>>): WorkspaceContext {
  return fixture.workspace as WorkspaceContext;
}

describe('UI archive gate', () => {
  it('runs prepare, startup, readiness, browser E2E, and cleanup in order', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const events: string[] = [];
      const stop = vi.fn(async () => { events.push('stop'); });
      const result = await runUiArchiveGate(workspaceFor(fixture), artifactsFor(fixture, uiTasks()), {
        runCommand: async (command) => {
          events.push(command);
          return { status: 0, output: 'ok' };
        },
        startServer: async (command) => {
          events.push(command);
          return { stop };
        },
        waitForReady: async () => { events.push('ready'); },
      });

      expect(result.passed).toBe(true);
      expect(events).toEqual(['pnpm e2e:prepare', 'pnpm dev', 'ready', 'pnpm playwright test', 'pnpm e2e:cleanup', 'stop']);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects a UI plan without startup or browser identity before running commands', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const runCommand = vi.fn();
      await expect(runUiArchiveGate(workspaceFor(fixture), artifactsFor(fixture, uiTasks({ startup: undefined, browser: undefined })), { runCommand }))
        .rejects.toThrow(/startup|browser/i);
      expect(runCommand).not.toHaveBeenCalled();
    } finally {
      fixture.cleanup();
    }
  });

  it('always runs cleanup and stops the real project when browser E2E fails', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const events: string[] = [];
      await expect(runUiArchiveGate(workspaceFor(fixture), artifactsFor(fixture, uiTasks()), {
        runCommand: async (command) => {
          events.push(command);
          return command === 'pnpm playwright test' ? { status: 1, output: 'failed' } : { status: 0, output: 'ok' };
        },
        startServer: async (command) => {
          events.push(command);
          return { stop: async () => { events.push('stop'); } };
        },
        waitForReady: async () => { events.push('ready'); },
      })).rejects.toThrow(/E2E|failed|验证/i);
      expect(events).toEqual(['pnpm e2e:prepare', 'pnpm dev', 'ready', 'pnpm playwright test', 'pnpm e2e:cleanup', 'stop']);
    } finally {
      fixture.cleanup();
    }
  });
});
