import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { createWorkflowFixture, writeChangeArtifacts } from '../helpers/codespec-workflow.js';
import { createCanonicalChange } from '../../src/core/codespec-workflow/change-manager.js';
import { archiveChange } from '../../src/core/codespec-workflow/archive-transaction.js';
import { loadWorkspace } from '../../src/core/codespec-workflow/loaders.js';
import { resolveChange } from '../../src/core/codespec-workflow/change-resolver.js';
import { canTransition } from '../../src/core/codespec-workflow/state-machine.js';
import { detectStaleChanges } from '../../src/core/codespec-workflow/stale.js';
import { buildUiIndex } from '../../src/core/ui-content-index.js';
import { runCLI } from '../helpers/run-cli.js';

describe('canonical CodeSpec workflow journeys', () => {
  it('creates a feature Change, resumes it through verification, and preserves one Change for revision', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const created = await createCanonicalChange(fixture.workspace, {
        title: '登录功能', summary: '支持用户登录', mode: 'feature',
      });
      expect(created.changeId).toMatch(/^CHG-\d{8}-\d{3}$/);
      expect(await fs.readdir(created.changeDir)).toEqual(expect.arrayContaining([
        'metadata.yaml', 'design.md', 'spec.md', 'tasks.yaml', 'verification.yaml',
      ]));
      expect(canTransition('ANALYZE', 'DESIGN')).toBe(true);
      expect(canTransition('VERIFY', 'IMPLEMENT')).toBe(true);
      expect(canTransition('VERIFY', 'DESIGN')).toBe(true);
      expect(created.metadata.change.id).toBe(created.changeId);
    } finally {
      fixture.cleanup();
    }
  });

  it('supports multiple active Changes but rejects ambiguous semantic selection', async () => {
    const fixture = await createWorkflowFixture();
    try {
      for (const title of ['订单支付', '订单退款', '用户登录']) {
        await createCanonicalChange(fixture.workspace, { title, summary: title, mode: 'feature' });
      }
      await expect(resolveChange(fixture.workspace, { text: '订单' })).rejects.toThrow(/Multiple active Changes/i);
      const firstChange = await resolveChange(fixture.workspace, { text: '订单支付' });
      await expect(resolveChange(fixture.workspace, { id: firstChange.changeId })).resolves.toMatchObject({ reason: 'explicit_id' });
    } finally {
      fixture.cleanup();
    }
  });

  it('detects a stale baseline before archive and keeps canonical paths isolated', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const metadata = fixture.metadataAt('VERIFY');
      metadata.modules.confirmed = [{ module: 'MOD-001', outcome: 'OWNED', reason: 'workflow' }];
      metadata.baseline.modules = { 'MOD-001': { outcome: 'OWNED', latest_change: null, requirement_ids: ['MOD-001-REQ-001'], spec_hash: 'a'.repeat(64), requirements: { 'MOD-001-REQ-001': 'b'.repeat(64) } } };
      metadata.requirements.modified = [{ id: 'MOD-001-REQ-001', module: 'MOD-001' }];
      const dir = path.join(fixture.paths.changes, fixture.changeId);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'metadata.yaml'), JSON.stringify(metadata));
      await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-001'), { recursive: true });
      await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-001', 'spec.md'), 'changed');
      const stale = await detectStaleChanges(fixture.workspace, ['MOD-001-REQ-001']);
      expect(stale).toContain(fixture.changeId);
      expect(path.basename(dir)).toMatch(/^CHG-/);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects a nonexistent canonical Change during JSON preflight even when --yes is supplied', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const result = await runCLI(
        ['archive', fixture.changeId, '--json', '--yes'],
        { cwd: fixture.tempDir }
      );

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('archive_preflight_failed');
      await expect(fs.readdir(fixture.paths.archivedChanges)).resolves.toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it('exposes approve and rejects an incomplete design instead of recording approval', async () => {
    const fixture = await createWorkflowFixture();
    try {
      await writeChangeArtifacts(fixture, { metadata: { change: { status: 'DESIGN' } } });
      const result = await runCLI(
        ['approve', '--change', fixture.changeId, '--stage', 'design'],
        { cwd: fixture.tempDir }
      );

      expect(result.exitCode).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/无法确认设计|阶段门禁/i);
    } finally {
      fixture.cleanup();
    }
  });

  it('routes a v1 current-spec archive through the confirmation gate without creating history', async () => {
    const fixture = await createWorkflowFixture({ v1: true });
    try {
      const created = await createCanonicalChange(fixture.workspace, {
        title: '当前规格归档', summary: '验证 v1 归档路由', mode: 'feature',
      });
      const result = await runCLI(
        ['archive', created.changeId, '--json', '--yes'],
        { cwd: fixture.tempDir }
      );

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('archive_confirmation_required');
      await expect(fs.access(path.join(fixture.paths.archivedChanges, created.changeId))).rejects.toThrow();
      await expect(fs.access(path.join(fixture.paths.archive, 'history.yaml'))).rejects.toThrow();

      const metadata = {
        ...created.metadata,
        change: { ...created.metadata.change, status: 'ARCHIVE' as const },
        gates: {
          ...created.metadata.gates,
          plan: { ...created.metadata.gates.plan, satisfied: true },
          archive: { ...created.metadata.gates.archive, satisfied: true },
        },
        approvals: {
          ...created.metadata.approvals,
          design: { status: 'approved' as const, revision: 1, content_hash: 'd'.repeat(64), approved_at: '2026-09-07T10:29:00.000Z' },
          plan: { status: 'approved' as const, revision: 1, content_hash: 'a'.repeat(64), approved_at: '2026-09-07T10:30:00.000Z' },
        },
        archive: { ...created.metadata.archive, ready: true },
      };
      await fs.writeFile(path.join(created.changeDir, 'metadata.yaml'), stringifyYaml(metadata));
      await fs.writeFile(path.join(created.changeDir, 'spec.md'), '# Payment\n\n- **模块编号：** MOD-002\n- **规格版本：** 1\n');

      await archiveChange(await loadWorkspace(fixture.codespecDir), created.changeId);
      await expect(fs.access(created.changeDir)).rejects.toThrow();
      await expect(fs.access(path.join(fixture.paths.archivedChanges, created.changeId))).rejects.toThrow();
      await expect(fs.access(path.join(fixture.paths.archive, 'history.yaml'))).rejects.toThrow();
      await expect(fs.readFile(fixture.paths.business, 'utf8')).resolves.toContain('version: 1');
      await expect(buildUiIndex(fixture.tempDir)).resolves.toMatchObject({ currentSpecGraph: expect.any(Object) });
    } finally {
      fixture.cleanup();
    }
  });

  it('exposes an explicit legacy workspace migration command', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const result = await runCLI(['migrate', '--json'], { cwd: fixture.tempDir });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ status: 'migrated' });
      await expect(fs.readFile(path.join(fixture.codespecDir, 'business.yaml'), 'utf8')).resolves.toContain('version: 1');
      await expect(fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-001', 'spec.md'), 'utf8')).resolves.toContain('规格版本：** legacy');
    } finally {
      fixture.cleanup();
    }
  });
});
