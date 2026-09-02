import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runCLI } from '../helpers/run-cli.js';

const tempDirs: string[] = [];

async function createEmptyCodeSpecProject(): Promise<string> {
  const projectDir = await fs.mkdtemp(path.join(tmpdir(), 'openspec-empty-code-spec-'));
  tempDirs.push(projectDir);

  const initialized = await runCLI(['init', '.', '--tools', 'none', '--force', '--no-animation'], {
    cwd: projectDir,
  });
  expect(initialized.exitCode).toBe(0);

  return projectDir;
}

function outputOf(result: Awaited<ReturnType<typeof runCLI>>): string {
  return `${result.stdout}${result.stderr}`;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('empty code-spec workspace', () => {
  it('blocks status and validation until a real business module is defined', async () => {
    const projectDir = await createEmptyCodeSpecProject();

    const [status, validation] = await Promise.all([
      runCLI(['status', '--all', '--json'], { cwd: projectDir }),
      runCLI(['validate', '--all', '--strict', '--no-interactive'], { cwd: projectDir }),
    ]);

    for (const result of [status, validation]) {
      expect(result.exitCode).toBe(1);
      expect(outputOf(result)).toContain('尚未定义业务模块');
      expect(outputOf(result)).toContain('openspec/business.md');
      expect(outputOf(result)).toContain('MOD-001');
    }

    expect(await fs.readdir(path.join(projectDir, 'openspec', 'changes'))).toEqual(['index.yaml']);
  });

  it('runs status and validation after the author adds a real business module', async () => {
    const projectDir = await createEmptyCodeSpecProject();
    await fs.appendFile(
      path.join(projectDir, 'openspec', 'business.md'),
      '\n| MOD-001 | 用户管理 | 管理用户账户 | 管理账户；认证 | 用户；账户 |\n'
    );

    const [status, validation] = await Promise.all([
      runCLI(['status', '--all', '--json'], { cwd: projectDir }),
      runCLI(['validate', '--all', '--strict', '--no-interactive'], { cwd: projectDir }),
    ]);

    expect(status.exitCode).toBe(0);
    expect(validation.exitCode).toBe(0);
  });
});
