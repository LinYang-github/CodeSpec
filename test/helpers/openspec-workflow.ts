import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';

import { getWorkspacePaths } from '../../src/core/openspec-workflow/paths.js';
import { parseWorkspaceConfig } from '../../src/core/openspec-workflow/schemas.js';
import type { ChangeMetadata, WorkspaceConfig } from '../../src/core/openspec-workflow/types.js';
import { cleanupTempPath } from './temp-cleanup.js';

export interface WorkflowFixture {
  tempDir: string;
  openspecDir: string;
  paths: ReturnType<typeof getWorkspacePaths>;
  workspace: {
    openspecDir: string;
    config: WorkspaceConfig;
    paths: ReturnType<typeof getWorkspacePaths>;
  };
  changeId: string;
  latestSpecs: string[];
  metadataAt: (status: ChangeMetadata['change']['status']) => ChangeMetadata;
  cleanup: () => void;
}

const DEFAULT_CONFIG: WorkspaceConfig = parseWorkspaceConfig({
  version: 1,
  schema: 'code-spec',
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

function mergeWorkspaceConfig(
  base: WorkspaceConfig,
  overrides: Partial<WorkspaceConfig> | undefined
): WorkspaceConfig {
  if (!overrides) {
    return base;
  }

  return parseWorkspaceConfig({
    ...base,
    ...overrides,
    project: {
      ...base.project,
      ...overrides.project,
    },
    paths: {
      ...base.paths,
      ...overrides.paths,
    },
    workflow: {
      ...base.workflow,
      ...overrides.workflow,
    },
    requirements: {
      ...base.requirements,
      ...overrides.requirements,
    },
    changes: {
      ...base.changes,
      ...overrides.changes,
    },
    archive: {
      ...base.archive,
      ...overrides.archive,
    },
  });
}

function buildMetadata(
  fixture: Pick<WorkflowFixture, 'changeId' | 'paths'>,
  status: ChangeMetadata['change']['status'],
  overrides?: Partial<ChangeMetadata>
): ChangeMetadata {
  const timestamp = new Date('2026-09-01T00:00:00.000Z').toISOString();
  return {
    schema_version: 1,
    change: {
      id: fixture.changeId,
      revision: 1,
      title: 'Demo change',
      mode: 'feature',
      status,
      created_at: timestamp,
      updated_at: timestamp,
      ...overrides?.change,
    },
    impact: {
      summary: 'Introduce a canonical workflow fixture',
      mode: 'feature',
      scope: 'single-module',
      ...overrides?.impact,
    },
    baseline: {
      created_at: timestamp,
      stale: false,
      modules: {},
      ...overrides?.baseline,
    },
    relations: {
      depends_on: [],
      related_to: [],
      conflicts_with: [],
      supersedes: [],
      ...overrides?.relations,
    },
    gates: {
      analyze: { required: true, satisfied: false },
      design: { required: true, satisfied: false },
      plan: { required: true, satisfied: false },
      implement: { required: true, satisfied: false },
      verify: { required: true, satisfied: false },
      archive: { required: true, satisfied: false },
      ...overrides?.gates,
    },
    modules: {
      candidates: [],
      confirmed: [],
      dependencies: [],
      ...overrides?.modules,
    },
    requirements: {
      added: [],
      modified: [],
      removed: [],
      ...overrides?.requirements,
    },
    artifacts: {
      metadata: path.relative(
        fixture.paths.openspecDir,
        path.join(fixture.paths.changes, fixture.changeId, 'metadata.yaml')
      ),
      proposal: path.relative(
        fixture.paths.openspecDir,
        path.join(fixture.paths.changes, fixture.changeId, 'proposal.md')
      ),
      design: path.relative(
        fixture.paths.openspecDir,
        path.join(fixture.paths.changes, fixture.changeId, 'design.md')
      ),
      spec: path.relative(
        fixture.paths.openspecDir,
        path.join(fixture.paths.changes, fixture.changeId, 'spec.md')
      ),
      tasks: path.relative(
        fixture.paths.openspecDir,
        path.join(fixture.paths.changes, fixture.changeId, 'tasks.md')
      ),
      verification: path.relative(
        fixture.paths.openspecDir,
        path.join(fixture.paths.changes, fixture.changeId, 'verification.md')
      ),
      ...overrides?.artifacts,
    },
    tasks: {
      total: 0,
      completed: 0,
      items: {},
      ...overrides?.tasks,
    },
    verification: {
      requirements_verified: false,
      tests_passed: false,
      build_passed: false,
      lint_passed: false,
      verified_at: null,
      ...overrides?.verification,
    },
    archive: {
      ready: false,
      conflict: false,
      archived_at: null,
      ...overrides?.archive,
    },
  };
}

export async function createWorkflowFixture(options?: {
  configOverrides?: Partial<WorkspaceConfig>;
}): Promise<WorkflowFixture> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-workflow-'));
  const openspecDir = path.join(tempDir, 'openspec');
  const config = mergeWorkspaceConfig(DEFAULT_CONFIG, options?.configOverrides);
  const paths = getWorkspacePaths(openspecDir, config);

  await fs.mkdir(paths.changes, { recursive: true });
  await fs.mkdir(paths.archive, { recursive: true });
  await fs.mkdir(paths.currentSpecs, { recursive: true });
  await fs.mkdir(paths.archivedChanges, { recursive: true });
  await fs.mkdir(path.dirname(paths.business), { recursive: true });
  await fs.mkdir(path.dirname(paths.changeIndex), { recursive: true });
  await fs.writeFile(paths.business, '# Business\n\n| Module ID | Module Name | Description | Responsibilities | Keywords |\n| --- | --- | --- | --- | --- |\n| MOD-001 | Workflow | Workflow management | Manage changes | workflow |\n| MOD-002 | Payment | Payment management | Process payments | payment |\n');
  await fs.writeFile(paths.changeIndex, 'version: 1\nchanges: []\n');
  await fs.writeFile(path.join(openspecDir, 'config.yaml'), stringifyYaml(config));

  const changeId = 'CHG-20260901-001';

  return {
    tempDir,
    openspecDir,
    paths,
    workspace: {
      openspecDir,
      config,
      paths,
    },
    changeId,
    latestSpecs: [],
    metadataAt: (status) => buildMetadata({ changeId, paths }, status),
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

export async function writeChangeArtifacts(
  fixture: WorkflowFixture,
  options?: {
    metadata?: Partial<ChangeMetadata>;
    proposal?: string;
    design?: string;
    spec?: string;
    tasks?: string;
    verification?: string;
  }
): Promise<void> {
  const changeDir = path.join(fixture.paths.changes, fixture.changeId);
  await fs.mkdir(changeDir, { recursive: true });

  const metadata = buildMetadata(
    fixture,
    options?.metadata?.change?.status ?? 'ANALYZE',
    options?.metadata
  );

  await fs.writeFile(path.join(changeDir, 'metadata.yaml'), stringifyYaml(metadata));
  await fs.writeFile(path.join(changeDir, 'proposal.md'), options?.proposal ?? '# Proposal\n');
  await fs.writeFile(path.join(changeDir, 'design.md'), options?.design ?? '# Design\n');
  await fs.writeFile(path.join(changeDir, 'spec.md'), options?.spec ?? '# Spec\n');
  await fs.writeFile(path.join(changeDir, 'tasks.md'), options?.tasks ?? '# Tasks\n');
  await fs.writeFile(
    path.join(changeDir, 'verification.md'),
    options?.verification ?? '# Verification\n'
  );
}
