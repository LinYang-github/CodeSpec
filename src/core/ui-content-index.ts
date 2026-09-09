import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

import { getWorkspacePaths } from './codespec-workflow/paths.js';
import { loadCurrentSpecGraph } from './codespec-workflow/current-spec-graph-loader.js';
import { parseBusinessRegistry } from './codespec-workflow/current-spec-yaml.js';
import { parseWorkspaceConfig } from './codespec-workflow/schemas.js';
import type { CurrentSpecGraph } from './codespec-workflow/current-spec-graph.js';
import type { ChangeMode, ChangeStatus, SddLevel } from './codespec-workflow/types.js';

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
  structuredContent?: unknown;
  modifiedAt: string;
}

export interface UiChangeGroup {
  id: string;
  documents: UiDocument[];
  title?: string;
  mode?: ChangeMode;
  sddLevel?: SddLevel;
  status?: ChangeStatus;
  modules?: string[];
  taskProgress?: { total: number; completed: number };
  verification?: {
    requirementsVerified: boolean;
    testsPassed: boolean;
    buildPassed: boolean;
    lintPassed: boolean;
    verifiedAt: string | null;
    evidenceReceipt?: string;
  };
  archiveState?: { ready: boolean; conflict: boolean; archivedAt: string | null };
  archiveGateSatisfied?: boolean;
  gateReasons?: string[];
}

export interface UiArchiveCandidate extends UiChangeGroup {
  ready: boolean;
  conflict: boolean;
  gateReasons: string[];
}

export interface UiIndex {
  documents: UiDocument[];
  projectName: string;
  businessDocument: UiDocument | null;
  businessModules: BusinessModule[];
  currentSpecGraph: UiCurrentSpecGraph | null;
  changes: UiChangeGroup[];
  archive: {
    currentSpecs: UiDocument[];
    legacySpecSnapshots: UiDocument[];
    history: UiDocument[];
    historyCount: number;
    historyChanges: UiChangeGroup[];
    candidates: UiArchiveCandidate[];
  };
  skipped: Array<{
    relativePath: string;
    reason: 'binary' | 'too_large' | 'outside_root' | 'unreadable';
  }>;
  rebuiltAt: string;
}

export interface UiCurrentSpecGraph {
  modules: CurrentSpecGraph['business']['modules'];
  relations: CurrentSpecGraph['relations'];
  apis: Array<CurrentSpecGraph['apis'] extends Map<string, infer Api> ? Api : never>;
}

export interface BusinessModule {
  id: string;
  name: string;
  description: string;
  responsibility: string;
  keywords: string[];
  status?: 'ACTIVE' | 'RETIRED';
  inputs?: string[];
  outputs?: string[];
  relatedModules?: string[];
}

export function parseBusinessModules(content: string): BusinessModule[] {
  try {
    const parsed = parseBusinessRegistry(parseYaml(content));
    return parsed.modules.map((module) => ({
      id: module.id,
      name: module.name,
      description: '',
      responsibility: '',
      keywords: [],
      status: module.status,
      inputs: module.inputs,
      outputs: module.outputs,
      relatedModules: module.relatedModules,
    }));
  } catch {
    // Legacy workspaces keep the Markdown registry until migration is run.
  }
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
  projectName: string;
  business: string;
  changes: string;
  specs: string;
  archivedChanges: string;
}

