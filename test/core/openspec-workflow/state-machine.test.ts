import { afterEach, describe, expect, it } from 'vitest';

import { loadWorkspace } from '../../../src/core/openspec-workflow/loaders.js';
import {
  canTransition,
  incrementRevision,
  transitionChange,
} from '../../../src/core/openspec-workflow/state-machine.js';
import {
  validateEntryGate,
  validateExitGate,
} from '../../../src/core/openspec-workflow/gates.js';
import { validateRelations } from '../../../src/core/openspec-workflow/relations.js';
import {
  createWorkflowFixture,
  writeBusinessFile,
  writeChangeArtifacts,
} from '../../helpers/openspec-workflow.js';

describe('openspec workflow state machine', () => {
  it('allows VERIFY to return to IMPLEMENT for an implementation failure', () => {
    expect(canTransition('VERIFY', 'IMPLEMENT')).toBe(true);
  });

  it('rejects VERIFY to IMPLEMENT when the supplied reason is a spec/design error', async () => {
    const fixture = await createWorkflowFixture();
    afterEach(fixture.cleanup);
    await writeChangeArtifacts(fixture, { metadata: { change: { status: 'VERIFY' } } });
    const workspace = await loadWorkspace(fixture.openspecDir);
    const artifacts = await import('../../../src/core/openspec-workflow/artifacts.js').then((m) =>
      m.loadChangeArtifacts(workspace.paths, fixture.changeId)
    );

    await expect(
      transitionChange(workspace, artifacts, 'IMPLEMENT', 'spec error')
    ).rejects.toThrow(/DESIGN/i);
  });

  it('increments revision only for approved semantic changes', async () => {
    const fixture = await createWorkflowFixture();
    afterEach(fixture.cleanup);
    const metadata = fixture.metadataAt('DESIGN');
    metadata.requirements.added.push({ id: 'MOD-001-REQ-001', module: 'MOD-001' });
    expect(incrementRevision(metadata, 'requirements changed').change.revision).toBe(2);
  });

  it('blocks exiting ANALYZE without proposal summary, modules, and satisfied analyze gate', async () => {
    const fixture = await createWorkflowFixture();
    afterEach(fixture.cleanup);
    await writeBusinessFile(
      fixture,
      [
        '# Business',
        '',
        '| Module ID | Module Name | Description | Responsibilities | Keywords |',
        '| --- | --- | --- | --- | --- |',
        '| MOD-001 | Order Management | Owns orders | Continue orders | orders |',
      ].join('\n')
    );
    await writeChangeArtifacts(fixture, {
      proposal: '# Proposal\n',
      metadata: {
        change: { status: 'ANALYZE' },
      },
    });

    const workspace = await loadWorkspace(fixture.openspecDir);
    const artifacts = await import('../../../src/core/openspec-workflow/artifacts.js').then((m) =>
      m.loadChangeArtifacts(workspace.paths, fixture.changeId)
    );
    const result = validateExitGate(workspace, artifacts);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/summary|module|analyze/i);
  });

  it('requires fresh verification evidence before entering ARCHIVE', async () => {
    const fixture = await createWorkflowFixture();
    afterEach(fixture.cleanup);
    await writeBusinessFile(
      fixture,
      [
        '# Business',
        '',
        '| Module ID | Module Name | Description | Responsibilities | Keywords |',
        '| --- | --- | --- | --- | --- |',
        '| MOD-001 | Order Management | Owns orders | Continue orders | orders |',
      ].join('\n')
    );
    await writeChangeArtifacts(fixture, {
      metadata: {
        change: { status: 'VERIFY' },
      },
    });

    const workspace = await loadWorkspace(fixture.openspecDir);
    const artifacts = await import('../../../src/core/openspec-workflow/artifacts.js').then((m) =>
      m.loadChangeArtifacts(workspace.paths, fixture.changeId)
    );
    const result = validateEntryGate(workspace, artifacts, 'ARCHIVE');

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/requirements|tests|build|lint/i);
  });

  it('rejects a satisfied analyze flag when proposal sections and module consistency are absent', async () => {
    const fixture = await createWorkflowFixture(); afterEach(fixture.cleanup);
    await writeBusinessFile(fixture, '# Business\n\n| Module ID | Module Name | Description | Responsibilities | Keywords |\n| --- | --- | --- | --- | --- |\n| MOD-001 | Orders | Owns orders | Orders | orders |\n');
    await writeChangeArtifacts(fixture, { metadata: { gates: { analyze: { required: true, satisfied: true } } } });
    const workspace = await loadWorkspace(fixture.openspecDir);
    const artifacts = await import('../../../src/core/openspec-workflow/artifacts.js').then((m) => m.loadChangeArtifacts(workspace.paths, fixture.changeId));
    expect(validateExitGate(workspace, artifacts).errors.join('\\n')).toMatch(/summary|goal|scope|module/i);
  });

  it('rejects a revision reason that merely contains the word semantic', () => {
    expect(() => incrementRevision({} as never, 'semantic cleanup')).toThrow(/Requirement|Scope/i);
  });

  it('matches a Requirement ID literally when the ID contains regex-significant characters', () => {
    const metadata = {
      ...({} as never),
      modules: { confirmed: [{ module: 'MOD-001', outcome: 'OWNED', reason: 'orders' }] },
      requirements: { added: [{ id: 'MOD-001-REQ-[001]+', module: 'MOD-001' }], modified: [], removed: [] },
      gates: { design: { required: true, satisfied: true } },
    } as never;
    const artifacts = { metadata, design: 'Requirement MOD-001-REQ-[001]+ is consistent', proposal: '', spec: '', tasks: '', verification: '' } as never;
    expect(validateExitGate({} as never, artifacts).errors).not.toContain('design Requirement consistency is not satisfied');
  });

  it('rejects archive dependencies that are not archived', async () => {
    const fixture = await createWorkflowFixture();
    afterEach(fixture.cleanup);
    await writeBusinessFile(
      fixture,
      [
        '# Business',
        '',
        '| Module ID | Module Name | Description | Responsibilities | Keywords |',
        '| --- | --- | --- | --- | --- |',
        '| MOD-001 | Order Management | Owns orders | Continue orders | orders |',
      ].join('\n')
    );
    await writeChangeArtifacts(fixture, {
      metadata: {
        relations: { depends_on: ['CHG-20260901-002'] },
      },
    });
    await writeChangeArtifacts(
      {
        ...fixture,
        changeId: 'CHG-20260901-002',
      },
      {
        metadata: {
          change: {
            id: 'CHG-20260901-002',
            status: 'VERIFY',
          },
        },
      }
    );

    const workspace = await loadWorkspace(fixture.openspecDir);
    const artifacts = await import('../../../src/core/openspec-workflow/artifacts.js').then((m) =>
      m.loadChangeArtifacts(workspace.paths, fixture.changeId)
    );

    await expect(validateRelations(workspace, artifacts.metadata)).rejects.toThrow(/ARCHIVED|depends_on/i);
  });

  it('does not expose an optional gate bypass on lifecycle transitions', async () => {
    const fixture = await createWorkflowFixture();
    afterEach(fixture.cleanup);

    await expect(
      (transitionChange as unknown as (
        metadata: ReturnType<typeof fixture.metadataAt>,
        target: string,
        reason: string
      ) => Promise<unknown>)(fixture.metadataAt('ANALYZE'), 'DESIGN', 'bypass gates')
    ).rejects.toThrow(/workspace|artifacts|mandatory gate/i);
  });

  it('validates the current state exit gate before the target entry gate', async () => {
    const fixture = await createWorkflowFixture();
    afterEach(fixture.cleanup);
    await writeChangeArtifacts(fixture, {
      metadata: {
        change: { status: 'ANALYZE' },
        gates: { analyze: { required: true, satisfied: true } },
      },
      proposal: '# Proposal\n',
    });
    const workspace = await loadWorkspace(fixture.openspecDir);
    const artifacts = await import('../../../src/core/openspec-workflow/artifacts.js').then((m) =>
      m.loadChangeArtifacts(workspace.paths, fixture.changeId)
    );

    await expect(
      transitionChange(workspace, artifacts, 'DESIGN', 'analysis complete')
    ).rejects.toThrow(/ANALYZE.*summary|proposal.*summary|module/i);
  });

  it('requires parsed Requirement and Scenario traceability before PLAN', async () => {
    const fixture = await createWorkflowFixture();
    afterEach(fixture.cleanup);
    await writeChangeArtifacts(fixture, {
      metadata: {
        change: { status: 'DESIGN' },
        gates: { design: { required: true, satisfied: true } },
        modules: {
          confirmed: [{ module: 'MOD-001', outcome: 'OWNED', reason: 'owner' }],
        },
        requirements: {
          added: [{ id: 'MOD-001-REQ-001', module: 'MOD-001' }],
        },
      },
      design: '# Design\n\nMOD-001-REQ-001\n',
      spec: `## ADDED
### MOD-001-REQ-001 新需求
**New**
系统 SHALL 工作。
#### Scenario: SCN-001 成功
- **GIVEN** 条件
- **WHEN** 动作
- **THEN** 结果
`,
      tasks: '# Tasks\n\n- [ ] SP-01 implementation without traceability IDs\n',
    });
    const workspace = await loadWorkspace(fixture.openspecDir);
    const artifacts = await import('../../../src/core/openspec-workflow/artifacts.js').then((m) =>
      m.loadChangeArtifacts(workspace.paths, fixture.changeId)
    );

    await expect(
      transitionChange(workspace, artifacts, 'PLAN', 'design complete')
    ).rejects.toThrow(/traceability|MOD-001-REQ-001|SCN-001/i);
  });
});
