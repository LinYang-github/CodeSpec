import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';

import { approveStage } from '../../src/core/codespec-workflow/approvals.js';
import { parseAnalysisDocument } from '../../src/core/codespec-workflow/analysis.js';
import { projectAnalysisMetadata } from '../../src/core/codespec-workflow/analysis-consistency.js';
import type { ChangeArtifacts } from '../../src/core/codespec-workflow/artifacts.js';
import { parseCurrentSpecDelta, renderCurrentSpecDelta, type CurrentSpecDeltaDocument } from '../../src/core/codespec-workflow/current-spec-delta.js';
import { renderCurrentSpecification, type CurrentSpecRequirement, type CurrentSpecification } from '../../src/core/codespec-workflow/current-spec-model.js';
import { createWorkflowFixture, type WorkflowFixture } from './codespec-workflow.js';
import { verificationArtifactIdentity } from '../../src/core/codespec-workflow/verification.js';

export function requirement(id = 'MOD-002-REQ-001', states = ['A', 'B']): CurrentSpecRequirement {
  return {
    id, title: `支持 ${states.join('+')}`,
    scenarios: states.map((state, index) => ({
      id: `${id}-SCN-${String(index + 1).padStart(3, '0')}`, title: state,
      given: ['就绪'], when: [`执行 ${state}`], then: [`得到 ${state}`], error: ['失败时提示重试'], testCases: [{
        id: `${id}-SCN-${String(index + 1).padStart(3, '0')}-TC-UI-01`, title: `验证 ${state}`, type: 'UI',
        automationTest: id === 'MOD-002-REQ-002' ? 'src/two.ts' : 'src/one.ts', testId: `state-${index}`, latestVerification: '待验证',
        steps: [{ number: '1', action: `执行 ${state}`, expected: `得到 ${state}` }],
      }],
    })),
  };
}

export function currentSpecification(): CurrentSpecification {
  return {
    title: '当前用户管理', module: 'MOD-002', version: '1',
    requirements: [requirement(), requirement('MOD-002-REQ-002', ['D'])],
    engineeringFiles: [
      { path: 'src/one.ts', role: '原始作用', references: ['MOD-002-REQ-001', ...requirement().scenarios.flatMap((scenario) => scenario.testCases.map((test) => test.id))] },
      { path: 'src/two.ts', role: '无关实现', references: ['MOD-002-REQ-002', ...requirement('MOD-002-REQ-002', ['D']).scenarios.flatMap((scenario) => scenario.testCases.map((test) => test.id))] },
    ],
  };
}

export function modification(current = requirement(), next = requirement('MOD-002-REQ-001', ['A', 'B', 'C'])): CurrentSpecDeltaDocument {
  return {
    title: '只改变一个需求', module: 'MOD-002', version: 1,
    requirements: [{ action: 'MODIFIED', module: 'MOD-002', id: current.id, previous: current, next, reason: '本次请求' }],
    engineeringFiles: [{ path: 'src/one.ts', module: 'MOD-002', change: '修改', role: '本次实现', references: [current.id, ...next.scenarios.flatMap((scenario) => scenario.testCases.map((test) => test.id))] }],
  };
}