const DEFAULT_UI_PATHS: UiWorkspacePaths = {
  projectName: 'CodeSpec',
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

function getStructuredContent(content: string, contentType: UiContentType, filePath: string): unknown {
  if (contentType !== 'yaml' || !new Set(['metadata.yaml', 'tasks.yaml', 'verification.yaml']).has(path.basename(filePath))) return undefined;
  try {
    const value = parseYaml(content);
    JSON.stringify(value);
    return value;
  } catch {
    return undefined;
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
    .map(([id, groupedDocuments]) => toChangeGroup(id, groupedDocuments));
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
    .map(([id, groupedDocuments]) => toChangeGroup(id, groupedDocuments));
}

function toChangeGroup(id: string, documents: UiDocument[]): UiChangeGroup {
  const metadata = getChangeMetadata(documents);
  return {
    id,
    documents,
    ...(metadata.title === undefined ? {} : { title: metadata.title }),
    ...(metadata.mode === undefined ? {} : { mode: metadata.mode }),
    ...(metadata.sddLevel === undefined ? {} : { sddLevel: metadata.sddLevel }),
    ...(metadata.status === undefined ? {} : { status: metadata.status }),
    ...(metadata.modules === undefined ? {} : { modules: metadata.modules }),
    ...(metadata.taskProgress === undefined ? {} : { taskProgress: metadata.taskProgress }),
    ...(metadata.verification === undefined ? {} : { verification: metadata.verification }),
    ...(metadata.archiveState === undefined ? {} : { archiveState: metadata.archiveState }),
    ...(metadata.archiveGateSatisfied === undefined ? {} : { archiveGateSatisfied: metadata.archiveGateSatisfied }),
  };
}

type YamlRecord = Record<string, unknown>;

function asRecord(value: unknown): YamlRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as YamlRecord : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getChangeMetadata(documents: UiDocument[]): {
  title?: string;
  mode?: ChangeMode;
  sddLevel?: SddLevel;
  status?: ChangeStatus;
  modules?: string[];
  taskProgress?: { total: number; completed: number };
  verification?: UiChangeGroup['verification'];
  archiveState?: UiChangeGroup['archiveState'];
  archiveGateSatisfied?: boolean;
} {
  const metadata = documents.find((document) => path.basename(document.relativePath) === 'metadata.yaml');
  if (!metadata) return {};

  try {
    const root = asRecord(parseYaml(metadata.content));
    const change = asRecord(root?.change);
    const modules = asRecord(root?.modules);
    const tasks = asRecord(root?.tasks);
    const verification = asRecord(root?.verification);
    const archive = asRecord(root?.archive);
    const gates = asRecord(root?.gates);
    const archiveGate = asRecord(gates?.archive);
    const level = change?.sdd_level;
    const status = change?.status;
    const mode = change?.mode;
    const confirmedModules = Array.isArray(modules?.confirmed)
      ? modules.confirmed.map((item) => asString(asRecord(item)?.module)).filter((item): item is string => Boolean(item))
      : undefined;
    const total = asNumber(tasks?.total);
    const completed = asNumber(tasks?.completed);
    const verificationSummary = [
      asBoolean(verification?.requirements_verified),
      asBoolean(verification?.tests_passed),
      asBoolean(verification?.build_passed),
      asBoolean(verification?.lint_passed),
    ];
    const hasVerification = verificationSummary.every((item) => item !== undefined);
    const ready = asBoolean(archive?.ready);
    const conflict = asBoolean(archive?.conflict);
    return {
      ...(asString(change?.title) === undefined ? {} : { title: asString(change?.title) }),
      ...(mode === 'feature' || mode === 'bugfix' || mode === 'refactor' ? { mode } : {}),
      ...(level === 1 || level === 2 || level === 3 ? { sddLevel: level } : {}),
      ...(typeof status === 'string' && ['ANALYZE', 'DESIGN', 'PLAN', 'IMPLEMENT', 'VERIFY', 'ARCHIVE', 'ARCHIVED', 'ABANDONED'].includes(status)
        ? { status: status as ChangeStatus }
        : {}),
      ...(confirmedModules === undefined ? {} : { modules: confirmedModules }),
      ...(total !== undefined && completed !== undefined ? { taskProgress: { total, completed } } : {}),
      ...(hasVerification ? {
        verification: {
          requirementsVerified: verificationSummary[0]!,
          testsPassed: verificationSummary[1]!,
          buildPassed: verificationSummary[2]!,
          lintPassed: verificationSummary[3]!,
          verifiedAt: asString(verification?.verified_at) ?? null,
          ...(asString(verification?.evidence_receipt) === undefined ? {} : { evidenceReceipt: asString(verification?.evidence_receipt) }),
        },
      } : {}),
      ...(ready !== undefined && conflict !== undefined ? {
        archiveState: {
          ready,
          conflict,
          archivedAt: asString(archive?.archived_at) ?? null,
        },
      } : {}),
      ...(asBoolean(archiveGate?.satisfied) === undefined ? {} : { archiveGateSatisfied: asBoolean(archiveGate?.satisfied) }),
    };
  } catch {
    return {};
  }
}

function getGateReasons(change: UiChangeGroup): string[] {
  const reasons: string[] = [];
  if (change.status !== 'ARCHIVE') reasons.push(`尚未进入 ARCHIVE（当前：${change.status ?? '未知'}）`);
  if (change.archiveGateSatisfied === false) reasons.push('ARCHIVE 门禁尚未满足');
  if (change.archiveState?.ready === false && change.archiveGateSatisfied !== false) reasons.push('归档状态尚未准备就绪');
  if (change.archiveState?.conflict) reasons.push('存在归档冲突');
  if (change.taskProgress && change.taskProgress.completed < change.taskProgress.total) reasons.push('存在未完成任务');
  if (change.verification) {
    if (!change.verification.requirementsVerified) reasons.push('缺少 Requirement 验证证据');
    if (!change.verification.testsPassed) reasons.push('缺少测试验证证据');
    if (!change.verification.buildPassed) reasons.push('缺少构建验证证据');
    if (!change.verification.lintPassed) reasons.push('缺少 lint 验证证据');
    if (!change.verification.verifiedAt) reasons.push('验证证据尚未生成');
  } else {
    reasons.push('缺少 Verification 摘要');
  }
  return reasons;
}

function getArchiveCandidate(change: UiChangeGroup): UiArchiveCandidate {
  const gateReasons = getGateReasons(change);
  return {
    ...change,
    ready: gateReasons.length === 0 && change.archiveState?.ready === true,
    conflict: change.archiveState?.conflict === true,
    gateReasons,
  };
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
  return { currentSpecs, legacySpecSnapshots, history, historyCount: historyChanges.length, historyChanges, candidates: [] };
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
      projectName: config.project.name,
      business: toPosixPath(path.relative(projectRoot, paths.business)),
      changes: relativePrefix(projectRoot, paths.changes),
      specs: relativePrefix(projectRoot, paths.currentSpecs),
      archivedChanges: relativePrefix(projectRoot, paths.archivedChanges),
    };
  } catch {
    return DEFAULT_UI_PATHS;
  }
}

