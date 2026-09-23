import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stringify as stringifyYaml } from 'yaml';

import { getWorkspacePaths } from '../../src/core/codespec-workflow/paths.js';
import { parseWorkspaceConfig } from '../../src/core/codespec-workflow/schemas.js';
import type { ChangeMetadata, WorkspaceConfig } from '../../src/core/codespec-workflow/types.js';
import { cleanupTempPath } from './temp-cleanup.js';

const execFileAsync = promisify(execFile);

export interface WorkflowFixture {
  tempDir: string;
  codespecDir: string;
  paths: ReturnType<typeof getWorkspacePaths>;
  workspace: {
    codespecDir: string;
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
    business: 'business.yaml',
    configuration: 'configuration.yaml',
    changes: 'changes',
    change_index: 'changes/index.yaml',
    specs: 'specs',
    transactions: '.transactions',
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
      sdd_level: 2,
      status,
      created_at: timestamp,
      updated_at: timestamp,
      ...overrides?.change,
    },
    impact: {
      summary: 'Introduce a canonical workflow fixture',
      mode: 'feature',
      scope: 'single-module',
      affected_areas: [],
      ...overrides?.impact,
    },
    baseline: {
      created_at: timestamp,
      commit: null,
      working_tree_fingerprint: `sha256:${'0'.repeat(64)}`,
      current_fingerprint: '0'.repeat(64),
      stale: false,
      modules: {},
      ...overrides?.baseline,
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
    approvals: {
      schema_version: 1,
      analyze: { status: 'pending', revision: 1, content_hash: '', approved_at: null },
      design: { status: 'pending', revision: 1, content_hash: '', approved_at: null },
      plan: { status: 'pending', revision: 1, content_hash: '', approved_at: null },
      ...overrides?.approvals,
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
      analysis: path.relative(
        fixture.paths.codespecDir,
        path.join(fixture.paths.changes, fixture.changeId, 'analysis.yaml')
      ),
      metadata: path.relative(
        fixture.paths.codespecDir,
        path.join(fixture.paths.changes, fixture.changeId, 'metadata.yaml')
      ),
      design: path.relative(
        fixture.paths.codespecDir,
        path.join(fixture.paths.changes, fixture.changeId, 'design.md')
      ),
      spec: path.relative(
        fixture.paths.codespecDir,
        path.join(fixture.paths.changes, fixture.changeId, 'spec.md')
      ),
      tasks: path.relative(
        fixture.paths.codespecDir,
        path.join(fixture.paths.changes, fixture.changeId, 'tasks.yaml')
      ),
      verification: path.relative(
        fixture.paths.codespecDir,
        path.join(fixture.paths.changes, fixture.changeId, 'verification.yaml')
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
      ...overrides?.archive,
    },
  };
}

export async function createWorkflowFixture(options?: {
  configOverrides?: Partial<WorkspaceConfig>;
  /** Create the consolidated v1 projection instead of the legacy markdown fixture. */
  v1?: boolean;
}): Promise<WorkflowFixture> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-workflow-'));
  const codespecDir = path.join(tempDir, 'codespec');
  const v1 = options?.v1 ?? true;
  const config = mergeWorkspaceConfig(DEFAULT_CONFIG, options?.configOverrides);
  const paths = getWorkspacePaths(codespecDir, config);

  await fs.mkdir(paths.changes, { recursive: true });
  await fs.mkdir(paths.currentSpecs, { recursive: true });
  await fs.mkdir(path.dirname(paths.business), { recursive: true });
  await fs.mkdir(path.dirname(paths.changeIndex), { recursive: true });
  if (v1) {
    await fs.writeFile(paths.business, stringifyYaml({
      version: 1,
      modules: [
        { id: 'MOD-001', name: 'Workflow', status: 'ACTIVE', inputs: [], outputs: [], relatedModules: [] },
        { id: 'MOD-002', name: 'Payment', status: 'ACTIVE', inputs: [], outputs: [], relatedModules: [] },
      ],
    }));
    await fs.writeFile(paths.configuration, stringifyYaml({ version: 1, profiles: [] }));
    for (const moduleId of ['MOD-001', 'MOD-002']) {
      const moduleDir = path.join(paths.currentSpecs, moduleId);
      await fs.mkdir(moduleDir, { recursive: true });
      await fs.writeFile(path.join(moduleDir, 'spec.md'), `# ${moduleId}\n\n- **模块编号：** ${moduleId}\n- **规格版本：** 1\n\n### 当前模块工程文件\n\n| 文件 | 作用 | 关联需求 / 场景 / 测试用例 |\n| --- | --- | --- |\n`);
      await fs.writeFile(path.join(moduleDir, 'interface.yaml'), stringifyYaml({ version: 1, module: moduleId, relations: [] }));
      await fs.writeFile(path.join(moduleDir, 'api.yaml'), stringifyYaml({ version: 1, module: moduleId, routes: [] }));
    }
  } else {
    await fs.writeFile(paths.business, '# Business\n\n| Module ID | Module Name | Description | Responsibilities | Keywords |\n| --- | --- | --- | --- | --- |\n| MOD-001 | Workflow | Workflow management | Manage changes | workflow |\n| MOD-002 | Payment | Payment management | Process payments | payment |\n');
    await fs.writeFile(paths.configuration, 'version: 1\nprofiles: []\n');
  }
  await fs.writeFile(paths.changeIndex, 'version: 1\nchanges: []\n');
  await fs.writeFile(path.join(codespecDir, 'config.yaml'), stringifyYaml(config));
  await execFileAsync('git', ['init', '--quiet'], { cwd: tempDir });
  await execFileAsync('git', ['config', 'user.email', 'codespec-tests@example.com'], { cwd: tempDir });
  await execFileAsync('git', ['config', 'user.name', 'CodeSpec Tests'], { cwd: tempDir });
  await execFileAsync('git', ['add', '.'], { cwd: tempDir });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'Initialize fixture'], { cwd: tempDir });

  const changeId = 'CHG-20260901-001';

  return {
    tempDir,
    codespecDir,
    paths,
    workspace: {
      codespecDir,
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
    analysis?: string;
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
  await fs.writeFile(path.join(changeDir, 'analysis.yaml'), options?.analysis ?? stringifyYaml({
    version: 1,
    change: fixture.changeId,
    revision: metadata.change.revision,
    problem: 'Describe the requested behavior',
    goals: [],
    nonGoals: [],
    scope: { in: [], out: [] },
    actors: [],
    constraints: [],
    assumptions: [],
    openQuestions: [],
    acceptanceCriteria: [],
    modules: [],
    requirements: [],
  }));
  await fs.writeFile(path.join(changeDir, 'design.md'), options?.design ?? `# Design

## 归档影响分析

\`\`\`yaml
outcome: none
references: []
verification: []
\`\`\`
`);
  await fs.writeFile(path.join(changeDir, 'spec.md'), options?.spec ?? '# Spec\n');
  await fs.writeFile(path.join(changeDir, 'tasks.yaml'), options?.tasks ?? stringifyYaml({
    version: 1,
    changeRevision: metadata.change.revision,
    tasks: [],
    moduleDeltas: [],
    moduleRegistrations: { upsert: [], retire: [] },
  }));
  await fs.writeFile(
    path.join(changeDir, 'verification.yaml'),
    options?.verification ?? stringifyYaml({
      version: 1,
      changeRevision: metadata.change.revision,
      testCases: [],
    })
  );
}
