import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_WORKFLOWS } from '../../src/core/profiles.js';

const { useKeypressMock, execFileSyncMock } = vi.hoisted(() => ({
  useKeypressMock: vi.fn(),
  execFileSyncMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
}));

vi.mock('@inquirer/core', () => ({
  createPrompt: vi.fn((view) => async (config: Record<string, never>) => {
    let keypressHandler: ((key: { name: string; ctrl: boolean }) => void) | undefined;
    useKeypressMock.mockImplementation((handler) => {
      keypressHandler = handler;
    });

    return new Promise<void>((resolve) => {
      view(config, resolve);
      keypressHandler?.({ name: 'return', ctrl: false });
    });
  }),
  isEnterKey: vi.fn((key) => key.name === 'return'),
  useKeypress: useKeypressMock,
}));

describe('welcome screen', () => {
  const originalNoColor = process.env.NO_COLOR;
  const originalNoAnimation = process.env.CODESPEC_NO_ANIMATION;
  const originalStdinIsTTY = process.stdin.isTTY;
  const originalStdoutIsTTY = process.stdout.isTTY;
  const originalColumns = process.stdout.columns;
  let writeSpy: ReturnType<typeof vi.spyOn<typeof process.stdout, 'write'>>;

  const writtenOutput = () =>
    writeSpy.mock.calls.map((call) => String(call[0])).join('');

  // The animated path paints on a timer, so assert against the static fallback.
  const renderStatically = () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  };

  beforeEach(() => {
    delete process.env.NO_COLOR;
    delete process.env.CODESPEC_NO_ANIMATION;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'columns', { value: 100, configurable: true });
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    useKeypressMock.mockClear();
    // Deterministic default: no OS-level reduced-motion preference detectable,
    // so animated-path tests behave the same on every machine.
    execFileSyncMock.mockReset();
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not available in tests');
    });
  });

  afterEach(() => {
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
    if (originalNoAnimation === undefined) {
      delete process.env.CODESPEC_NO_ANIMATION;
    } else {
      process.env.CODESPEC_NO_ANIMATION = originalNoAnimation;
    }
    Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutIsTTY, configurable: true });
    Object.defineProperty(process.stdout, 'columns', { value: originalColumns, configurable: true });
    vi.restoreAllMocks();
  });

  it('uses an Inquirer prompt to wait for Enter', async () => {
    const { showWelcomeScreen } = await import('../../src/ui/welcome-screen.js');

    await showWelcomeScreen(PUBLIC_WORKFLOWS);

    expect(useKeypressMock).toHaveBeenCalledOnce();
  });

  it('renders the HRHY CodeSpec brand in its static fallback', async () => {
    const { showWelcomeScreen } = await import('../../src/ui/welcome-screen.js');
    process.env.CODESPEC_NO_ANIMATION = '1';

    await showWelcomeScreen(PUBLIC_WORKFLOWS);

    expect(writtenOutput()).toContain('HRHY');
    expect(writtenOutput()).toContain('CodeSpec');
  });

  it('only advertises commands the profile installs', async () => {
    const { showWelcomeScreen } = await import('../../src/ui/welcome-screen.js');
    renderStatically();

    await showWelcomeScreen(PUBLIC_WORKFLOWS);

    const output = writtenOutput();

    expect(output).toContain('/codespec:workflow');
    expect(output).toContain('/codespec:rebase');
    expect(output).toContain('/codespec:archive');
    expect(output).not.toContain('/codespec:propose');
    expect(output).not.toContain('/codespec:apply');
  });

  it('only advertises public commands from a custom profile', async () => {
    const { showWelcomeScreen } = await import('../../src/ui/welcome-screen.js');
    renderStatically();

    await showWelcomeScreen(['workflow']);

    const output = writtenOutput();

    expect(output).toContain('/codespec:workflow');
    expect(output).not.toContain('/codespec:rebase');
    expect(output).not.toContain('/codespec:propose');
  });

  it('omits the quick start block when no onboarding workflow is installed', async () => {
    const { showWelcomeScreen } = await import('../../src/ui/welcome-screen.js');
    renderStatically();

    await showWelcomeScreen([]);

    const output = writtenOutput();

    expect(output).toContain('欢迎使用 HRHY CodeSpec');
    expect(output).not.toContain('设置完成后的快速开始：');
  });

  it('does not promise codespec commands in the setup summary', async () => {
    const { showWelcomeScreen } = await import('../../src/ui/welcome-screen.js');
    renderStatically();

    // This screen runs before tool selection, and skills-only tools (Codex,
    // Kimi Code, ...) correctly receive no command files, so the summary must
    // not state that codespec slash commands are part of every setup.
    await showWelcomeScreen([]);

    const output = writtenOutput();

    expect(output).toContain('AI 工具的 Agent Skills');
    expect(output).toContain('工作流命令（如果工具支持）');
    expect(output).not.toContain('codespec slash commands');
  });

  it('flags that the quick-start spelling varies by tool', async () => {
    const { showWelcomeScreen } = await import('../../src/ui/welcome-screen.js');
    renderStatically();

    // The quick start shows canonical names, but this screen renders one
    // prompt before tools are picked — an Amazon Q user types @codespec:workflow
    // and a Codex user $codespec-workflow, neither of which is shown here.
    await showWelcomeScreen(['workflow']);

    const output = writtenOutput();

    expect(output).toContain('/codespec:workflow');
    expect(output).toContain('不同工具的调用写法可能不同');
  });

  it('omits the spelling caveat when there is no quick start block', async () => {
    const { showWelcomeScreen } = await import('../../src/ui/welcome-screen.js');
    renderStatically();

    await showWelcomeScreen([]);

    expect(writtenOutput()).not.toContain('不同工具的调用写法可能不同');
  });

  it('keeps every rendered line inside the animation width budget', async () => {
    const { showWelcomeScreen } = await import('../../src/ui/welcome-screen.js');
    renderStatically();

    // The animated path moves the cursor up a fixed count of logical lines, so a
    // line that wraps at the narrowest animating terminal (MIN_WIDTH = 60) makes
    // each frame redraw lower than the last. Worst case is every command shown.
    await showWelcomeScreen(PUBLIC_WORKFLOWS);

    const rendered = writtenOutput().replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

    for (const line of rendered.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(59);
    }
  });

  it('renders statically when CODESPEC_NO_ANIMATION is set', async () => {
    const { showWelcomeScreen } = await import('../../src/ui/welcome-screen.js');
    process.env.CODESPEC_NO_ANIMATION = '1';

    await showWelcomeScreen(PUBLIC_WORKFLOWS);

    // Static rendering still waits for the Enter the prompt line asks for;
    // otherwise the keystroke falls through into the tool picker (#1462).
    expect(useKeypressMock).toHaveBeenCalledOnce();
    const output = writtenOutput();
    expect(output).toContain('欢迎使用 HRHY CodeSpec');
    expect(output).toContain('按 Enter');
    // No cursor-up repaints: the frame is drawn exactly once.
    expect(output).not.toMatch(/\x1b\[\d+A/);
  });

  it('honors CODESPEC_NO_ANIMATION even when set to an empty value', async () => {
    const { showWelcomeScreen } = await import('../../src/ui/welcome-screen.js');
    process.env.CODESPEC_NO_ANIMATION = '';

    await showWelcomeScreen(PUBLIC_WORKFLOWS);

    expect(useKeypressMock).toHaveBeenCalledOnce();
    expect(writtenOutput()).not.toMatch(/\x1b\[\d+A/);
  });

  it('renders statically when animate is disabled via options', async () => {
    const { showWelcomeScreen } = await import('../../src/ui/welcome-screen.js');

    await showWelcomeScreen(PUBLIC_WORKFLOWS, { animate: false });

    expect(useKeypressMock).toHaveBeenCalledOnce();
    const output = writtenOutput();
    expect(output).toContain('欢迎使用 HRHY CodeSpec');
    expect(output).not.toMatch(/\x1b\[\d+A/);
  });

  it('does not print an Enter prompt when standard input is not interactive', async () => {
    const { showWelcomeScreen } = await import('../../src/ui/welcome-screen.js');
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    renderStatically();

    await showWelcomeScreen(PUBLIC_WORKFLOWS);

    expect(writtenOutput()).not.toContain('按 Enter');
    expect(useKeypressMock).not.toHaveBeenCalled();
  });

  it.runIf(process.platform === 'darwin' || process.platform === 'linux')(
    'renders statically when the OS prefers reduced motion',
    async () => {
      const { showWelcomeScreen } = await import('../../src/ui/welcome-screen.js');
      execFileSyncMock.mockImplementation((file: string) =>
        file === 'defaults' ? '1\n' : 'false\n'
      );

      await showWelcomeScreen(PUBLIC_WORKFLOWS);

      expect(useKeypressMock).toHaveBeenCalledOnce();
      expect(writtenOutput()).toContain('欢迎使用 HRHY CodeSpec');
    }
  );
});

describe('prefersReducedMotion', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  it('detects macOS Reduce Motion', async () => {
    const { prefersReducedMotion } = await import('../../src/ui/welcome-screen.js');
    execFileSyncMock.mockReturnValue('1\n');

    expect(prefersReducedMotion('darwin')).toBe(true);
    expect(execFileSyncMock).toHaveBeenCalledWith(
      'defaults',
      ['read', 'com.apple.universalaccess', 'reduceMotion'],
      expect.objectContaining({ timeout: 500 })
    );
  });

  it('treats a disabled or unset macOS preference as no preference', async () => {
    const { prefersReducedMotion } = await import('../../src/ui/welcome-screen.js');

    execFileSyncMock.mockReturnValue('0\n');
    expect(prefersReducedMotion('darwin')).toBe(false);

    // `defaults read` exits non-zero while the key has never been toggled.
    execFileSyncMock.mockImplementation(() => {
      throw new Error('The domain/default pair does not exist');
    });
    expect(prefersReducedMotion('darwin')).toBe(false);
  });

  it('detects GNOME reduced motion via disabled animations', async () => {
    const { prefersReducedMotion } = await import('../../src/ui/welcome-screen.js');

    execFileSyncMock.mockReturnValue('false\n');
    expect(prefersReducedMotion('linux')).toBe(true);

    execFileSyncMock.mockReturnValue('true\n');
    expect(prefersReducedMotion('linux')).toBe(false);
  });

  it('returns false without spawning anything on other platforms', async () => {
    const { prefersReducedMotion } = await import('../../src/ui/welcome-screen.js');

    expect(prefersReducedMotion('win32')).toBe(false);
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });
});
