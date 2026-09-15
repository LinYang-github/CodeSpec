import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { captureBaseline, hashAbsentRequirement } from '../../../src/core/codespec-workflow/baseline.js';
import { loadWorkspace } from '../../../src/core/codespec-workflow/loaders.js';
import { hashRequirementSnapshot, parseRequirementSnapshot } from '../../../src/core/codespec-workflow/current-spec-model.js';
import { createWorkflowFixture } from '../../helpers/codespec-workflow.js';
import { currentMarkdown, requirementMarkdown } from '../../helpers/rich-requirement.js';

describe('canonical Requirement semantic baselines', () => {
  async function setup() {
    const fixture = await createWorkflowFixture();
    afterEach(fixture.cleanup);
    const metadata = fixture.metadataAt('DESIGN');
    delete metadata.artifacts.proposal;
    metadata.artifacts.analysis = `changes/${fixture.changeId}/analysis.yaml`;
    metadata.modules.confirmed = [{ module: 'MOD-002', outcome: 'OWNED', reason: '用户管理' }];
    metadata.requirements = { added: [{ id: 'MOD-002-REQ-008', module: 'MOD-002' }], modified: [{ id: 'MOD-002-REQ-006', module: 'MOD-002' }], removed: [] };
    const dir = path.join(fixture.paths.changes, fixture.changeId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'metadata.yaml'), stringifyYaml(metadata));
    await fs.writeFile(path.join(dir, 'analysis.yaml'), stringifyYaml({
      version: 1, change: fixture.changeId, revision: 1, problem: '管理用户', goals: [{ id: 'GOAL-001', statement: '管理用户' }], nonGoals: [],
      scope: { in: ['用户'], out: [] }, actors: ['管理员'], constraints: [], assumptions: [], openQuestions: [],
      acceptanceCriteria: [{ id: 'AC-001', statement: '管理用户', priority: 'MUST', requirements: ['MOD-002-REQ-006', 'MOD-002-REQ-008'] }],
      modules: metadata.modules.confirmed, requirements: [{ id: 'MOD-002-REQ-006', action: 'MODIFIED', reason: '修改' }, { id: 'MOD-002-REQ-008', action: 'ADDED', reason: '新增' }],
    }));
    const file = path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, currentMarkdown);
    return { fixture, metadata, file, workspace: await loadWorkspace(fixture.codespecDir) };
  }

  it('captures only analysis-declared Requirement state and an ID-specific absence marker', async () => {
    const { workspace, metadata } = await setup();
    // A stale metadata-only reference must not expand the baseline authority.
    metadata.requirements.modified.push({ id: 'MOD-002-REQ-007', module: 'MOD-002' });
    const baseline = await captureBaseline(workspace, metadata);
    expect(baseline.modules['MOD-002'].requirement_ids).toEqual(['MOD-002-REQ-006', 'MOD-002-REQ-008']);
    expect(baseline.modules['MOD-002'].requirements).toEqual({
      'MOD-002-REQ-006': hashRequirementSnapshot(parseRequirementSnapshot(requirementMarkdown)),
      'MOD-002-REQ-008': createHash('sha256').update('codespec:requirement-absent:v1:MOD-002-REQ-008').digest('hex'),
    });
  });

  it('ignores unrelated Requirement, module title, file table and Markdown formatting changes', async () => {
    const { workspace, metadata, file } = await setup();
    const before = (await captureBaseline(workspace, metadata)).modules;
    await fs.writeFile(file, currentMarkdown.replace('# 用户管理', '# 管理用户').replace('显示状态', '显示更多状态').replace('| 自动化测试 |', '| 更新的测试说明 |').replaceAll(' | ', '  |  ').replaceAll('\n', '\r\n'));
    expect((await captureBaseline(workspace, metadata)).modules).toEqual(before);
    await fs.writeFile(file, currentMarkdown.replace('THEN 用户出现在列表', 'THEN 用户出现在顶部'));
    expect((await captureBaseline(workspace, metadata)).modules['MOD-002'].requirements['MOD-002-REQ-006']).not.toBe(before['MOD-002'].requirements['MOD-002-REQ-006']);
  });

  it.each([
    [currentMarkdown.replaceAll('REQ-006', 'REQ-009'), /MODIFIED.*does not exist in Current/],
    [currentMarkdown + requirementMarkdown.replaceAll('REQ-006', 'REQ-008'), /ADDED.*already exists in Current/],
  ])('refuses a missing modified Requirement or an ADDED ID already present in Current', async (source, message) => {
    const { workspace, metadata, file } = await setup();
    await fs.writeFile(file, source);
    await expect(captureBaseline(workspace, metadata)).rejects.toThrow(message);
  });
});

it('keeps the Task 6 absence marker independent of the snapshot refresh path', () => {
  expect(hashAbsentRequirement('MOD-001-REQ-001')).toBe('32f1160ca43cbba82071e8b1179166961629d05cf963e2b5d7ce823e0dac76dd');
});
