import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { archiveChange, preflightArchive, prepareArchive, commitConfirmedArchive, __setArchiveTestHooksForTests } from '../../../src/core/codespec-workflow/archive-transaction.js';
import { verificationArtifactIdentity } from '../../../src/core/codespec-workflow/verification.js';
import { ensureCliBuilt } from '../../helpers/run-cli.js';
import { parseCurrentSpecification, renderCurrentSpecification } from '../../../src/core/codespec-workflow/current-spec-model.js';
import { loadChangeArtifacts, loadWorkspace } from '../../../src/core/codespec-workflow/loaders.js';
import { createCurrentArchiveFixture, modification, requirement, writeCanonicalChange } from '../../helpers/current-archive.js';
import { snapshotDirectory } from '../../helpers/fs-snapshot.js';
import { approveStage } from '../../../src/core/codespec-workflow/approvals.js';
import type { WorkspacePaths } from '../../../src/core/codespec-workflow/paths.js';

// Keep real filesystem behavior while allowing a deterministic concurrent
// write immediately after one read, before preflight captures its tree.
vi.mock('node:fs/promises', async (importOriginal) => ({ ...await importOriginal<typeof import('node:fs/promises')>() }));

interface ExpectedEscrow {
  transactionId: string;
  retained: Array<{ phase: string; target: string; file: string; expectedChecksum: string; bytes: string }>;
}