async function loadUiCurrentSpecGraph(projectRoot: string): Promise<UiCurrentSpecGraph | null> {
  try {
    const codespecDir = path.join(projectRoot, 'codespec');
    const config = parseWorkspaceConfig(parseYaml(await fs.readFile(path.join(codespecDir, 'config.yaml'), 'utf8')));
    const graph = await loadCurrentSpecGraph(getWorkspacePaths(codespecDir, config));
    return {
      modules: graph.business.modules,
      relations: graph.relations,
      apis: [...graph.apis.values()],
    };
  } catch {
    // The document browser remains usable for legacy and incomplete workspaces.
    return null;
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
        structuredContent: getStructuredContent(content, contentType, filePath),
        modifiedAt: stats.mtime.toISOString(),
      });
    } catch {
      skipped.push({ relativePath, reason: 'unreadable' });
    }
  }
}

export async function buildUiIndex(projectRoot: string): Promise<UiIndex> {
  const root = await fs.realpath(projectRoot);
  const [uiPaths, currentSpecGraph] = await Promise.all([loadUiWorkspacePaths(root), loadUiCurrentSpecGraph(root)]);
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

  const changes = groupChangeDocuments(
    documents.filter((document) => !historyPrefixes.some((prefix) => document.relativePath.startsWith(prefix))),
    uiPaths.changes
  );
  const archive = getArchiveGroups(documents, uiPaths);
  archive.candidates = changes.map(getArchiveCandidate);

  return {
    documents,
    projectName: uiPaths.projectName,
    businessDocument: businessDocument ?? null,
    businessModules: businessDocument ? parseBusinessModules(businessDocument.content) : [],
    currentSpecGraph,
    changes,
    archive,
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
