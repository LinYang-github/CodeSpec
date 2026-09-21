import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { archiveChange, preflightArchive, prepareArchive, commitArchive, __setArchiveTestHooksForTests } from '../../../src/core/codespec-workflow/archive-transaction.js';
import { recordFreshVerification, renderVerificationMarkdown, verificationArtifactIdentity } from '../../../src/core/codespec-workflow/verification.js';
import { createWorkflowFixture } from '../../helpers/codespec-workflow.js';
import type { ChangeMetadata } from '../../../src/core/codespec-workflow/types.js';
import { parseCurrentSpec } from '../../../src/core/codespec-workflow/current-spec-parser.js';
import type { ArchiveImpact } from '../../../src/core/codespec-workflow/archive-impact.js';
import { ensureCliBuilt, runCLI } from '../../helpers/run-cli.js';
import { createArchiveJournal } from '../../../src/core/codespec-workflow/transaction-journal.js';
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
      await expect(fs.access(path.join(fixture.paths.archivedChanges, fixture.changeId))).rejects.toThrow();
      await expect(fs.access(fixture.paths.archive)).rejects.toThrow();
    } finally { fixture.cleanup(); }
  });

  it('merges two sequential Changes without copying unrelated Requirements or earlier Change prose', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const currentPath = path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md');
      const historic = path.join(fixture.paths.archivedChanges, 'CHG-20260831-001', 'spec.md');
      await fs.mkdir(path.dirname(historic), { recursive: true });
      const historicContent = 'Archived prose and old Requirement snapshots must never be imported.\r\n';
      await fs.writeFile(historic, historicContent);
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
      await expect(fs.access(historic)).rejects.toThrow();
      expect(await fs.readFile(currentPath, 'utf8')).not.toContain('Archived prose');
      expect(await fs.readFile(currentPath, 'utf8')).not.toContain('Escrow author bytes');
      expect(await fs.readFile(escrowFile, 'utf8')).toBe(escrowAuthorBytes);
      expect(parse(await fs.readFile(fixture.paths.changeIndex, 'utf8')).changes).toEqual([]);
      for (const artifacts of [first, second]) {
        await expect(fs.access(artifacts.changeDir)).rejects.toThrow();
        await expect(fs.access(path.join(fixture.paths.archivedChanges, artifacts.changeId))).rejects.toThrow();
      }
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
      const failure = await commitArchive(prepared).catch((error: Error) => error);
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
      const failure = await commitArchive(prepared).catch((error: Error) => error);
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
      await expect(fs.access(path.join(fixture.paths.archivedChanges, fixture.changeId, 'metadata.yaml'))).rejects.toThrow();
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
      const failure = await commitArchive(prepared).catch((error: unknown) => error);
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
      await expect(commitArchive(prepared)).rejects.toThrow(`ARCHIVE CONFLICT: ${path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md')}`);
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
      await expect(fs.access(path.join(fixture.paths.archivedChanges, fixture.changeId))).rejects.toThrow();
    } finally { readSpy?.mockRestore(); fixture.cleanup(); }
  });

  it('rejects an all-ADDED delta when its registered module has no spec.md', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const currentPath = path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md');
      await fs.unlink(currentPath);
      const delta = modification();
      delta.requirements[0] = { ...delta.requirements[0], action: 'ADDED', previous: undefined };
      delta.engineeringFiles[0].change = '新增';
      await writeCanonicalChange(fixture, delta);
      const before = snapshotDirectory(fixture.codespecDir);
      await expect(archiveChange(await loadWorkspace(fixture.codespecDir), fixture.changeId)).rejects.toThrow('当前模块 MOD-002 缺少 spec.md，无法归档');
      expect(snapshotDirectory(fixture.codespecDir)).toEqual(before);
    } finally { fixture.cleanup(); }
  });

  it.each([
    { module: 'MOD-001', filename: 'spec.md', message: '当前模块 MOD-001 缺少 spec.md，无法归档' },
    { module: 'MOD-002', filename: 'interface.yaml', message: '当前模块 MOD-002 缺少 interface.yaml，无法归档' },
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
});

