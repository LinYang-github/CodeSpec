import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  getGlobalDataDir,
  registerStore,
} from '../../src/core/index.js';
import { writeStoreMetadataState } from '../../src/core/store/foundation.js';
import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import { cleanupTempPath } from '../helpers/temp-cleanup.js';

const VALID_DELTA_SPEC = `## ADDED Requirements

### Requirement: Billing SHALL work
The system SHALL create bills.

#### Scenario: Creates bills
- **WHEN** a billing period ends
- **THEN** a bill is created
`;

describe('store root selection for normal commands', () => {
  let tempDir: string;
  let appRepo: string;
  let storeRoot: string;
  let globalDataDir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tempDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-store-root-selection-'))
    );
    env = {
      XDG_DATA_HOME: path.join(tempDir, 'data'),
      XDG_CONFIG_HOME: path.join(tempDir, 'config'),
      OPEN_SPEC_INTERACTIVE: '0',
      OPENSPEC_TELEMETRY: '0',
    };
    globalDataDir = getGlobalDataDir({ env });
    appRepo = path.join(tempDir, 'app-repo');
    fs.mkdirSync(appRepo, { recursive: true });
    storeRoot = await registerStoreFixture('team-context');
  });

  afterEach(() => {
    cleanupTempPath(tempDir);
  });

  function createOpenSpecRoot(rootDir: string): void {
    fs.mkdirSync(path.join(rootDir, 'openspec', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'openspec', 'changes', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
  }

  async function registerStoreFixture(id: string): Promise<string> {
    const root = path.join(tempDir, 'stores', id);
    createOpenSpecRoot(root);
    await registerStore({ id, localPath: root, globalDataDir });
    return fs.realpathSync.native(root);
  }

  function createChange(
    rootDir: string,
    name: string,
    options: { deltaSpec?: string | null; tasksDone?: boolean } = {}
  ): string {
    const changeDir = path.join(rootDir, 'openspec', 'changes', name);
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(
      path.join(changeDir, 'proposal.md'),
      '## Why\nBilling needs work.\n\n## What Changes\n- **billing:** Add billing\n'
    );
    fs.writeFileSync(
      path.join(changeDir, 'tasks.md'),
      options.tasksDone === false ? '- [ ] Task 1\n' : '- [x] Task 1\n'
    );
    if (options.deltaSpec !== null) {
      const specDir = path.join(changeDir, 'specs', 'billing');
      fs.mkdirSync(specDir, { recursive: true });
      fs.writeFileSync(path.join(specDir, 'spec.md'), options.deltaSpec ?? VALID_DELTA_SPEC);
    }
    return changeDir;
  }

  function parseJson(result: RunCLIResult): any {
    try {
      return JSON.parse(result.stdout);
    } catch (error) {
      throw new Error(
        `Could not parse JSON.\nCommand: ${result.command}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\n${String(error)}`
      );
    }
  }

  function expectNoLocalOpenSpec(): void {
    expect(fs.existsSync(path.join(appRepo, 'openspec'))).toBe(false);
  }

  describe('selecting a registered store by id', () => {
    it('creates a change only in the store and names the root on stderr', async () => {
      const result = await runCLI(['new', 'change', 'add-billing', '--store', 'team-context'], {
        cwd: appRepo,
        env,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain(`使用 OpenSpec 根目录：team-context（${storeRoot}）`);
      expect(result.stdout).toContain('已创建 Change：add-billing');
      expect(result.stdout).toContain(
        path.join(storeRoot, 'openspec', 'changes', 'add-billing')
      );

      expect(
        fs.existsSync(path.join(storeRoot, 'openspec', 'changes', 'add-billing'))
      ).toBe(true);
      expectNoLocalOpenSpec();
    });

    it('includes the shared root block and absolute paths in new change JSON', async () => {
      const result = await runCLI(
        ['new', 'change', 'add-billing', '--store', 'team-context', '--json'],
        { cwd: appRepo, env }
      );
      expect(result.exitCode).toBe(0);

      const json = parseJson(result);
      expect(json.root).toEqual({
        path: storeRoot,
        source: 'store',
        store_id: 'team-context',
      });
      expect(path.isAbsolute(json.change.path)).toBe(true);
      expect(json.change.path).toBe(
        path.join(storeRoot, 'openspec', 'changes', 'add-billing')
      );
      expectNoLocalOpenSpec();
    });

    it('wins over the nearest local root', async () => {
      const localRepo = path.join(tempDir, 'local-repo');
      createOpenSpecRoot(localRepo);
      createChange(localRepo, 'local-change');
      createChange(storeRoot, 'store-change');

      const result = await runCLI(['list', '--json', '--store', 'team-context'], {
        cwd: localRepo,
        env,
      });
      expect(result.exitCode).toBe(0);

      const json = parseJson(result);
      const names = json.changes.map((change: any) => change.name);
      expect(names).toContain('store-change');
      expect(names).not.toContain('local-change');
      expect(json.root.store_id).toBe('team-context');
    });

    it('lists an empty team store before any changes exist', async () => {
      const blankStoreRoot = path.join(tempDir, 'stores', 'blank-context');
      fs.mkdirSync(path.join(blankStoreRoot, 'openspec'), { recursive: true });
      fs.writeFileSync(
        path.join(blankStoreRoot, 'openspec', 'config.yaml'),
        'schema: spec-driven\n'
      );
      await writeStoreMetadataState(blankStoreRoot, {
        version: 1,
        id: 'blank-context',
      });
      const registered = await runCLI(
        ['store', 'register', blankStoreRoot, '--json'],
        { cwd: appRepo, env }
      );
      expect(registered.exitCode).toBe(0);

      const result = await runCLI(['list', '--json', '--store', 'blank-context'], {
        cwd: appRepo,
        env,
      });
      expect(result.exitCode).toBe(0);
      const json = parseJson(result);
      expect(json.changes).toEqual([]);
      expect(json.root).toEqual({
        path: fs.realpathSync.native(blankStoreRoot),
        source: 'store',
        store_id: 'blank-context',
      });
    });

    it('reads, validates, shows, and reports status in the selected store', async () => {
      createChange(storeRoot, 'store-change');

      const status = await runCLI(
        ['status', '--change', 'store-change', '--store', 'team-context', '--json'],
        { cwd: appRepo, env }
      );
      expect(status.exitCode).toBe(0);
      const statusJson = parseJson(status);
      expect(statusJson.changeName).toBe('store-change');
      expect(statusJson.schemaName).toBe('spec-driven');
      expect(statusJson.root).toEqual({
        path: storeRoot,
        source: 'store',
        store_id: 'team-context',
      });

      // The batch sweep must select the same root and carry the same store
      // context per change as the single-change path above.
      const batch = await runCLI(['status', '--all', '--store', 'team-context', '--json'], {
        cwd: appRepo,
        env,
      });
      expect(batch.exitCode).toBe(0);
      const batchJson = parseJson(batch);
      expect(batchJson.root).toEqual(statusJson.root);
      expect(batchJson.changes.map((change: { changeName: string }) => change.changeName)).toEqual([
        'store-change',
      ]);
      expect(batchJson.changes[0]).toEqual({ ...statusJson, root: undefined });

      const instructions = await runCLI(
        ['instructions', 'design', '--change', 'store-change', '--store', 'team-context', '--json'],
        { cwd: appRepo, env }
      );
      expect(instructions.exitCode).toBe(0);
      const instructionsJson = parseJson(instructions);
      expect(instructionsJson.artifactId).toBe('design');
      expect(instructionsJson.root.store_id).toBe('team-context');
      expect(path.isAbsolute(instructionsJson.changeDir)).toBe(true);
      expect(instructionsJson.changeDir).toContain(storeRoot);

      const show = await runCLI(
        ['show', 'store-change', '--store', 'team-context', '--json'],
        { cwd: appRepo, env }
      );
      expect(show.exitCode).toBe(0);
      const showJson = parseJson(show);
      expect(showJson.id).toBe('store-change');
      expect(showJson.root.store_id).toBe('team-context');

      const validate = await runCLI(
        ['validate', 'store-change', '--store', 'team-context', '--json'],
        { cwd: appRepo, env }
      );
      expect(validate.exitCode).toBe(0);
      const validateJson = parseJson(validate);
      expect(validateJson.items[0]).toMatchObject({ id: 'store-change', valid: true });
      expect(validateJson.root.store_id).toBe('team-context');

      expectNoLocalOpenSpec();
    });

    it('loads apply and archive operation inputs from the selected store root', async () => {
      createChange(storeRoot, 'store-change');
      fs.writeFileSync(
        path.join(storeRoot, 'openspec', 'config.yaml'),
        `schema: spec-driven
context: Store context
operations:
  apply:
    guidance:
      - Store apply guidance
  archive:
    guidance:
      - Store archive guidance
`
      );

      const applyResult = await runCLI(
        ['instructions', 'apply', '--change', 'store-change', '--store', 'team-context', '--json'],
        { cwd: appRepo, env }
      );
      const archiveResult = await runCLI(
        ['instructions', 'archive', '--change', 'store-change', '--store', 'team-context', '--json'],
        { cwd: appRepo, env }
      );

      expect(applyResult.exitCode).toBe(0);
      expect(parseJson(applyResult)).toMatchObject({
        context: 'Store context',
        operationGuidance: ['Store apply guidance'],
        root: { path: storeRoot, store_id: 'team-context' },
      });
      expect(archiveResult.exitCode).toBe(0);
      expect(parseJson(archiveResult)).toMatchObject({
        context: 'Store context',
        operationGuidance: ['Store archive guidance'],
        root: { path: storeRoot, store_id: 'team-context' },
      });
      expectNoLocalOpenSpec();
    });

    it('lists specs from the store with minimal JSON support', async () => {
      const specDir = path.join(storeRoot, 'openspec', 'specs', 'billing');
      fs.mkdirSync(specDir, { recursive: true });
      fs.writeFileSync(
        path.join(specDir, 'spec.md'),
        '# billing\n\n## Purpose\nBills.\n\n## Requirements\n\n### Requirement: Billing SHALL work\nThe system SHALL bill.\n\n#### Scenario: Bills\n- **WHEN** due\n- **THEN** billed\n'
      );

      const result = await runCLI(['list', '--specs', '--json', '--store', 'team-context'], {
        cwd: appRepo,
        env,
      });
      expect(result.exitCode).toBe(0);
      const json = parseJson(result);
      expect(json.specs).toEqual([{ id: 'billing', requirementCount: 1 }]);
      expect(json.root.store_id).toBe('team-context');
    });

    it('runs bulk validation against the selected store', async () => {
      createChange(storeRoot, 'store-change');

      const result = await runCLI(['validate', '--all', '--store', 'team-context', '--json'], {
        cwd: appRepo,
        env,
      });
      expect(result.exitCode).toBe(0);
      const json = parseJson(result);
      expect(json.items.map((item: any) => item.id)).toContain('store-change');
      expect(json.root.store_id).toBe('team-context');
    });

    it('requires interactive human confirmation before archiving a selected store change', async () => {
      createChange(storeRoot, 'store-change');

      const result = await runCLI(
        ['archive', 'store-change', '--store', 'team-context', '--json', '--yes'],
        { cwd: appRepo, env }
      );
      expect(result.exitCode).toBe(1);
      expect(parseJson(result).status[0].code).toBe('archive_confirmation_required');
      expect(
        fs.existsSync(path.join(storeRoot, 'openspec', 'changes', 'store-change'))
      ).toBe(true);
      expect(fs.readdirSync(path.join(storeRoot, 'openspec', 'changes', 'archive'))).toEqual([]);
      expectNoLocalOpenSpec();
    });
  });

  describe('human output and stdout purity', () => {
    it('keeps show stdout as the raw markdown payload', async () => {
      createChange(storeRoot, 'store-change');

      const result = await runCLI(['show', 'store-change', '--store', 'team-context'], {
        cwd: appRepo,
        env,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.startsWith('## Why')).toBe(true);
      expect(result.stderr).toContain(`使用 OpenSpec 根目录：team-context（${storeRoot}）`);
    });

    it('diffs a delta against the selected store\'s main specs', async () => {
      // A same-named capability sits in the cwd repo with different text. If
      // --diff resolved main specs against the cwd instead of the store root,
      // the diff below would be computed from this decoy.
      fs.mkdirSync(path.join(appRepo, 'openspec', 'specs', 'billing'), { recursive: true });
      fs.writeFileSync(
        path.join(appRepo, 'openspec', 'specs', 'billing', 'spec.md'),
        '# billing Specification\n\n## Purpose\nDecoy.\n\n## Requirements\n### Requirement: Billing SHALL work\nThe system SHALL create decoy bills.\n\n#### Scenario: Creates bills\n- **WHEN** a billing period ends\n- **THEN** a decoy bill is created\n'
      );
      fs.mkdirSync(path.join(storeRoot, 'openspec', 'specs', 'billing'), { recursive: true });
      fs.writeFileSync(
        path.join(storeRoot, 'openspec', 'specs', 'billing', 'spec.md'),
        '# billing Specification\n\n## Purpose\nBilling.\n\n## Requirements\n### Requirement: Billing SHALL work\nThe system SHALL create bills.\n\n#### Scenario: Creates bills\n- **WHEN** a billing period ends\n- **THEN** a bill is created\n'
      );
      createChange(storeRoot, 'store-change', {
        deltaSpec: '## MODIFIED Requirements\n\n### Requirement: Billing SHALL work\nThe system SHALL create bills monthly.\n\n#### Scenario: Creates bills\n- **WHEN** a billing period ends\n- **THEN** a bill is created\n',
      });

      const result = await runCLI(
        ['show', 'store-change', '--store', 'team-context', '--diff'],
        { cwd: appRepo, env }
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('MODIFIED: Billing SHALL work');
      expect(result.stdout).toContain('-The system SHALL create bills.');
      expect(result.stdout).toContain('+The system SHALL create bills monthly.');
      expect(result.stdout).not.toContain('decoy');
    });

    it('keeps instructions stdout as the artifact payload', async () => {
      createChange(storeRoot, 'store-change');

      const result = await runCLI(
        ['instructions', 'design', '--change', 'store-change', '--store', 'team-context'],
        { cwd: appRepo, env }
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.startsWith('<artifact id="design"')).toBe(true);
      expect(result.stderr).toContain('使用 OpenSpec 根目录：team-context');
    });

    it('writes the status banner to stderr in human mode', async () => {
      createChange(storeRoot, 'store-change');

      const result = await runCLI(
        ['status', '--change', 'store-change', '--store', 'team-context'],
        { cwd: appRepo, env }
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain(`使用 OpenSpec 根目录：team-context（${storeRoot}）`);
      expect(result.stdout).toContain('Change：store-change');
      expect(result.stdout).not.toContain('使用 OpenSpec 根目录');
    });
  });

  describe('selector errors', () => {
    it('rejects --store-path with register guidance', async () => {
      const result = await runCLI(['new', 'change', 'nope', '--store-path', '/x'], {
        cwd: appRepo,
        env,
      });
      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain('store register');
      expect(output).toContain('--store <id>');
      expectNoLocalOpenSpec();
      expect(fs.existsSync(path.join(storeRoot, 'openspec', 'changes', 'nope'))).toBe(false);
    });

    it('rejects show --store-path despite allowUnknownOption', async () => {
      const result = await runCLI(['show', '--store-path', '/x'], { cwd: appRepo, env });
      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain('store register');
    });

    it('reports unknown stores with the same message across commands', async () => {
      const expected =
        "未知 Store 'team-contxt'。已登记的 Store：team-context.";

      const status = await runCLI(['status', '--store', 'team-contxt'], { cwd: appRepo, env });
      const list = await runCLI(['list', '--store', 'team-contxt'], { cwd: appRepo, env });

      expect(status.exitCode).toBe(1);
      expect(list.exitCode).toBe(1);
      expect(status.stdout + status.stderr).toContain(expected);
      expect(list.stdout + list.stderr).toContain(expected);
    });

    it('rejects an invalid store id format before registry lookup', async () => {
      const result = await runCLI(['list', '--store', 'Bad_Id'], { cwd: appRepo, env });
      expect(result.exitCode).toBe(1);
      expect(result.stdout + result.stderr).toContain('kebab-case');
    });

    it('emits machine-readable resolver failures in JSON mode', async () => {
      const result = await runCLI(['status', '--json', '--store', 'team-contxt'], {
        cwd: appRepo,
        env,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stdout.trim().startsWith('{')).toBe(true);
      const json = parseJson(result);
      expect(json.status[0].code).toBe('unknown_store');
      expect(json.status[0].message).toContain('team-contxt');
    });

    it('reports a corrupt registry as machine-readable JSON, not prose', async () => {
      fs.writeFileSync(
        path.join(globalDataDir, 'stores', 'registry.yaml'),
        '{not yaml: ['
      );

      const result = await runCLI(['status', '--json', '--store', 'team-context'], {
        cwd: appRepo,
        env,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stdout.trim().startsWith('{')).toBe(true);
      const json = parseJson(result);
      expect(json.status[0].severity).toBe('error');
      expect(json.status[0].code).toBe('invalid_store_registry');
    });

    it('fails on an unhealthy store root and points to doctor', async () => {
      const brokenRoot = path.join(tempDir, 'stores', 'broken-context');
      fs.mkdirSync(brokenRoot, { recursive: true });
      await writeStoreMetadataState(brokenRoot, { version: 1, id: 'broken-context' });
      await registerStore({
        id: 'broken-context',
        localPath: brokenRoot,
        globalDataDir,
      });

      const result = await runCLI(['list', '--store', 'broken-context'], {
        cwd: appRepo,
        env,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stdout + result.stderr).toContain('store doctor');
      // No scaffolding or repair happened.
      expect(fs.existsSync(path.join(brokenRoot, 'openspec'))).toBe(false);
    });
  });

  describe('default resolution without --store', () => {
    it('fails with a store hint instead of scaffolding when no root exists', async () => {
      const result = await runCLI(['new', 'change', 'foo'], { cwd: appRepo, env });
      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain('team-context');
      expect(output).toContain('--store <id>');
      expect(output).toContain('openspec init');
      expectNoLocalOpenSpec();
    });

    it('treats leftover workspace state as no root at all', async () => {
      fs.mkdirSync(path.join(appRepo, '.openspec-workspace'), { recursive: true });
      fs.writeFileSync(
        path.join(appRepo, '.openspec-workspace', 'view.yaml'),
        'version: 1\nname: platform\ncontext: null\nlinks: {}\n'
      );

      const result = await runCLI(['status'], { cwd: appRepo, env });
      expect(result.exitCode).toBe(1);
      expect(result.stdout + result.stderr).toContain('team-context');
    });

    it('ignores leftover workspace state when a nearby root exists', async () => {
      const localRepo = path.join(tempDir, 'workspace-repo');
      createOpenSpecRoot(localRepo);
      fs.mkdirSync(path.join(localRepo, '.openspec-workspace'), { recursive: true });
      fs.writeFileSync(
        path.join(localRepo, '.openspec-workspace', 'view.yaml'),
        'version: 1\nname: platform\ncontext: null\nlinks: {}\n'
      );
      createChange(localRepo, 'local-change');

      const result = await runCLI(['status', '--change', 'local-change', '--json'], {
        cwd: localRepo,
        env,
      });
      expect(result.exitCode).toBe(0);
      const json = parseJson(result);
      expect(json.schemaName).toBe('spec-driven');
      expect(json.root.source).toBe('nearest');
      expect(json.root.store_id).toBeUndefined();
    });

    it('works inside the standalone repo itself without a flag', async () => {
      createChange(storeRoot, 'store-change');

      const result = await runCLI(['status', '--change', 'store-change', '--json'], {
        cwd: storeRoot,
        env,
      });
      expect(result.exitCode).toBe(0);
      const json = parseJson(result);
      expect(json.changeName).toBe('store-change');
      expect(json.root).toEqual({ path: storeRoot, source: 'nearest' });
    });

    it('keeps implicit-root behavior when no stores are registered', async () => {
      const isolatedEnv = {
        ...env,
        XDG_DATA_HOME: path.join(tempDir, 'data-empty'),
      };

      const result = await runCLI(['status', '--json'], { cwd: appRepo, env: isolatedEnv });
      expect(result.exitCode).toBe(0);
      const json = parseJson(result);
      expect(json.changes).toEqual([]);
      expect(json.root.source).toBe('implicit');
    });

    it('keeps list working for a legacy project.md root when no stores are registered', async () => {
      const isolatedEnv = {
        ...env,
        XDG_DATA_HOME: path.join(tempDir, 'data-empty'),
      };
      fs.mkdirSync(path.join(appRepo, 'openspec'), { recursive: true });
      fs.writeFileSync(path.join(appRepo, 'openspec', 'project.md'), '# Project\n');

      const result = await runCLI(['list', '--json'], { cwd: appRepo, env: isolatedEnv });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const json = parseJson(result);
      expect(json.changes).toEqual([]);
      expect({
        ...json.root,
        path: fs.realpathSync.native(json.root.path),
      }).toEqual({ path: fs.realpathSync.native(appRepo), source: 'implicit' });
    });

    it('rejects implicit roots for bulk validation and listing', async () => {
      const isolatedEnv = {
        ...env,
        XDG_DATA_HOME: path.join(tempDir, 'data-empty'),
      };

      for (const args of [
        ['validate', '--all'],
        ['validate', '--changes'],
        ['validate', '--specs'],
        ['list'],
        ['list', '--specs'],
      ]) {
        const result = await runCLI(args, { cwd: appRepo, env: isolatedEnv });
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain(
          '从当前目录开始未找到 OpenSpec 根目录。'
        );
        expect(result.stderr).not.toContain('没有可验证条目。');
        expect(result.stderr).not.toContain('没有活动 Change。');
        expect(result.stderr).not.toContain('没有 Spec。');
      }
    });

    it('reports missing roots as JSON instead of fabricating an implicit root', async () => {
      const isolatedEnv = {
        ...env,
        XDG_DATA_HOME: path.join(tempDir, 'data-empty'),
      };

      for (const args of [
        ['validate', '--all', '--json'],
        ['validate', '--changes', '--json'],
        ['validate', '--specs', '--json'],
        ['list', '--json'],
        ['list', '--specs', '--json'],
      ]) {
        const result = await runCLI(args, { cwd: appRepo, env: isolatedEnv });
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toBe('');

        const json = parseJson(result);
        if (args[0] === 'validate') {
          expect(json).not.toHaveProperty('root');
        } else {
          expect(json.root).toBeNull();
          expect(json[args.includes('--specs') ? 'specs' : 'changes']).toEqual([]);
        }
        expect(json.status[0]).toEqual(
          expect.objectContaining({
            severity: 'error',
            code: 'no_openspec_root',
            message: '从当前目录开始未找到 OpenSpec 根目录。',
          })
        );
      }
    });

    it('still accepts an existing root with no items', async () => {
      const isolatedEnv = {
        ...env,
        XDG_DATA_HOME: path.join(tempDir, 'data-empty'),
      };
      createOpenSpecRoot(appRepo);

      const result = await runCLI(['validate', '--all', '--json'], {
        cwd: appRepo,
        env: isolatedEnv,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const json = parseJson(result);
      expect(json.items).toEqual([]);
      expect(json.summary.totals).toEqual({ items: 0, passed: 0, failed: 0 });
      expect({
        ...json.root,
        path: fs.realpathSync.native(json.root.path),
      }).toEqual({ path: fs.realpathSync.native(appRepo), source: 'nearest' });
    });

    it('preserves direct validation behavior without a root', async () => {
      const isolatedEnv = {
        ...env,
        XDG_DATA_HOME: path.join(tempDir, 'data-empty'),
      };

      const result = await runCLI(['validate', 'missing'], {
        cwd: appRepo,
        env: isolatedEnv,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("未知条目 'missing'。");
      expect(result.stderr).not.toContain('No OpenSpec root found');
    });
  });

  describe('archive requires interactive human confirmation', () => {
    it('rejects JSON and --yes before resolving archive details', async () => {
      createChange(storeRoot, 'store-change');

      const result = await runCLI(
        ['archive', 'store-change', '--store', 'team-context', '--json', '--yes'],
        { cwd: appRepo, env }
      );
      expect(result.exitCode).toBe(1);
      expect(parseJson(result).status[0].code).toBe('archive_confirmation_required');
      expect(
        fs.existsSync(path.join(storeRoot, 'openspec', 'changes', 'store-change'))
      ).toBe(true);
      expect(fs.readdirSync(path.join(storeRoot, 'openspec', 'changes', 'archive'))).toEqual([]);
    });
  });

  describe('initiative links are retired from normal change flows', () => {
    it('rejects --initiative and creates no files', async () => {
      const localRepo = path.join(tempDir, 'initiative-repo');
      createOpenSpecRoot(localRepo);

      const result = await runCLI(
        ['new', 'change', 'linked-change', '--initiative', 'billing-launch'],
        { cwd: localRepo, env }
      );
      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain('--initiative 已不再支持');
      expect(
        fs.existsSync(path.join(localRepo, 'openspec', 'changes', 'linked-change'))
      ).toBe(false);
    });

    it('removes openspec set change entirely', async () => {
      const localRepo = path.join(tempDir, 'set-change-repo');
      createOpenSpecRoot(localRepo);
      createChange(localRepo, 'existing-change');
      const metadataPath = path.join(
        localRepo,
        'openspec',
        'changes',
        'existing-change',
        '.openspec.yaml'
      );

      const result = await runCLI(
        ['set', 'change', 'existing-change', '--initiative', 'billing-launch'],
        { cwd: localRepo, env }
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout + result.stderr).toContain('unknown command');
      expect(fs.existsSync(metadataPath)).toBe(false);

      const help = await runCLI(['--help'], { cwd: localRepo, env });
      expect(help.stdout).not.toContain('Set checked-in OpenSpec metadata');
      expect(help.stdout).not.toMatch(/^\s*set\s/m);
    });
  });

  describe('setup and register point to --store usage', () => {
    it('shows --store usage after setup', async () => {
      const result = await runCLI(
        ['store', 'setup', 'fresh-context', '--path', path.join(tempDir, 'fresh-context'), '--no-init-git'],
        { cwd: appRepo, env }
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('openspec new change <change-id> --store fresh-context');
    });

    it('shows --store usage after register', async () => {
      const registerRoot = path.join(tempDir, 'register-context');
      createOpenSpecRoot(registerRoot);
      await writeStoreMetadataState(registerRoot, {
        version: 1,
        id: 'register-context',
      });

      const result = await runCLI(['store', 'register', registerRoot], {
        cwd: appRepo,
        env,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('openspec new change <change-id> --store register-context');
    });
  });
});
