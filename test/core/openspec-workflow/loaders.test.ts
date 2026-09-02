import path from 'node:path';
import * as fs from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';

import {
  loadBusinessRegistry,
  loadChangeArtifacts,
  loadWorkspace,
} from '../../../src/core/openspec-workflow/loaders.js';
import { EmptyBusinessRegistryError } from '../../../src/core/openspec-workflow/business-registry.js';
import { parseWorkspaceConfig } from '../../../src/core/openspec-workflow/schemas.js';
import { listActiveChanges } from '../../../src/core/openspec-workflow/change-resolver.js';
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

  it('loads a generic spec-driven workspace using its configured paths', async () => {
    const fixture = await createWorkflowFixture({ configOverrides: {
      schema: 'spec-driven',
      paths: { business: 'generic/business.md', changes: 'generic/changes', change_index: 'generic/index.yaml', archive: 'generic/archive', specs: 'generic/specs', archived_changes: 'generic/archive/changes' },
    }});
    afterEach(fixture.cleanup);
    await fs.mkdir(path.dirname(fixture.paths.business), { recursive: true });
    await fs.mkdir(path.dirname(fixture.paths.changeIndex), { recursive: true });
    await fs.mkdir(fixture.paths.currentSpecs, { recursive: true });
    await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-001.md'), '# Generic current spec\n');
    await writeBusinessFile(fixture, '| Module ID | Module Name | Description | Responsibilities | Keywords |\n| --- | --- | --- | --- | --- |\n| MOD-001 | Generic | Generic behavior | Generic work | generic |');
    await fs.writeFile(fixture.paths.changeIndex, 'version: 1\nchanges: []\n');
    const workspace = await loadWorkspace(fixture.openspecDir);
    expect(workspace.config.schema).toBe('spec-driven');
    expect(workspace.paths.currentSpecs).toBe(path.join(fixture.openspecDir, 'generic', 'specs'));
    await expect(fs.readFile(path.join(workspace.paths.currentSpecs, 'MOD-001.md'), 'utf8')).resolves.toContain('Generic current spec');
    expect(workspace.registry.modules[0]?.id).toBe('MOD-001');
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

  it('accepts localized or custom business table headers', async () => {
    const fixture = await createWorkflowFixture();
    afterEach(fixture.cleanup);

    for (const header of [
      '| 模块 ID | 模块名称 | 描述 | 职责 | 关键词 |',
      '| Module ID | Module Name | Description | Responsibilities | Keywords |',
      '| 域 | 名称 | 说明 | 工作 | 标签 |',
    ]) {
      await writeBusinessFile(
        fixture,
        [
          '# Business',
          '',
          header,
          '| --- | --- | --- | --- | --- |',
          '| MOD-001 | 账户 | 账户域 | 管理账户 | 账户 |',
        ].join('\n')
      );

      await expect(loadBusinessRegistry(fixture.paths)).resolves.toMatchObject({
        modules: [expect.objectContaining({ id: 'MOD-001' })],
      });
    }
  });

  it('rejects empty registries without parsing headers or fenced examples as modules', async () => {
    const fixture = await createWorkflowFixture();
    afterEach(fixture.cleanup);

    for (const content of [
      [
        '# 业务',
        '',
        '| 模块 ID | 模块名称 | 描述 | 职责 | 关键词 |',
        '| --- | --- | --- | --- | --- |',
      ].join('\n'),
      [
        '# 业务',
        '',
        '示例：',
        '```markdown',
        '| MOD-001 | 账户 | 账户域 | 管理账户 | 账户 |',
        '```',
      ].join('\n'),
    ]) {
      await writeBusinessFile(fixture, content);
      await expect(loadBusinessRegistry(fixture.paths)).rejects.toBeInstanceOf(
        EmptyBusinessRegistryError
      );
    }
  });

  it('keeps malformed non-header business rows invalid', async () => {
    const fixture = await createWorkflowFixture();
    afterEach(fixture.cleanup);

    await writeBusinessFile(
      fixture,
      [
        '| 自定义 ID | 名称 | 描述 | 职责 | 关键词 |',
        '| --- | --- | --- | --- | --- |',
        '| MOD-01 | 账户 | 账户域 | 管理账户 | 账户 |',
      ].join('\n')
    );

    await expect(loadBusinessRegistry(fixture.paths)).rejects.toThrow(/MOD-###/);
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

  it('requires metadata artifact paths to equal the selected Change canonical paths', async () => {
    const fixture = await createWorkflowFixture();
    afterEach(fixture.cleanup);
    await writeChangeArtifacts(fixture, {
      metadata: {
        artifacts: {
          proposal: 'changes/CHG-20260901-002/proposal.md',
        },
      },
    });
    const otherDir = path.join(fixture.paths.changes, 'CHG-20260901-002');
    await fs.mkdir(otherDir, { recursive: true });
    await fs.writeFile(path.join(otherDir, 'proposal.md'), 'must not be loaded\n');

    await expect(loadChangeArtifacts(fixture.paths, fixture.changeId)).rejects.toThrow(
      /artifact.*proposal.*canonical|exact.*path|selected Change/i
    );
  });

  it('rejects metadata IDs that do not match their canonical directory name', async () => {
    const fixture = await createWorkflowFixture();
    afterEach(fixture.cleanup);
    await writeChangeArtifacts(fixture, {
      metadata: { change: { id: 'CHG-20260901-002' } },
    });

    const workspace = await loadWorkspace(fixture.openspecDir);
    await expect(listActiveChanges(workspace)).rejects.toThrow(/directory.*metadata.*id|mismatch/i);
  });

  it('rejects symlinked canonical artifacts before reading them', async () => {
    const fixture = await createWorkflowFixture();
    afterEach(fixture.cleanup);
    await writeChangeArtifacts(fixture);
    const proposalPath = path.join(fixture.paths.changes, fixture.changeId, 'proposal.md');
    const outsidePath = path.join(fixture.tempDir, 'outside-proposal.md');
    await fs.writeFile(outsidePath, 'outside\n');
    await fs.unlink(proposalPath);
    await fs.symlink(outsidePath, proposalPath);

    await expect(loadChangeArtifacts(fixture.paths, fixture.changeId)).rejects.toThrow(
      /symlink|realpath|contain/i
    );
  });

  it('returns only canonical active states and fails closed on malformed active metadata', async () => {
    const fixture = await createWorkflowFixture();
    afterEach(fixture.cleanup);
    await writeChangeArtifacts(fixture, { metadata: { change: { status: 'ARCHIVED' } } });
    const workspace = await loadWorkspace(fixture.openspecDir);

    await expect(listActiveChanges(workspace)).resolves.toEqual([]);

    const malformedDir = path.join(fixture.paths.changes, 'CHG-20260901-002');
    await fs.mkdir(malformedDir, { recursive: true });
    await fs.writeFile(path.join(malformedDir, 'metadata.yaml'), 'change: [malformed\n');
    await expect(listActiveChanges(workspace)).rejects.toThrow(/metadata|yaml|parse/i);
  });
});
