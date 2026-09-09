import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import type { WorkspacePaths } from './paths.js';

interface JournalEntry {
  target: string;
  before: string | null;
  after: string | null;
  beforeChecksum: string | null;
  afterChecksum: string | null;
}

interface JournalManifest {
  version: 1;
  transactionId: string;
  entries: JournalEntry[];
  cleanupAfterCommit: string[];
}

export interface JournalInput {
  paths: WorkspacePaths;
  transactionId: string;
  files: Array<{ target: string; before: string | null; after: string | null }>;
  cleanupAfterCommit?: string[];
}

export interface ArchiveJournal {
  paths: WorkspacePaths;
  transactionId: string;
  directory: string;
  manifest: JournalManifest;
}

const checksum = (value: string | null): string | null => value === null
  ? null
  : `sha256:${createHash('sha256').update(value).digest('hex')}`;

function relativeTarget(paths: WorkspacePaths, target: string): string {
  const relative = path.relative(paths.codespecDir, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Journal target must remain inside codespecDir: ${target}`);
  }
  return relative.split(path.sep).join('/');
}

function resolveTarget(paths: WorkspacePaths, relative: string): string {
  return path.resolve(paths.codespecDir, relative);
}

async function writeDurable(file: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const handle = await fs.open(file, 'w');
  try {
    await handle.writeFile(value, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function installValue(target: string, value: string | null): Promise<void> {
  if (value === null) {
    await fs.rm(target, { force: true });
    return;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.codespec-transaction-${process.pid}`;
  await writeDurable(temporary, value);
  await fs.rename(temporary, target);
}

function assertManifest(value: unknown): JournalManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Archive journal is malformed');
  const manifest = value as Partial<JournalManifest>;
  if (manifest.version !== 1 || typeof manifest.transactionId !== 'string' || !Array.isArray(manifest.entries) || !Array.isArray(manifest.cleanupAfterCommit)) {
    throw new Error('Archive journal is malformed');
  }
  for (const entry of manifest.entries) {
    if (!entry || typeof entry.target !== 'string'
      || ![null, 'string'].includes(entry.before === null ? null : typeof entry.before)
      || ![null, 'string'].includes(entry.after === null ? null : typeof entry.after)
      || checksum(entry.before) !== entry.beforeChecksum || checksum(entry.after) !== entry.afterChecksum) {
      throw new Error('Archive journal checksum is invalid');
    }
  }
  if (manifest.cleanupAfterCommit.some((target) => typeof target !== 'string')) throw new Error('Archive journal cleanup list is invalid');
  return manifest as JournalManifest;
}

export async function createArchiveJournal(input: JournalInput): Promise<ArchiveJournal> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(input.transactionId)) throw new Error('Archive journal transaction ID is invalid');
  const directory = path.join(input.paths.transactions, input.transactionId);
  if (await fs.access(directory).then(() => true).catch(() => false)) throw new Error(`Archive journal already exists: ${input.transactionId}`);
  const targets = new Set<string>();
  const entries = input.files.map((file) => {
    const target = relativeTarget(input.paths, file.target);
    if (targets.has(target)) throw new Error(`Archive journal contains duplicate target: ${target}`);
    targets.add(target);
    return { target, before: file.before, after: file.after, beforeChecksum: checksum(file.before), afterChecksum: checksum(file.after) };
  });
  const cleanupAfterCommit = (input.cleanupAfterCommit ?? []).map((target) => relativeTarget(input.paths, target));
  const manifest: JournalManifest = { version: 1, transactionId: input.transactionId, entries, cleanupAfterCommit };
  await fs.mkdir(directory, { recursive: true });
  await writeDurable(path.join(directory, 'journal.yaml'), stringifyYaml(manifest));
  return { paths: input.paths, transactionId: input.transactionId, directory, manifest };
}

export async function markArchiveJournalCommitted(journal: ArchiveJournal): Promise<void> {
  await writeDurable(path.join(journal.directory, 'COMMITTED'), `${journal.transactionId}\n`);
}

/** Installs staged after-values while retaining the journal for crash recovery. */
export async function installArchiveJournal(journal: ArchiveJournal): Promise<void> {
  for (const entry of journal.manifest.entries) {
    await installValue(resolveTarget(journal.paths, entry.target), entry.after);
  }
}

async function recoverJournal(paths: WorkspacePaths, directory: string): Promise<void> {
  const manifest = assertManifest(parseYaml(await fs.readFile(path.join(directory, 'journal.yaml'), 'utf8')));
  const committed = await fs.access(path.join(directory, 'COMMITTED')).then(() => true).catch(() => false);
  for (const entry of manifest.entries) await installValue(resolveTarget(paths, entry.target), committed ? entry.after : entry.before);
  if (committed) {
    for (const relative of manifest.cleanupAfterCommit) await fs.rm(resolveTarget(paths, relative), { recursive: true, force: true });
  }
  await fs.rm(directory, { recursive: true, force: true });
}

/** Recovers interrupted archive transactions before any workspace operation proceeds. */
export async function recoverPendingTransactions(paths: WorkspacePaths): Promise<void> {
  const entries = await fs.readdir(paths.transactions, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) throw new Error(`Archive transaction entry must be a directory: ${entry.name}`);
    await recoverJournal(paths, path.join(paths.transactions, entry.name));
  }
}
