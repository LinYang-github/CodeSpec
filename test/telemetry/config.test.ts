import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getConfigPath,
  getTelemetryConfig,
  readConfig,
  updateTelemetryConfig,
  writeConfig,
} from '../../src/telemetry/config.js';

describe('telemetry/config', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codespec-telemetry-test-'));
    originalEnv = { ...process.env };
    process.env.XDG_CONFIG_HOME = path.join(tempDir, 'xdg');
    process.env.HOME = tempDir;
    process.env.USERPROFILE = tempDir;
    process.env.APPDATA = path.join(tempDir, 'appdata');
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses only the CodeSpec-owned configuration path', () => {
    expect(getConfigPath()).toBe(path.join(tempDir, 'xdg', 'codespec', 'config.json'));
  });

  it('returns an empty config when no CodeSpec config has been written', async () => {
    await expect(readConfig()).resolves.toEqual({});
  });

  it('does not read or migrate a legacy configuration path', async () => {
    const legacyPath = path.join(tempDir, '.config', 'codespec', 'config.json');
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(legacyPath, JSON.stringify({ telemetry: { anonymousId: 'legacy-id' } }));

    await expect(readConfig()).resolves.toEqual({});
    expect(fs.existsSync(getConfigPath())).toBe(false);
  });

  it('preserves unrelated configuration fields while deep-merging telemetry state', async () => {
    await writeConfig({ existingField: 'kept', telemetry: { anonymousId: 'id-1' } });
    await updateTelemetryConfig({ noticeSeen: true });

    await expect(readConfig()).resolves.toEqual({
      existingField: 'kept',
      telemetry: { anonymousId: 'id-1', noticeSeen: true },
    });
    await expect(getTelemetryConfig()).resolves.toEqual({
      anonymousId: 'id-1',
      noticeSeen: true,
    });
  });
});
