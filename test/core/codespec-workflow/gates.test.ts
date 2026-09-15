import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { createCurrentArchiveFixture, modification, requirement, writeCanonicalChange } from '../../helpers/current-archive.js';
import { validateExitGate } from '../../../src/core/codespec-workflow/gates.js';
import { validateChangeTraceability } from '../../../src/core/codespec-workflow/traceability.js';
import { verificationArtifactIdentity, validateCurrentVerificationArtifacts, validateVerificationEvidence } from '../../../src/core/codespec-workflow/verification.js';
import { renderCurrentSpecDelta } from '../../../src/core/codespec-workflow/current-spec-delta.js';
import { preflightArchive } from '../../../src/core/codespec-workflow/archive-transaction.js';
import { approveStage } from '../../../src/core/codespec-workflow/approvals.js';

async function setup() {
  const fixture = await createCurrentArchiveFixture();
  await fs.writeFile(fixture.paths.configuration, stringify({ version: 1, profiles: [{ id: 'test', services: [] }] }));
  const delta = modification();
  for (const scenario of delta.requirements[0].next!.scenarios) scenario.testCases = [{
    id: `${scenario.id}-TC-API-01`, title: '行为验收', type: 'API', automationTest: 'test/users.test.ts', testId: 'users', latestVerification: '待验证', steps: [{ number: '1', action: '执行请求', expected: '成功' }],
  }];
  delta.engineeringFiles[0].references = ['MOD-002-REQ-001'];
  const artifacts = await writeCanonicalChange(fixture, delta);
  const tasks = delta.requirements[0].next!.scenarios.map((scenario, index) => ({
    id: `${fixture.changeId}-TASK-0${index + 1}`, title: '实现行为', status: 'DONE', acceptanceCriteria: ['AC-001'],
    requirements: ['MOD-002-REQ-001'], scenarios: [scenario.id], testCases: [scenario.testCases[0].id], plannedFiles: ['src/one.ts'],
    verificationPlan: [{ testCase: scenario.testCases[0].id, runner: 'node', command: 'node -e "process.exit(0)"', profile: 'test', services: [], prepare: 'none', cleanup: 'none' }],
  }));
  artifacts.tasks = stringify({ version: 1, changeRevision: 1, tasks, moduleDeltas: [], moduleRegistrations: { upsert: [], retire: [] } });
  artifacts.verification = stringify({ version: 1, changeRevision: 1, artifactIdentity: verificationArtifactIdentity(artifacts), testCases: tasks.map((task) => ({
    testCase: task.testCases[0], acceptanceCriteria: ['AC-001'], result: 'PASS', testFile: 'src/one.ts', testId: task.testCases[0],
    command: task.verificationPlan[0].command, profile: 'test', services: [], browser: 'not-applicable', exitCode: 0,
    gitRevision: artifacts.metadata.baseline.commit ?? '0000000', treeFingerprint: artifacts.metadata.baseline.working_tree_fingerprint,
    executedAt: '2026-09-15T00:00:00Z', summary: '通过', cleanupSucceeded: true,
  })) });
  return { fixture, artifacts, delta };
}

