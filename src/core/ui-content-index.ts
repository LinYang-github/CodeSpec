import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

import { getWorkspacePaths } from './codespec-workflow/paths.js';
import { parseWorkspaceConfig } from './codespec-workflow/schemas.js';

export type UiSource = 'codespec' | 'superpowers-plans';
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
  businessDocument: UiDocument | null;
  businessModules: BusinessModule[];
  changes: UiChangeGroup[];
  archive: {
    currentSpecs: UiDocument[];
    legacySpecSnapshots: UiDocument[];
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

export interface BusinessModule {
  id: string;
  name: string;
  description: string;
  responsibility: string;
  keywords: string[];
}

export function parseBusinessModules(content: string): BusinessModule[] {
  let inFence = false;
  return content.split(/\r?\n/u).flatMap((line) => {
    if (/^\s*```/u.test(line)) {
      inFence = !inFence;
      return [];
    }
    if (inFence || !/^\s*\|/u.test(line)) return [];

    const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
    if (!/^MOD-\d+$/u.test(cells[0] ?? '') || cells.length < 3) return [];

    const isCanonicalRow = cells.length >= 5;
    const description = isCanonicalRow ? cells[2] ?? '' : '';
    const responsibility = isCanonicalRow ? cells[3] ?? '' : cells[2] ?? '';
    const keywordCell = isCanonicalRow ? cells[4] ?? '' : cells[3] ?? '';
    return [{
      id: cells[0],
      name: cells[1] ?? '',
      description,
      responsibility,
      keywords: keywordCell.split(/[\s,，;；]+/u).filter(Boolean),
    }];
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

interface UiWorkspacePaths {
  business: string;
  changes: string;
  specs: string;
  archivedChanges: string;
}

const DEFAULT_UI_PATHS: UiWorkspacePaths = {
  business: 'codespec/business.md',
  changes: 'codespec/changes/',
  specs: 'codespec/specs/',
  archivedChanges: 'codespec/archive/changes/',
};

function getCategory(relativePath: string, source: UiSource, uiPaths: UiWorkspacePaths): string {
  if (source === 'superpowers-plans') return 'Superpowers Plans';
  if (relativePath === uiPaths.business) return '业务说明';
  if (relativePath.startsWith(uiPaths.archivedChanges) || relativePath.startsWith('codespec/changes/archive/')) return '归档 Change';
  if (relativePath.startsWith('codespec/archive/specs/')) return '归档 Spec';
  if (relativePath.startsWith(uiPaths.changes)) return '活动 Change';
  if (relativePath.startsWith(uiPaths.specs)) return '当前 Spec';
  return '其他 CodeSpec 文件';
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

function mergeChangeGroups(groups: UiChangeGroup[]): UiChangeGroup[] {
  const merged = new Map<string, UiDocument[]>();
  for (const group of groups) {
    const documents = merged.get(group.id) ?? [];
    documents.push(...group.documents);
    merged.set(group.id, documents);
  }
  return [...merged.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, groupedDocuments]) => ({ id, documents: groupedDocuments }));
}

function getArchiveGroups(documents: UiDocument[], uiPaths: UiWorkspacePaths): UiIndex['archive'] {
  const currentSpecs = documents.filter((document) =>
    document.relativePath.startsWith(uiPaths.specs) && /\/spec\.md$/u.test(document.relativePath)
  );
  const legacySpecSnapshots = documents.filter((document) =>
    /^codespec\/archive\/specs\/[^/]+\/spec\.md$/u.test(document.relativePath)
  );
  const historyPrefixes = [...new Set([uiPaths.archivedChanges, 'codespec/changes/archive/'])];
  const history = documents.filter((document) => historyPrefixes.some((prefix) => document.relativePath.startsWith(prefix)));
  const historyChanges = mergeChangeGroups(historyPrefixes.flatMap((prefix) => groupChangeDocuments(documents, prefix)));
  return { currentSpecs, legacySpecSnapshots, history, historyCount: historyChanges.length, historyChanges };
}

function relativePrefix(projectRoot: string, directory: string): string {
  const relative = toPosixPath(path.relative(projectRoot, directory)).replace(/^\/+|\/+$/gu, '');
  return relative ? `${relative}/` : '';
}

async function loadUiWorkspacePaths(projectRoot: string): Promise<UiWorkspacePaths> {
  try {
    const codespecDir = path.join(projectRoot, 'codespec');
    const config = parseWorkspaceConfig(parseYaml(await fs.readFile(path.join(codespecDir, 'config.yaml'), 'utf8')));
    const paths = getWorkspacePaths(codespecDir, config);
    return {
      business: toPosixPath(path.relative(projectRoot, paths.business)),
      changes: relativePrefix(projectRoot, paths.changes),
      specs: relativePrefix(projectRoot, paths.currentSpecs),
      archivedChanges: relativePrefix(projectRoot, paths.archivedChanges),
    };
  } catch {
    return DEFAULT_UI_PATHS;
  }
}

async function collectFiles(
  directory: string,
  projectRoot: string,
  source: UiSource,
  uiPaths: UiWorkspacePaths,
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
      await collectFiles(filePath, projectRoot, source, uiPaths, documents, skipped);
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
        category: getCategory(relativePath, source, uiPaths),
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
  const uiPaths = await loadUiWorkspacePaths(root);
  const documents: UiDocument[] = [];
  const skipped: UiIndex['skipped'] = [];

  for (const [relativePath, source] of [
    ['codespec', 'codespec'],
    [path.join('docs', 'superpowers', 'plans'), 'superpowers-plans'],
  ] as const) {
    const directory = path.join(root, relativePath);
    try {
      const stats = await fs.stat(directory);
      if (stats.isDirectory()) await collectFiles(directory, root, source, uiPaths, documents, skipped);
    } catch {
      // Missing scan roots produce an empty section rather than a command failure.
    }
  }

  documents.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  skipped.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const businessDocument = documents.find((document) => document.relativePath === uiPaths.business);
  const historyPrefixes = [...new Set([uiPaths.archivedChanges, 'codespec/changes/archive/'])];

  return {
    documents,
    businessDocument: businessDocument ?? null,
    businessModules: businessDocument ? parseBusinessModules(businessDocument.content) : [],
    changes: groupChangeDocuments(
      documents.filter((document) => !historyPrefixes.some((prefix) => document.relativePath.startsWith(prefix))),
      uiPaths.changes
    ),
    archive: getArchiveGroups(documents, uiPaths),
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
