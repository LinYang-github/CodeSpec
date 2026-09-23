import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { createWorkflowFixture } from '../helpers/codespec-workflow.js';
import { currentMarkdown } from '../helpers/rich-requirement.js';

describe('canonical Current Requirement show', () => {
  let fixture: Awaited<ReturnType<typeof createWorkflowFixture>>;
  const bin = path.join(process.cwd(), 'bin', 'codespec.js');
  const run = (...args: string[]) => spawnSync('node', [bin, 'show', ...args], { cwd: fixture.tempDir, encoding: 'utf8' });
  beforeEach(async () => {
    fixture = await createWorkflowFixture();
    await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
    await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), currentMarkdown);
  });
  afterEach(() => fixture.cleanup());

  it('prints only the exact Current Requirement with all scenarios and tests', () => {
    const result = run('MOD-002', '--type', 'spec', '--requirement', 'MOD-002-REQ-006');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^## MOD-002-REQ-006：新增用户/);
    expect(result.stdout).toContain('MOD-002-REQ-006-SCN-001-TC-UI-01');
    expect(result.stdout).toContain('重复用户时拒绝创建');
    expect(result.stdout).not.toContain('REQ-007');
    expect(result.stdout).not.toContain('当前模块工程文件');
  });

  it('returns a structured Requirement in JSON and preserves whole Current reads', () => {
    const exact = run('MOD-002', '--type', 'spec', '--requirement', 'MOD-002-REQ-006', '--json');
    expect(exact.status, exact.stderr).toBe(0);
    expect(JSON.parse(exact.stdout)).toMatchObject({ id: 'MOD-002-REQ-006', title: '新增用户', scenarios: [{ id: 'MOD-002-REQ-006-SCN-001', testCases: [{ steps: [{ number: '1' }, { number: '2' }] }] }] });
    const whole = run('MOD-002', '--type', 'spec');
    expect(whole.status, whole.stderr).toBe(0);
    expect(whole.stdout).toContain('REQ-007');
    expect(whole.stdout).toContain('当前模块工程文件');
    const json = run('MOD-002', '--type', 'spec', '--json');
    expect(json.status, json.stderr).toBe(0);
    expect(JSON.parse(json.stdout).requirements).toHaveLength(2);
  });

  it.each(['1', 'MOD-003-REQ-006', 'MOD-002-REQ-999'])('rejects index, module mismatch and unknown Requirement %s', (id) => {
    const result = run('MOD-002', '--type', 'spec', '--requirement', id, '--json');
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Requirement|需求/);
  });

});

