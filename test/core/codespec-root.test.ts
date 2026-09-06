import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';

import {
  DEFAULT_CODESPEC_SCHEMA,
  ensureCodeSpecRoot,
  inspectCodeSpecRoot,
  rollbackCreatedPaths,
} from '../../src/core/index.js';
import { parseWorkspaceConfig } from '../../src/core/codespec-workflow/schemas.js';

describe('CodeSpec root helper', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codespec-root-helper-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createHealthyRoot(root: string, configName = 'config.yaml'): void {
    fs.mkdirSync(path.join(root, 'codespec', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'codespec', 'changes', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(root, 'codespec', configName), `schema: ${DEFAULT_CODESPEC_SCHEMA}\n`);
  }

  it('inspects a healthy root with config.yaml', async () => {
    const root = path.join(tempDir, 'store');
    createHealthyRoot(root);

    await expect(inspectCodeSpecRoot(root)).resolves.toEqual(expect.objectContaining({
      healthy: true,
      present: true,
      config: {
        present: true,
        path: 'codespec/config.yaml',
      },
      diagnostics: [],
    }));
  });

  it('inspects a healthy root with config.yml', async () => {
    const root = path.join(tempDir, 'store');
    createHealthyRoot(root, 'config.yml');

    await expect(inspectCodeSpecRoot(root)).resolves.toEqual(expect.objectContaining({
      healthy: true,
      config: {
        present: true,
        path: 'codespec/config.yml',
      },
    }));
  });

  it('reports missing root pieces without mutating files', async () => {
    const root = path.join(tempDir, 'store');
    fs.mkdirSync(path.join(root, 'codespec', 'changes'), { recursive: true });

    const inspection = await inspectCodeSpecRoot(root);

    expect(inspection.healthy).toBe(false);
    expect(inspection.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'codespec_config_missing',
    ]);
    expect(fs.existsSync(path.join(root, 'codespec', 'changes', 'archive'))).toBe(false);
  });

  it('accepts roots before changes, applied specs, or archives exist', async () => {
    const root = path.join(tempDir, 'store');
    fs.mkdirSync(path.join(root, 'codespec'), { recursive: true });
    fs.writeFileSync(path.join(root, 'codespec', 'config.yaml'), `schema: ${DEFAULT_CODESPEC_SCHEMA}\n`);

    const inspection = await inspectCodeSpecRoot(root);

    expect(inspection).toEqual(expect.objectContaining({
      healthy: true,
      specs: { present: false },
      changes: { present: false },
      archive: { present: false },
      diagnostics: [],
    }));
  });

  it('reports malformed optional planning paths without throwing', async () => {
    const root = path.join(tempDir, 'store');
    fs.mkdirSync(path.join(root, 'codespec'), { recursive: true });
    fs.writeFileSync(path.join(root, 'codespec', 'config.yaml'), `schema: ${DEFAULT_CODESPEC_SCHEMA}\n`);
    fs.writeFileSync(path.join(root, 'codespec', 'changes'), 'not a directory\n');

    const inspection = await inspectCodeSpecRoot(root);

    expect(inspection.healthy).toBe(false);
    expect(inspection.changes).toEqual({ present: false });
    expect(inspection.archive).toEqual({ present: false });
    expect(inspection.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'codespec_changes_not_directory',
    ]);
  });

  it('ensures the default root shape and records created paths', async () => {
    const root = path.join(tempDir, 'store');

    const result = await ensureCodeSpecRoot(root);

    expect(result.createdArtifacts).toEqual([
      'codespec/',
      'codespec/specs/',
      'codespec/changes/',
      'codespec/changes/archive/',
      'codespec/config.yaml',
    ]);
    expect(result.inspection.healthy).toBe(true);
    expect(parseWorkspaceConfig(parseYaml(
      fs.readFileSync(path.join(root, 'codespec', 'config.yaml'), 'utf-8')
    ))).toMatchObject({
      schema: DEFAULT_CODESPEC_SCHEMA,
      project: { name: 'store' },
    });
  });

  it('preserves existing config and user files', async () => {
    const root = path.join(tempDir, 'store');
    createHealthyRoot(root, 'config.yml');
    fs.writeFileSync(path.join(root, 'codespec', 'specs', 'note.md'), 'keep me\n');

    const result = await ensureCodeSpecRoot(root);

    expect(result.createdArtifacts).toEqual([]);
    expect(fs.existsSync(path.join(root, 'codespec', 'config.yaml'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'codespec', 'config.yml'), 'utf-8')).toBe(
      `schema: ${DEFAULT_CODESPEC_SCHEMA}\n`
    );
    expect(fs.readFileSync(path.join(root, 'codespec', 'specs', 'note.md'), 'utf-8')).toBe(
      'keep me\n'
    );
  });

  it('rolls back only ledger-created files and empty directories', async () => {
    const root = path.join(tempDir, 'store');
    const result = await ensureCodeSpecRoot(root);
    fs.writeFileSync(path.join(root, 'user.md'), 'mine\n');

    await rollbackCreatedPaths(result.createdPaths);

    expect(fs.existsSync(path.join(root, 'codespec'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'user.md'), 'utf-8')).toBe('mine\n');
  });
});
