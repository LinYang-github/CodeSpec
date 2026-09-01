import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createWorkflowFixture } from '../helpers/openspec-workflow.js';
import { createCanonicalChange } from '../../src/core/openspec-workflow/change-manager.js';
import { resolveChange } from '../../src/core/openspec-workflow/change-resolver.js';
import { canTransition, transitionChange } from '../../src/core/openspec-workflow/state-machine.js';
import { detectStaleChanges } from '../../src/core/openspec-workflow/stale.js';

describe('canonical OpenSpec workflow journeys', () => {
  it('creates a feature Change, resumes it through verification, and preserves one Change for revision', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const created = await createCanonicalChange(fixture.workspace, {
        title: '登录功能', summary: '支持用户登录', mode: 'feature',
      });
      expect(created.changeId).toMatch(/^CHG-\d{8}-\d{3}$/);
      expect(await fs.readdir(created.changeDir)).toEqual(expect.arrayContaining([
        'metadata.yaml', 'proposal.md', 'design.md', 'spec.md', 'tasks.md', 'verification.md',
      ]));
      expect(canTransition('ANALYZE', 'DESIGN')).toBe(true);
      expect(canTransition('VERIFY', 'IMPLEMENT')).toBe(true);
      expect(canTransition('VERIFY', 'DESIGN')).toBe(true);
      expect(transitionChange(fixture.metadataAt('VERIFY'), 'DESIGN', 'requirements changed').change.revision).toBe(1);
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
      metadata.baseline.modules = { 'MOD-001': 'old-hash' };
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
});
