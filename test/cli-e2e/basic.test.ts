import { afterAll, describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { runCLI, cliProjectRoot } from '../helpers/run-cli.js';
import { AI_TOOLS } from '../../src/core/config.js';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

const tempRoots: string[] = [];

async function prepareFixture(fixtureName: string): Promise<string> {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'openspec-cli-e2e-'));
  tempRoots.push(base);
  const projectDir = path.join(base, 'project');
  await fs.mkdir(projectDir, { recursive: true });
  const fixtureDir = path.join(cliProjectRoot, 'test', 'fixtures', fixtureName);
  await fs.cp(fixtureDir, projectDir, { recursive: true });
  return projectDir;
}

function expectJsonOnlyOutput(result: Awaited<ReturnType<typeof runCLI>>) {
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(() => JSON.parse(result.stdout)).not.toThrow();
}

afterAll(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('openspec CLI e2e basics', () => {
  it('shows help output', async () => {
    const result = await runCLI(['--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: openspec');
    expect(result.stderr).toBe('');

  });

  it('shows dynamic tool ids in init help', async () => {
    const result = await runCLI(['init', '--help']);
    expect(result.exitCode).toBe(0);

    const expectedTools = AI_TOOLS.filter((tool) => tool.available)
      .map((tool) => tool.value)
      .join(', ');
    const normalizedOutput = result.stdout.replace(/\s+/g, ' ').trim();
    expect(normalizedOutput).toContain(
      `可使用 "all"、"none"，或逗号分隔的工具 ID：${expectedTools}`
    );
    expect(normalizedOutput).toContain('--language <language>');
  });

  it('reports the package version', async () => {
    const pkgRaw = await fs.readFile(path.join(cliProjectRoot, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw);
    const result = await runCLI(['--version']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
  });

  it('validates the tmp-init fixture with --all --json', async () => {
    const projectDir = await prepareFixture('tmp-init');
    const result = await runCLI(['validate', '--all', '--json'], { cwd: projectDir });
    expect(result.exitCode).toBe(0);
    const output = result.stdout.trim();
    expect(output).not.toBe('');
    const json = JSON.parse(output);
    expect(json.summary?.totals?.failed).toBe(0);
    expect(json.items.some((item: any) => item.id === 'c1' && item.type === 'change')).toBe(true);
  });

  it('keeps list --json free of spinner output', async () => {
    const projectDir = await prepareFixture('tmp-init');
    const result = await runCLI(['list', '--json'], { cwd: projectDir });
    expectJsonOnlyOutput(result);
  });

  it('keeps schemas --json free of spinner output', async () => {
    const projectDir = await prepareFixture('tmp-init');
    const result = await runCLI(['schemas', '--json'], { cwd: projectDir });
    expectJsonOnlyOutput(result);
  });

  it('keeps status --json free of spinner output', async () => {
    const projectDir = await prepareFixture('tmp-init');
    const result = await runCLI(['status', '--change', 'c1', '--json'], { cwd: projectDir });
    expectJsonOnlyOutput(result);
  });

  it('keeps instructions --json free of spinner output', async () => {
    const projectDir = await prepareFixture('tmp-init');
    const result = await runCLI(['instructions', 'proposal', '--change', 'c1', '--json'], {
      cwd: projectDir,
    });
    expectJsonOnlyOutput(result);
  });

  it('keeps instructions apply --json free of spinner output', async () => {
    const projectDir = await prepareFixture('tmp-init');
    const result = await runCLI(['instructions', 'apply', '--change', 'c1', '--json'], {
      cwd: projectDir,
    });
    expectJsonOnlyOutput(result);
  });

  it('keeps templates --json free of spinner output', async () => {
    const projectDir = await prepareFixture('tmp-init');
    const result = await runCLI(['templates', '--json'], { cwd: projectDir });
    expectJsonOnlyOutput(result);
  });

  it('returns an error for unknown items in the fixture', async () => {
    const projectDir = await prepareFixture('tmp-init');
    const result = await runCLI(['validate', 'does-not-exist'], { cwd: projectDir });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("未知条目 'does-not-exist'");
  });

  describe('init command non-interactive options', () => {
    it('initializes artifact language non-interactively', async () => {
      const projectDir = await prepareFixture('tmp-init');
      const emptyProjectDir = path.join(projectDir, '..', 'language-project');
      await fs.mkdir(emptyProjectDir, { recursive: true });

      const result = await runCLI(
        ['init', '--tools', 'none', '--language', 'French', '--no-animation'],
        { cwd: emptyProjectDir },
      );

      expect(result.exitCode).toBe(0);
      const config = await fs.readFile(
        path.join(emptyProjectDir, 'openspec', 'config.yaml'),
        'utf-8',
      );
      expect(config).toContain('语言：French');
      expect(config).toContain('所有产物必须使用 French 编写。');
      expect(config).toContain('保留 OpenSpec 结构标题以及 SHALL/MUST 关键词为英文。');

      await fs.appendFile(
        path.join(emptyProjectDir, 'openspec', 'business.md'),
        '\n| MOD-001 | 语言设置 | 管理产物语言 | 配置语言 | 用户 |\n',
        'utf-8'
      );

      const created = await runCLI(['new', 'change', 'language-check', '--json'], {
        cwd: emptyProjectDir,
      });
      expect(created.exitCode).toBe(0);
      const changeId = JSON.parse(created.stdout).change.id;
      const instructions = await runCLI(
        ['instructions', 'propose', '--change', changeId, '--json'],
        { cwd: emptyProjectDir },
      );
      expect(instructions.exitCode).toBe(0);
      expect(JSON.parse(instructions.stdout).instructions).toContain('语言：French');
    });

    it('initializes with --tools all option', async () => {
      const projectDir = await prepareFixture('tmp-init');
      const emptyProjectDir = path.join(projectDir, '..', 'empty-project');
      await fs.mkdir(emptyProjectDir, { recursive: true });

      const codexHome = path.join(emptyProjectDir, '.codex');
      const testHome = path.join(emptyProjectDir, 'home');
      const result = await runCLI(['init', '--tools', 'all'], {
        cwd: emptyProjectDir,
        env: { CODEX_HOME: codexHome, HOME: testHome, USERPROFILE: testHome },
        timeoutMs: 20000,
      });
      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('OpenSpec 设置完成');

      // Check that skills were created for multiple tools
      const claudeSkillPath = path.join(emptyProjectDir, '.claude/skills/openspec-explore/SKILL.md');
      const cursorSkillPath = path.join(emptyProjectDir, '.cursor/skills/openspec-explore/SKILL.md');
      const minimaxSkillPath = path.join(
        testHome,
        '.minimax/skills/openspec-explore/SKILL.md'
      );
      expect(await fileExists(claudeSkillPath)).toBe(true);
      expect(await fileExists(cursorSkillPath)).toBe(true);
      expect(await fileExists(minimaxSkillPath)).toBe(true);
    }, 25000);

    it('initializes with --tools list option', async () => {
      const projectDir = await prepareFixture('tmp-init');
      const emptyProjectDir = path.join(projectDir, '..', 'empty-project');
      await fs.mkdir(emptyProjectDir, { recursive: true });

      const result = await runCLI(['init', '--tools', 'claude'], { cwd: emptyProjectDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('OpenSpec 设置完成');
      expect(result.stdout).toContain('Claude Code');

      // New init creates skills, not CLAUDE.md
      const claudeSkillPath = path.join(emptyProjectDir, '.claude/skills/openspec-explore/SKILL.md');
      const cursorSkillPath = path.join(emptyProjectDir, '.cursor/skills/openspec-explore/SKILL.md');
      expect(await fileExists(claudeSkillPath)).toBe(true);
      expect(await fileExists(cursorSkillPath)).toBe(false); // Not selected
    });

    it('initializes with --tools agents option', async () => {
      const projectDir = await prepareFixture('tmp-init');
      const emptyProjectDir = path.join(projectDir, '..', 'empty-project');
      await fs.mkdir(emptyProjectDir, { recursive: true });

      const result = await runCLI(['init', '--tools', 'agents'], { cwd: emptyProjectDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('OpenSpec 设置完成');

      const skillPath = path.join(emptyProjectDir, '.agents', 'skills', 'openspec-explore', 'SKILL.md');
      expect(await fileExists(skillPath)).toBe(true);
    });

    it('initializes with --tools zed option', async () => {
      const projectDir = await prepareFixture('tmp-init');
      const emptyProjectDir = path.join(projectDir, '..', 'empty-project');
      await fs.mkdir(emptyProjectDir, { recursive: true });

      const result = await runCLI(['init', '--tools', 'zed'], { cwd: emptyProjectDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('OpenSpec 设置完成');
      expect(result.stdout).toContain('Zed Agent');
      expect(result.stdout).not.toContain('Restart your IDE');

      const skillPath = path.join(emptyProjectDir, '.agents', 'skills', 'openspec-explore', 'SKILL.md');
      expect(await fileExists(skillPath)).toBe(true);
      expect(await fs.readFile(
        path.join(emptyProjectDir, '.agents', 'skills', '.openspec-target'),
        'utf-8'
      )).toBe('zed\n');

      const updateResult = await runCLI(['update'], { cwd: emptyProjectDir });
      expect(updateResult.exitCode).toBe(0);
      expect(await fs.readFile(
        path.join(emptyProjectDir, '.agents', 'skills', '.openspec-target'),
        'utf-8'
      )).toBe('zed\n');
      const updatedSkill = await fs.readFile(skillPath, 'utf-8');
      expect(updatedSkill).toContain('/openspec-explore');
      expect(updatedSkill).not.toContain('$openspec-explore');
    });

    it('initializes with --tools none option', async () => {
      const projectDir = await prepareFixture('tmp-init');
      const emptyProjectDir = path.join(projectDir, '..', 'empty-project');
      await fs.mkdir(emptyProjectDir, { recursive: true });

      const result = await runCLI(['init', '--tools', 'none'], { cwd: emptyProjectDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('OpenSpec 设置完成');

      // With --tools none, no tool skills should be created
      const claudeSkillPath = path.join(emptyProjectDir, '.claude/skills/openspec-explore/SKILL.md');
      const cursorSkillPath = path.join(emptyProjectDir, '.cursor/skills/openspec-explore/SKILL.md');

      expect(await fileExists(claudeSkillPath)).toBe(false);
      expect(await fileExists(cursorSkillPath)).toBe(false);
    });

    it('returns error for invalid tool names', async () => {
      const projectDir = await prepareFixture('tmp-init');
      const emptyProjectDir = path.join(projectDir, '..', 'empty-project');
      await fs.mkdir(emptyProjectDir, { recursive: true });

      const result = await runCLI(['init', '--tools', 'invalid-tool'], { cwd: emptyProjectDir });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Invalid tool(s): invalid-tool');
      expect(result.stderr).toContain('Available values:');
    });

    it('returns error when combining reserved keywords with explicit ids', async () => {
      const projectDir = await prepareFixture('tmp-init');
      const emptyProjectDir = path.join(projectDir, '..', 'empty-project');
      await fs.mkdir(emptyProjectDir, { recursive: true });

      const result = await runCLI(['init', '--tools', 'all,claude'], { cwd: emptyProjectDir });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Cannot combine reserved values "all" or "none" with specific tool IDs');
    });
  });

  describe('archive requires interactive human confirmation', () => {
    // runCLI closes the child's stdin, which is exactly how an AI agent or a
    // CI script invokes the CLI.
    async function prepareChange(options: { tasksComplete?: boolean } = {}): Promise<string> {
      const base = await fs.mkdtemp(path.join(tmpdir(), 'openspec-archive-e2e-'));
      tempRoots.push(base);
      const changeDir = path.join(base, 'openspec', 'changes', 'add-greeting');
      await fs.mkdir(path.join(changeDir, 'specs', 'greeting'), { recursive: true });
      await fs.mkdir(path.join(base, 'openspec', 'specs'), { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'proposal.md'),
        '## Why\nThis change exists to document greeting behavior for the team, which is long enough.\n\n## What Changes\n- Add a greeting requirement.\n'
      );
      await fs.writeFile(
        path.join(changeDir, 'tasks.md'),
        options.tasksComplete === false ? '- [ ] Task 1\n' : '- [x] Task 1\n'
      );
      await fs.writeFile(
        path.join(changeDir, 'specs', 'greeting', 'spec.md'),
        '## ADDED Requirements\n\n### Requirement: Greeting\nThe system SHALL greet the user.\n\n#### Scenario: Greets on request\n- **WHEN** the user says hello\n- **THEN** the system greets back\n'
      );
      return base;
    }

    it('rejects a non-interactive archive before any archive prompt', async () => {
      const projectDir = await prepareChange();
      const result = await runCLI(['archive', 'add-greeting'], { cwd: projectDir });

      const output = `${result.stdout}${result.stderr}`;
      expect(result.exitCode).toBe(1);
      expect(output).toContain('归档必须在交互式终端中由人工确认');
      expect(output).not.toContain('no answer could be read from stdin');

      // The change is untouched: nothing was archived or merged.
      expect(await fileExists(path.join(projectDir, 'openspec', 'changes', 'add-greeting', 'proposal.md'))).toBe(true);
      expect(await fileExists(path.join(projectDir, 'openspec', 'specs', 'greeting', 'spec.md'))).toBe(false);
    });

    it('does not inspect incomplete tasks before confirmation', async () => {
      const projectDir = await prepareChange({ tasksComplete: false });
      const result = await runCLI(['archive', 'add-greeting'], { cwd: projectDir });

      const output = `${result.stdout}${result.stderr}`;
      expect(result.exitCode).toBe(1);
      expect(output).toContain('归档必须在交互式终端中由人工确认');
      expect(output).not.toContain('1 incomplete task(s) found');
    });

    it('rejects --yes and --json instead of allowing an automated archive', async () => {
      const projectDir = await prepareChange({ tasksComplete: false });
      const result = await runCLI(['archive', 'add-greeting', '--json', '--yes'], { cwd: projectDir });

      const output = `${result.stdout}${result.stderr}`;
      expect(result.exitCode).toBe(1);
      expect(output).toContain('archive_confirmation_required');
      expect(output).toContain('归档必须在交互式终端中由人工确认');
      expect(await fileExists(path.join(projectDir, 'openspec', 'changes', 'add-greeting', 'proposal.md'))).toBe(true);
    });
  });
});