export async function writeCanonicalChange(fixture: WorkflowFixture, delta: CurrentSpecDeltaDocument, changeId = fixture.changeId): Promise<ChangeArtifacts> {
  for (const entry of delta.requirements) for (const scenario of entry.next?.scenarios ?? []) for (const test of scenario.testCases) {
    let file = delta.engineeringFiles.find((candidate) => candidate.path === test.automationTest);
    if (!file) {
      file = { path: test.automationTest, module: entry.module, change: '新增', role: '验收测试', references: [entry.id] };
      delta.engineeringFiles.push(file);
    }
    if (!file.references.includes(test.id)) file.references.push(test.id);
  }
  const changeDir = path.join(fixture.paths.changes, changeId);
  await fs.mkdir(changeDir, { recursive: true });
  let metadata = fixture.metadataAt('ARCHIVE');
  metadata.change.id = changeId;
  metadata.artifacts = Object.fromEntries(['metadata.yaml', 'analysis.yaml', 'design.md', 'spec.md', 'tasks.yaml', 'verification.yaml']
    .map((file) => [file.split('.')[0], path.relative(fixture.codespecDir, path.join(changeDir, file))])) as typeof metadata.artifacts;
  metadata.archive.ready = true;
  for (const gate of Object.values(metadata.gates)) gate.satisfied = true;
  const analysis = parseAnalysisDocument({
    version: 1, change: changeId, revision: 1, problem: '支持新增能力',
    goals: [{ id: 'GOAL-001', statement: '满足本次请求' }], nonGoals: [], scope: { in: ['当前需求'], out: ['其他需求'] },
    actors: ['用户'], constraints: [], assumptions: [], openQuestions: [],
    acceptanceCriteria: [{ id: 'AC-001', statement: '请求成功', priority: 'MUST', requirements: delta.requirements.map((entry) => entry.id) }],
    modules: [{ module: delta.module, outcome: 'OWNED', reason: '模块负责本次行为' }],
    requirements: delta.requirements.map(({ id, action, reason }) => ({ id, action, reason })),
  });
  Object.assign(metadata, projectAnalysisMetadata(analysis));
  const artifacts: ChangeArtifacts = {
    changeId, changeDir, metadata, analysis: stringify(analysis),
    design: `# 设计\n\n${delta.requirements.map((entry) => entry.id).join('\n')}\n\n## SDD 分级依据\n\n单模块需求。\n\n## 归档影响分析\n\n\`\`\`yaml\noutcome: none\nreferences: []\nverification: []\n\`\`\`\n`,
    spec: renderCurrentSpecDelta(delta),
    tasks: stringify({ version: 1, changeRevision: 1, tasks: [], moduleDeltas: [], moduleRegistrations: { upsert: [], retire: [] } }),
    verification: stringify({ version: 1, changeRevision: 1, testCases: [] }),
  };
  const tasks = delta.requirements.flatMap((entry) => (entry.next ?? entry.previous!).scenarios.map((scenario) => ({
    id: '', title: `实现 ${scenario.title}`, status: 'DONE', acceptanceCriteria: ['AC-001'], requirements: [entry.id], scenarios: [scenario.id], testCases: scenario.testCases.map((test) => test.id), plannedFiles: ['src/one.ts'],
    verificationPlan: scenario.testCases.map((test) => ({ testCase: test.id, runner: 'node', command: 'node -e "process.exit(0)"', profile: 'test', services: [], prepare: 'none', cleanup: 'none' })),
  }))).map((task, index) => ({ ...task, id: `${changeId}-TASK-${String(index + 1).padStart(2, '0')}` }));
  artifacts.tasks = stringify({ version: 1, changeRevision: 1, tasks, moduleDeltas: [], moduleRegistrations: { upsert: [], retire: [] } });
  artifacts.verification = stringify({ version: 1, changeRevision: 1, artifactIdentity: verificationArtifactIdentity(artifacts), testCases: tasks.flatMap((task) => task.verificationPlan.map((plan) => ({
    testCase: plan.testCase, acceptanceCriteria: ['AC-001'], result: 'PASS', testFile: 'src/one.ts', testId: plan.testCase,
    command: plan.command, profile: 'test', services: [], browser: 'not-applicable', exitCode: 0, gitRevision: metadata.baseline.commit ?? '0000000', treeFingerprint: metadata.baseline.working_tree_fingerprint,
    executedAt: '2026-09-15T00:00:00Z', summary: '通过', cleanupSucceeded: true,
  }))) });
  await fs.writeFile(fixture.paths.configuration, stringify({ version: 1, profiles: [{ id: 'test', services: [] }] }));
  // Parse the fixture at its public artifact boundary before issuing receipts.
  parseCurrentSpecDelta(artifacts.spec);
  for (const stage of ['analyze', 'design', 'plan'] as const) {
    metadata = approveStage(artifacts, stage);
    artifacts.metadata = metadata;
  }
  for (const [key, file] of Object.entries(metadata.artifacts)) {
    await fs.writeFile(path.join(fixture.codespecDir, file!), key === 'metadata' ? stringify(metadata) : artifacts[key as keyof ChangeArtifacts] as string);
  }
  const index = parse(await fs.readFile(fixture.paths.changeIndex, 'utf8'));
  const { id, title, mode, status, updated_at } = metadata.change;
  index.changes = [...index.changes.filter((entry: { id: string }) => entry.id !== id), { id, title, mode, status, updated_at }];
  await fs.writeFile(fixture.paths.changeIndex, stringify(index));
  return artifacts;
}

export async function createCurrentArchiveFixture() {
  const fixture = await createWorkflowFixture({ v1: true });
  await fs.mkdir(fixture.paths.transactions, { recursive: true });
  const current = currentSpecification();
  await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), renderCurrentSpecification(current));
  await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-001', 'spec.md'), '# 依赖模块\n\n- **模块编号：** MOD-001\n- **规格版本：** 1\n');
  await fs.mkdir(path.join(fixture.tempDir, 'src'), { recursive: true });
  await fs.writeFile(path.join(fixture.tempDir, 'src', 'one.ts'), 'export const value = 1;\n');
  await fs.writeFile(path.join(fixture.tempDir, 'src', 'two.ts'), 'export const value = 2;\n');
  return { ...fixture, current };
}
