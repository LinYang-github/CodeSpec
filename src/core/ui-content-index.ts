import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

export type UiSource = 'openspec' | 'superpowers-plans';
export type UiContentType = 'markdown' | 'yaml' | 'text';

export interface UiDocument {
  id: string;
  relativePath: string;
  source: UiSource;
  category: string;
  contentType: UiContentType;
  title: string;
  labels: string[];
  content: string;
  modifiedAt: string;
}

export interface UiChangeGroup {
  id: string;
  documents: UiDocument[];
}

export interface UiIndex {
  documents: UiDocument[];
  changes: UiChangeGroup[];
  archive: {
    specSnapshots: UiDocument[];
    history: UiDocument[];
    historyCount: number;
    historyChanges: UiChangeGroup[];
  };
  skipped: Array<{
    relativePath: string;
    reason: 'binary' | 'too_large' | 'outside_root' | 'unreadable';
  }>;
  rebuiltAt: string;
}

export interface BusinessModule { id: string; name: string; responsibility: string; keywords: string[]; }

export function parseBusinessModules(content: string): BusinessModule[] {
  return content.split(/\r?\n/u).slice(2).flatMap((line) => {
    const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
    if (!/^MOD-\d+$/u.test(cells[0] ?? '')) return [];
    return [{ id: cells[0], name: cells[1] ?? '', responsibility: cells[2] ?? '', keywords: (cells[3] ?? '').split(/\s+/u).filter(Boolean) }];
  });
}

const MAX_FILE_SIZE = 1_048_576;
const ALLOWED_EXTENSIONS = new Set(['.md', '.mdx', '.yaml', '.yml', '.json', '.txt']);

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function createDocumentId(relativePath: string): string {
  return createHash('sha256').update(relativePath).digest('hex').slice(0, 24);
}

function getContentType(filePath: string): UiContentType {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.md' || extension === '.mdx') return 'markdown';
  if (extension === '.yaml' || extension === '.yml') return 'yaml';
  return 'text';
}

function getCategory(relativePath: string, source: UiSource): string {
  if (source === 'superpowers-plans') return 'Superpowers Plans';
  if (relativePath === 'openspec/business.md') return '业务说明';
  if (relativePath.startsWith('openspec/archive/changes/') || relativePath.startsWith('openspec/changes/archive/')) return '归档 Change';
  if (relativePath.startsWith('openspec/archive/specs/')) return '归档 Spec';
  if (relativePath.startsWith('openspec/changes/')) return '活动 Change';
  if (relativePath.startsWith('openspec/specs/')) return '当前 Spec';
  return '其他 OpenSpec 文件';
}

function getTitle(content: string, filePath: string, contentType: UiContentType): string {
  if (contentType === 'markdown') {
    const heading = content.match(/^#\s+(.+)$/m);
    if (heading?.[1]) return heading[1].trim();
  }
  return path.basename(filePath);
}

function getYamlLabels(content: string): string[] {
  try {
    const value = parseYaml(content);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];

    return ['id', 'status', 'updated_at', 'created_at']
      .map((key) => (value as Record<string, unknown>)[key])
      .filter((item): item is string | number | boolean =>
        typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
      )
      .map(String);
  } catch {
    return [];
  }
}

function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
}

function groupChangeDocuments(documents: UiDocument[], prefix: string): UiChangeGroup[] {
  const groups = new Map<string, UiDocument[]>();
  for (const document of documents) {
    if (!document.relativePath.startsWith(prefix)) continue;
    const remainder = document.relativePath.slice(prefix.length);
    const separatorIndex = remainder.indexOf('/');
    if (separatorIndex < 1) continue;
    const id = remainder.slice(0, separatorIndex);
    const group = groups.get(id) ?? [];
    group.push(document);
    groups.set(id, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, groupedDocuments]) => ({ id, documents: groupedDocuments }));
}

