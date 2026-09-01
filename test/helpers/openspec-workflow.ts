import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { getWorkspacePaths } from '../../src/core/openspec-workflow/paths.js';
import { parseWorkspaceConfig } from '../../src/core/openspec-workflow/schemas.js';
import type { WorkspaceConfig } from '../../src/core/openspec-workflow/types.js';
import { cleanupTempPath } from './temp-cleanup.js';

export interface WorkflowFixture {
  tempDir: string;
  openspecDir: string;
  paths: ReturnType<typeof getWorkspacePaths>;
  workspace: {
    openspecDir: string;
    config: WorkspaceConfig;
  };
  changeId: string;
  latestSpecs: string[];
  metadataAt: string;
  cleanup: () => void;
}

const DEFAULT_CONFIG: WorkspaceConfig = parseWorkspaceConfig({
  version: 1,
  project: { name: 'demo' },
  paths: {
    business: 'business.md',
    changes: 'changes',
    change_index: 'changes/index.yaml',
    archive: 'archive',
    specs: 'archive/specs',
    archived_changes: 'archive/changes',
  },
  workflow: { multiple_active_changes: true },
  requirements: { id_format: '{module}-REQ-{sequence:03d}' },
  changes: { id_format: 'CHG-{date}-{sequence:03d}' },
  archive: {
    update_index: true,
    require_verification: true,
    conflict_strategy: 'optimistic',
  },
});

export async function createWorkflowFixture(): Promise<WorkflowFixture> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-workflow-'));
  const openspecDir = path.join(tempDir, 'openspec');
  const paths = getWorkspacePaths(openspecDir, DEFAULT_CONFIG);

  await fs.mkdir(paths.changes, { recursive: true });
  await fs.mkdir(paths.archive, { recursive: true });
  await fs.mkdir(paths.currentSpecs, { recursive: true });
  await fs.mkdir(paths.archivedChanges, { recursive: true });
  await fs.writeFile(paths.business, '# Business\n');
  await fs.writeFile(paths.changeIndex, 'version: 1\nchanges: []\n');

  const changeId = 'CHG-20260901-001';
  const metadataAt = new Date('2026-09-01T00:00:00.000Z').toISOString();

  return {
    tempDir,
    openspecDir,
    paths,
    workspace: {
      openspecDir,
      config: DEFAULT_CONFIG,
    },
    changeId,
    latestSpecs: [],
    metadataAt,
    cleanup: () => cleanupTempPath(tempDir),
  };
}

export async function writeBusinessFile(fixture: WorkflowFixture, body: string): Promise<void> {
  await fs.writeFile(fixture.paths.business, body);
}

export async function writeCurrentRequirement(
  fixture: WorkflowFixture,
  requirementId: string,
  body: string
): Promise<void> {
  const [moduleId] = requirementId.split('-REQ-');
  const specDir = path.join(fixture.paths.currentSpecs, moduleId);
  await fs.mkdir(specDir, { recursive: true });
  await fs.writeFile(path.join(specDir, 'spec.md'), body);
}

export async function writeActiveReservation(
  fixture: WorkflowFixture,
  requirementId: string
): Promise<void> {
  const reservationsPath = path.join(fixture.paths.changes, 'reservations.txt');
  await fs.mkdir(path.dirname(reservationsPath), { recursive: true });
  await fs.writeFile(reservationsPath, `${requirementId}\n`);
}

export async function writeDelta(
  fixture: WorkflowFixture,
  requirementId: string,
  delta: { previous?: string; next?: string; reason?: string }
): Promise<void> {
  const deltaPath = path.join(fixture.paths.changes, `${requirementId}.yaml`);
  await fs.writeFile(deltaPath, JSON.stringify({ requirementId, ...delta }, null, 2));
}

export async function readCurrentRequirement(
  fixture: WorkflowFixture,
  requirementId: string
): Promise<string> {
  const [moduleId] = requirementId.split('-REQ-');
  return fs.readFile(path.join(fixture.paths.currentSpecs, moduleId, 'spec.md'), 'utf8');
}
