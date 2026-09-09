import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createArchiveJournal,
  installArchiveJournal,
  markArchiveJournalCommitted,
  recoverPendingTransactions,
} from '../../../src/core/codespec-workflow/transaction-journal.js';
import type { WorkspacePaths } from '../../../src/core/codespec-workflow/paths.js';
import { loadWorkspace } from '../../../src/core/codespec-workflow/loaders.js';
import { createWorkflowFixture } from '../../helpers/codespec-workflow.js';

const temporaryDirectories: string[] = [];

function pathsFor(root: string): WorkspacePaths {
  const codespecDir = path.join(root, 'codespec');
  return {
    codespecDir,
    business: path.join(codespecDir, 'business.yaml'),
    configuration: path.join(codespecDir, 'configuration.yaml'),
    changes: path.join(codespecDir, 'changes'),
    changeIndex: path.join(codespecDir, 'changes', 'index.yaml'),
    archive: path.join(codespecDir, 'archive'),
    currentSpecs: path.join(codespecDir, 'specs'),
    transactions: path.join(codespecDir, '.transactions'),
    archivedChanges: path.join(codespecDir, 'archive', 'changes'),
  };
}

async function setupTarget(): Promise<{ paths: WorkspacePaths; target: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-journal-'));
  temporaryDirectories.push(root);
  const paths = pathsFor(root);
  const target = path.join(paths.currentSpecs, 'MOD-001', 'spec.md');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, 'before\n');
  return { paths, target };
}

describe('archive transaction journal', () => {
  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
  });

  it('restores every target to its pre-archive bytes when recovery finds no commit marker', async () => {
    const { paths, target } = await setupTarget();
    await createArchiveJournal({
      paths,
      transactionId: 'archive-CHG-20260907-001',
      files: [{ target, before: 'before\n', after: 'after\n' }],
    });
    await fs.writeFile(target, 'after\n');

    await recoverPendingTransactions(paths);

    await expect(fs.readFile(target, 'utf8')).resolves.toBe('before\n');
    await expect(fs.access(path.join(paths.transactions, 'archive-CHG-20260907-001'))).rejects.toThrow();
  });

  it('finishes every target from staged bytes when recovery finds a durable commit marker', async () => {
    const { paths, target } = await setupTarget();
    const journal = await createArchiveJournal({
      paths,
      transactionId: 'archive-CHG-20260907-001',
      files: [{ target, before: 'before\n', after: 'after\n' }],
    });
    await markArchiveJournalCommitted(journal);

    await recoverPendingTransactions(paths);

    await expect(fs.readFile(target, 'utf8')).resolves.toBe('after\n');
    await expect(fs.access(path.join(paths.transactions, 'archive-CHG-20260907-001'))).rejects.toThrow();
  });

  it('installs staged bytes before commit without deleting the recovery journal', async () => {
    const { paths, target } = await setupTarget();
    const journal = await createArchiveJournal({
      paths,
      transactionId: 'archive-CHG-20260907-001',
      files: [{ target, before: 'before\n', after: 'after\n' }],
    });

    await installArchiveJournal(journal);

    await expect(fs.readFile(target, 'utf8')).resolves.toBe('after\n');
    await expect(fs.access(journal.directory)).resolves.toBeUndefined();
  });

  it('recovers pending transactions before a workspace is loaded for another command', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const target = path.join(fixture.paths.currentSpecs, 'MOD-001', 'spec.md');
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, 'before\n');
      await createArchiveJournal({
        paths: fixture.paths,
        transactionId: 'archive-CHG-20260907-001',
        files: [{ target, before: 'before\n', after: 'after\n' }],
      });
      await fs.writeFile(target, 'after\n');

      await loadWorkspace(fixture.codespecDir);

      await expect(fs.readFile(target, 'utf8')).resolves.toBe('before\n');
    } finally {
      fixture.cleanup();
    }
  });
});
