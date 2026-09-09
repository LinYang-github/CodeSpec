import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import { migrateLegacyWorkspace } from '../../../src/core/codespec-workflow/migration.js';
import { createWorkflowFixture } from '../../helpers/codespec-workflow.js';

describe('current specification migration', () => {
  it('converts the legacy business registry and creates legacy module documents without guessing relationships', async () => {
    const fixture = await createWorkflowFixture();
    try {
      await fs.writeFile(fixture.paths.business, [
        '| 模块 ID | 名称 | 描述 | 职责 | 关键词 |',
        '| --- | --- | --- | --- | --- |',
        '| MOD-002 | 用户管理 | 管理用户 | 用户维护 | 用户 |',
      ].join('\n'));
      await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
      await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), '# 旧用户管理规格\n');

      await migrateLegacyWorkspace(fixture.codespecDir);

      const business = parseYaml(await fs.readFile(path.join(fixture.codespecDir, 'business.yaml'), 'utf8')) as any;
      expect(business).toEqual({ version: 1, modules: [{ id: 'MOD-002', name: '用户管理', status: 'ACTIVE', inputs: [], outputs: [], relatedModules: [] }] });
      expect(await fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), 'utf8')).toContain('**规格版本：** legacy');
      expect(parseYaml(await fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'interface.yaml'), 'utf8'))).toEqual({ version: 1, module: 'MOD-002', relations: [] });
      expect(parseYaml(await fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'api.yaml'), 'utf8'))).toEqual({ version: 1, module: 'MOD-002', routes: [] });
      expect(parseYaml(await fs.readFile(path.join(fixture.codespecDir, 'configuration.yaml'), 'utf8'))).toEqual({ version: 1, profiles: [] });
      expect((parseYaml(await fs.readFile(path.join(fixture.codespecDir, 'config.yaml'), 'utf8')) as any).paths.business).toBe('business.yaml');
    } finally {
      fixture.cleanup();
    }
  });

  it('invalidates both approvals on an active legacy Change during migration', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const metadata = fixture.metadataAt('IMPLEMENT');
      metadata.approvals.design = { status: 'approved', revision: 1, content_hash: 'a'.repeat(64), approved_at: '2026-09-07T10:30:00.000Z' };
      metadata.approvals.plan = { status: 'approved', revision: 1, content_hash: 'b'.repeat(64), approved_at: '2026-09-07T10:30:00.000Z' };
      const changeDir = path.join(fixture.paths.changes, fixture.changeId);
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'metadata.yaml'), stringifyYaml(metadata));
      await fs.writeFile(path.join(changeDir, 'proposal.md'), '# 旧 Change\n');
      await fs.writeFile(path.join(changeDir, 'design.md'), '# 旧设计\n');
      await fs.writeFile(path.join(changeDir, 'spec.md'), '# 旧规格\n');
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '# 旧任务\n');
      await fs.writeFile(path.join(changeDir, 'verification.md'), '# 旧验证\n');

      await migrateLegacyWorkspace(fixture.codespecDir);

      const migrated = parseYaml(await fs.readFile(path.join(changeDir, 'metadata.yaml'), 'utf8')) as any;
      expect(migrated.change.revision).toBe(2);
      expect(migrated.change.status).toBe('DESIGN');
      expect(migrated.approvals.design.status).toBe('pending');
      expect(migrated.approvals.plan.status).toBe('pending');
    } finally {
      fixture.cleanup();
    }
  });

  it('still converts active legacy Changes when root files already use the v1 layout', async () => {
    const fixture = await createWorkflowFixture({ v1: true });
    try {
      const metadata = fixture.metadataAt('IMPLEMENT');
      metadata.approvals.design = { status: 'approved', revision: 1, content_hash: 'a'.repeat(64), approved_at: '2026-09-07T10:30:00.000Z' };
      metadata.approvals.plan = { status: 'approved', revision: 1, content_hash: 'b'.repeat(64), approved_at: '2026-09-07T10:30:00.000Z' };
      const changeDir = path.join(fixture.paths.changes, fixture.changeId);
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'metadata.yaml'), stringifyYaml(metadata));
      await fs.writeFile(path.join(changeDir, 'proposal.md'), '# 旧 Change\n');

      await migrateLegacyWorkspace(fixture.codespecDir);

      const migrated = parseYaml(await fs.readFile(path.join(changeDir, 'metadata.yaml'), 'utf8')) as any;
      expect(migrated.change.revision).toBe(2);
      expect(migrated.change.status).toBe('DESIGN');
      expect(migrated.approvals.design.status).toBe('pending');
      expect(migrated.approvals.plan.status).toBe('pending');
    } finally {
      fixture.cleanup();
    }
  });
});
