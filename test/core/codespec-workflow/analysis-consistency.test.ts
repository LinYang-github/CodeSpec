import * as fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';

import {
  projectAnalysisMetadata,
  validateAnalysisAgainstWorkspace,
} from '../../../src/core/codespec-workflow/analysis-consistency.js';
import { loadChangeArtifacts, loadWorkspace } from '../../../src/core/codespec-workflow/loaders.js';
import {
  createWorkflowFixture,
  writeBusinessFile,
  writeChangeArtifacts,
} from '../../helpers/codespec-workflow.js';

const analysis = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  change: 'CHG-20260901-001',
  revision: 1,
  problem: '在订单页中展示支付失败原因',
  goals: [{ id: 'GOAL-001', statement: '用户能够理解支付失败的原因' }],
  nonGoals: [{ id: 'NON-GOAL-001', statement: '本次不增加新的支付方式' }],
  scope: { in: ['订单支付失败提示'], out: ['新的支付渠道'] },
  actors: ['用户'],
  constraints: [{ id: 'CONSTRAINT-001', statement: '复用既有错误码', source: '支付服务契约' }],
  assumptions: [{ id: 'ASSUMPTION-001', statement: '错误码已经可用', status: 'CONFIRMED', requirements: ['MOD-001-REQ-001'] }],
  openQuestions: [{ id: 'QUESTION-001', question: '提示文案是否需要本地化', status: 'RESOLVED', resolution: '沿用现有本地化策略' }],
  acceptanceCriteria: [{ id: 'AC-001', statement: '支付失败时展示可理解的原因', priority: 'MUST', requirements: ['MOD-001-REQ-001'] }],
  modules: [{ module: 'MOD-001', outcome: 'OWNED', reason: '订单模块负责支付反馈' }],
  requirements: [{ id: 'MOD-001-REQ-001', action: 'ADDED', reason: '增加支付失败原因展示' }],
  ...overrides,
});

async function writeAnalysis(
  fixture: Awaited<ReturnType<typeof createWorkflowFixture>>,
  document: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const analysisPath = path.join(fixture.paths.changes, fixture.changeId, 'analysis.yaml');
  await writeChangeArtifacts(fixture, {
    metadata: {
      artifacts: {
        analysis: path.join('changes', fixture.changeId, 'analysis.yaml'),
      },
      ...metadata,
    } as never,
  });
  await fs.writeFile(analysisPath, stringifyYaml(document));
}

async function loadFixtureArtifacts(fixture: Awaited<ReturnType<typeof createWorkflowFixture>>) {
  const workspace = await loadWorkspace(fixture.codespecDir);
  return { workspace, artifacts: await loadChangeArtifacts(workspace.paths, fixture.changeId) };
}

const currentSpec = (requirementId: string) => `# 订单管理

- **模块编号：** MOD-001
- **规格版本：** 1

## ${requirementId}：支付反馈

#### Scenario: SCN-001 支付失败

- GIVEN 用户提交支付
- WHEN 支付被拒绝
- THEN 显示失败原因
- ERROR 无法读取错误原因时显示通用提示
`;

describe('analysis metadata projection', () => {
  it('derives compatibility module and requirement queries from the analysis document', () => {
    expect(projectAnalysisMetadata(analysis({
      modules: [
        { module: 'MOD-002', outcome: 'DEPENDENCY', reason: '支付服务提供错误码' },
        { module: 'MOD-001', outcome: 'OWNED', reason: '订单模块负责反馈' },
      ],
      requirements: [
        { id: 'MOD-001-REQ-003', action: 'REMOVED', reason: '移除过时提示' },
        { id: 'MOD-001-REQ-002', action: 'MODIFIED', reason: '补充失败原因' },
        { id: 'MOD-001-REQ-001', action: 'ADDED', reason: '增加失败原因' },
      ],
    }) as never)).toEqual({
      modules: {
        candidates: [
          { module: 'MOD-001', outcome: 'OWNED', reason: '订单模块负责反馈' },
          { module: 'MOD-002', outcome: 'DEPENDENCY', reason: '支付服务提供错误码' },
        ],
        confirmed: [
          { module: 'MOD-001', outcome: 'OWNED', reason: '订单模块负责反馈' },
          { module: 'MOD-002', outcome: 'DEPENDENCY', reason: '支付服务提供错误码' },
        ],
        dependencies: [{ module: 'MOD-002', outcome: 'DEPENDENCY', reason: '支付服务提供错误码' }],
      },
      requirements: {
        added: [{ id: 'MOD-001-REQ-001', module: 'MOD-001' }],
        modified: [{ id: 'MOD-001-REQ-002', module: 'MOD-001' }],
        removed: [{ id: 'MOD-001-REQ-003', module: 'MOD-001' }],
      },
    });
  });
});

