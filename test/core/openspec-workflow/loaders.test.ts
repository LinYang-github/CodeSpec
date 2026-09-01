import path from 'node:path';
import * as fs from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';

import {
  loadBusinessRegistry,
  loadChangeArtifacts,
  loadWorkspace,
} from '../../../src/core/openspec-workflow/loaders.js';
import { parseWorkspaceConfig } from '../../../src/core/openspec-workflow/schemas.js';
import {
  createWorkflowFixture,
  writeBusinessFile,
  writeChangeArtifacts,
} from '../../helpers/openspec-workflow.js';

describe('openspec workflow loaders', () => {
  it('retains generic spec-driven workspace configuration parsing', () => {
    expect(parseWorkspaceConfig({
      version: 1, schema: 'spec-driven', project: { name: 'generic' },
      paths: { business: 'business.md', changes: 'changes', change_index: 'changes/index.yaml', archive: 'archive', specs: 'specs', archived_changes: 'changes/archive' },
      workflow: { multiple_active_changes: false }, requirements: { id_format: '{module}-REQ-{sequence:03d}' },
      changes: { id_format: 'CHG-{date}-{sequence:03d}' }, archive: { update_index: true, require_verification: false, conflict_strategy: 'optimistic' },
    }).schema).toBe('spec-driven');
  });

  it('selects the canonical code-spec schema from workspace config', async () => {
    const fixture = await createWorkflowFixture();
    afterEach(fixture.cleanup);
    await writeBusinessFile(fixture, [
      '| Module ID | Module Name | Description | Responsibilities | Keywords |',
      '| --- | --- | --- | --- | --- |',
      '| MOD-001 | 工作流 | 管理变更 | 需求管理 | 变更 |',
    ].join('\n'));
    const workspace = await loadWorkspace(fixture.openspecDir);
    expect(workspace.config.schema).toBe('code-spec');
  });

  it('loads canonical configured paths before reading business and change data', async () => {
    const fixture = await createWorkflowFixture({
      configOverrides: {
        paths: {
          business: 'catalog/business.md',
          changes: 'active-changes',
          change_index: 'nav/index.yaml',
          archive: 'records',
          specs: 'records/specs',
          archived_changes: 'records/changes',
        },
      },
    });
    afterEach(fixture.cleanup);

    await fs.mkdir(path.dirname(fixture.paths.business), { recursive: true });
    await fs.mkdir(path.dirname(fixture.paths.changeIndex), { recursive: true });
    await writeBusinessFile(
      fixture,
      [
        '# Business',
        '',
        '| Module ID | Module Name | Description | Responsibilities | Keywords |',
        '| --- | --- | --- | --- | --- |',
        '| MOD-001 | User Management | Owns user accounts | Manage accounts; Reset passwords | users, identity |',
      ].join('\n')
    );
    await fs.writeFile(
      fixture.paths.changeIndex,
      [
        'version: 1',
        'changes:',
        '  - id: CHG-20260901-001',
        '    title: Demo change',
        '    mode: feature',
        '    status: ANALYZE',
        '    updated_at: 2026-09-01T00:00:00.000Z',
        '',
      ].join('\n')
    );
    await writeChangeArtifacts(fixture, {
      metadata: {
        artifacts: {
          metadata: 'active-changes/CHG-20260901-001/metadata.yaml',
          proposal: 'active-changes/CHG-20260901-001/proposal.md',
          design: 'active-changes/CHG-20260901-001/design.md',
          spec: 'active-changes/CHG-20260901-001/spec.md',
          tasks: 'active-changes/CHG-20260901-001/tasks.md',
          verification: 'active-changes/CHG-20260901-001/verification.md',
        },
      },
    });

    const workspace = await loadWorkspace(fixture.openspecDir);

    expect(workspace.paths.changeIndex).toBe(path.join(fixture.openspecDir, 'nav', 'index.yaml'));
    expect(workspace.registry.modules.map((module) => module.id)).toEqual(['MOD-001']);
    expect(workspace.index.entries.map((entry) => entry.id)).toEqual(['CHG-20260901-001']);
  });

  it('rejects duplicate module ids in the canonical business registry', async () => {
    const fixture = await createWorkflowFixture();
    afterEach(fixture.cleanup);

    await writeBusinessFile(
      fixture,
      [
        '# Business',
        '',
        '| Module ID | Module Name | Description | Responsibilities | Keywords |',
        '| --- | --- | --- | --- | --- |',
        '| MOD-001 | User Management | Owns user accounts | Manage accounts | users |',
        '| MOD-001 | Order Management | Owns orders | Manage orders | orders |',
      ].join('\n')
    );

    await expect(loadBusinessRegistry(fixture.paths)).rejects.toThrow(/duplicate.*MOD-001/i);
  });

  it('loads canonical active change artifacts', async () => {
    const fixture = await createWorkflowFixture();
    afterEach(fixture.cleanup);

    await writeChangeArtifacts(fixture);

    const artifacts = await loadChangeArtifacts(fixture.paths, fixture.changeId);

    expect(artifacts.metadata.change.id).toBe(fixture.changeId);
    expect(artifacts.proposal).toContain('# Proposal');
    expect(artifacts.design).toContain('# Design');
    expect(artifacts.spec).toContain('# Spec');
    expect(artifacts.tasks).toContain('# Tasks');
    expect(artifacts.verification).toContain('# Verification');
  });

  it('rejects legacy module-only change directories as unsupported for canonical loading', async () => {
    const fixture = await createWorkflowFixture();
    afterEach(fixture.cleanup);

    const legacyChangeDir = path.join(fixture.paths.changes, fixture.changeId);
    await fs.mkdir(legacyChangeDir, { recursive: true });
    await fs.writeFile(path.join(legacyChangeDir, '.openspec.yaml'), 'schema: code-spec\n');

    await expect(loadChangeArtifacts(fixture.paths, fixture.changeId)).rejects.toThrow(
      /legacy|unsupported|\.openspec\.yaml/i
    );
  });

  it('rejects a Change ID that could escape the active changes directory', async () => {
    const fixture = await createWorkflowFixture();
    afterEach(fixture.cleanup);

    await expect(loadChangeArtifacts(fixture.paths, '../outside')).rejects.toThrow(
      /change id|CHG-YYYYMMDD-NNN|safe/i
    );
  });

  it('requires config.yaml for canonical workspace loading', async () => {
    const fixture = await createWorkflowFixture();
    afterEach(fixture.cleanup);

    await fs.rename(
      path.join(fixture.openspecDir, 'config.yaml'),
      path.join(fixture.openspecDir, 'config.yml')
    );

    await expect(loadWorkspace(fixture.openspecDir)).rejects.toThrow(/config\.yaml/i);
  });
});
