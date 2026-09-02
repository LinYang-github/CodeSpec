import * as fs from 'node:fs/promises';

import { parseBusinessModule } from './schemas.js';
import type { BusinessModule } from './types.js';
import type { WorkspacePaths } from './paths.js';

export interface BusinessRegistry {
  modules: BusinessModule[];
  byId: Map<string, BusinessModule>;
  byName: Map<string, BusinessModule>;
}

export class EmptyBusinessRegistryError extends Error {
  readonly code = 'empty_business_registry';

  constructor(readonly businessPath: string) {
    super(`尚未定义业务模块。请先在 ${businessPath} 中至少添加一条以 MOD-### 开头的模块记录。`);
    this.name = 'EmptyBusinessRegistryError';
  }
}

export function isEmptyBusinessRegistryError(error: unknown): error is EmptyBusinessRegistryError {
  return error instanceof EmptyBusinessRegistryError;
}

function parseDelimitedList(rawValue: string, delimiters: RegExp): string[] {
  return rawValue
    .split(delimiters)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseTableColumns(line: string): string[] | null {
  if (!line.startsWith('|')) {
    return null;
  }

  return line
    .split('|')
    .slice(1, -1)
    .map((value) => value.trim());
}

function isTableSeparator(columns: string[]): boolean {
  return columns.length >= 5 && columns.every((value) => /^:?-{3,}:?$/.test(value));
}

function isTableHeader(lines: string[], lineIndex: number): boolean {
  const columns = parseTableColumns(lines[lineIndex]!.trim());
  const nextColumns = parseTableColumns(lines[lineIndex + 1]?.trim() ?? '');

  return !!columns && columns.length >= 5 && !!nextColumns && isTableSeparator(nextColumns);
}

function isFenceDelimiter(line: string): boolean {
  return /^(?:`{3,}|~{3,})/.test(line);
}

function parseModuleRow(line: string): BusinessModule | null {
  const columns = parseTableColumns(line);

  if (!columns || columns.length < 5) {
    return null;
  }

  if (isTableSeparator(columns)) {
    return null;
  }

  return parseBusinessModule({
    id: columns[0],
    name: columns[1],
    description: columns[2] || undefined,
    responsibilities: parseDelimitedList(columns[3], /[;\n]/),
    keywords: parseDelimitedList(columns[4], /[;,，]/),
  });
}

export async function loadBusinessRegistry(paths: WorkspacePaths): Promise<BusinessRegistry> {
  const content = await fs.readFile(paths.business, 'utf8');
  const modules: BusinessModule[] = [];
  const byId = new Map<string, BusinessModule>();
  const byName = new Map<string, BusinessModule>();

  const lines = content.split(/\r?\n/u);
  let insideFence = false;

  for (const [lineIndex, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (isFenceDelimiter(line)) {
      insideFence = !insideFence;
      continue;
    }

    if (insideFence || isTableHeader(lines, lineIndex)) {
      continue;
    }

    const moduleRow = parseModuleRow(line);
    if (!moduleRow) {
      continue;
    }

    if (byId.has(moduleRow.id)) {
      throw new Error(`Duplicate module id in business registry: ${moduleRow.id}`);
    }

    const normalizedName = moduleRow.name.toLocaleLowerCase('en-US');
    if (byName.has(normalizedName)) {
      throw new Error(`Duplicate module name in business registry: ${moduleRow.name}`);
    }

    modules.push(moduleRow);
    byId.set(moduleRow.id, moduleRow);
    byName.set(normalizedName, moduleRow);
  }

  if (modules.length === 0) {
    throw new EmptyBusinessRegistryError(paths.business);
  }

  return { modules, byId, byName };
}
