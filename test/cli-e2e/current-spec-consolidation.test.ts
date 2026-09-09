import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';

import { buildUiIndex } from '../../src/core/ui-content-index.js';
import { archiveChange } from '../../src/core/codespec-workflow/archive-transaction.js';
import { createCanonicalChange } from '../../src/core/codespec-workflow/change-manager.js';
import { loadWorkspace } from '../../src/core/codespec-workflow/loaders.js';
import { createWorkflowFixture } from '../helpers/codespec-workflow.js';

describe('current-spec consolidation CLI journey', () => {
  it('starts from the v1 five-file workspace layout and exposes its current graph', async () => {
    const fixture = await createWorkflowFixture({ v1: true });
    try {
      expect(path.basename(fixture.paths.business)).toBe('business.yaml');
      expect(path.basename(fixture.paths.configuration)).toBe('configuration.yaml');
      expect(path.basename(fixture.paths.transactions)).toBe('transactions');

      const index = await buildUiIndex(fixture.tempDir);
      expect(index.currentSpecGraph).toBeTruthy();
      await expect(fs.access(path.join(fixture.paths.currentSpecs, 'MOD-001', 'interface.yaml'))).resolves.toBeUndefined();
      await expect(fs.access(path.join(fixture.paths.currentSpecs, 'MOD-001', 'api.yaml'))).resolves.toBeUndefined();
    } finally {
      fixture.cleanup();
    }
  });

  it('records both approvals, archives into current specs, and leaves no Change history copy', async () => {
    const fixture = await createWorkflowFixture({ v1: true });
    try {
      const created = await createCanonicalChange(fixture.workspace, {
        title: '当前规格收敛', summary: '归档到唯一当前规格', mode: 'feature',
      });
      const approved = {
        ...created.metadata,
        change: { ...created.metadata.change, status: 'ARCHIVE' as const },
        gates: {
          ...created.metadata.gates,
          plan: { ...created.metadata.gates.plan, satisfied: true },
          archive: { ...created.metadata.gates.archive, satisfied: true },
        },
        approvals: {
          ...created.metadata.approvals,
          design: { status: 'approved' as const, revision: 1, content_hash: 'b'.repeat(64), approved_at: '2026-09-07T10:30:00.000Z' },
          plan: { status: 'approved' as const, revision: 1, content_hash: 'c'.repeat(64), approved_at: '2026-09-07T10:31:00.000Z' },
        },
        archive: { ...created.metadata.archive, ready: true },
      };
      await fs.writeFile(path.join(created.changeDir, 'metadata.yaml'), stringifyYaml(approved));
      await fs.writeFile(path.join(created.changeDir, 'spec.md'), '# Payment\n\n- **模块编号：** MOD-002\n- **规格版本：** 1\n');

      await archiveChange(await loadWorkspace(fixture.codespecDir), created.changeId);

      await expect(fs.access(created.changeDir)).rejects.toThrow();
      await expect(fs.access(path.join(fixture.paths.archivedChanges, created.changeId))).rejects.toThrow();
      await expect(fs.access(path.join(fixture.paths.archive, 'history.yaml'))).rejects.toThrow();
      await expect(buildUiIndex(fixture.tempDir)).resolves.toMatchObject({ currentSpecGraph: expect.any(Object) });
    } finally {
      fixture.cleanup();
    }
  });
});