describe('analysis workspace consistency', () => {
  it('rejects an ADDED Requirement that already exists in the Current Specification', async () => {
    const fixture = await createWorkflowFixture(); afterEach(fixture.cleanup);
    await writeAnalysis(fixture, analysis());
    await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-001'), { recursive: true });
    await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-001', 'spec.md'), currentSpec('MOD-001-REQ-001'));
    const { workspace, artifacts } = await loadFixtureArtifacts(fixture);

    await expect(validateAnalysisAgainstWorkspace(workspace, artifacts)).resolves.toContainEqual(
      expect.stringMatching(/requirements\[0\].*ADDED.*MOD-001-REQ-001.*already exists/i),
    );
  });

  it.each(['MODIFIED', 'REMOVED'] as const)('rejects a %s Requirement missing from the Current Specification', async (action) => {
    const fixture = await createWorkflowFixture(); afterEach(fixture.cleanup);
    await writeAnalysis(fixture, analysis({
      requirements: [{ id: 'MOD-001-REQ-001', action, reason: '更新支付反馈' }],
    }));
    const { workspace, artifacts } = await loadFixtureArtifacts(fixture);

    await expect(validateAnalysisAgainstWorkspace(workspace, artifacts)).resolves.toContainEqual(
      expect.stringMatching(new RegExp(`requirements\\[0\\].*${action}.*MOD-001-REQ-001.*does not exist`, 'i')),
    );
  });

  it('rejects a Requirement assigned to a module that is not OWNED', async () => {
    const fixture = await createWorkflowFixture(); afterEach(fixture.cleanup);
    await writeAnalysis(fixture, analysis({
      modules: [{ module: 'MOD-001', outcome: 'DEPENDENCY', reason: '支付服务负责反馈' }],
    }));
    const { workspace, artifacts } = await loadFixtureArtifacts(fixture);

    await expect(validateAnalysisAgainstWorkspace(workspace, artifacts)).resolves.toContainEqual(
      expect.stringMatching(/requirements\[0\].*MOD-001-REQ-001.*OWNED/i),
    );
  });

  it('rejects a module that is not registered in the workspace business registry', async () => {
    const fixture = await createWorkflowFixture(); afterEach(fixture.cleanup);
    await writeAnalysis(fixture, analysis({
      modules: [{ module: 'MOD-003', outcome: 'OWNED', reason: '未知模块' }],
      requirements: [{ id: 'MOD-003-REQ-001', action: 'ADDED', reason: '未知需求' }],
      assumptions: [{ id: 'ASSUMPTION-001', statement: '假设', status: 'CONFIRMED', requirements: ['MOD-003-REQ-001'] }],
      acceptanceCriteria: [{ id: 'AC-001', statement: '验收', priority: 'MUST', requirements: ['MOD-003-REQ-001'] }],
    }));
    const { workspace, artifacts } = await loadFixtureArtifacts(fixture);

    await expect(validateAnalysisAgainstWorkspace(workspace, artifacts)).resolves.toContainEqual(
      expect.stringMatching(/modules\[0\].*MOD-003.*registered/i),
    );
  });

  it('does not search archive history when determining whether an ADDED Requirement exists', async () => {
    const fixture = await createWorkflowFixture(); afterEach(fixture.cleanup);
    await writeAnalysis(fixture, analysis(), {
      modules: {
        candidates: [{ module: 'MOD-001', outcome: 'OWNED', reason: '订单模块负责支付反馈' }],
        confirmed: [{ module: 'MOD-001', outcome: 'OWNED', reason: '订单模块负责支付反馈' }],
        dependencies: [],
      },
      requirements: { added: [{ id: 'MOD-001-REQ-001', module: 'MOD-001' }], modified: [], removed: [] },
    });
    const archiveSpec = path.join(fixture.paths.archive, 'specs', 'MOD-001');
    await fs.mkdir(archiveSpec, { recursive: true });
    await fs.writeFile(path.join(archiveSpec, 'spec.md'), currentSpec('MOD-001-REQ-001'));
    const { workspace, artifacts } = await loadFixtureArtifacts(fixture);

    await expect(validateAnalysisAgainstWorkspace(workspace, artifacts)).resolves.toEqual([]);
  });

  it('reports change and revision identity before metadata projection drift', async () => {
    const fixture = await createWorkflowFixture(); afterEach(fixture.cleanup);
    await writeAnalysis(fixture, analysis({ change: 'CHG-20260901-002', revision: 2 }), {
      modules: { candidates: [], confirmed: [], dependencies: [] },
    });
    const { workspace, artifacts } = await loadFixtureArtifacts(fixture);

    await expect(validateAnalysisAgainstWorkspace(workspace, artifacts)).resolves.toEqual([
      'analysis.yaml.change: expected CHG-20260901-002 to equal metadata.change.id CHG-20260901-001',
      'analysis.yaml.revision: expected 2 to equal metadata.change.revision',
      'metadata.modules: must exactly equal the projection derived from analysis.yaml',
      'metadata.requirements: must exactly equal the projection derived from analysis.yaml',
    ]);
  });

  it('requires an active historical five-artifact Change to migrate before leaving ANALYZE', async () => {
    const fixture = await createWorkflowFixture(); afterEach(fixture.cleanup);
    await writeBusinessFile(fixture, '# Business\n\n| Module ID | Module Name | Description | Responsibilities | Keywords |\n| --- | --- | --- | --- | --- |\n| MOD-001 | Orders | Owns orders | Orders | orders |\n');
    await writeChangeArtifacts(fixture);
    const { workspace, artifacts } = await loadFixtureArtifacts(fixture);

    await expect(validateAnalysisAgainstWorkspace(workspace, artifacts)).resolves.toEqual([
      'analysis.yaml: active five-artifact Change must be migrated before ANALYZE can complete',
    ]);
  });
});
