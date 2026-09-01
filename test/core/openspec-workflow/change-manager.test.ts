import path from 'node:path';
import * as fs from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { loadWorkspace } from '../../../src/core/openspec-workflow/loaders.js';
import {
  __setChangeManagerTestHooksForTests,
  allocateChangeId,
  createCanonicalChange,
  resumeChange,
} from '../../../src/core/openspec-workflow/change-manager.js';
import { resolveChange } from '../../../src/core/openspec-workflow/change-resolver.js';
import {
  createWorkflowFixture,
  writeBusinessFile,
  writeChangeArtifacts,
} from '../../helpers/openspec-workflow.js';

async function loadCanonicalWorkspace() {
  const fixture = await createWorkflowFixture();
  afterEach(fixture.cleanup);

  await writeBusinessFile(
    fixture,
    [
      '# Business',
      '',
      '| Module ID | Module Name | Description | Responsibilities | Keywords |',
      '| --- | --- | --- | --- | --- |',
      '| MOD-001 | Order Management | Owns orders | Continue orders | orders, checkout |',
      '| MOD-002 | Billing | Owns billing | Capture payments | billing, payments |',
    ].join('\n')
  );

  const workspace = await loadWorkspace(fixture.openspecDir);
  return { fixture, workspace };
}

describe('openspec workflow change management', () => {
  it('allocates the next Change sequence across active and archived Changes', async () => {
    const fixture = await createWorkflowFixture();
    afterEach(fixture.cleanup);

    await fs.mkdir(path.join(fixture.paths.changes, 'CHG-20260901-001'), { recursive: true });
    await fs.mkdir(path.join(fixture.paths.archivedChanges, 'CHG-20260901-002'), {
      recursive: true,
    });

    await expect(allocateChangeId(fixture.paths, '20260901')).resolves.toBe('CHG-20260901-003');
  });

  it('creates a canonical Change with metadata, artifacts, and navigation index entry', async () => {
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'));
    afterEach(() => vi.useRealTimers());
    const { fixture, workspace } = await loadCanonicalWorkspace();

    const created = await createCanonicalChange(workspace, {
      title: 'Continue orders',
      summary: 'Resume order flow in the canonical workflow',
      mode: 'feature',
    });

    expect(created.changeId).toMatch(/^CHG-\d{8}-001$/);
    await expect(fs.stat(path.join(fixture.paths.changes, created.changeId))).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });

    const metadata = parseYaml(
      await fs.readFile(path.join(fixture.paths.changes, created.changeId, 'metadata.yaml'), 'utf8')
    ) as { change: { status: string; title: string } };
    expect(metadata.change.status).toBe('ANALYZE');
    expect(metadata.change.title).toBe('Continue orders');

    const index = parseYaml(await fs.readFile(fixture.paths.changeIndex, 'utf8')) as {
      changes: Array<{ id: string; title: string; status: string }>;
    };
    expect(index.changes).toContainEqual({
      id: created.changeId,
      title: 'Continue orders',
      mode: 'feature',
      status: 'ANALYZE',
      updated_at: metadata.change.status ? expect.any(String) : '',
    });
  });

  it('does not guess when semantic resolution has multiple active Changes', async () => {
    const { fixture, workspace } = await loadCanonicalWorkspace();

    await writeChangeArtifacts(fixture, {
      metadata: {
        change: {
          id: 'CHG-20260901-001',
          title: 'Continue orders for checkout',
        },
      },
    });
    const secondChangeDir = path.join(fixture.paths.changes, 'CHG-20260901-002');
    await fs.mkdir(secondChangeDir, { recursive: true });
    await fs.writeFile(
      path.join(secondChangeDir, 'metadata.yaml'),
      await fs.readFile(path.join(fixture.paths.changes, fixture.changeId, 'metadata.yaml'), 'utf8')
    );
    const secondMetadata = parseYaml(
      await fs.readFile(path.join(secondChangeDir, 'metadata.yaml'), 'utf8')
    ) as Record<string, any>;
    secondMetadata.change.id = 'CHG-20260901-002';
    secondMetadata.change.title = 'Continue orders after payment';
    await fs.writeFile(
      path.join(secondChangeDir, 'metadata.yaml'),
      JSON.stringify(secondMetadata, null, 2)
    );

    await expect(resolveChange(workspace, { text: 'continue orders' })).rejects.toThrow(
      /multiple.*Change|choose|ambiguous/i
    );
  });

  it('resolves Change selectors by explicit ID, bound context, semantic match, then sole active Change', async () => {
    const { fixture, workspace } = await loadCanonicalWorkspace();

    await writeChangeArtifacts(fixture, {
      metadata: {
        change: {
          id: 'CHG-20260901-001',
          title: 'Continue orders for checkout',
        },
      },
    });

    const secondChangeDir = path.join(fixture.paths.changes, 'CHG-20260901-002');
    await fs.mkdir(secondChangeDir, { recursive: true });
    const baseMetadata = parseYaml(
      await fs.readFile(path.join(fixture.paths.changes, 'CHG-20260901-001', 'metadata.yaml'), 'utf8')
    ) as Record<string, any>;
    baseMetadata.change.id = 'CHG-20260901-002';
    baseMetadata.change.title = 'Capture billing';
    await fs.writeFile(
      path.join(secondChangeDir, 'metadata.yaml'),
      JSON.stringify(baseMetadata, null, 2)
    );
    await fs.writeFile(path.join(secondChangeDir, 'proposal.md'), '# Proposal\n');
    await fs.writeFile(path.join(secondChangeDir, 'design.md'), '# Design\n');
    await fs.writeFile(path.join(secondChangeDir, 'spec.md'), '# Spec\n');
    await fs.writeFile(path.join(secondChangeDir, 'tasks.md'), '# Tasks\n');
    await fs.writeFile(path.join(secondChangeDir, 'verification.md'), '# Verification\n');

    await expect(resolveChange(workspace, { id: 'CHG-20260901-002' })).resolves.toMatchObject({
      changeId: 'CHG-20260901-002',
    });
    await expect(
      resolveChange(workspace, { cwd: path.join(fixture.paths.changes, 'CHG-20260901-001') })
    ).resolves.toMatchObject({ changeId: 'CHG-20260901-001' });
    await expect(resolveChange(workspace, { text: 'billing' })).resolves.toMatchObject({
      changeId: 'CHG-20260901-002',
    });

    await fs.rm(secondChangeDir, { recursive: true, force: true });
    await expect(resolveChange(workspace, { text: 'no semantic match here' })).resolves.toMatchObject({
      changeId: 'CHG-20260901-001',
      reason: 'sole_active',
    });
    await expect(resolveChange(workspace, {})).resolves.toMatchObject({
      changeId: 'CHG-20260901-001',
    });
  });

  it('resumes a stale Change with a diagnostic before IMPLEMENT actions', async () => {
    const { fixture, workspace } = await loadCanonicalWorkspace();

    await writeChangeArtifacts(fixture, {
      metadata: {
        change: {
          status: 'IMPLEMENT',
        },
        baseline: {
          stale: true,
        },
      },
    });

    await expect(resumeChange(workspace, { id: fixture.changeId }, 'IMPLEMENT')).resolves.toMatchObject({
      changeId: fixture.changeId,
      diagnostic: {
        code: 'STALE',
      },
    });
  });

  it('rejects resuming archived or abandoned Changes', async () => {
    const { fixture, workspace } = await loadCanonicalWorkspace();

    await writeChangeArtifacts(fixture, {
      metadata: {
        change: {
          status: 'ARCHIVED',
        },
      },
    });

    await expect(resumeChange(workspace, { id: fixture.changeId }, 'IMPLEMENT')).rejects.toThrow(
      /cannot resume|ARCHIVED/i
    );

    await writeChangeArtifacts(fixture, {
      metadata: {
        change: {
          status: 'ABANDONED',
        },
      },
    });

    await expect(resumeChange(workspace, { id: fixture.changeId }, 'ANALYZE')).rejects.toThrow(
      /cannot resume|ABANDONED/i
    );
  });

  it('cleans up a staged Change when index publication fails', async () => {
    const { fixture, workspace } = await loadCanonicalWorkspace();

    await fs.rm(fixture.paths.changeIndex, { force: true });
    await fs.mkdir(fixture.paths.changeIndex, { recursive: true });

    await expect(
      createCanonicalChange(workspace, {
        title: 'Broken publication',
        summary: 'Fail index publication on purpose',
        mode: 'feature',
      })
    ).rejects.toThrow();

    await expect(
      fs.stat(path.join(fixture.paths.changes, 'CHG-20260901-001'))
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.stat(fixture.paths.changeIndex)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
  });

  it('preserves an existing destination Change when publish collides after allocation', async () => {
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'));
    afterEach(() => vi.useRealTimers());
    const { fixture, workspace } = await loadCanonicalWorkspace();
    const allocatedId = await allocateChangeId(fixture.paths, new Date().toISOString().slice(0, 10).replace(/-/g, ''));
    const collidingChangeDir = path.join(fixture.paths.changes, allocatedId);
    const stagingDir = path.join(fixture.paths.changes, `.${allocatedId}.tmp`);

    __setChangeManagerTestHooksForTests({
      beforePublishRename: async () => {
        await fs.mkdir(collidingChangeDir, { recursive: true });
        await fs.writeFile(path.join(collidingChangeDir, 'marker.txt'), 'preexisting\n');
      },
    });

    try {
      await expect(
        createCanonicalChange(workspace, {
          title: 'Concurrent collision',
          summary: 'Simulate a destination collision during publish',
          mode: 'feature',
        })
      ).rejects.toSatisfy(
        (error: NodeJS.ErrnoException) => error.code === 'EEXIST' || error.code === 'ENOTEMPTY'
      );

      expect(await fs.readFile(path.join(collidingChangeDir, 'marker.txt'), 'utf8')).toBe('preexisting\n');
      await expect(fs.stat(stagingDir)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      __setChangeManagerTestHooksForTests(null);
    }
  });
});
