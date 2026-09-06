import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  isTelemetryEnabled,
  maybeShowTelemetryNotice,
  shutdown,
  trackCommand,
} from '../../src/telemetry/index.js';

describe('telemetry/index', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codespec-telemetry-test-'));
    originalEnv = { ...process.env };
    process.env.XDG_CONFIG_HOME = tempDir;
    delete process.env.CI;
    delete process.env.DO_NOT_TRACK;
    delete process.env.CODESPEC_TELEMETRY;
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    await shutdown();
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('is disabled until an HRHY-owned telemetry endpoint is provisioned', () => {
    expect(isTelemetryEnabled()).toBe(false);
  });

  it('remains disabled even if a local config requests telemetry', () => {
    const configDir = path.join(tempDir, 'codespec');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ telemetry: { enabled: true } }));

    expect(isTelemetryEnabled()).toBe(false);
  });

  it('does not send command data, create an anonymous id, or show a telemetry notice', async () => {
    await trackCommand('init', '1.0.0');
    await maybeShowTelemetryNotice();
    await shutdown();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(tempDir, 'codespec', 'config.json'))).toBe(false);
  });
});
