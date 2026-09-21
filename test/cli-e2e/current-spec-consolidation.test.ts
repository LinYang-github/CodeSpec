import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { buildUiIndex } from '../../src/core/ui-content-index.js';
import { archiveChange } from '../../src/core/codespec-workflow/archive-transaction.js';
import { createCanonicalChange } from '../../src/core/codespec-workflow/change-manager.js';
import { loadWorkspace } from '../../src/core/codespec-workflow/loaders.js';
import { createWorkflowFixture } from '../helpers/codespec-workflow.js';
import { createCurrentArchiveFixture, modification, writeCanonicalChange } from '../helpers/current-archive.js';

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

  it('records all approvals, merges current specs, and removes archive history', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const created = await createCanonicalChange(fixture.workspace, {
        title: '当前规格收敛', summary: '归档到唯一当前规格', mode: 'feature',
      });
      await writeCanonicalChange(fixture, modification(), created.changeId);

      await archiveChange(await loadWorkspace(fixture.codespecDir), created.changeId);

      await expect(fs.access(created.changeDir)).rejects.toThrow();
      await expect(fs.access(path.join(fixture.paths.archivedChanges, created.changeId))).rejects.toThrow();
      await expect(fs.access(fixture.paths.archive)).rejects.toThrow();
      await expect(buildUiIndex(fixture.tempDir)).resolves.toMatchObject({ currentSpecGraph: expect.any(Object) });
    } finally {
      fixture.cleanup();
    }
  });
});