const ready = (fixture: Awaited<ReturnType<typeof createWorkflowFixture>>, modules = ['MOD-002']): ChangeMetadata => {
  const metadata = fixture.metadataAt('ARCHIVE');
  metadata.archive.ready = true; metadata.gates.archive.satisfied = true;
  metadata.tasks = { total: 1, completed: 1, items: { 'SP-01': { status: 'DONE' } } };
  metadata.verification = { requirements_verified: true, tests_passed: true, build_passed: true, lint_passed: true, verified_at: new Date().toISOString() };
  metadata.modules.confirmed = modules.map((module) => ({ module: module as `MOD-${string}`, outcome: 'OWNED' as const, reason: 'test' }));
  return metadata;
};

async function setup(fixture: Awaited<ReturnType<typeof createWorkflowFixture>>, metadata: ChangeMetadata, spec: string, impact?: ArchiveImpact) {
  const dir = path.join(fixture.paths.changes, fixture.changeId); await fs.mkdir(dir, { recursive: true });
  const ids = [...metadata.requirements.added, ...metadata.requirements.modified, ...metadata.requirements.removed].map((r) => r.id);
  const scenarios = [...spec.matchAll(/#### Scenario:\s*(SCN-\d{3})/gu)].map((m) => m[1]);
  await fs.writeFile(path.join(dir, 'proposal.md'), '# Proposal\n\nsummary goals scope\n'); await fs.writeFile(path.join(dir, 'design.md'), `# Design\n\n${ids.join('\n')}\n\n## 归档影响分析\n\n\`\`\`yaml\n${stringify(impact ?? { outcome: 'none', references: [], verification: [] })}\`\`\`\n`);
  await fs.writeFile(path.join(dir, 'tasks.md'), `# Tasks\n\n${ids.map((id, index) => `- [x] SP-${String(index + 1).padStart(2, '0')} ${id} ${scenarios.join(' ')} test/spec.test.ts`).join('\n')}\n`);
  const baselineIdentity = createHash('sha256').update(JSON.stringify(metadata.baseline)).digest('hex');
  const artifactIdentity = verificationArtifactIdentity({
    proposal: await fs.readFile(path.join(dir, 'proposal.md'), 'utf8'),
    design: await fs.readFile(path.join(dir, 'design.md'), 'utf8'),
    tasks: await fs.readFile(path.join(dir, 'tasks.md'), 'utf8'),
    spec,
  });
  const evidence = { schema_version: 1, change_id: metadata.change.id, verified_at: new Date().toISOString(), revision: metadata.change.revision, status: 'PASS' as const, requirement_ids: ids, scenario_ids: scenarios, baseline_identity: baselineIdentity, receipt: '', commands: ['requirements', 'unit', 'typecheck', 'build', 'lint', 'bdd', 'integration'].map((kind) => ({ command: `node -e "process.exit(0)"`, kind, exit_code: 0, output_summary: 'ok', started_at: new Date().toISOString(), finished_at: new Date().toISOString() })) };
  Object.assign(evidence, { artifact_identity: artifactIdentity });
  evidence.receipt = createHash('sha256').update(JSON.stringify({ ...evidence, receipt: undefined })).digest('hex');
  metadata.verification.verified_at = evidence.verified_at;
  metadata.verification.evidence_receipt = evidence.receipt; metadata.verification.baseline_identity = evidence.baseline_identity;
  await fs.writeFile(path.join(dir, 'metadata.yaml'), stringify(metadata));
  await fs.writeFile(path.join(dir, 'verification.md'), renderVerificationMarkdown(evidence));
  await fs.writeFile(path.join(dir, 'spec.md'), spec);
}

describe.skip('transactional CodeSpec archive', () => {
  it.each(['metadata', 'index', 'Current'])('identifies the changed %s snapshot in legacy archive conflicts', async (target) => {
    const fixture = await createWorkflowFixture();
    try {
      const metadata = ready(fixture); metadata.requirements.added = [{ id: 'MOD-002-REQ-001', module: 'MOD-002' }];
      await setup(fixture, metadata, '## ADDED\n### MOD-002-REQ-001 title\n**New**\ntext\n#### Scenario: SCN-001 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**ERROR** err\n');
      const prepared = await prepareArchive(await preflightArchive(fixture.workspace, fixture.changeId));
      const file = target === 'metadata' ? path.join(fixture.paths.changes, fixture.changeId, 'metadata.yaml')
        : target === 'index' ? fixture.paths.changeIndex : path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, '\n# author edit\n');
      const failure = await commitArchive(prepared).catch((error: Error) => error);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/^ARCHIVE CONFLICT:/);
      expect((failure as Error).message).toContain(file);
      expect(await fs.readFile(file, 'utf8')).toContain('# author edit');
    } finally { fixture.cleanup(); }
  });
  it('recovers a pending journal before direct archive execution', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const target = path.join(fixture.paths.currentSpecs, 'MOD-001', 'spec.md');
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, 'before\n');
      await createArchiveJournal({
        paths: fixture.paths,
        transactionId: 'archive-CHG-20260901-999',
        files: [{ target, before: 'before\n', after: 'after\n' }],
      });
      await fs.writeFile(target, 'after\n');
      const metadata = ready(fixture); metadata.requirements.added = [{ id: 'MOD-002-REQ-001', module: 'MOD-002' }];
      await setup(fixture, metadata, '## ADDED\n### MOD-002-REQ-001 title\n**New**\ntext\n#### Scenario: SCN-001 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**ERROR** err\n');
      await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
      await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), '# Current\n');

      await archiveChange(fixture.workspace, fixture.changeId);

      await expect(fs.readFile(target, 'utf8')).resolves.toBe('before\n');
    } finally { fixture.cleanup(); }
  });

  it('recovers a lock left by a dead archive process', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const metadata = ready(fixture); metadata.requirements.added = [{ id: 'MOD-002-REQ-001', module: 'MOD-002' }];
      await setup(fixture, metadata, '## ADDED\n### MOD-002-REQ-001 title\n**New**\ntext\n#### Scenario: SCN-001 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**ERROR** err\n');
      await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
      await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), '# Current\n');
      const lock = path.join(fixture.paths.transactions, '.archive.lock');
      await fs.mkdir(lock, { recursive: true });
      await fs.writeFile(path.join(lock, '.owner.json'), JSON.stringify({ pid: 999999, started_at: '2026-09-05T00:00:00.000Z' }));
      await expect(archiveChange(fixture.workspace, fixture.changeId)).resolves.toMatchObject({ changeId: fixture.changeId });
    } finally { fixture.cleanup(); }
  });

  it.each(['current-spec:MOD-002', 'change-index'])('restores Current and active Change if installation fails at %s', async (step) => {
    const fixture = await createWorkflowFixture();
    try {
      const metadata = ready(fixture); metadata.requirements.added = [{ id: 'MOD-002-REQ-001', module: 'MOD-002' }];
      await setup(fixture, metadata, '## ADDED\n### MOD-002-REQ-001 title\n**New**\ntext\n#### Scenario: SCN-001 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**ERROR** err\n');
      const currentFile = path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md');
      await fs.mkdir(path.dirname(currentFile), { recursive: true }); await fs.writeFile(currentFile, '# Current\n');
      const metadataFile = path.join(fixture.paths.changes, fixture.changeId, 'metadata.yaml');
      const originalMetadata = await fs.readFile(metadataFile, 'utf8');
      __setArchiveTestHooksForTests({ beforeCommitStep: (current) => { if (current === step) throw new Error('injected installation failure'); } });
      await expect(archiveChange(fixture.workspace, fixture.changeId)).rejects.toThrow(/injected installation failure.*rolled back/);
      expect(await fs.readFile(currentFile, 'utf8')).toBe('# Current\n');
      expect(await fs.readFile(metadataFile, 'utf8')).toBe(originalMetadata);
      await expect(fs.access(path.join(fixture.paths.archivedChanges, fixture.changeId))).rejects.toThrow();
    } finally { __setArchiveTestHooksForTests(null); fixture.cleanup(); }
  });
  it('supersedes A with B in Current specs and removes archive history', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const oldBody = 'A rule\n#### Scenario: SCN-001 A\n- **GIVEN** x\n- **WHEN** y\n- **THEN** a\n- **ERROR** err\n';
      const newBody = 'B rule\n#### Scenario: SCN-002 B\n- **GIVEN** x\n- **WHEN** y\n- **THEN** b\n- **ERROR** err\n';
      const metadata = ready(fixture, ['MOD-001', 'MOD-002']);
      metadata.requirements.removed = [{ id: 'MOD-001-REQ-001', module: 'MOD-001' }];
      metadata.requirements.added = [{ id: 'MOD-002-REQ-001', module: 'MOD-002' }];
      await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-001'), { recursive: true });
      await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-001', 'spec.md'), '# Current A\n\n### MOD-001-REQ-001 A\n' + oldBody);
      const historic = path.join(fixture.paths.archivedChanges, 'CHG-20260831-001', 'spec.md');
      await fs.mkdir(path.dirname(historic), { recursive: true });
      const historicBytes = Buffer.from('Historical A delta and reasons.\r\nDo not rewrite.\r\n');
      await fs.writeFile(historic, historicBytes);
      const impact: ArchiveImpact = { outcome: 'affected', verification: ['archive-regression'], references: [{
        current_requirement: 'MOD-001-REQ-001', current_scenario: 'SCN-001', disposition: 'superseded',
        replacement_requirement: 'MOD-002-REQ-001', replacement_scenario: 'SCN-002',
      }] };
      const delta = '## REMOVED\n### MOD-001-REQ-001 A\n**Previous**\n' + oldBody + '**Reason**\nB replaces A\n\n## ADDED\n### MOD-002-REQ-001 B\n**New**\n' + newBody;
      await setup(fixture, metadata, delta, impact);
      const evidence = await recordFreshVerification(fixture.workspace, fixture.changeId, [
        { kind: 'archive-regression', command: 'node -e "process.exit(0)"', requirementIds: ['MOD-001-REQ-001', 'MOD-002-REQ-001'], scenarioIds: ['SCN-001', 'SCN-002'] },
        { kind: 'unit', command: 'node -e "process.exit(0)"' }, { kind: 'typecheck', command: 'node -e "process.exit(0)"' }, { kind: 'bdd', command: 'node -e "process.exit(0)"' }, { kind: 'integration', command: 'node -e "process.exit(0)"' }, { kind: 'build', command: 'node -e "process.exit(0)"' }, { kind: 'lint', command: 'node -e "process.exit(0)"' },
      ]);
      const preview = await runCLI(['archive', fixture.changeId, '--json', '--yes'], { cwd: fixture.tempDir });
      expect(preview.exitCode).toBe(1);
      expect(JSON.parse(preview.stdout).preflight).toMatchObject({
        changeId: fixture.changeId, revision: 1, archiveImpact: impact,
        evidence: { receipt: evidence.receipt, regressionCommands: [{ kind: 'archive-regression', exit_code: 0 }] },
      });
      await expect(fs.access(path.join(fixture.paths.changes, fixture.changeId))).resolves.toBeUndefined();
      await archiveChange(fixture.workspace, fixture.changeId);
      expect(parseCurrentSpec(await fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-001', 'spec.md'), 'utf8')).requirements).toEqual([]);
      const currentB = await fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), 'utf8');
      expect(parseCurrentSpec(currentB).requirements.map((requirement) => requirement.id)).toEqual(['MOD-002-REQ-001']);
      expect(evidence.receipt).toMatch(/^[a-f0-9]{64}$/u);
      await expect(fs.access(historic)).rejects.toThrow();
      await expect(fs.access(path.join(fixture.paths.archivedChanges, fixture.changeId, 'spec.md'))).rejects.toThrow();
      await expect(fs.access(fixture.paths.archive)).rejects.toThrow();
    } finally { fixture.cleanup(); }
  });
  it('rejects a spec edited after verification even when the Change revision was not incremented', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const metadata = ready(fixture); metadata.requirements.added = [{ id: 'MOD-002-REQ-001', module: 'MOD-002' }];
      const spec = '## ADDED\n### MOD-002-REQ-001 title\n**New**\ntext\n#### Scenario: SCN-001 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**ERROR** err\n';
      await setup(fixture, metadata, spec);
      await fs.writeFile(path.join(fixture.paths.changes, fixture.changeId, 'spec.md'), spec.replace('**THEN** z', '**THEN** a different result'));
      await expect(archiveChange(fixture.workspace, fixture.changeId)).rejects.toThrow(/产物.*重新验证/);
      await expect(fs.access(path.join(fixture.paths.archivedChanges, fixture.changeId))).rejects.toThrow();
    } finally { fixture.cleanup(); }
  });
  it.each(['spec.md', 'design.md', 'tasks.md', 'verification.md'])('rejects %s edits after preflight without moving the active Change', async (filename) => {
    const fixture = await createWorkflowFixture();
    try {
      const metadata = ready(fixture); metadata.requirements.added = [{ id: 'MOD-002-REQ-001', module: 'MOD-002' }];
      await setup(fixture, metadata, '## ADDED\n### MOD-002-REQ-001 title\n**New**\ntext\n#### Scenario: SCN-001 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**ERROR** err\n');
      const prepared = await prepareArchive(await preflightArchive(fixture.workspace, fixture.changeId));
      const file = path.join(fixture.paths.changes, fixture.changeId, filename);
      const edited = await fs.readFile(file, 'utf8') + '\nEdited after preflight\n';
      await fs.writeFile(file, edited);
      const failure = await commitArchive(prepared).catch((error: Error) => error);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/^ARCHIVE CONFLICT:/);
      expect((failure as Error).message).toContain(path.dirname(file));
      expect(await fs.readFile(file, 'utf8')).toBe(edited);
      await expect(fs.access(path.join(fixture.paths.archivedChanges, fixture.changeId))).rejects.toThrow();
    } finally { fixture.cleanup(); }
  });

  it('preserves module attachments and leaves dependency modules untouched', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const metadata = ready(fixture);
      metadata.modules.confirmed.push({ module: 'MOD-001', outcome: 'DEPENDENCY', reason: 'read dependency only' });
      metadata.requirements.added = [{ id: 'MOD-002-REQ-001', module: 'MOD-002' }];
      await setup(fixture, metadata, '## ADDED\n### MOD-002-REQ-001 title\n**New**\ntext\n#### Scenario: SCN-001 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**ERROR** err\n');
      const attachment = path.join(fixture.paths.currentSpecs, 'MOD-002', 'notes.txt');
      await fs.mkdir(path.dirname(attachment), { recursive: true });
      await fs.writeFile(attachment, 'Human-authored supporting notes');
      await archiveChange(fixture.workspace, fixture.changeId);
      expect(await fs.readFile(attachment, 'utf8')).toBe('Human-authored supporting notes');
      await expect(fs.access(path.join(fixture.paths.currentSpecs, 'MOD-001'))).rejects.toThrow();
    } finally { fixture.cleanup(); }
  });

  it('blocks a false none declaration before changing an existing requirement', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const old = '### MOD-002-REQ-006 title\nold\n#### Scenario: SCN-001 old\n- **GIVEN** x\n- **WHEN** y\n- **THEN** z\n- **ERROR** err\n';
      const next = 'new\n#### Scenario: SCN-002 new\n- **GIVEN** x\n- **WHEN** y\n- **THEN** changed\n- **ERROR** err\n';
      await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
      const currentFile = path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md');
      await fs.writeFile(currentFile, old);
      const metadata = ready(fixture); metadata.requirements.modified = [{ id: 'MOD-002-REQ-006', module: 'MOD-002' }];
      await setup(fixture, metadata, '## MODIFIED\n### MOD-002-REQ-006 title\n**Previous**\n' + old.split('\n').slice(1).join('\n') + '**New**\n' + next + '**Reason**\nchange policy\n');
      await expect(archiveChange(fixture.workspace, fixture.changeId)).rejects.toThrow(/映射/);
      expect(await fs.readFile(currentFile, 'utf8')).toBe(old);
      await expect(fs.access(path.join(fixture.paths.archivedChanges, fixture.changeId))).rejects.toThrow();
    } finally { fixture.cleanup(); }
  });

  it('cleans existing archive README and history instead of appending a new record', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const metadata = ready(fixture); metadata.requirements.added = [{ id: 'MOD-002-REQ-001', module: 'MOD-002' }];
      await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
      await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), '# Current\n');
      await setup(fixture, metadata, '## ADDED\n### MOD-002-REQ-001 title\n**New**\ntext\n#### Scenario: SCN-001 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**ERROR** z-error\n');
      await fs.mkdir(fixture.paths.archive, { recursive: true });
      await fs.writeFile(path.join(fixture.paths.archive, 'README.md'), '# Existing archive\nKeep this chapter.\n');
      await fs.writeFile(path.join(fixture.paths.archive, 'history.yaml'), stringify({ version: 1, records: [{ change: 'CHG-20260831-001', status: 'ARCHIVED', archived_at: '2026-08-31T00:00:00.000Z' }] }));
      await archiveChange(fixture.workspace, fixture.changeId);
      await expect(fs.access(fixture.paths.archive)).rejects.toThrow();
      const current = await fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), 'utf8');
      expect(current).toContain('- **ERROR** z-error');
      expect(parseCurrentSpec(current).requirements[0].scenarios[0].error).toEqual(['z-error']);
    } finally { fixture.cleanup(); }
  });

  it('rejects a MODIFIED delta when Current differs from Previous without changing files', async () => {
    const fixture = await createWorkflowFixture();
    try {
      await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
      await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), '### MOD-002-REQ-006 title\nB\n');
      const metadata = ready(fixture); metadata.requirements.modified = [{ id: 'MOD-002-REQ-006', module: 'MOD-002' }];
      await setup(fixture, metadata, '## MODIFIED\n### MOD-002-REQ-006 title\n**Previous**\nA\n**New**\nC\n#### Scenario: SCN-006 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**ERROR** z-error\n**Reason**\nfix\n');
      await expect(archiveChange(fixture.workspace, fixture.changeId)).rejects.toThrow(/ARCHIVE CONFLICT/i);
      await expect(fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), 'utf8')).resolves.toContain('B');
    } finally { fixture.cleanup(); }
  });

  it('preflights every module before writing any Current spec', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const metadata = ready(fixture, ['MOD-001', 'MOD-002']); metadata.requirements.added = [{ id: 'MOD-001-REQ-001', module: 'MOD-001' }, { id: 'MOD-002-REQ-001', module: 'MOD-002' }];
      await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-001'), { recursive: true }); await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
      await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-001', 'spec.md'), 'base'); await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), 'base');
      await setup(fixture, metadata, '## ADDED\n### MOD-001-REQ-001 title\n**New**\ntext\n#### Scenario: SCN-001 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**ERROR** z-error\n\n## MODIFIED\n### MOD-002-REQ-001 title\n**Previous**\nbad\n**New**\nnew\n#### Scenario: SCN-002 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**ERROR** z-error\n**Reason**\nx\n');
      await expect(archiveChange(fixture.workspace, fixture.changeId)).rejects.toThrow(/conflict/i);
      await expect(fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-001', 'spec.md'), 'utf8')).resolves.toBe('base');
    } finally { fixture.cleanup(); }
  });

  it('rejects a Current Specification Scenario whose ERROR line is missing', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const metadata = ready(fixture);
      metadata.requirements.added = [{ id: 'MOD-002-REQ-001', module: 'MOD-002' }];
      await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
      await fs.writeFile(
        path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'),
        '### MOD-002-REQ-009 existing\n\n#### Scenario: SCN-009 old behavior\n- **GIVEN** old\n- **WHEN** old\n- **THEN** old\n'
      );
      await setup(
        fixture,
        metadata,
        '## ADDED\n### MOD-002-REQ-001 title\n**New**\ntext\n#### Scenario: SCN-001 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**ERROR** recorded\n'
      );

      await expect(archiveChange(fixture.workspace, fixture.changeId)).rejects.toThrow(
        /MOD-002-REQ-009.*SCN-009.*ERROR/i
      );
      await expect(
        fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), 'utf8')
      ).resolves.toContain('SCN-009 old behavior');
    } finally { fixture.cleanup(); }
  });

  it('rejects a Change whose Delta Scenario ERROR is empty', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const metadata = ready(fixture);
      metadata.requirements.added = [{ id: 'MOD-002-REQ-001', module: 'MOD-002' }];
      await setup(
        fixture,
        metadata,
        '## ADDED\n### MOD-002-REQ-001 title\n**New**\ntext\n#### Scenario: SCN-001 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**ERROR**\n'
      );

      await expect(archiveChange(fixture.workspace, fixture.changeId)).rejects.toThrow(
        /MOD-002-REQ-001.*SCN-001.*ERROR.*人工补写/i
      );
    } finally { fixture.cleanup(); }
  });
});
