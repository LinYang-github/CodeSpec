import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import {
  __setVerificationTestHooksForTests,
  parseVerificationDocument,
  recordFreshVerification,
} from '../../../src/core/codespec-workflow/verification.js';
import { createWorkflowFixture } from '../../helpers/codespec-workflow.js';
import { loadChangeArtifacts } from '../../../src/core/codespec-workflow/loaders.js';
import { validateExitGate } from '../../../src/core/codespec-workflow/gates.js';

const passCommand = `node -e "process.stdout.write('ok')"`;

async function setupVerifiableChange(
  fixture: Awaited<ReturnType<typeof createWorkflowFixture>>,
  affected = false,
): Promise<void> {
  const metadata = fixture.metadataAt('VERIFY');
  metadata.modules.confirmed = [{ module: 'MOD-002', outcome: 'OWNED', reason: 'owns payment' }];
  metadata.requirements[affected ? 'modified' : 'added'] = [{ id: 'MOD-002-REQ-006', module: 'MOD-002' }];
  metadata.baseline.modules = {
    'MOD-002': {
      outcome: 'OWNED',
      latest_change: null,
      requirement_ids: ['MOD-002-REQ-006'],
      spec_hash: 'a'.repeat(64),
      requirements: { 'MOD-002-REQ-006': 'b'.repeat(64) },
    },
  };
  const dir = path.join(fixture.paths.changes, fixture.changeId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'metadata.yaml'), stringifyYaml(metadata));
  await fs.writeFile(path.join(dir, 'proposal.md'), '# Proposal\n\nsubstantive proposal\n');
  const impact = affected ? {
    outcome: 'affected',
    references: [{
      current_requirement: 'MOD-002-REQ-006', current_scenario: 'SCN-001',
      disposition: 'modified',
      replacement_requirement: 'MOD-002-REQ-006', replacement_scenario: 'SCN-002',
    }],
    verification: ['archive-regression'],
  } : { outcome: 'none', references: [], verification: [] };
  await fs.writeFile(path.join(dir, 'design.md'), '# Design\n\nMOD-002-REQ-006\n\n## 归档影响分析\n\n```yaml\n' + stringifyYaml(impact) + '```\n');
  await fs.writeFile(
    path.join(dir, 'spec.md'),
    `## ${affected ? 'MODIFIED' : 'ADDED'}
### MOD-002-REQ-006 支付
${affected ? `**Previous**
旧规则
#### Scenario: SCN-001 旧支付
- **GIVEN** 旧状态
- **WHEN** 支付
- **THEN** 旧结果
- **ERROR** 旧错误处理
` : ''}\
**New**
新规则
#### Scenario: SCN-002 新支付
- **GIVEN** 新状态
- **WHEN** 支付
- **THEN** 新结果
- **ERROR** 新错误处理
${affected ? '**Reason**\n业务变化\n' : ''}
`
  );
  await fs.writeFile(
    path.join(dir, 'tasks.md'),
    '# Tasks\n\n- [x] SP-01 MOD-002-REQ-006 SCN-001 SCN-002 test/payment.test.ts\n'
  );
  if (affected) {
    await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
    await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'),
      '### MOD-002-REQ-006 支付\n旧规则\n#### Scenario: SCN-001 旧支付\n- **GIVEN** 旧状态\n- **WHEN** 支付\n- **THEN** 旧结果\n- **ERROR** 旧错误处理\n');
  }
  await fs.writeFile(path.join(dir, 'verification.md'), '# Verification\n');
}

