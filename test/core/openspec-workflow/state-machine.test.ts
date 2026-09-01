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

    expect(() =>
      transitionChange(fixture.metadataAt('VERIFY'), 'IMPLEMENT', 'spec error')
    ).toThrow(/DESIGN/i);
  });

  it('increments revision only for approved semantic changes', async () => {
    const fixture = await createWorkflowFixture();
    afterEach(fixture.cleanup);
    const metadata = fixture.metadataAt('DESIGN');
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
    const result = validateExitGate(workspace, artifacts, 'ANALYZE');

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
});
