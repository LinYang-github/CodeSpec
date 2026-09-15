import { describe, expect, it, vi } from 'vitest';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import * as fs from 'node:fs/promises';
import path from 'node:path';

import { runUiArchiveGate } from '../../../src/core/codespec-workflow/ui-archive-gate.js';
import type { ChangeArtifacts } from '../../../src/core/codespec-workflow/artifacts.js';
import type { WorkspaceContext } from '../../../src/core/codespec-workflow/loaders.js';
import { createWorkflowFixture } from '../../helpers/codespec-workflow.js';
import { createCurrentArchiveFixture, modification, writeCanonicalChange } from '../../helpers/current-archive.js';
import { recordFreshVerification } from '../../../src/core/codespec-workflow/verification.js';
import { validateChangeTraceability } from '../../../src/core/codespec-workflow/traceability.js';

async function sharedPlansFixture(conflicting = false) {
  const fixture = await createCurrentArchiveFixture();
  const artifacts = await writeCanonicalChange(fixture, modification());
  artifacts.metadata.impact.affected_areas = ['ui'];
  const analysis = parseYaml(artifacts.analysis!);
  analysis.acceptanceCriteria.push({ ...analysis.acceptanceCriteria[0], id: 'AC-002' });
  artifacts.analysis = stringifyYaml(analysis);
  const tasks = parseYaml(artifacts.tasks);
  for (const task of tasks.tasks) Object.assign(task.verificationPlan[0], {
    startup: 'start', browser: 'chromium', command: `node -e "require('node:fs').appendFileSync('executions.txt', 'x')"`,
  });
  const duplicates = tasks.tasks.map((task: Record<string, unknown>, index: number) => ({ ...structuredClone(task), id: `${fixture.changeId}-TASK-0${index + 4}`, acceptanceCriteria: ['AC-002'] }));
  tasks.tasks.push(...duplicates);
  if (conflicting) tasks.tasks[3].verificationPlan[0].prepare = 'different preparation';
  artifacts.tasks = stringifyYaml(tasks);
  for (const key of ['metadata', 'analysis', 'tasks'] as const) await fs.writeFile(path.join(artifacts.changeDir, `${key}.yaml`), key === 'metadata' ? stringifyYaml(artifacts.metadata) : artifacts[key]!);
  return { fixture, artifacts, tasks };
}

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
  it.each(['UI', 'ordinary'])('executes consistent shared test plans once and preserves both AC/task chains: %s', async (runner) => {
    const { fixture, artifacts, tasks } = await sharedPlansFixture();
    try {
      expect(validateChangeTraceability(artifacts).issues).toEqual([]);
      if (runner === 'UI') {
        const executed: string[] = [];
        const gate = await runUiArchiveGate(fixture.workspace, artifacts, {
          runCommand: async (command) => { executed.push(command); return { status: 0, output: 'ok' }; },
          startServer: async () => ({ stop: async () => {} }), waitForReady: async () => {},
        });
        expect(executed.filter((command) => command.includes('appendFileSync'))).toHaveLength(3);
        expect(gate.verification.testCases).toHaveLength(3);
        expect(gate.verification.testCases.every((record) => record.acceptanceCriteria?.join(',') === 'AC-001,AC-002')).toBe(true);
        const trace = validateChangeTraceability({ ...artifacts, verification: stringifyYaml(gate.verification) }, true);
        expect(trace.issues).toEqual([]);
        expect(new Set(trace.traceRows?.map((row) => row.task_id)).size).toBe(6);
      } else {
        const evidence = await recordFreshVerification(fixture.workspace, fixture.changeId, tasks.tasks.slice(0, 3).flatMap((task: { verificationPlan: Array<{ testCase: string; command: string }> }) => task.verificationPlan));
        expect(await fs.readFile(path.join(fixture.tempDir, 'executions.txt'), 'utf8')).toBe('xxx');
        expect(new Set(evidence.trace_rows?.map((row) => row.task_id)).size).toBe(6);
        expect(new Set(evidence.trace_rows?.map((row) => row.acceptance_id))).toEqual(new Set(['AC-001', 'AC-002']));
      }
    } finally { fixture.cleanup(); }
  });

  it.each(['UI', 'ordinary'])('rejects conflicting shared definitions before executing any command: %s', async (runner) => {
    const { fixture, artifacts, tasks } = await sharedPlansFixture(true);
    const executed: string[] = [];
    try {
      const promise = runner === 'UI' ? runUiArchiveGate(fixture.workspace, artifacts, {
        runCommand: async (command) => { executed.push(command); return { status: 0, output: 'ok' }; },
        startServer: async () => ({ stop: async () => {} }), waitForReady: async () => {},
      }) : recordFreshVerification(fixture.workspace, fixture.changeId, tasks.tasks.slice(0, 3).flatMap((task: { verificationPlan: Array<{ testCase: string; command: string }> }) => task.verificationPlan));
      await expect(promise).rejects.toThrow(/conflicting verification plan.*MOD-002-REQ-001-SCN-001-TC-UI-01/i);
      expect(executed).toEqual([]);
      await expect(fs.access(path.join(fixture.tempDir, 'executions.txt'))).rejects.toThrow();
    } finally { fixture.cleanup(); }
  });
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
