import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { parseChangeMetadata } from './schemas.js';
import type { ChangeId, ChangeMetadata } from './types.js';
import type { WorkspaceContext } from './loaders.js';

export interface ChangeSelector {
  id?: string;
  text?: string;
  cwd?: string;
}

export interface ResolvedChange {
  changeId: ChangeId;
  reason: 'explicit_id' | 'bound_context' | 'semantic_match' | 'sole_active';
  metadata: ChangeMetadata;
}

interface ActiveChangeCandidate {
  changeId: ChangeId;
  changeDir: string;
  metadata: ChangeMetadata;
}

const CHANGE_ID_PATTERN = /^CHG-\d{8}-\d{3}$/;

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

async function readCanonicalMetadata(changeDir: string): Promise<ChangeMetadata> {
  return parseChangeMetadata(
    parseYaml(await fs.readFile(path.join(changeDir, 'metadata.yaml'), 'utf8'))
  );
}

export async function listActiveChanges(
  workspace: WorkspaceContext
): Promise<ActiveChangeCandidate[]> {
  const entries = await fs.readdir(workspace.paths.changes, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  });

  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && CHANGE_ID_PATTERN.test(entry.name))
      .map(async (entry) => {
        const changeDir = path.join(workspace.paths.changes, entry.name);
        try {
          const metadata = await readCanonicalMetadata(changeDir);
          return {
            changeId: metadata.change.id,
            changeDir,
            metadata,
          };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
          }
          throw error;
        }
      })
  );

  return candidates
    .filter((candidate): candidate is ActiveChangeCandidate => candidate !== null)
    .sort((left, right) => left.changeId.localeCompare(right.changeId));
}

function resolveByBoundContext(
  activeChanges: ActiveChangeCandidate[],
  cwd: string | undefined
): ActiveChangeCandidate | null {
  if (!cwd) {
    return null;
  }

  const resolvedCwd = path.resolve(cwd);
  return (
    activeChanges.find((candidate) => {
      const relative = path.relative(candidate.changeDir, resolvedCwd);
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    }) ?? null
  );
}

function resolveBySemanticMatch(
  activeChanges: ActiveChangeCandidate[],
  text: string | undefined
): ActiveChangeCandidate | null {
  if (!text) {
    return null;
  }

  const needle = normalizeSearchText(text);
  if (!needle) {
    return null;
  }

  const matches = activeChanges.filter((candidate) => {
    const haystacks = [
      candidate.changeId,
      candidate.metadata.change.title,
      candidate.metadata.impact.summary,
    ].map(normalizeSearchText);
    return haystacks.some((haystack) => haystack.includes(needle));
  });

  if (matches.length === 0) {
    throw new Error(`No active Change matches "${text}".`);
  }

  if (matches.length > 1) {
    const choices = matches.map((candidate) => `${candidate.changeId} (${candidate.metadata.change.title})`);
    throw new Error(
      `Multiple active Changes match "${text}". Choose one explicitly:\n  ${choices.join('\n  ')}`
    );
  }

  return matches[0];
}

export async function resolveChange(
  workspace: WorkspaceContext,
  selector: ChangeSelector
): Promise<ResolvedChange> {
  const activeChanges = await listActiveChanges(workspace);
  const explicitId = selector.id ?? (selector.text && CHANGE_ID_PATTERN.test(selector.text) ? selector.text : undefined);

  if (explicitId) {
    const match = activeChanges.find((candidate) => candidate.changeId === explicitId);
    if (!match) {
      throw new Error(`Active Change "${explicitId}" not found.`);
    }
    return {
      changeId: match.changeId,
      reason: 'explicit_id',
      metadata: match.metadata,
    };
  }

  const bound = resolveByBoundContext(activeChanges, selector.cwd);
  if (bound) {
    return {
      changeId: bound.changeId,
      reason: 'bound_context',
      metadata: bound.metadata,
    };
  }

  const semantic = resolveBySemanticMatch(activeChanges, selector.text);
  if (semantic) {
    return {
      changeId: semantic.changeId,
      reason: 'semantic_match',
      metadata: semantic.metadata,
    };
  }

  if (activeChanges.length === 1) {
    return {
      changeId: activeChanges[0].changeId,
      reason: 'sole_active',
      metadata: activeChanges[0].metadata,
    };
  }

  if (activeChanges.length === 0) {
    throw new Error('No active Changes found.');
  }

  const available = activeChanges.map((candidate) => `${candidate.changeId} (${candidate.metadata.change.title})`);
  throw new Error(
    `Multiple active Changes are available. Choose one explicitly:\n  ${available.join('\n  ')}`
  );
}
