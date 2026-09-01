import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import {
  __setVerificationTestHooksForTests,
  recordFreshVerification,
} from '../../../src/core/openspec-workflow/verification.js';
import { createWorkflowFixture } from '../../helpers/openspec-workflow.js';

const passCommand = `node -e "process.stdout.write('ok')"`;

async function setupVerifiableChange(
  fixture: Awaited<ReturnType<typeof createWorkflowFixture>>
): Promise<void> {
  const metadata = fixture.metadataAt('VERIFY');
  metadata.modules.confirmed = [{ module: 'MOD-002', outcome: 'OWNED', reason: 'owns payment' }];
  metadata.requirements.modified = [{ id: 'MOD-002-REQ-006', module: 'MOD-002' }];
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
  await fs.writeFile(path.join(dir, 'design.md'), '# Design\n\nMOD-002-REQ-006\n');
  await fs.writeFile(
    path.join(dir, 'spec.md'),
    `## MODIFIED
### MOD-002-REQ-006 支付
**Previous**
旧规则
#### Scenario: SCN-001 旧支付
- **GIVEN** 旧状态
- **WHEN** 支付
- **THEN** 旧结果
**New**
新规则
#### Scenario: SCN-002 新支付
- **GIVEN** 新状态
- **WHEN** 支付
- **THEN** 新结果
**Reason**
业务变化
`
  );
  await fs.writeFile(
    path.join(dir, 'tasks.md'),
    '# Tasks\n\n- [x] SP-01 MOD-002-REQ-006 SCN-002 test/payment.test.ts\n'
  );
  await fs.writeFile(path.join(dir, 'verification.md'), '# Verification\n');
}

describe('fresh verification', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    __setVerificationTestHooksForTests(null);
    cleanups.splice(0).forEach((cleanup) => cleanup());
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
      { kind: 'test', command: passCommand },
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
    expect(evidence.commands).toHaveLength(4);
    expect(evidence.commands.every((command) => command.exit_code === 0)).toBe(true);

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
  });

  it('rejects incomplete Requirement or Scenario coverage', async () => {
    const fixture = await createWorkflowFixture();
    cleanups.push(fixture.cleanup);
    await setupVerifiableChange(fixture);

    await expect(
      recordFreshVerification(fixture.workspace, fixture.changeId, [
        { kind: 'requirements', command: passCommand, requirementIds: ['MOD-002-REQ-006'] },
        { kind: 'test', command: passCommand },
        { kind: 'build', command: passCommand },
        { kind: 'lint', command: passCommand },
      ])
    ).rejects.toThrow(/Scenario.*SCN-002|coverage/i);
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
    ).rejects.toThrow(/failed.*exit.*7|Verification command failed/i);

    const evidence = parseYaml(
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
        { kind: 'test', command: passCommand },
        { kind: 'build', command: passCommand },
        { kind: 'lint', command: passCommand },
      ])
    ).rejects.toThrow(/metadata publication fault/);

    await expect(fs.readFile(metadataPath, 'utf8')).resolves.toBe(beforeMetadata);
    await expect(fs.readFile(verificationPath, 'utf8')).resolves.toBe(beforeVerification);
  });
});