async function expectedEscrowAtFailure(paths: WorkspacePaths): Promise<ExpectedEscrow> {
  const pending = (await fs.readdir(paths.transactions)).filter((entry) => !entry.startsWith('.'));
  expect(pending).toHaveLength(1);
  const manifest = parse(await fs.readFile(path.join(paths.transactions, pending[0], 'journal.yaml'), 'utf8'));
  const retained: ExpectedEscrow['retained'] = [];
  for (const [index, entry] of (manifest.entries as Array<{ target: string; before: string | null; after: string | null }>).entries()) {
    const current = await fs.readFile(path.join(paths.codespecDir, entry.target), 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (entry.before === entry.after || current !== entry.after) continue;
    for (const [phase, bytes] of [['installation', entry.before], ['recovery', entry.after]] as const) {
      if (bytes !== null) retained.push({ phase, target: entry.target, file: `${phase}/${index}/displaced`, bytes,
        expectedChecksum: `sha256:${createHash('sha256').update(bytes).digest('hex')}` });
    }
  }
  return { transactionId: manifest.transactionId, retained };
}

/** Keep the complete old tree equality assertion, adding only the exact
 * durable safety records that are now part of the approved rollback contract.
 */
async function expectRestoredWithSafetyRecords(paths: WorkspacePaths, before: Map<string, string>, escrow?: ExpectedEscrow): Promise<void> {
  const expected = new Map(before);
  const relative = (file: string) => path.relative(paths.codespecDir, file).split(path.sep).join('/');
  const addFile = (file: string, content: string) => {
    let directory = path.posix.dirname(file);
    while (directory !== '.') { expected.set(`${directory}/`, ''); directory = path.posix.dirname(directory); }
    expected.set(file, content);
  };
  const ledger = `${paths.changeIndex}.lock-ledger`;
  const generations = escrow ? ['000000000001', '000000000002', '000000000003'] : ['000000000001', '000000000002'];
  expect((await fs.readdir(ledger)).sort()).toEqual(generations.flatMap((generation) => [`${generation}.owner`, `${generation}.owner.released`]));
  const tokens: string[] = [];
  for (const generation of generations) {
    const ownerPath = path.join(ledger, `${generation}.owner`);
    const bytes = await fs.readFile(ownerPath, 'utf8');
    const owner = JSON.parse(bytes);
    expect(owner).toEqual({ version: 1, kind: 'codespec-index-lock-mutation', pid: process.pid, token: expect.stringMatching(/^[0-9a-f-]{36}$/u) });
    tokens.push(owner.token);
    expect(await fs.readFile(`${ownerPath}.released`, 'utf8')).toBe(bytes);
    addFile(relative(ownerPath), bytes);
    addFile(relative(`${ownerPath}.released`), bytes);
  }
  expect(new Set(tokens).size).toBe(generations.length);
  if (escrow && escrow.retained.length) {
    const root = path.join(paths.transactions, '.recovery-escrow');
    expect(await fs.readdir(root)).toEqual([escrow.transactionId]);
    const directory = path.join(root, escrow.transactionId);
    const manifest = await fs.readFile(path.join(directory, 'manifest.yaml'), 'utf8');
    expect(parse(manifest)).toEqual({
      version: 1, transactionId: escrow.transactionId, outcome: 'rolled-back', cleanupPolicy: 'manual-only',
      reason: 'Displaced inodes may still receive author writes through previously opened handles.',
      retained: escrow.retained.map(({ bytes: _bytes, ...entry }) => entry),
    });
    addFile(relative(path.join(directory, 'manifest.yaml')), manifest);
    for (const entry of escrow.retained) addFile(relative(path.join(directory, entry.file)), entry.bytes);
  }
  expect(snapshotDirectory(paths.codespecDir)).toEqual(expected);
}

describe('six-artifact canonical Requirement archive', () => {
  it('marks every other active Change stale after archive', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      await writeCanonicalChange(fixture, modification());
      const secondChangeId = 'CHG-20260901-002';
      await writeCanonicalChange(fixture, modification(), secondChangeId);
      const workspace = await loadWorkspace(fixture.codespecDir);
      await archiveChange(workspace, fixture.changeId);
      expect((await loadChangeArtifacts(workspace.paths, secondChangeId)).metadata.baseline.stale).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects a retired codespec/archive directory without deleting its contents', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      await writeCanonicalChange(fixture, modification());
      const retiredFile = path.join(fixture.codespecDir, 'archive', 'keep.txt');
      await fs.mkdir(path.dirname(retiredFile), { recursive: true });
      await fs.writeFile(retiredFile, 'author data\n');
      const before = snapshotDirectory(fixture.codespecDir);

      await expect(archiveChange(await loadWorkspace(fixture.codespecDir), fixture.changeId))
        .rejects.toThrow(/已废弃的 codespec\/archive/);

      expect(snapshotDirectory(fixture.codespecDir)).toEqual(before);
    } finally {
      fixture.cleanup();
    }
  });

  it('preserves a file created in the Change directory during archive', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const artifacts = await writeCanonicalChange(fixture, modification());
      const concurrentFile = path.join(artifacts.changeDir, 'author-note.txt');
      __setArchiveTestHooksForTests({ beforeCommitStep: async (step) => {
        if (step === 'current-spec:MOD-002') await fs.writeFile(concurrentFile, 'concurrent author data\n');
      } });

      await archiveChange(await loadWorkspace(fixture.codespecDir), fixture.changeId);

      await expect(fs.readFile(concurrentFile, 'utf8')).resolves.toBe('concurrent author data\n');
      expect((await fs.readdir(artifacts.changeDir)).sort()).toEqual(['author-note.txt']);
    } finally {
      __setArchiveTestHooksForTests(null);
      fixture.cleanup();
    }
  });

  it.each(['after-index-lock'])('recovers an interrupted child-process archive at %s and releases only its abandoned index lock before retry', async (boundary) => {
    const fixture = await createCurrentArchiveFixture();
    await ensureCliBuilt();
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs/promises';
      import { syncBuiltinESMExports } from 'node:module';
      import { archiveChange, __setArchiveTestHooksForTests } from ${JSON.stringify(new URL('../../../dist/core/codespec-workflow/archive-transaction.js', import.meta.url).href)};
      import { loadWorkspace } from ${JSON.stringify(new URL('../../../dist/core/codespec-workflow/loaders.js', import.meta.url).href)};
      const pause = async () => {
        process.send('archive-paused');
        await new Promise(() => { setInterval(() => {}, 1000); });
      };
      const actualLink = fs.link;
      fs.link = async (...args) => {
        await actualLink(...args);
        if (${JSON.stringify(boundary)} === 'after-index-lock' && args[1] === ${JSON.stringify(`${fixture.paths.changeIndex}.lock`)}) await pause();
      };
      syncBuiltinESMExports();
      __setArchiveTestHooksForTests({ beforeCommitStep: async (step) => {
        if (step === ${JSON.stringify(boundary)}) await pause();
      } });
      process.on('message', async () => {
        await archiveChange(await loadWorkspace(${JSON.stringify(fixture.codespecDir)}), ${JSON.stringify(fixture.changeId)});
      });
    `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    const exited = once(child, 'exit');
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    try {
      await writeCanonicalChange(fixture, modification());
      const paused = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Child archive did not pause: ${stderr}`)), 10_000);
        child.once('message', (message) => { clearTimeout(timeout); message === 'archive-paused' ? resolve() : reject(new Error(String(message))); });
        child.once('error', (error) => { clearTimeout(timeout); reject(error); });
        child.once('exit', () => { clearTimeout(timeout); reject(new Error(`Child archive exited before pause: ${stderr}`)); });
      });
      child.send('start');
      await paused;
      const indexLock = `${fixture.paths.changeIndex}.lock`;
      await expect(fs.access(indexLock)).resolves.toBeUndefined();
      await expect(loadWorkspace(fixture.codespecDir)).resolves.toBeDefined();
      await expect(fs.access(indexLock)).resolves.toBeUndefined();

      child.kill('SIGKILL');
      await exited;
      const recovered = await loadWorkspace(fixture.codespecDir);
      await expect(fs.access(indexLock)).rejects.toThrow();
      const current = path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md');
      expect(parseCurrentSpecification(await fs.readFile(current, 'utf8')).requirements).toEqual(fixture.current.requirements);
      await expect(archiveChange(recovered, fixture.changeId)).resolves.toMatchObject({ changeId: fixture.changeId });
      await expect(fs.access(indexLock)).rejects.toThrow();
      expect((await fs.readdir(fixture.paths.transactions)).filter((entry) => !entry.startsWith('.'))).toEqual([]);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
      fixture.cleanup();
    }
  }, 20_000);

  it('archives the fresh UI execution record and summary produced at archive time', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const artifacts = await writeCanonicalChange(fixture, modification());
      artifacts.metadata.impact.affected_areas = ['ui'];
      const testCase = 'MOD-002-REQ-001-SCN-001-TC-UI-01';
      const command = `node -e "console.log('fresh UI run')"`;
      artifacts.tasks = stringify({ version: 1, changeRevision: 1, tasks: [{
        id: `${fixture.changeId}-TASK-01`, title: 'UI 验证', status: 'DONE',
        acceptanceCriteria: ['AC-001'],
        requirements: ['MOD-002-REQ-001'], scenarios: ['MOD-002-REQ-001-SCN-001'], testCases: [testCase], plannedFiles: ['src/one.ts'],
        verificationPlan: [{ testCase, runner: 'node', command, startup: 'node -e "setInterval(() => {}, 1000)"', browser: 'chromium', profile: 'test', services: [], prepare: 'node -e "process.exit(0)"', cleanup: 'node -e "process.exit(0)"' }],
      }], moduleDeltas: [], moduleRegistrations: { upsert: [], retire: [] } });
      artifacts.verification = stringify({ version: 1, changeRevision: 1, testCases: [{
        testCase, result: 'PASS', testFile: 'src/one.ts', testId: testCase, command, profile: 'test', services: [], browser: 'chromium', exitCode: 0,
        gitRevision: '0000000', treeFingerprint: artifacts.metadata.baseline.working_tree_fingerprint, executedAt: '2026-09-15T00:00:00.000Z', summary: 'old execution', cleanupSucceeded: true,
      }] });
      const uiTasks = parse(artifacts.tasks);
      uiTasks.tasks = [1, 2, 3].map((index) => {
        const scenario = `MOD-002-REQ-001-SCN-00${index}`; const id = `${scenario}-TC-UI-01`;
        return { ...uiTasks.tasks[0], id: `${fixture.changeId}-TASK-0${index}`, scenarios: [scenario], testCases: [id], verificationPlan: [{ ...uiTasks.tasks[0].verificationPlan[0], testCase: id }] };
      });
      artifacts.tasks = stringify(uiTasks);
      artifacts.metadata = approveStage(artifacts, 'plan');
      await fs.writeFile(fixture.paths.configuration, stringify({ version: 1, profiles: [{ id: 'test', services: [] }] }));
      await fs.writeFile(path.join(artifacts.changeDir, 'tasks.yaml'), artifacts.tasks);
      await fs.writeFile(path.join(artifacts.changeDir, 'verification.yaml'), artifacts.verification);
      await fs.writeFile(path.join(artifacts.changeDir, 'metadata.yaml'), stringify(artifacts.metadata));
      await archiveChange(await loadWorkspace(fixture.codespecDir), fixture.changeId);
      expect(await fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), 'utf8')).toContain('fresh UI run');
      await expect(fs.access(path.join(fixture.codespecDir, 'archive'))).rejects.toThrow();
    } finally { fixture.cleanup(); }
  });

  it('merges two sequential Changes without copying unrelated Requirements', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const currentPath = path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md');
      const first = await writeCanonicalChange(fixture, modification());
      const workspace = await loadWorkspace(fixture.codespecDir);
      const firstResult = await archiveChange(workspace, fixture.changeId);
      expect(firstResult.requirementIds).toEqual(['MOD-002-REQ-001']);
      expect(firstResult.archivedPath).toBe(path.join(fixture.paths.currentSpecs, 'MOD-002'));
      const afterFirst = parseCurrentSpecification(await fs.readFile(currentPath, 'utf8'));
      expect(afterFirst.requirements[1]).toEqual(fixture.current.requirements[1]);
      const escrowRoot = path.join(fixture.paths.transactions, '.recovery-escrow');
      const firstEscrow = path.join(escrowRoot, (await fs.readdir(escrowRoot))[0]);
      const escrowManifest = parse(await fs.readFile(path.join(firstEscrow, 'manifest.yaml'), 'utf8'));
      const savedCurrent = escrowManifest.retained.find((entry: { phase: string; target: string }) => entry.phase === 'installation' && entry.target === 'specs/MOD-002/spec.md');
      const escrowFile = path.join(firstEscrow, savedCurrent.file);
      const escrowAuthorBytes = 'Escrow author bytes must never become business inputs or be silently collected.\n';
      await fs.writeFile(escrowFile, escrowAuthorBytes);
      const secondId = 'CHG-20260915-002';
      const second = await writeCanonicalChange(fixture, modification(afterFirst.requirements[0], requirement('MOD-002-REQ-001', ['A', 'B', 'C', 'E'])), secondId);
      expect(second.spec).not.toContain('MOD-002-REQ-002');
      expect(second.spec).not.toContain(first.changeId);
      await archiveChange(workspace, secondId);
      const final = parseCurrentSpecification(await fs.readFile(currentPath, 'utf8'));
      expect(final.requirements.map((entry) => entry.id)).toEqual(['MOD-002-REQ-001', 'MOD-002-REQ-002']);
      expect(final.requirements[0].scenarios.map((entry) => entry.title)).toEqual(['A', 'B', 'C', 'E']);
      expect(final.requirements[1]).toEqual(fixture.current.requirements[1]);
      expect(final.engineeringFiles[1]).toEqual(fixture.current.engineeringFiles[1]);
      expect(await fs.readFile(currentPath, 'utf8')).not.toContain('Escrow author bytes');
      expect(await fs.readFile(escrowFile, 'utf8')).toBe(escrowAuthorBytes);
      expect(parse(await fs.readFile(fixture.paths.changeIndex, 'utf8')).changes).toEqual([]);
      for (const artifacts of [first, second]) {
        await expect(fs.access(artifacts.changeDir)).rejects.toThrow();
      }
      await expect(fs.access(path.join(fixture.codespecDir, 'archive'))).rejects.toThrow();
    } finally { fixture.cleanup(); }
  });

  it('rejects a whole Current spec in the canonical artifact contract instead of replacing the module', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const artifacts = await writeCanonicalChange(fixture, modification());
      await fs.writeFile(path.join(artifacts.changeDir, 'spec.md'), renderCurrentSpecification({ ...fixture.current, requirements: [requirement()], engineeringFiles: [fixture.current.engineeringFiles[0]] }));
      const before = snapshotDirectory(fixture.codespecDir);
      await expect(archiveChange(await loadWorkspace(fixture.codespecDir), fixture.changeId)).rejects.toThrow(/rich delta|action section/i);
      expect(snapshotDirectory(fixture.codespecDir)).toEqual(before);
    } finally { fixture.cleanup(); }
  });

  it('reports an engineering-file action conflict with the stable ARCHIVE CONFLICT prefix before writes', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const delta = modification();
      delta.engineeringFiles[0].change = '新增';
      await writeCanonicalChange(fixture, delta);
      const before = snapshotDirectory(fixture.codespecDir);
      await expect(archiveChange(await loadWorkspace(fixture.codespecDir), fixture.changeId)).rejects.toThrow(/^ARCHIVE CONFLICT:.*src\/one\.ts/);
      expect(snapshotDirectory(fixture.codespecDir)).toEqual(before);
    } finally { fixture.cleanup(); }
  });

  it.each(['current-spec:MOD-002', 'change-index'])('restores Current, six active artifacts, index and journal after failure at %s', async (step) => {
    const fixture = await createCurrentArchiveFixture();
    try {
      await writeCanonicalChange(fixture, modification());
      const workspace = await loadWorkspace(fixture.codespecDir);
      const before = snapshotDirectory(fixture.codespecDir);
      let sawMergedCurrent = false;
      let expectedEscrow: ExpectedEscrow | undefined;
      __setArchiveTestHooksForTests({ beforeCommitStep: async (currentStep) => {
        if (currentStep === step) {
          sawMergedCurrent = (await fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), 'utf8')).includes('得到 C');
          expectedEscrow = await expectedEscrowAtFailure(fixture.paths);
          throw new Error('injected canonical installation failure');
        }
      } });
      await expect(archiveChange(workspace, fixture.changeId)).rejects.toThrow(/injected canonical installation failure.*rolled back/);
      expect(sawMergedCurrent).toBe(step !== 'current-spec:MOD-002');
      expect(expectedEscrow).toBeDefined();
      await expectRestoredWithSafetyRecords(fixture.paths, before, expectedEscrow);
    } finally { __setArchiveTestHooksForTests(null); fixture.cleanup(); }
  });

  it.each(['analysis.yaml', 'spec.md', 'tasks.yaml'])('preserves a concurrent %s edit after canonical preflight', async (filename) => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const artifacts = await writeCanonicalChange(fixture, modification());
      const workspace = await loadWorkspace(fixture.codespecDir);
      const prepared = await prepareArchive(await preflightArchive(workspace, fixture.changeId));
      const file = path.join(artifacts.changeDir, filename);
      const edited = `${await fs.readFile(file, 'utf8')}\n# author edit\n`;
      await fs.writeFile(file, edited);
      const before = snapshotDirectory(fixture.codespecDir);
      const failure = await commitConfirmedArchive(prepared).catch((error: Error) => error);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/^ARCHIVE CONFLICT:/);
      expect((failure as Error).message).toContain(file);
      await expectRestoredWithSafetyRecords(fixture.paths, before);
    } finally { fixture.cleanup(); }
  });

  it('names a changed snapshot tree with a stable archive conflict prefix', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      await writeCanonicalChange(fixture, modification());
      const prepared = await prepareArchive(await preflightArchive(await loadWorkspace(fixture.codespecDir), fixture.changeId));
      const file = fixture.paths.business;
      await fs.appendFile(file, '\n# author edit\n');
      const failure = await commitConfirmedArchive(prepared).catch((error: Error) => error);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/^ARCHIVE CONFLICT:/);
      expect((failure as Error).message).toContain(file);
      expect(await fs.readFile(file, 'utf8')).toContain('# author edit');
    } finally { fixture.cleanup(); }
  });

  it('rolls back owned files and preserves a Current edit made during installation', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const artifacts = await writeCanonicalChange(fixture, modification());
      const workspace = await loadWorkspace(fixture.codespecDir);
      const currentPath = path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md');
      const authorEdit = renderCurrentSpecification({ ...fixture.current, title: 'concurrent author edit' });
      __setArchiveTestHooksForTests({ beforeCommitStep: async (step) => {
        if (step === 'change-index') await fs.writeFile(currentPath, authorEdit);
      } });
      await expect(archiveChange(workspace, fixture.changeId)).rejects.toThrow(/rollback incomplete/);
      expect(await fs.readFile(currentPath, 'utf8')).toBe(authorEdit);
      expect(await fs.readFile(path.join(artifacts.changeDir, 'analysis.yaml'), 'utf8')).toBe(artifacts.analysis);
      await expect(fs.access(path.join(fixture.codespecDir, 'archive'))).rejects.toThrow();
      expect((await fs.readdir(fixture.paths.transactions)).filter((entry) => !entry.startsWith('.'))).toHaveLength(1);
    } finally { __setArchiveTestHooksForTests(null); fixture.cleanup(); }
  });

  it.each(['Current semantic edit', 'invalid metadata YAML', 'deleted analysis'])('identifies the exact raw snapshot path before parsing: %s', async (mutation) => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const artifacts = await writeCanonicalChange(fixture, modification());
      const prepared = await prepareArchive(await preflightArchive(await loadWorkspace(fixture.codespecDir), fixture.changeId));
      const file = mutation === 'Current semantic edit' ? path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md')
        : path.join(artifacts.changeDir, mutation === 'invalid metadata YAML' ? 'metadata.yaml' : 'analysis.yaml');
      if (mutation === 'deleted analysis') await fs.unlink(file);
      else await fs.writeFile(file, mutation === 'invalid metadata YAML' ? 'change: [broken YAML'
        : (await fs.readFile(file, 'utf8')).replace('得到 A', '作者修改 THEN'));
      const before = snapshotDirectory(fixture.codespecDir);
      const failure = await commitConfirmedArchive(prepared).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/^ARCHIVE CONFLICT:/);
      expect((failure as Error).message).toContain(file);
      await expectRestoredWithSafetyRecords(fixture.paths, before);
    } finally { fixture.cleanup(); }
  });

  it('revalidates Previous against live Current immediately before installation', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      await writeCanonicalChange(fixture, modification());
      const workspace = await loadWorkspace(fixture.codespecDir);
      const prepared = await prepareArchive(await preflightArchive(workspace, fixture.changeId));
      const edited = renderCurrentSpecification({ ...fixture.current, requirements: [requirement('MOD-002-REQ-001', ['X']), fixture.current.requirements[1]] });
      const currentPath = path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md');
      await fs.writeFile(currentPath, edited);
      await expect(commitConfirmedArchive(prepared)).rejects.toThrow(`ARCHIVE CONFLICT: ${path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md')}`);
      expect(await fs.readFile(currentPath, 'utf8')).toBe(edited);
    } finally { fixture.cleanup(); }
  });

  it.each(['Current', 'active spec'])('preserves an author edit to %s between the initial read and preflight snapshot', async (target) => {
    const fixture = await createCurrentArchiveFixture();
    let readSpy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const artifacts = await writeCanonicalChange(fixture, modification());
      const workspace = await loadWorkspace(fixture.codespecDir);
      const file = target === 'Current' ? path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md') : path.join(artifacts.changeDir, 'spec.md');
      const originalRead = fs.readFile;
      const original = await originalRead(file, 'utf8');
      const edited = target === 'Current' ? original.replace('得到 D', '作者修改 D') : original + '\n<!-- author edit -->\n';
      let didEdit = false;
      let reads = 0;
      readSpy = vi.spyOn(fs, 'readFile').mockImplementation((async (requested: Parameters<typeof fs.readFile>[0], options: Parameters<typeof fs.readFile>[1]) => {
        const content = await originalRead(requested, options);
        if (String(requested) === file) reads += 1;
        if (String(requested) === file && reads === (target === 'Current' ? 1 : 2) && !didEdit) {
          didEdit = true;
          await fs.writeFile(file, edited);
        }
        return content;
      }) as typeof fs.readFile);
      await expect(archiveChange(workspace, fixture.changeId)).rejects.toThrow(/ARCHIVE CONFLICT|预检后.*变化/);
      expect(await originalRead(file, 'utf8')).toBe(edited);
      await expect(fs.access(path.join(fixture.codespecDir, 'archive'))).rejects.toThrow();
    } finally { readSpy?.mockRestore(); fixture.cleanup(); }
  });

  it('creates all three Current files when a registered module is archived for the first time', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const moduleDirectory = path.join(fixture.paths.currentSpecs, 'MOD-002');
      await fs.rm(moduleDirectory, { recursive: true });
      const delta = modification();
      delta.requirements[0] = { ...delta.requirements[0], action: 'ADDED', previous: undefined };
      delta.engineeringFiles[0].change = '新增';
      await writeCanonicalChange(fixture, delta);
      await archiveChange(await loadWorkspace(fixture.codespecDir), fixture.changeId);
      expect((await fs.readdir(moduleDirectory)).sort()).toEqual(['api.yaml', 'interface.yaml', 'spec.md']);
      expect(parseCurrentSpecification(await fs.readFile(path.join(moduleDirectory, 'spec.md'), 'utf8')).requirements)
        .toEqual([delta.requirements[0].next]);
    } finally { fixture.cleanup(); }
  });

  it.each([
    { module: 'MOD-001', filename: 'spec.md', message: '当前模块 MOD-001 缺少 spec.md，无法读取 Current' },
    { module: 'MOD-002', filename: 'interface.yaml', message: '当前模块 MOD-002 缺少 interface.yaml，无法读取 Current' },
  ])('rejects a registered module missing $filename before archive writes', async ({ module, filename, message }) => {
    const fixture = await createCurrentArchiveFixture();
    try {
      await fs.unlink(path.join(fixture.paths.currentSpecs, module, filename));
      await writeCanonicalChange(fixture, modification());
      const before = snapshotDirectory(fixture.codespecDir);
      await expect(archiveChange(await loadWorkspace(fixture.codespecDir), fixture.changeId)).rejects.toThrow(message);
      expect(snapshotDirectory(fixture.codespecDir)).toEqual(before);
    } finally { fixture.cleanup(); }
  });

  it('rebuilds a missing derived api.yaml during archive', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const apiPath = path.join(fixture.paths.currentSpecs, 'MOD-002', 'api.yaml');
      await fs.unlink(apiPath);
      await writeCanonicalChange(fixture, modification());
      await archiveChange(await loadWorkspace(fixture.codespecDir), fixture.changeId);
      expect(parse(await fs.readFile(apiPath, 'utf8'))).toEqual({ version: 1, module: 'MOD-002', routes: [] });
    } finally { fixture.cleanup(); }
  });

  it('does not create Current files for another registered module', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const untouched = path.join(fixture.paths.currentSpecs, 'MOD-001');
      await fs.rm(untouched, { recursive: true });
      await writeCanonicalChange(fixture, modification());
      await archiveChange(await loadWorkspace(fixture.codespecDir), fixture.changeId);
      await expect(fs.access(untouched)).rejects.toThrow();
      expect(parseCurrentSpecification(await fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), 'utf8')).requirements)
        .toHaveLength(2);
    } finally { fixture.cleanup(); }
  });

  it('registers a new module and creates its three Current files from an all-ADDED delta', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const next = requirement('MOD-003-REQ-001', ['通知']);
      const artifacts = await writeCanonicalChange(fixture, {
        title: '通知', module: 'MOD-003', version: 1,
        requirements: [{ id: next.id, module: 'MOD-003', action: 'ADDED', next, reason: '通知用户' }], engineeringFiles: [],
      });
      const tasks = parse(artifacts.tasks);
      tasks.moduleRegistrations.upsert = [{ id: 'MOD-003', name: '通知' }];
      artifacts.tasks = stringify(tasks);
      artifacts.metadata = approveStage(artifacts, 'plan');
      artifacts.verification = stringify({ ...parse(artifacts.verification), artifactIdentity: verificationArtifactIdentity(artifacts) });
      await fs.writeFile(path.join(artifacts.changeDir, 'verification.yaml'), artifacts.verification);
      await fs.writeFile(path.join(artifacts.changeDir, 'tasks.yaml'), artifacts.tasks);
      await fs.writeFile(path.join(artifacts.changeDir, 'metadata.yaml'), stringify(artifacts.metadata));
      await archiveChange(await loadWorkspace(fixture.codespecDir), fixture.changeId);
      expect((await fs.readdir(path.join(fixture.paths.currentSpecs, 'MOD-003'))).sort()).toEqual(['api.yaml', 'interface.yaml', 'spec.md']);
      const spec = parseCurrentSpecification(await fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-003', 'spec.md'), 'utf8'));
      expect(spec.requirements).toEqual([next]);
      expect(parse(await fs.readFile(fixture.paths.business, 'utf8')).modules).toContainEqual(expect.objectContaining({ id: 'MOD-003', status: 'ACTIVE' }));
    } finally { fixture.cleanup(); }
  });

  it.each(['analyze', 'design', 'plan'] as const)('rejects a stale %s approval receipt before archive writes', async (stage) => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const artifacts = await writeCanonicalChange(fixture, modification());
      artifacts.metadata.approvals[stage]!.content_hash = '0'.repeat(64);
      await fs.writeFile(path.join(artifacts.changeDir, 'metadata.yaml'), stringify(artifacts.metadata));
      const before = snapshotDirectory(fixture.codespecDir);
      await expect(archiveChange(await loadWorkspace(fixture.codespecDir), fixture.changeId)).rejects.toThrow(/确认已失效/);
      expect(snapshotDirectory(fixture.codespecDir)).toEqual(before);
    } finally { fixture.cleanup(); }
  });

  it('rejects a UI archive when confirmed inputs change while fresh verification runs', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const artifacts = await writeCanonicalChange(fixture, modification());
      artifacts.metadata.impact.affected_areas = ['ui'];
      await fs.writeFile(path.join(artifacts.changeDir, 'metadata.yaml'), stringify(artifacts.metadata));
      const prepared = await prepareArchive(await preflightArchive(await loadWorkspace(fixture.codespecDir), fixture.changeId));
      const before = await fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), 'utf8');

      await expect(commitConfirmedArchive(prepared, async () => {
        const index = parse(await fs.readFile(fixture.paths.changeIndex, 'utf8'));
        index.changes[0].updated_at = '2026-09-21T00:00:00Z';
        await fs.writeFile(fixture.paths.changeIndex, stringify(index));
        return { passed: true, verification: parse(artifacts.verification), outputSummary: 'passed' };
      })).rejects.toThrow(/ARCHIVE CONFLICT.*重新预检并确认/);

      expect(await fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), 'utf8')).toBe(before);
      await expect(fs.access(artifacts.changeDir)).resolves.toBeUndefined();
    } finally { fixture.cleanup(); }
  });
});