describe('fresh verification', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    __setVerificationTestHooksForTests(null);
    cleanups.splice(0).forEach((cleanup) => cleanup());
  });

  it('does not treat a declared regression or unrelated command coverage as executed archive regression', async () => {
    const fixture = await createWorkflowFixture(); cleanups.push(fixture.cleanup);
    await setupVerifiableChange(fixture, true);
    await expect(recordFreshVerification(fixture.workspace, fixture.changeId, [
      { kind: 'requirements', command: passCommand, requirementIds: ['MOD-002-REQ-006'], scenarioIds: ['SCN-001', 'SCN-002'] },
      { kind: 'unit', command: passCommand }, { kind: 'typecheck', command: passCommand }, { kind: 'bdd', command: passCommand }, { kind: 'integration', command: passCommand },
      { kind: 'build', command: passCommand },
      { kind: 'lint', command: passCommand },
    ])).rejects.toThrow(/archive-regression/);
    expect(parseYaml(await fs.readFile(path.join(fixture.paths.changes, fixture.changeId, 'metadata.yaml'), 'utf8')).verification.requirements_verified).toBe(false);
  });

  it('rejects a caller-supplied command that differs from the workspace-controlled declaration', async () => {
    const fixture = await createWorkflowFixture({ configOverrides: {
      verification: { commands: {
        unit: { command: passCommand }, typecheck: { command: passCommand },
        build: { command: passCommand }, lint: { command: passCommand },
        bdd: { command: passCommand }, integration: { command: passCommand },
      } },
    } });
    cleanups.push(fixture.cleanup);
    await setupVerifiableChange(fixture);

    await expect(recordFreshVerification(fixture.workspace, fixture.changeId, [
      { kind: 'requirements', command: passCommand, requirementIds: ['MOD-002-REQ-006'], scenarioIds: ['SCN-002'] },
      { kind: 'unit', command: 'node -e "process.stdout.write(\'other\')"' },
      { kind: 'typecheck', command: passCommand }, { kind: 'build', command: passCommand },
      { kind: 'lint', command: passCommand }, { kind: 'bdd', command: passCommand },
      { kind: 'integration', command: passCommand },
    ])).rejects.toThrow(/workspace.*unit|unit.*workspace/i);
  });

  it('records a configured inapplicable category with its reason instead of executing a substitute command', async () => {
    const reason = '项目没有独立 BDD runner；Scenario 由集成测试覆盖。';
    const fixture = await createWorkflowFixture({ configOverrides: {
      verification: { commands: {
        unit: { command: passCommand }, typecheck: { command: passCommand },
        build: { command: passCommand }, lint: { command: passCommand },
        bdd: { not_applicable_reason: reason }, integration: { command: passCommand },
      } },
    } });
    cleanups.push(fixture.cleanup);
    await setupVerifiableChange(fixture);

    const evidence = await recordFreshVerification(fixture.workspace, fixture.changeId, [
      { kind: 'requirements', command: passCommand, requirementIds: ['MOD-002-REQ-006'], scenarioIds: ['SCN-002'] },
      { kind: 'unit', command: passCommand }, { kind: 'typecheck', command: passCommand },
      { kind: 'build', command: passCommand }, { kind: 'lint', command: passCommand },
      { kind: 'integration', command: passCommand },
    ]);

    expect(evidence.not_applicable).toEqual({ bdd: reason });
    expect(evidence.commands.some((command) => command.kind === 'bdd')).toBe(false);
  });

  it('requires old and new scenario coverage on successful archive-regression commands', async () => {
    const fixture = await createWorkflowFixture(); cleanups.push(fixture.cleanup);
    await setupVerifiableChange(fixture, true);
    const commands = [
      { kind: 'requirements' as const, command: passCommand, requirementIds: ['MOD-002-REQ-006'], scenarioIds: ['SCN-001', 'SCN-002'] },
      { kind: 'unit' as const, command: passCommand }, { kind: 'typecheck' as const, command: passCommand }, { kind: 'bdd' as const, command: passCommand }, { kind: 'integration' as const, command: passCommand }, { kind: 'build' as const, command: passCommand }, { kind: 'lint' as const, command: passCommand },
      { kind: 'archive-regression' as const, command: passCommand, requirementIds: ['MOD-002-REQ-006'], scenarioIds: ['SCN-002'] },
    ];
    await expect(recordFreshVerification(fixture.workspace, fixture.changeId, commands)).rejects.toThrow(/archive-regression.*SCN-001/);
    commands[7].scenarioIds = ['SCN-001', 'SCN-002'];
    const evidence = await recordFreshVerification(fixture.workspace, fixture.changeId, commands);
    expect(evidence.status).toBe('PASS');
    expect(evidence.commands[7]).toMatchObject({ kind: 'archive-regression', exit_code: 0, requirement_ids: ['MOD-002-REQ-006'], scenario_ids: ['SCN-001', 'SCN-002'] });
  });

  it('allows the first run and atomically records evidence plus metadata receipt', async () => {
    const fixture = await createWorkflowFixture();
    cleanups.push(fixture.cleanup);
    await setupVerifiableChange(fixture);

    const evidence = await recordFreshVerification(fixture.workspace, fixture.changeId, [
      {
        kind: 'requirements',
        command: passCommand,
        requirementIds: ['MOD-002-REQ-006'],
        scenarioIds: ['SCN-002'],
      },
      { kind: 'unit', command: passCommand }, { kind: 'typecheck', command: passCommand }, { kind: 'bdd', command: passCommand }, { kind: 'integration', command: passCommand },
      { kind: 'build', command: passCommand },
      { kind: 'lint', command: passCommand },
    ]);

    expect(evidence).toMatchObject({
      schema_version: 1,
      change_id: fixture.changeId,
      revision: 1,
      status: 'PASS',
      requirement_ids: ['MOD-002-REQ-006'],
      scenario_ids: ['SCN-002'],
      baseline_identity: expect.stringMatching(/^[a-f0-9]{64}$/),
      receipt: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(evidence.commands).toHaveLength(7);
    expect(evidence.commands.every((command) => command.exit_code === 0)).toBe(true);
    expect(evidence.trace_rows).toEqual([
      expect.objectContaining({
        requirement_id: 'MOD-002-REQ-006', scenario_id: 'SCN-002', task_id: 'SP-01',
        test_id: 'test/payment.test.ts', result: 'PASS', evidence_id: `verification:${fixture.changeId}:1`,
      }),
    ]);

    const verificationDocument = await fs.readFile(
      path.join(fixture.paths.changes, fixture.changeId, 'verification.md'),
      'utf8'
    );
    expect(verificationDocument).toContain('# 验证证据');
    expect(verificationDocument).toContain('## 验证结果');
    expect(verificationDocument).toContain('| Requirement ID |');
    expect(verificationDocument).toContain('## 机器校验数据');

    const metadata = parseYaml(
      await fs.readFile(
        path.join(fixture.paths.changes, fixture.changeId, 'metadata.yaml'),
        'utf8'
      )
    ) as {
      verification: {
        requirements_verified: boolean;
        tests_passed: boolean;
        build_passed: boolean;
        lint_passed: boolean;
        evidence_receipt: string;
        baseline_identity: string;
      };
    };
    expect(metadata.verification).toMatchObject({
      requirements_verified: true,
      tests_passed: true,
      build_passed: true,
      lint_passed: true,
      evidence_receipt: evidence.receipt,
      baseline_identity: evidence.baseline_identity,
    });
    const designFile = path.join(fixture.paths.changes, fixture.changeId, 'design.md');
    await fs.writeFile(designFile, (await fs.readFile(designFile, 'utf8')).replace('# Design', '# Revised design'));
    const gate = await validateExitGate(fixture.workspace, await loadChangeArtifacts(fixture.paths, fixture.changeId));
    expect(gate.errors.join('; ')).toMatch(/产物.*重新验证/);
  });

  it('rejects fresh verification when a Scenario has no Task-to-Test trace reference', async () => {
    const fixture = await createWorkflowFixture();
    cleanups.push(fixture.cleanup);
    await setupVerifiableChange(fixture);
    await fs.writeFile(
      path.join(fixture.paths.changes, fixture.changeId, 'tasks.md'),
      '# Tasks\n\n- [x] SP-01 MOD-002-REQ-006 SCN-002\n'
    );

    await expect(recordFreshVerification(fixture.workspace, fixture.changeId, [
      { kind: 'requirements', command: 'node -e "process.exit(99)"', requirementIds: ['MOD-002-REQ-006'], scenarioIds: ['SCN-002'] },
    ])).rejects.toThrow(/SCN-002.*Test-to-Evidence trace row/i);
  });

  it('rejects evidence when a verification command changes the Change artifacts', async () => {
    const fixture = await createWorkflowFixture();
    cleanups.push(fixture.cleanup);
    await setupVerifiableChange(fixture);
    const tasksRelative = path.relative(fixture.codespecDir, path.join(fixture.paths.changes, fixture.changeId, 'tasks.md'));
    const mutatingCommand = `node -e "require('fs').appendFileSync('${tasksRelative}', ' concurrent-edit')"`;

    await expect(recordFreshVerification(fixture.workspace, fixture.changeId, [
      { kind: 'requirements', command: mutatingCommand, requirementIds: ['MOD-002-REQ-006'], scenarioIds: ['SCN-002'] },
    ])).rejects.toThrow(/验证期间.*Change.*重新验证/i);
  });

  it('requires an existing repository code_reference for Level 3 trace rows', async () => {
    const fixture = await createWorkflowFixture();
    cleanups.push(fixture.cleanup);
    await setupVerifiableChange(fixture);
    const metadataPath = path.join(fixture.paths.changes, fixture.changeId, 'metadata.yaml');
    const metadata = parseYaml(await fs.readFile(metadataPath, 'utf8')) as { change: { sdd_level: number } };
    metadata.change.sdd_level = 3;
    await fs.writeFile(metadataPath, stringifyYaml(metadata));
    const commands = [
      { kind: 'requirements' as const, command: passCommand, requirementIds: ['MOD-002-REQ-006'], scenarioIds: ['SCN-002'] },
      { kind: 'unit' as const, command: passCommand }, { kind: 'typecheck' as const, command: passCommand },
      { kind: 'bdd' as const, command: passCommand }, { kind: 'integration' as const, command: passCommand },
      { kind: 'build' as const, command: passCommand }, { kind: 'lint' as const, command: passCommand },
    ];
    await expect(recordFreshVerification(fixture.workspace, fixture.changeId, commands)).rejects.toThrow(/Level 3.*code_reference/i);

    await fs.mkdir(path.join(fixture.tempDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(fixture.tempDir, 'src', 'payment.ts'), 'export const payment = true;\n');
    await fs.writeFile(path.join(fixture.paths.changes, fixture.changeId, 'tasks.md'), '# Tasks\n\n- [x] SP-01 MOD-002-REQ-006 SCN-002 test/payment.test.ts code:src/payment.ts:1\n');
    const evidence = await recordFreshVerification(fixture.workspace, fixture.changeId, commands);
    expect(evidence.trace_rows?.[0]).toMatchObject({ code_reference: 'src/payment.ts:1' });
  });

  it('rejects incomplete Requirement or Scenario coverage', async () => {
    const fixture = await createWorkflowFixture();
    cleanups.push(fixture.cleanup);
    await setupVerifiableChange(fixture);

    await expect(
      recordFreshVerification(fixture.workspace, fixture.changeId, [
        { kind: 'requirements', command: passCommand, requirementIds: ['MOD-002-REQ-006'] },
        { kind: 'unit', command: passCommand }, { kind: 'typecheck', command: passCommand }, { kind: 'bdd', command: passCommand }, { kind: 'integration', command: passCommand },
        { kind: 'build', command: passCommand },
        { kind: 'lint', command: passCommand },
      ])
    ).rejects.toThrow(/Scenario.*SCN-002|coverage/i);
  });

  it('rejects an empty Scenario ERROR before publishing PASS evidence', async () => {
    const fixture = await createWorkflowFixture();
    cleanups.push(fixture.cleanup);
    await setupVerifiableChange(fixture);
    const specPath = path.join(fixture.paths.changes, fixture.changeId, 'spec.md');
    const spec = await fs.readFile(specPath, 'utf8');
    await fs.writeFile(specPath, spec.replace('- **ERROR** 新错误处理', '- **ERROR**'));

    await expect(
      recordFreshVerification(fixture.workspace, fixture.changeId, [
        { kind: 'requirements', command: passCommand, requirementIds: ['MOD-002-REQ-006'], scenarioIds: ['SCN-002'] },
        { kind: 'unit', command: passCommand }, { kind: 'typecheck', command: passCommand }, { kind: 'bdd', command: passCommand }, { kind: 'integration', command: passCommand },
        { kind: 'build', command: passCommand },
        { kind: 'lint', command: passCommand },
      ])
    ).rejects.toThrow(/MOD-002-REQ-006.*SCN-002.*ERROR.*人工补写/i);
  });

  it('records a failed real command without granting PASS metadata gates', async () => {
    const fixture = await createWorkflowFixture();
    cleanups.push(fixture.cleanup);
    await setupVerifiableChange(fixture);

    await expect(
      recordFreshVerification(fixture.workspace, fixture.changeId, [
        {
          kind: 'requirements',
          command: `node -e "process.exit(7)"`,
          requirementIds: ['MOD-002-REQ-006'],
          scenarioIds: ['SCN-002'],
        },
      ])
    ).rejects.toThrow('验证命令失败，退出码为 7');

    const evidence = parseVerificationDocument(
      await fs.readFile(
        path.join(fixture.paths.changes, fixture.changeId, 'verification.md'),
        'utf8'
      )
    ) as { status: string; commands: Array<{ exit_code: number }> };
    const metadata = parseYaml(
      await fs.readFile(
        path.join(fixture.paths.changes, fixture.changeId, 'metadata.yaml'),
        'utf8'
      )
    ) as { verification: { requirements_verified: boolean } };
    expect(evidence.status).toBe('FAIL');
    expect(evidence.commands[0].exit_code).toBe(7);
    expect(metadata.verification.requirements_verified).toBe(false);
  });

  it('reads legacy YAML evidence while accepting the new Markdown document format', () => {
    const legacyEvidence = {
      schema_version: 1,
      change_id: 'CHG-20260901-001',
      verified_at: '2026-09-03T00:00:00.000Z',
      revision: 1,
      status: 'PASS' as const,
      requirement_ids: ['MOD-002-REQ-006'],
      scenario_ids: ['SCN-002'],
      baseline_identity: 'a'.repeat(64),
      receipt: 'b'.repeat(64),
      commands: [],
    };

    expect(parseVerificationDocument(stringifyYaml(legacyEvidence))).toEqual(legacyEvidence);
  });

  it('rejects Markdown without exactly one machine evidence block', () => {
    const block = '```yaml\nschema_version: 1\n```';

    expect(() => parseVerificationDocument('# 验证证据\n\n没有机器校验数据')).toThrow('缺少机器校验数据');
    expect(() => parseVerificationDocument(`${block}\n\n${block}`)).toThrow('只能包含一个');
  });

  it('rolls back both files when atomic metadata publication fails', async () => {
    const fixture = await createWorkflowFixture();
    cleanups.push(fixture.cleanup);
    await setupVerifiableChange(fixture);
    const metadataPath = path.join(fixture.paths.changes, fixture.changeId, 'metadata.yaml');
    const verificationPath = path.join(fixture.paths.changes, fixture.changeId, 'verification.md');
    const beforeMetadata = await fs.readFile(metadataPath, 'utf8');
    const beforeVerification = await fs.readFile(verificationPath, 'utf8');

    __setVerificationTestHooksForTests({
      beforePublish: (file) => {
        if (file === metadataPath) throw new Error('metadata publication fault');
      },
    });

    await expect(
      recordFreshVerification(fixture.workspace, fixture.changeId, [
        {
          kind: 'requirements',
          command: passCommand,
          requirementIds: ['MOD-002-REQ-006'],
          scenarioIds: ['SCN-002'],
        },
        { kind: 'unit', command: passCommand }, { kind: 'typecheck', command: passCommand }, { kind: 'bdd', command: passCommand }, { kind: 'integration', command: passCommand },
        { kind: 'build', command: passCommand },
        { kind: 'lint', command: passCommand },
      ])
    ).rejects.toThrow(/metadata publication fault/);

    await expect(fs.readFile(metadataPath, 'utf8')).resolves.toBe(beforeMetadata);
    await expect(fs.readFile(verificationPath, 'utf8')).resolves.toBe(beforeVerification);
  });
});
