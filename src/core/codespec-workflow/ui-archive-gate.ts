import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import type { ChangeArtifacts } from './artifacts.js';
import type { WorkspaceContext } from './loaders.js';
import { parseConfiguration } from './current-spec-yaml.js';
import { parseCurrentTasks, parseCurrentVerification, type CurrentTasks, type CurrentVerification } from './current-change-yaml.js';

const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 250;
const COMMAND_TIMEOUT_MS = 120_000;

export interface UiArchiveGateResult {
  passed: true;
  verification: CurrentVerification;
  outputSummary: string;
}

interface CommandResult {
  status: number;
  output: string;
}

interface ServerHandle {
  stop(): Promise<void>;
}

export interface UiArchiveGateHooks {
  runCommand?: (command: string, cwd: string) => Promise<CommandResult>;
  startServer?: (command: string, cwd: string) => Promise<ServerHandle>;
  waitForReady?: (workspace: WorkspaceContext, tasks: CurrentTasks) => Promise<void>;
}

export function isUiChange(artifacts: Pick<ChangeArtifacts, 'metadata'>): boolean {
  return artifacts.metadata.impact.affected_areas.includes('ui');
}

function commandResult(command: string, cwd: string): Promise<CommandResult> {
  const child = spawn(command, { shell: true, cwd });
  let output = '';
  let timer: NodeJS.Timeout | undefined;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (status: number): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ status, output: output.slice(0, 4000) });
    };
    child.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { output += data.toString(); });
    child.once('error', () => finish(1));
    child.once('close', (status) => finish(status ?? 1));
    timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(124);
    }, COMMAND_TIMEOUT_MS);
  });
}

function startServer(command: string, cwd: string): Promise<ServerHandle> {
  const child = spawn(command, { shell: true, cwd, detached: true, stdio: 'ignore' });
  return new Promise((resolve, reject) => {
    let settled = false;
    const handle: ServerHandle = {
      async stop(): Promise<void> {
        if (child.pid === undefined) return;
        try {
          process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
      },
    };
    const resolveHandle = (): void => {
      if (settled) return;
      settled = true;
      resolve(handle);
    };
    process.nextTick(resolveHandle);
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

async function waitForConfiguredServices(workspace: WorkspaceContext, tasks: CurrentTasks): Promise<void> {
  const configuration = parseConfiguration(parseYaml(await fs.readFile(workspace.paths.configuration, 'utf8')));
  const urls: string[] = [];
  for (const plan of tasks.tasks.flatMap((task) => task.verificationPlan)) {
    const profile = configuration.profiles.find((candidate) => candidate.id === plan.profile);
    if (!profile) throw new Error(`UI 验证 profile 未配置：${plan.profile}`);
    for (const serviceId of plan.services) {
      const service = profile.services.find((candidate) => candidate.id === serviceId);
      if (!service) throw new Error(`UI 验证 service 未配置：${plan.profile}/${serviceId}`);
      if (!service.endpoint) throw new Error(`UI 验证 service 缺少可探测 endpoint：${plan.profile}/${serviceId}`);
      for (const binding of service.routeBindings) urls.push(new URL(binding.path, service.endpoint).toString());
    }
  }
  if (!urls.length) return;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError = '服务未就绪';
  while (Date.now() < deadline) {
    try {
      const responses = await Promise.all(urls.map((url) => fetch(url, { signal: AbortSignal.timeout(2000) })));
      if (responses.every((response) => response.status < 500)) return;
      lastError = `服务返回状态：${responses.map((response) => response.status).join(', ')}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  throw new Error(`UI 工程服务等待超时：${lastError}`);
}

function requireUiPlans(tasks: CurrentTasks): CurrentTasks['tasks'][number]['verificationPlan'] {
  const plans = tasks.tasks.flatMap((task) => task.verificationPlan);
  if (!plans.length) throw new Error('UI Change 没有 verificationPlan。');
  for (const plan of plans) {
    if (!plan.startup) throw new Error(`UI 验证计划缺少 startup：${plan.testCase}`);
    if (!plan.browser) throw new Error(`UI 验证计划缺少 browser：${plan.testCase}`);
  }
  return plans;
}

export async function runUiArchiveGate(
  workspace: WorkspaceContext,
  artifacts: ChangeArtifacts,
  hooks: UiArchiveGateHooks = {},
): Promise<UiArchiveGateResult> {
  if (!isUiChange(artifacts)) {
    throw new Error('runUiArchiveGate 只能用于 UI Change。');
  }
  const tasks = parseCurrentTasks(parseYaml(artifacts.tasks));
  const plans = requireUiPlans(tasks);
  const cwd = path.dirname(workspace.codespecDir);
  const runCommand = hooks.runCommand ?? commandResult;
  const runServer = hooks.startServer ?? startServer;
  const waitForReady = hooks.waitForReady ?? waitForConfiguredServices;
  const records: Array<Record<string, unknown>> = [];
  const output: string[] = [];
  let firstFailure: Error | undefined;
  for (const plan of plans) {
    let failed: Error | undefined;
    let server: ServerHandle | undefined;
    let cleanupSucceeded = false;
    let browserResult: CommandResult = { status: 1, output: '' };
    try {
      const prepare = await runCommand(plan.prepare, cwd);
      output.push(prepare.output);
      if (prepare.status !== 0) throw new Error(`UI prepare 失败：${plan.testCase}`);
      server = await runServer(plan.startup!, cwd);
      await waitForReady(workspace, tasks);
      output.push('工程已就绪');
      browserResult = await runCommand(plan.command, cwd);
      output.push(browserResult.output);
      if (browserResult.status !== 0) throw new Error(`浏览器 E2E 失败：${plan.testCase}`);
    } catch (error) {
      failed = error instanceof Error ? error : new Error(String(error));
    } finally {
      try {
        const cleanup = await runCommand(plan.cleanup, cwd);
        cleanupSucceeded = cleanup.status === 0;
        output.push(cleanup.output);
        if (!cleanupSucceeded && !failed) failed = new Error(`UI cleanup 失败：${plan.testCase}`);
      } finally {
        await server?.stop();
      }
    }
    const executedAt = new Date().toISOString();
    records.push({
      testCase: plan.testCase,
      result: failed ? 'FAIL' : 'PASS',
      testFile: tasks.tasks.find((task) => task.verificationPlan.some((candidate) => candidate.testCase === plan.testCase))?.plannedFiles[0] ?? 'unknown',
      testId: plan.testCase,
      command: plan.command,
      profile: plan.profile,
      services: plan.services,
      browser: plan.browser,
      exitCode: browserResult.status,
      gitRevision: artifacts.metadata.baseline.commit ?? '0000000',
      treeFingerprint: artifacts.metadata.baseline.working_tree_fingerprint,
      executedAt,
      summary: browserResult.output.slice(0, 2000) || (failed ? failed.message : 'UI E2E 通过'),
      cleanupSucceeded,
    });
    if (failed) {
      firstFailure = failed;
      break;
    }
  }

  if (firstFailure) throw firstFailure;
  const verification = parseCurrentVerification({ version: 1, changeRevision: artifacts.metadata.change.revision, testCases: records });
  return { passed: true, verification, outputSummary: output.join('\n').slice(0, 4000) };
}
