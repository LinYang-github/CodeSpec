import * as fs from 'node:fs/promises';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';

import { formatLocalDate } from '../../utils/date.js';
import { loadChangeArtifacts, type WorkspaceContext } from './loaders.js';
import { resolveChange, type ChangeSelector } from './change-resolver.js';
import type { ChangeId, ChangeMetadata, ChangeMode, ChangeStatus } from './types.js';

export interface CreateCanonicalChangeInput {
  title: string;
  summary: string;
  mode: ChangeMode;
}

export interface CreatedCanonicalChange {
  changeId: ChangeId;
  changeDir: string;
  metadataPath: string;
  indexPath: string;
  metadata: ChangeMetadata;
}

export interface ResumeDiagnostic {
  code: 'STALE';
  message: string;
}

export interface ResumeResult {
  changeId: ChangeId;
  metadata: ChangeMetadata;
  diagnostic: ResumeDiagnostic | null;
}

const CHANGE_ID_PATTERN = /^CHG-(\d{8})-(\d{3})$/;

async function listChangeIds(directory: string): Promise<ChangeId[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  });

  return entries
    .filter((entry) => entry.isDirectory() && CHANGE_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name as ChangeId);
}

function buildArtifactPath(openspecDir: string, targetPath: string): string {
  return path.relative(openspecDir, targetPath);
}

function buildMetadata(
  workspace: WorkspaceContext,
  changeId: ChangeId,
  input: CreateCanonicalChangeInput,
  timestamp: string
): ChangeMetadata {
  const changeDir = path.join(workspace.paths.changes, changeId);

  return {
    schema_version: 1,
    change: {
      id: changeId,
      revision: 1,
      title: input.title,
      mode: input.mode,
      status: 'ANALYZE',
      created_at: timestamp,
      updated_at: timestamp,
    },
    impact: {
      summary: input.summary,
      mode: input.mode,
      scope: 'single-module',
    },
    baseline: {
      created_at: timestamp,
      stale: false,
      modules: {},
    },
    relations: {
      depends_on: [],
      related_to: [],
      conflicts_with: [],
      supersedes: [],
    },
    gates: {
      analyze: { required: true, satisfied: false },
      design: { required: true, satisfied: false },
      plan: { required: true, satisfied: false },
      implement: { required: true, satisfied: false },
      verify: { required: true, satisfied: false },
      archive: { required: true, satisfied: false },
    },
    modules: {
      candidates: [],
      confirmed: [],
      dependencies: [],
    },
    requirements: {
      added: [],
      modified: [],
      removed: [],
    },
    artifacts: {
      metadata: buildArtifactPath(workspace.openspecDir, path.join(changeDir, 'metadata.yaml')),
      proposal: buildArtifactPath(workspace.openspecDir, path.join(changeDir, 'proposal.md')),
      design: buildArtifactPath(workspace.openspecDir, path.join(changeDir, 'design.md')),
      spec: buildArtifactPath(workspace.openspecDir, path.join(changeDir, 'spec.md')),
      tasks: buildArtifactPath(workspace.openspecDir, path.join(changeDir, 'tasks.md')),
      verification: buildArtifactPath(workspace.openspecDir, path.join(changeDir, 'verification.md')),
    },
    tasks: {
      total: 0,
      completed: 0,
      items: {},
    },
    verification: {
      requirements_verified: false,
      tests_passed: false,
      build_passed: false,
      lint_passed: false,
      verified_at: null,
    },
    archive: {
      ready: false,
      conflict: false,
      archived_at: null,
    },
  };
}

async function writeChangeIndex(
  workspace: WorkspaceContext,
  metadata: ChangeMetadata
): Promise<void> {
  const entries = workspace.index.entries.filter((entry) => entry.id !== metadata.change.id);
  entries.push({
    id: metadata.change.id,
    title: metadata.change.title,
    mode: metadata.change.mode,
    status: metadata.change.status,
    updated_at: metadata.change.updated_at,
  });
  entries.sort((left, right) => left.id.localeCompare(right.id));

  await fs.writeFile(
    workspace.paths.changeIndex,
    stringifyYaml({
      version: 1,
      changes: entries,
    })
  );
}

export async function allocateChangeId(
  paths: WorkspaceContext['paths'],
  date: string
): Promise<ChangeId> {
  const ids = [
    ...(await listChangeIds(paths.changes)),
    ...(await listChangeIds(paths.archivedChanges)),
  ];

  let maxSequence = 0;
  for (const id of ids) {
    const match = CHANGE_ID_PATTERN.exec(id);
    if (!match || match[1] !== date) {
      continue;
    }
    maxSequence = Math.max(maxSequence, Number(match[2]));
  }

  return `CHG-${date}-${String(maxSequence + 1).padStart(3, '0')}` as ChangeId;
}

export async function createCanonicalChange(
  workspace: WorkspaceContext,
  input: CreateCanonicalChangeInput
): Promise<CreatedCanonicalChange> {
  const changeId = await allocateChangeId(workspace.paths, formatLocalDate().replace(/-/g, ''));
  const changeDir = path.join(workspace.paths.changes, changeId);
  const timestamp = new Date().toISOString();
  const metadata = buildMetadata(workspace, changeId, input, timestamp);

  await fs.mkdir(changeDir, { recursive: false });
  await Promise.all([
    fs.writeFile(path.join(changeDir, 'metadata.yaml'), stringifyYaml(metadata)),
    fs.writeFile(path.join(changeDir, 'proposal.md'), '# Proposal\n'),
    fs.writeFile(path.join(changeDir, 'design.md'), '# Design\n'),
    fs.writeFile(path.join(changeDir, 'spec.md'), '# Spec\n'),
    fs.writeFile(path.join(changeDir, 'tasks.md'), '# Tasks\n'),
    fs.writeFile(path.join(changeDir, 'verification.md'), '# Verification\n'),
  ]);
  await writeChangeIndex(workspace, metadata);

  return {
    changeId,
    changeDir,
    metadataPath: path.join(changeDir, 'metadata.yaml'),
    indexPath: workspace.paths.changeIndex,
    metadata,
  };
}

export async function resumeChange(
  workspace: WorkspaceContext,
  selector: ChangeSelector,
  action: ChangeStatus
): Promise<ResumeResult> {
  const resolved = await resolveChange(workspace, selector);
  const artifacts = await loadChangeArtifacts(workspace.paths, resolved.changeId);

  const diagnostic =
    (action === 'IMPLEMENT' || action === 'ARCHIVE') && artifacts.metadata.baseline.stale
      ? {
          code: 'STALE' as const,
          message: `Change ${resolved.changeId} is stale and must be rebased before ${action}.`,
        }
      : null;

  return {
    changeId: resolved.changeId,
    metadata: artifacts.metadata,
    diagnostic,
  };
}
