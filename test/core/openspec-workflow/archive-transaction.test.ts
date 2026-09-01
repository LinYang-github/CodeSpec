import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import { archiveChange } from '../../../src/core/openspec-workflow/archive-transaction.js';
import { createWorkflowFixture } from '../../helpers/openspec-workflow.js';
import type { ChangeMetadata } from '../../../src/core/openspec-workflow/types.js';

const ready = (fixture: Awaited<ReturnType<typeof createWorkflowFixture>>, modules = ['MOD-002']): ChangeMetadata => {
  const metadata = fixture.metadataAt('ARCHIVE');
  metadata.archive.ready = true; metadata.gates.archive.satisfied = true;
  metadata.tasks = { total: 1, completed: 1, items: { 'SP-01': { status: 'DONE' } } };
  metadata.verification = { requirements_verified: true, tests_passed: true, build_passed: true, lint_passed: true, verified_at: new Date().toISOString() };
  metadata.modules.confirmed = modules.map((module) => ({ module: module as `MOD-${string}`, outcome: 'OWNED' as const, reason: 'test' }));
  return metadata;
};

async function setup(fixture: Awaited<ReturnType<typeof createWorkflowFixture>>, metadata: ChangeMetadata, spec: string) {
  const dir = path.join(fixture.paths.changes, fixture.changeId); await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'metadata.yaml'), stringify(metadata));
  await fs.writeFile(path.join(dir, 'proposal.md'), 'proposal'); await fs.writeFile(path.join(dir, 'design.md'), 'design');
  await fs.writeFile(path.join(dir, 'tasks.md'), 'tasks');
  await fs.writeFile(path.join(dir, 'verification.md'), stringify({ status: 'PASS', revision: metadata.change.revision, requirement_ids: [...metadata.requirements.added, ...metadata.requirements.modified, ...metadata.requirements.removed].map((r) => r.id), baseline_hash: 'fixture' }));
  await fs.writeFile(path.join(dir, 'spec.md'), spec);
}

describe('transactional OpenSpec archive', () => {
  it('rejects a MODIFIED delta when Current differs from Previous without changing files', async () => {
    const fixture = await createWorkflowFixture();
    try {
      await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
      await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), '### MOD-002-REQ-006 title\nB\n');
      const metadata = ready(fixture); metadata.requirements.modified = [{ id: 'MOD-002-REQ-006', module: 'MOD-002' }];
      await setup(fixture, metadata, '## MODIFIED\n### MOD-002-REQ-006 title\n**Previous**\nA\n**New**\nC\n**Reason**\nfix\n#### Scenario: SCN-006 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n');
      await expect(archiveChange(fixture.workspace, fixture.changeId)).rejects.toThrow(/ARCHIVE CONFLICT/i);
      await expect(fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), 'utf8')).resolves.toContain('B');
    } finally { fixture.cleanup(); }
  });

  it('preflights every module before writing any Current spec', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const metadata = ready(fixture, ['MOD-001', 'MOD-002']); metadata.requirements.added = [{ id: 'MOD-001-REQ-001', module: 'MOD-001' }, { id: 'MOD-002-REQ-001', module: 'MOD-002' }];
      await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-001'), { recursive: true }); await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
      await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-001', 'spec.md'), 'base'); await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), 'base');
      await setup(fixture, metadata, '## ADDED\n### MOD-001-REQ-001 title\n**New**\n### MOD-001-REQ-001 title\ntext\n**Reason**\nx\n#### Scenario: SCN-001 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n\n## MODIFIED\n### MOD-002-REQ-001 title\n**Previous**\nbad\n**New**\nnew\n**Reason**\nx\n#### Scenario: SCN-002 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n');
      await expect(archiveChange(fixture.workspace, fixture.changeId)).rejects.toThrow(/conflict/i);
      await expect(fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-001', 'spec.md'), 'utf8')).resolves.toBe('base');
    } finally { fixture.cleanup(); }
  });
});