describe('top-level show command', () => {
  const projectRoot = process.cwd();
  const testDir = path.join(projectRoot, 'test-show-command-tmp');
  const changesDir = path.join(testDir, 'codespec', 'changes');
  const specsDir = path.join(testDir, 'codespec', 'specs');
  const codespecBin = path.join(projectRoot, 'bin', 'codespec.js');


  beforeEach(async () => {
    await fs.mkdir(changesDir, { recursive: true });
    await fs.mkdir(specsDir, { recursive: true });

    const changeContent = `# Change: Demo\n\n## Why\nBecause reasons.\n\n## What Changes\n- **auth:** Add requirement\n`;
    await fs.mkdir(path.join(changesDir, 'demo'), { recursive: true });
    await fs.writeFile(path.join(changesDir, 'demo', 'proposal.md'), changeContent, 'utf-8');

    const specContent = `## Purpose\nAuth spec.\n\n## Requirements\n\n### Requirement: User Authentication\nText\n`;
    await fs.mkdir(path.join(specsDir, 'auth'), { recursive: true });
    await fs.writeFile(path.join(specsDir, 'auth', 'spec.md'), specContent, 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('prints hint and non-zero exit when no args and non-interactive', () => {
    const originalCwd = process.cwd();
    const originalEnv = { ...process.env };
    try {
      process.chdir(testDir);
      process.env.OPEN_SPEC_INTERACTIVE = '0';
      let err: any;
      try {
        execFileSync('node', [codespecBin, 'show'], { encoding: 'utf-8' });
      } catch (e) { err = e; }
      expect(err).toBeDefined();
      expect(err.status).not.toBe(0);
      const stderr = err.stderr.toString();
      expect(stderr).toContain('没有可显示的条目。');
      expect(stderr).toContain('codespec show <item>');
      expect(stderr).toContain('codespec change show');
      expect(stderr).toContain('codespec spec show');
    } finally {
      process.chdir(originalCwd);
      process.env = originalEnv;
    }
  });

  it('auto-detects change id and supports --json', () => {
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      const output = execFileSync('node', [codespecBin, 'show', 'demo', '--json'], { encoding: 'utf-8' });
      const json = JSON.parse(output);
      expect(json.id).toBe('demo');
      expect(Array.isArray(json.deltas)).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('does not warn about spec-only flags that were never passed', () => {
    // commander defaults `scenarios` to true for --no-scenarios, so a plain
    // `show <change>` must not warn about a flag the user never typed.
    const res = spawnSync('node', [codespecBin, 'show', 'demo', '--json'], {
      encoding: 'utf-8',
      cwd: testDir,
    });
    expect(res.status).toBe(0);
    expect(res.stderr).not.toContain('not applicable');
  });

  it('still warns when --no-scenarios is explicitly passed for a change', () => {
    const res = spawnSync(
      'node',
      [codespecBin, 'show', 'demo', '--json', '--no-scenarios'],
      { encoding: 'utf-8', cwd: testDir }
    );
    expect(res.status).toBe(0);
    expect(res.stderr).toContain('忽略不适用于 change 的选项：scenarios');
  });

  it('auto-detects spec id and supports spec-only flags', () => {
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      const output = execFileSync('node', [codespecBin, 'show', 'auth', '--json', '--requirements'], { encoding: 'utf-8' });
      const json = JSON.parse(output);
      expect(json.id).toBe('auth');
      expect(Array.isArray(json.requirements)).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('preserves one-based Requirement indexes for legacy spec-driven JSON reads', () => {
    const result = spawnSync('node', [codespecBin, 'show', 'auth', '--type', 'spec', '--json', '--requirement', '1'], { cwd: testDir, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).requirements).toHaveLength(1);
  });

  it('handles ambiguity and suggests --type', async () => {
    // create matching spec and change named 'foo'
    await fs.mkdir(path.join(changesDir, 'foo'), { recursive: true });
    await fs.writeFile(path.join(changesDir, 'foo', 'proposal.md'), '# Change: Foo\n\n## Why\n\n## What Changes\n', 'utf-8');
    await fs.mkdir(path.join(specsDir, 'foo'), { recursive: true });
    await fs.writeFile(path.join(specsDir, 'foo', 'spec.md'), '## Purpose\n\n## Requirements\n\n### Requirement: R\nX', 'utf-8');

    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      let err: any;
      try {
        execFileSync('node', [codespecBin, 'show', 'foo'], { encoding: 'utf-8' });
      } catch (e) { err = e; }
      expect(err).toBeDefined();
      expect(err.status).not.toBe(0);
      const stderr = err.stderr.toString();
      expect(stderr).toContain("条目 'foo' 同时匹配 Change 和 Spec");
      expect(stderr).toContain('--type change|spec');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('resolves a scaffolded change that has no proposal.md yet', async () => {
    // `codespec new change <name>` writes only .codespec.yaml, so `show` must
    // resolve the change the same way `list` and `status` already do.
    await fs.mkdir(path.join(changesDir, 'scaffolded'), { recursive: true });
    await fs.writeFile(path.join(changesDir, 'scaffolded', '.codespec.yaml'), 'schema: spec-driven\n', 'utf-8');

    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      let err: any;
      try {
        execFileSync('node', [codespecBin, 'show', 'scaffolded'], { encoding: 'utf-8' });
      } catch (e) { err = e; }
      expect(err).toBeDefined();
      const stderr = err.stderr.toString();
      // Resolved as a change, not rejected as an unknown item.
      expect(stderr).not.toContain('Unknown item');
      expect(stderr).toContain('尚未创建 proposal.md');
      expect(stderr).toContain('codespec status --change scaffolded');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('offers a scaffolded change when "change show" is called without a name', async () => {
    await fs.mkdir(path.join(changesDir, 'scaffolded'), { recursive: true });
    await fs.writeFile(path.join(changesDir, 'scaffolded', '.codespec.yaml'), 'schema: spec-driven\n', 'utf-8');

    const originalCwd = process.cwd();
    const originalEnv = { ...process.env };
    try {
      process.chdir(testDir);
      process.env.OPEN_SPEC_INTERACTIVE = '0';
      let err: any;
      try {
        execFileSync('node', [codespecBin, 'change', 'show'], { encoding: 'utf-8' });
      } catch (e) { err = e; }
      expect(err).toBeDefined();
      const stderr = err.stderr.toString();
      expect(stderr).toContain('可用 ID：');
      expect(stderr).toContain('scaffolded');
    } finally {
      process.chdir(originalCwd);
      process.env = originalEnv;
    }
  });

  it('prints nearest matches when not found', () => {
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      let err: any;
      try {
        execFileSync('node', [codespecBin, 'show', 'unknown-item'], { encoding: 'utf-8' });
      } catch (e) { err = e; }
      expect(err).toBeDefined();
      expect(err.status).not.toBe(0);
      const stderr = err.stderr.toString();
      expect(stderr).toContain("未知条目 'unknown-item'");
      expect(stderr).toContain('你是否想输入：');
    } finally {
      process.chdir(originalCwd);
    }
  });
});
