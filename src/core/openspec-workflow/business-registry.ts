import * as fs from 'node:fs/promises';

import { parseBusinessModule } from './schemas.js';
import type { BusinessModule } from './types.js';
import type { WorkspacePaths } from './paths.js';

export interface BusinessRegistry {
  modules: BusinessModule[];
  byId: Map<string, BusinessModule>;
  byName: Map<string, BusinessModule>;
}

function parseDelimitedList(rawValue: string, delimiters: RegExp): string[] {
  return rawValue
    .split(delimiters)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseModuleRow(line: string): BusinessModule | null {
  if (!line.startsWith('|')) {
    return null;
  }

  const columns = line
    .split('|')
    .slice(1, -1)
    .map((value) => value.trim());

  if (columns.length < 5) {
    return null;
  }

  if (columns.every((value) => /^:?-{3,}:?$/.test(value))) {
    return null;
  }

  if (columns[0] === 'Module ID') {
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

  for (const line of content.split(/\r?\n/u)) {
    const moduleRow = parseModuleRow(line.trim());
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
    throw new Error(`Missing canonical module registry entries in ${paths.business}`);
  }

  return { modules, byId, byName };
}