describe('acceptance criterion gates', () => {
  it('keeps optional evidence optional when a task covers both MUST and SHOULD requirements', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const delta = modification();
      const previous = requirement('MOD-002-REQ-002', ['D']); const next = requirement('MOD-002-REQ-002', ['D', 'E']);
      delta.requirements.push({ id: previous.id, module: 'MOD-002', action: 'MODIFIED', previous, next, reason: '可选增强' });
      delta.engineeringFiles.push({ path: 'src/two.ts', module: 'MOD-002', change: '修改', role: '可选实现', references: [previous.id] });
      const artifacts = await writeCanonicalChange(fixture, delta);
      const analysis = parse(artifacts.analysis!); analysis.acceptanceCriteria[0].requirements = ['MOD-002-REQ-001'];
      analysis.acceptanceCriteria.push({ id: 'AC-002', statement: '可选增强', priority: 'SHOULD', requirements: ['MOD-002-REQ-002'] });
      artifacts.analysis = stringify(analysis);
      const tasks = parse(artifacts.tasks); const merged = { ...tasks.tasks[0], acceptanceCriteria: ['AC-001', 'AC-002'] };
      for (const field of ['requirements', 'scenarios', 'testCases', 'verificationPlan']) merged[field] = [...new Set(tasks.tasks.flatMap((task: Record<string, unknown[]>) => task[field]))];
      tasks.tasks = [merged]; artifacts.tasks = stringify(tasks);
      const evidence = parse(artifacts.verification); evidence.testCases = evidence.testCases.filter((record: { testCase: string }) => record.testCase.startsWith('MOD-002-REQ-001'));
      evidence.artifactIdentity = verificationArtifactIdentity(artifacts); artifacts.verification = stringify(evidence);
      const warnings: string[] = [];
      expect(await validateCurrentVerificationArtifacts(fixture.workspace, artifacts, warnings)).toEqual([]);
      expect(warnings.join('\n')).toMatch(/AC-002.*evidence/);
      evidence.testCases[0].acceptanceCriteria.push('AC-002'); artifacts.verification = stringify(evidence);
      expect((await validateCurrentVerificationArtifacts(fixture.workspace, artifacts)).join('\n')).toMatch(/unrelated acceptance criterion AC-002/);
    } finally { fixture.cleanup(); }
  });
  it.each(['task-ac', 'task-requirement', 'task-scenario', 'task-test', 'evidence-ac', 'evidence-test', 'duplicate-evidence', 'missing-revision', 'verification-revision', 'duplicate-ac-requirement'])('rejects invalid references or revision: %s', async (fault) => {
    const { fixture, artifacts } = await setup();
    try {
      const tasks = parse(artifacts.tasks); const evidence = parse(artifacts.verification); const analysis = parse(artifacts.analysis!);
      if (fault === 'task-ac') tasks.tasks[0].acceptanceCriteria = ['AC-999'];
      if (fault === 'task-requirement') tasks.tasks[0].requirements = ['MOD-002-REQ-999'];
      if (fault === 'task-scenario') tasks.tasks[0].scenarios = ['MOD-002-REQ-001-SCN-999'];
      if (fault === 'task-test') tasks.tasks[0].testCases = ['MOD-002-REQ-001-SCN-001-TC-API-99'];
      if (fault === 'evidence-ac') evidence.testCases[0].acceptanceCriteria = ['AC-999'];
      if (fault === 'evidence-test') evidence.testCases[0].testCase = 'MOD-002-REQ-001-SCN-001-TC-API-99';
      if (fault === 'duplicate-evidence') evidence.testCases.push(evidence.testCases[0]);
      if (fault === 'missing-revision') delete tasks.changeRevision;
      if (fault === 'verification-revision') evidence.changeRevision = 2;
      if (fault === 'duplicate-ac-requirement') analysis.acceptanceCriteria[0].requirements.push('MOD-002-REQ-001');
      artifacts.tasks = stringify(tasks); artifacts.analysis = stringify(analysis);
      evidence.artifactIdentity = verificationArtifactIdentity(artifacts); artifacts.verification = stringify(evidence);
      expect(await validateCurrentVerificationArtifacts(fixture.workspace, artifacts)).not.toEqual([]);
    } finally { fixture.cleanup(); }
  });
  it('allows optional missing evidence in the real archive preflight while rejecting MUST evidence gaps', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const artifacts = await writeCanonicalChange(fixture, modification());
      const evidence = parse(artifacts.verification); evidence.testCases = [];
      artifacts.verification = stringify(evidence);
      await fs.writeFile(path.join(artifacts.changeDir, 'verification.yaml'), artifacts.verification);
      await expect(preflightArchive(fixture.workspace, fixture.changeId)).rejects.toThrow(/AC-001.*evidence/);
      const analysis = parse(artifacts.analysis!); analysis.acceptanceCriteria[0].priority = 'SHOULD'; artifacts.analysis = stringify(analysis);
      evidence.artifactIdentity = verificationArtifactIdentity(artifacts); artifacts.verification = stringify(evidence);
      for (const stage of ['analyze', 'design', 'plan'] as const) artifacts.metadata = approveStage(artifacts, stage);
      for (const name of ['analysis', 'verification', 'metadata'] as const) await fs.writeFile(path.join(artifacts.changeDir, `${name}.yaml`), name === 'metadata' ? stringify(artifacts.metadata) : artifacts[name]!);
      await expect(preflightArchive(fixture.workspace, fixture.changeId)).resolves.toBeDefined();
    } finally { fixture.cleanup(); }
  });
  it('traces the rich canonical delta through every planned test without legacy parsing', async () => {
    const { fixture, artifacts } = await setup();
    try {
      const trace = validateChangeTraceability(artifacts);
      expect(trace.issues).toEqual([]);
      expect(trace.links['Acceptance Criterion']).toEqual(['AC-001']);
      expect(validateVerificationEvidence(artifacts)).toEqual([]);
      expect((await validateExitGate(fixture.workspace, artifacts, 'PLAN')).errors).toEqual([]);
    } finally { fixture.cleanup(); }
  });

  it.each(['acceptance', 'scenario', 'task', 'test', 'evidence', 'FAIL', 'BLOCKED', 'revision', 'identity'])('blocks broken MUST chain: %s', async (gap) => {
    const { fixture, artifacts, delta } = await setup();
    try {
      const analysis = parse(artifacts.analysis!); const tasks = parse(artifacts.tasks); const evidence = parse(artifacts.verification);
      if (gap === 'acceptance') analysis.acceptanceCriteria[0].requirements = [];
      if (gap === 'scenario') delta.requirements[0].next!.scenarios = [];
      if (gap === 'task') tasks.tasks = [];
      if (gap === 'test') {
        const id = delta.requirements[0].next!.scenarios[0].testCases[0].id;
        delta.requirements[0].next!.scenarios[0].testCases = [];
        for (const file of delta.engineeringFiles) file.references = file.references.filter((reference) => reference !== id);
      }
      if (gap === 'evidence') evidence.testCases = [];
      if (gap === 'FAIL' || gap === 'BLOCKED') evidence.testCases[0].result = gap;
      if (gap === 'revision') tasks.changeRevision = 2;
      if (gap === 'identity') artifacts.design += '\n新设计行为';
      if (gap === 'scenario') {
        expect(() => renderCurrentSpecDelta(delta)).toThrow(/requires Scenarios/);
        return;
      }
      artifacts.analysis = stringify(analysis); artifacts.tasks = stringify(tasks); artifacts.spec = renderCurrentSpecDelta(delta);
      if (gap !== 'identity') evidence.artifactIdentity = verificationArtifactIdentity(artifacts);
      artifacts.verification = stringify(evidence);
      const gate = await validateExitGate(fixture.workspace, artifacts, 'VERIFY');
      expect(gate.ok).toBe(false);
      expect(gate.errors.join('\n')).toMatch(/AC-001|revision|identity/i);
      expect(await validateCurrentVerificationArtifacts(fixture.workspace, artifacts)).not.toEqual([]);
    } finally { fixture.cleanup(); }
  });

  it.each(['SHOULD', 'COULD'])('reports missing evidence as a warning for %s', async (priority) => {
    const { fixture, artifacts } = await setup();
    try {
      const analysis = parse(artifacts.analysis!); analysis.acceptanceCriteria[0].priority = priority; artifacts.analysis = stringify(analysis);
      const evidence = parse(artifacts.verification); evidence.testCases = []; evidence.artifactIdentity = verificationArtifactIdentity(artifacts); artifacts.verification = stringify(evidence);
      const gate = await validateExitGate(fixture.workspace, artifacts, 'VERIFY');
      expect(gate.errors).toEqual([]);
      expect(gate.warnings.join('\n')).toMatch(/AC-001.*evidence/i);
    } finally { fixture.cleanup(); }
  });

  it('binds semantic intent, revision, design, rich delta and task definitions but ignores status and evidence time', async () => {
    const { fixture, artifacts } = await setup();
    try {
      const identity = verificationArtifactIdentity(artifacts);
      const tasks = parse(artifacts.tasks); tasks.tasks[0].status = 'PENDING';
      expect(verificationArtifactIdentity({ ...artifacts, tasks: stringify(tasks) })).toBe(identity);
      expect(verificationArtifactIdentity({ ...artifacts, verification: '' })).toBe(identity);
      expect(verificationArtifactIdentity({ ...artifacts, metadata: { ...artifacts.metadata, change: { ...artifacts.metadata.change, updated_at: '2026-09-16T00:00:00Z' } } })).toBe(identity);
      const analysis = parse(artifacts.analysis!); analysis.acceptanceCriteria[0].statement = '不同目标';
      expect(verificationArtifactIdentity({ ...artifacts, analysis: stringify(analysis) })).not.toBe(identity);
      expect(verificationArtifactIdentity({ ...artifacts, metadata: { ...artifacts.metadata, change: { ...artifacts.metadata.change, revision: 2 } } })).not.toBe(identity);
      expect(verificationArtifactIdentity({ ...artifacts, design: artifacts.design + '\n行为变化' })).not.toBe(identity);
      const { parseCurrentSpecDelta } = await import('../../../src/core/codespec-workflow/current-spec-delta.js');
      const delta = parseCurrentSpecDelta(artifacts.spec);
      delta.requirements[0].next!.scenarios[0].testCases[0].testId = 'new-locator';
      delta.requirements[0].next!.scenarios[0].testCases[0].latestVerification = '2026-09-16';
      expect(verificationArtifactIdentity({ ...artifacts, spec: renderCurrentSpecDelta(delta) })).toBe(identity);
      delta.requirements[0].next!.scenarios[0].then = ['不同结果'];
      expect(verificationArtifactIdentity({ ...artifacts, spec: renderCurrentSpecDelta(delta) })).not.toBe(identity);
      tasks.tasks[0].title = '不同任务';
      expect(verificationArtifactIdentity({ ...artifacts, tasks: stringify(tasks) })).not.toBe(identity);
    } finally { fixture.cleanup(); }
  });
});