function getArchiveGroups(documents: UiDocument[]): UiIndex['archive'] {
  const specSnapshots = documents.filter((document) =>
    /^openspec\/archive\/specs\/[^/]+\/spec\.md$/u.test(document.relativePath)
  );
  const history = documents.filter((document) =>
    document.relativePath.startsWith('openspec/archive/changes/') || document.relativePath.startsWith('openspec/changes/archive/')
  );
  const historyChanges = [
    ...groupChangeDocuments(documents, 'openspec/archive/changes/'),
    ...groupChangeDocuments(documents, 'openspec/changes/archive/'),
  ].sort((left, right) => left.id.localeCompare(right.id));
  return { specSnapshots, history, historyCount: historyChanges.length, historyChanges };
}

async function collectFiles(
  directory: string,
  projectRoot: string,
  source: UiSource,
  documents: UiDocument[],
  skipped: UiIndex['skipped']
): Promise<void> {
  let entries: Dirent<string>[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    skipped.push({ relativePath: toPosixPath(path.relative(projectRoot, directory)), reason: 'unreadable' });
    return;
  }

  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    const relativePath = toPosixPath(path.relative(projectRoot, filePath));

    if (entry.isSymbolicLink()) {
      skipped.push({ relativePath, reason: 'outside_root' });
      continue;
    }
    if (entry.isDirectory()) {
      await collectFiles(filePath, projectRoot, source, documents, skipped);
      continue;
    }
    if (!entry.isFile() || !ALLOWED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

    try {
      const stats = await fs.stat(filePath);
      if (stats.size > MAX_FILE_SIZE) {
        skipped.push({ relativePath, reason: 'too_large' });
        continue;
      }

      const content = await fs.readFile(filePath, 'utf8');
      if (content.includes('\0')) {
        skipped.push({ relativePath, reason: 'binary' });
        continue;
      }

      const contentType = getContentType(filePath);
      documents.push({
        id: createDocumentId(relativePath),
        relativePath,
        source,
        category: getCategory(relativePath, source),
        contentType,
        title: getTitle(content, filePath, contentType),
        labels: contentType === 'yaml' ? getYamlLabels(content) : [],
        content,
        modifiedAt: stats.mtime.toISOString(),
      });
    } catch {
      skipped.push({ relativePath, reason: 'unreadable' });
    }
  }
}

export async function buildUiIndex(projectRoot: string): Promise<UiIndex> {
  const root = await fs.realpath(projectRoot);
  const documents: UiDocument[] = [];
  const skipped: UiIndex['skipped'] = [];

  for (const [relativePath, source] of [
    ['openspec', 'openspec'],
    [path.join('docs', 'superpowers', 'plans'), 'superpowers-plans'],
  ] as const) {
    const directory = path.join(root, relativePath);
    try {
      const stats = await fs.stat(directory);
      if (stats.isDirectory()) await collectFiles(directory, root, source, documents, skipped);
    } catch {
      // Missing scan roots produce an empty section rather than a command failure.
    }
  }

  documents.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  skipped.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  return {
    documents,
    changes: groupChangeDocuments(
      documents.filter((document) => !document.relativePath.startsWith('openspec/changes/archive/')),
      'openspec/changes/'
    ),
    archive: getArchiveGroups(documents),
    skipped,
    rebuiltAt: new Date().toISOString(),
  };
}

export function searchUiIndex(index: UiIndex, query: string, source?: UiSource): UiDocument[] {
  const normalizedQuery = normalizeSearchText(query);
  const candidates = source
    ? index.documents.filter((document) => document.source === source)
    : index.documents;

  if (!normalizedQuery) return [...candidates];

  return candidates
    .map((document) => {
      const title = normalizeSearchText(document.title);
      const relativePath = normalizeSearchText(document.relativePath);
      const content = normalizeSearchText(document.content);
      const rank = title.includes(normalizedQuery)
        ? 0
        : relativePath.includes(normalizedQuery)
          ? 1
          : content.includes(normalizedQuery)
            ? 2
            : -1;
      return { document, rank };
    })
    .filter((result) => result.rank >= 0)
    .sort((left, right) =>
      left.rank - right.rank ||
      right.document.modifiedAt.localeCompare(left.document.modifiedAt) ||
      left.document.relativePath.localeCompare(right.document.relativePath)
    )
    .map((result) => result.document);
}

export function findUiDocument(index: UiIndex, id: string): UiDocument | undefined {
  return index.documents.find((document) => document.id === id);
}
