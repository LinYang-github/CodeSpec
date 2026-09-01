import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import { createHash } from 'node:crypto';
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
  const ids = [...metadata.requirements.added, ...metadata.requirements.modified, ...metadata.requirements.removed].map((r) => r.id);
  const scenarios = [...spec.matchAll(/#### Scenario:\s*(SCN-\d{3})/gu)].map((m) => m[1]);
  await fs.writeFile(path.join(dir, 'proposal.md'), '# Proposal\n\nsummary goals scope\n'); await fs.writeFile(path.join(dir, 'design.md'), `# Design\n\n${ids.join('\n')}\n`);
  await fs.writeFile(path.join(dir, 'tasks.md'), `# Tasks\n\n${ids.map((id, index) => `- [x] SP-${String(index + 1).padStart(2, '0')} ${id} ${scenarios[index] ?? scenarios[0] ?? 'SCN-001'} test/spec.test.ts`).join('\n')}\n`);
  const baselineIdentity = createHash('sha256').update(JSON.stringify(metadata.baseline)).digest('hex');
  await fs.writeFile(path.join(dir, 'verification.md'), stringify({ schema_version: 1, change_id: metadata.change.id, verified_at: new Date().toISOString(), revision: metadata.change.revision, status: 'PASS', requirement_ids: ids, scenario_ids: scenarios, baseline_identity: baselineIdentity, receipt: 'a'.repeat(64), commands: ['requirements', 'test', 'build', 'lint'].map((kind) => ({ command: `node -e "process.exit(0)"`, kind, exit_code: 0, output_summary: 'ok', started_at: new Date().toISOString(), finished_at: new Date().toISOString() })) }));
  await fs.writeFile(path.join(dir, 'spec.md'), spec);
}

describe('transactional OpenSpec archive', () => {
  it('preserves existing archive README and history while appending the new record', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const metadata = ready(fixture); metadata.requirements.added = [{ id: 'MOD-002-REQ-001', module: 'MOD-002' }];
      await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
      await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), '# Current\n');
      await setup(fixture, metadata, '## ADDED\n### MOD-002-REQ-001 title\n**New**\ntext\n#### Scenario: SCN-001 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n');
      await fs.writeFile(path.join(fixture.paths.archive, 'README.md'), '# Existing archive\nKeep this chapter.\n');
      await fs.writeFile(path.join(fixture.paths.archive, 'history.yaml'), stringify({ version: 1, records: [{ change: 'CHG-20260831-001', status: 'ARCHIVED', archived_at: '2026-08-31T00:00:00.000Z' }] }));
      await archiveChange(fixture.workspace, fixture.changeId);
      await expect(fs.readFile(path.join(fixture.paths.archive, 'README.md'), 'utf8')).resolves.toContain('Keep this chapter.');
      const history = await fs.readFile(path.join(fixture.paths.archive, 'history.yaml'), 'utf8');
      expect(history).toContain('CHG-20260831-001'); expect(history).toContain(fixture.changeId);
    } finally { fixture.cleanup(); }
  });

  it('rejects a MODIFIED delta when Current differs from Previous without changing files', async () => {
    const fixture = await createWorkflowFixture();
    try {
      await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
      await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), '### MOD-002-REQ-006 title\nB\n');
      const metadata = ready(fixture); metadata.requirements.modified = [{ id: 'MOD-002-REQ-006', module: 'MOD-002' }];
      await setup(fixture, metadata, '## MODIFIED\n### MOD-002-REQ-006 title\n**Previous**\nA\n**New**\nC\n#### Scenario: SCN-006 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**Reason**\nfix\n');
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
      await setup(fixture, metadata, '## ADDED\n### MOD-001-REQ-001 title\n**New**\ntext\n#### Scenario: SCN-001 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n\n## MODIFIED\n### MOD-002-REQ-001 title\n**Previous**\nbad\n**New**\nnew\n#### Scenario: SCN-002 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**Reason**\nx\n');
      await expect(archiveChange(fixture.workspace, fixture.changeId)).rejects.toThrow(/conflict/i);
      await expect(fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-001', 'spec.md'), 'utf8')).resolves.toBe('base');
    } finally { fixture.cleanup(); }
  });
});
