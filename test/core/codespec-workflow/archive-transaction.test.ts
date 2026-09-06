import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { createHash } from 'node:crypto';
import { archiveChange, preflightArchive, prepareArchive, commitArchive, __setArchiveTestHooksForTests } from '../../../src/core/codespec-workflow/archive-transaction.js';
import { recordFreshVerification, renderVerificationMarkdown, verificationArtifactIdentity } from '../../../src/core/codespec-workflow/verification.js';
import { createWorkflowFixture } from '../../helpers/codespec-workflow.js';
import type { ChangeMetadata } from '../../../src/core/codespec-workflow/types.js';
import { parseCurrentSpec } from '../../../src/core/codespec-workflow/current-spec-parser.js';
import type { ArchiveImpact } from '../../../src/core/codespec-workflow/archive-impact.js';
import { runCLI } from '../../helpers/run-cli.js';

const ready = (fixture: Awaited<ReturnType<typeof createWorkflowFixture>>, modules = ['MOD-002']): ChangeMetadata => {
  const metadata = fixture.metadataAt('ARCHIVE');
  metadata.archive.ready = true; metadata.gates.archive.satisfied = true;
  metadata.tasks = { total: 1, completed: 1, items: { 'SP-01': { status: 'DONE' } } };
  metadata.verification = { requirements_verified: true, tests_passed: true, build_passed: true, lint_passed: true, verified_at: new Date().toISOString() };
  metadata.modules.confirmed = modules.map((module) => ({ module: module as `MOD-${string}`, outcome: 'OWNED' as const, reason: 'test' }));
  return metadata;
};

async function setup(fixture: Awaited<ReturnType<typeof createWorkflowFixture>>, metadata: ChangeMetadata, spec: string, impact?: ArchiveImpact) {
  const dir = path.join(fixture.paths.changes, fixture.changeId); await fs.mkdir(dir, { recursive: true });
  const ids = [...metadata.requirements.added, ...metadata.requirements.modified, ...metadata.requirements.removed].map((r) => r.id);
  const scenarios = [...spec.matchAll(/#### Scenario:\s*(SCN-\d{3})/gu)].map((m) => m[1]);
  await fs.writeFile(path.join(dir, 'proposal.md'), '# Proposal\n\nsummary goals scope\n'); await fs.writeFile(path.join(dir, 'design.md'), `# Design\n\n${ids.join('\n')}\n\n## 归档影响分析\n\n\`\`\`yaml\n${stringify(impact ?? { outcome: 'none', references: [], verification: [] })}\`\`\`\n`);
  await fs.writeFile(path.join(dir, 'tasks.md'), `# Tasks\n\n${ids.map((id, index) => `- [x] SP-${String(index + 1).padStart(2, '0')} ${id} ${scenarios.join(' ')} test/spec.test.ts`).join('\n')}\n`);
  const baselineIdentity = createHash('sha256').update(JSON.stringify(metadata.baseline)).digest('hex');
  const artifactIdentity = verificationArtifactIdentity({
    proposal: await fs.readFile(path.join(dir, 'proposal.md'), 'utf8'),
    design: await fs.readFile(path.join(dir, 'design.md'), 'utf8'),
    tasks: await fs.readFile(path.join(dir, 'tasks.md'), 'utf8'),
    spec,
  });
  const evidence = { schema_version: 1, change_id: metadata.change.id, verified_at: new Date().toISOString(), revision: metadata.change.revision, status: 'PASS' as const, requirement_ids: ids, scenario_ids: scenarios, baseline_identity: baselineIdentity, receipt: '', commands: ['requirements', 'unit', 'typecheck', 'build', 'lint', 'bdd', 'integration'].map((kind) => ({ command: `node -e "process.exit(0)"`, kind, exit_code: 0, output_summary: 'ok', started_at: new Date().toISOString(), finished_at: new Date().toISOString() })) };
  Object.assign(evidence, { artifact_identity: artifactIdentity });
  evidence.receipt = createHash('sha256').update(JSON.stringify({ ...evidence, receipt: undefined })).digest('hex');
  metadata.verification.verified_at = evidence.verified_at;
  metadata.verification.evidence_receipt = evidence.receipt; metadata.verification.baseline_identity = evidence.baseline_identity;
  await fs.writeFile(path.join(dir, 'metadata.yaml'), stringify(metadata));
  await fs.writeFile(path.join(dir, 'verification.md'), renderVerificationMarkdown(evidence));
  await fs.writeFile(path.join(dir, 'spec.md'), spec);
}

describe('transactional CodeSpec archive', () => {
  it('recovers a lock left by a dead archive process', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const metadata = ready(fixture); metadata.requirements.added = [{ id: 'MOD-002-REQ-001', module: 'MOD-002' }];
      await setup(fixture, metadata, '## ADDED\n### MOD-002-REQ-001 title\n**New**\ntext\n#### Scenario: SCN-001 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**ERROR** err\n');
      await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
      await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), '# Current\n');
      const lock = path.join(fixture.paths.archive, '.archive.lock');
      await fs.mkdir(lock);
      await fs.writeFile(path.join(lock, '.owner.json'), JSON.stringify({ pid: 999999, started_at: '2026-09-05T00:00:00.000Z' }));
      await expect(archiveChange(fixture.workspace, fixture.changeId)).resolves.toMatchObject({ changeId: fixture.changeId });
    } finally { fixture.cleanup(); }
  });

  it.each(['current-spec:MOD-002', 'archived-change', 'archive-history'])('restores Current, active Change, and history if installation fails at %s', async (step) => {
    const fixture = await createWorkflowFixture();
    try {
      const metadata = ready(fixture); metadata.requirements.added = [{ id: 'MOD-002-REQ-001', module: 'MOD-002' }];
      await setup(fixture, metadata, '## ADDED\n### MOD-002-REQ-001 title\n**New**\ntext\n#### Scenario: SCN-001 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**ERROR** err\n');
      const currentFile = path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md');
      await fs.mkdir(path.dirname(currentFile), { recursive: true }); await fs.writeFile(currentFile, '# Current\n');
      const historyFile = path.join(fixture.paths.archive, 'history.yaml');
      await fs.writeFile(historyFile, 'version: 1\nrecords: []\n');
      const metadataFile = path.join(fixture.paths.changes, fixture.changeId, 'metadata.yaml');
      const originalMetadata = await fs.readFile(metadataFile, 'utf8');
      __setArchiveTestHooksForTests({ beforeCommitStep: (current) => { if (current === step) throw new Error('injected installation failure'); } });
      await expect(archiveChange(fixture.workspace, fixture.changeId)).rejects.toThrow(/injected installation failure.*rolled back/);
      expect(await fs.readFile(currentFile, 'utf8')).toBe('# Current\n');
      expect(await fs.readFile(historyFile, 'utf8')).toBe('version: 1\nrecords: []\n');
      expect(await fs.readFile(metadataFile, 'utf8')).toBe(originalMetadata);
      await expect(fs.access(path.join(fixture.paths.archivedChanges, fixture.changeId))).rejects.toThrow();
    } finally { __setArchiveTestHooksForTests(null); fixture.cleanup(); }
  });
  it('supersedes A with B in Current specs, preserves the old Change, and binds history to the resulting specs', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const oldBody = 'A rule\n#### Scenario: SCN-001 A\n- **GIVEN** x\n- **WHEN** y\n- **THEN** a\n- **ERROR** err\n';
      const newBody = 'B rule\n#### Scenario: SCN-002 B\n- **GIVEN** x\n- **WHEN** y\n- **THEN** b\n- **ERROR** err\n';
      const metadata = ready(fixture, ['MOD-001', 'MOD-002']);
      metadata.requirements.removed = [{ id: 'MOD-001-REQ-001', module: 'MOD-001' }];
      metadata.requirements.added = [{ id: 'MOD-002-REQ-001', module: 'MOD-002' }];
      await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-001'), { recursive: true });
      await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-001', 'spec.md'), '# Current A\n\n### MOD-001-REQ-001 A\n' + oldBody);
      const historic = path.join(fixture.paths.archivedChanges, 'CHG-20260831-001', 'spec.md');
      await fs.mkdir(path.dirname(historic), { recursive: true });
      const historicBytes = Buffer.from('Historical A delta and reasons.\r\nDo not rewrite.\r\n');
      await fs.writeFile(historic, historicBytes);
      const impact: ArchiveImpact = { outcome: 'affected', verification: ['archive-regression'], references: [{
        current_requirement: 'MOD-001-REQ-001', current_scenario: 'SCN-001', disposition: 'superseded',
        replacement_requirement: 'MOD-002-REQ-001', replacement_scenario: 'SCN-002',
      }] };
      const delta = '## REMOVED\n### MOD-001-REQ-001 A\n**Previous**\n' + oldBody + '**Reason**\nB replaces A\n\n## ADDED\n### MOD-002-REQ-001 B\n**New**\n' + newBody;
      await setup(fixture, metadata, delta, impact);
      const evidence = await recordFreshVerification(fixture.workspace, fixture.changeId, [
        { kind: 'archive-regression', command: 'node -e "process.exit(0)"', requirementIds: ['MOD-001-REQ-001', 'MOD-002-REQ-001'], scenarioIds: ['SCN-001', 'SCN-002'] },
        { kind: 'unit', command: 'node -e "process.exit(0)"' }, { kind: 'typecheck', command: 'node -e "process.exit(0)"' }, { kind: 'bdd', command: 'node -e "process.exit(0)"' }, { kind: 'integration', command: 'node -e "process.exit(0)"' }, { kind: 'build', command: 'node -e "process.exit(0)"' }, { kind: 'lint', command: 'node -e "process.exit(0)"' },
      ]);
      const preview = await runCLI(['archive', fixture.changeId, '--json', '--yes'], { cwd: fixture.tempDir });
      expect(preview.exitCode).toBe(1);
      expect(JSON.parse(preview.stdout).preflight).toMatchObject({
        changeId: fixture.changeId, revision: 1, archiveImpact: impact,
        evidence: { receipt: evidence.receipt, regressionCommands: [{ kind: 'archive-regression', exit_code: 0 }] },
      });
      await expect(fs.access(path.join(fixture.paths.changes, fixture.changeId))).resolves.toBeUndefined();
      await archiveChange(fixture.workspace, fixture.changeId);
      expect(parseCurrentSpec(await fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-001', 'spec.md'), 'utf8')).requirements).toEqual([]);
      const currentB = await fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), 'utf8');
      expect(parseCurrentSpec(currentB).requirements.map((requirement) => requirement.id)).toEqual(['MOD-002-REQ-001']);
      expect(await fs.readFile(historic)).toEqual(historicBytes);
      expect(await fs.readFile(path.join(fixture.paths.archivedChanges, fixture.changeId, 'spec.md'), 'utf8')).toBe(delta);
      const history = parse(await fs.readFile(path.join(fixture.paths.archive, 'history.yaml'), 'utf8'));
      expect(history.records[0]).toMatchObject({
        change: fixture.changeId, change_revision: 1, evidence_id: evidence.receipt, archive_impact: impact,
        current_specs: expect.arrayContaining([{ module: 'MOD-002', revision: 1, content_hash: createHash('sha256').update(currentB).digest('hex') }]),
      });
    } finally { fixture.cleanup(); }
  });
  it('rejects a spec edited after verification even when the Change revision was not incremented', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const metadata = ready(fixture); metadata.requirements.added = [{ id: 'MOD-002-REQ-001', module: 'MOD-002' }];
      const spec = '## ADDED\n### MOD-002-REQ-001 title\n**New**\ntext\n#### Scenario: SCN-001 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**ERROR** err\n';
      await setup(fixture, metadata, spec);
      await fs.writeFile(path.join(fixture.paths.changes, fixture.changeId, 'spec.md'), spec.replace('**THEN** z', '**THEN** a different result'));
      await expect(archiveChange(fixture.workspace, fixture.changeId)).rejects.toThrow(/产物.*重新验证/);
      await expect(fs.access(path.join(fixture.paths.archivedChanges, fixture.changeId))).rejects.toThrow();
    } finally { fixture.cleanup(); }
  });
  it.each(['spec.md', 'design.md', 'tasks.md', 'verification.md'])('rejects %s edits after preflight without moving the active Change', async (filename) => {
    const fixture = await createWorkflowFixture();
    try {
      const metadata = ready(fixture); metadata.requirements.added = [{ id: 'MOD-002-REQ-001', module: 'MOD-002' }];
      await setup(fixture, metadata, '## ADDED\n### MOD-002-REQ-001 title\n**New**\ntext\n#### Scenario: SCN-001 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**ERROR** err\n');
      const prepared = await prepareArchive(await preflightArchive(fixture.workspace, fixture.changeId));
      const file = path.join(fixture.paths.changes, fixture.changeId, filename);
      const edited = await fs.readFile(file, 'utf8') + '\nEdited after preflight\n';
      await fs.writeFile(file, edited);
      await expect(commitArchive(prepared)).rejects.toThrow(/预检后.*变化/);
      expect(await fs.readFile(file, 'utf8')).toBe(edited);
      await expect(fs.access(path.join(fixture.paths.archivedChanges, fixture.changeId))).rejects.toThrow();
    } finally { fixture.cleanup(); }
  });

  it('preserves module attachments and leaves dependency modules untouched', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const metadata = ready(fixture);
      metadata.modules.confirmed.push({ module: 'MOD-001', outcome: 'DEPENDENCY', reason: 'read dependency only' });
      metadata.requirements.added = [{ id: 'MOD-002-REQ-001', module: 'MOD-002' }];
      await setup(fixture, metadata, '## ADDED\n### MOD-002-REQ-001 title\n**New**\ntext\n#### Scenario: SCN-001 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**ERROR** err\n');
      const attachment = path.join(fixture.paths.currentSpecs, 'MOD-002', 'notes.txt');
      await fs.mkdir(path.dirname(attachment), { recursive: true });
      await fs.writeFile(attachment, 'Human-authored supporting notes');
      await archiveChange(fixture.workspace, fixture.changeId);
      expect(await fs.readFile(attachment, 'utf8')).toBe('Human-authored supporting notes');
      await expect(fs.access(path.join(fixture.paths.currentSpecs, 'MOD-001'))).rejects.toThrow();
    } finally { fixture.cleanup(); }
  });

  it('blocks a false none declaration before changing an existing requirement', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const old = '### MOD-002-REQ-006 title\nold\n#### Scenario: SCN-001 old\n- **GIVEN** x\n- **WHEN** y\n- **THEN** z\n- **ERROR** err\n';
      const next = 'new\n#### Scenario: SCN-002 new\n- **GIVEN** x\n- **WHEN** y\n- **THEN** changed\n- **ERROR** err\n';
      await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
      const currentFile = path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md');
      await fs.writeFile(currentFile, old);
      const metadata = ready(fixture); metadata.requirements.modified = [{ id: 'MOD-002-REQ-006', module: 'MOD-002' }];
      await setup(fixture, metadata, '## MODIFIED\n### MOD-002-REQ-006 title\n**Previous**\n' + old.split('\n').slice(1).join('\n') + '**New**\n' + next + '**Reason**\nchange policy\n');
      await expect(archiveChange(fixture.workspace, fixture.changeId)).rejects.toThrow(/映射/);
      expect(await fs.readFile(currentFile, 'utf8')).toBe(old);
      await expect(fs.access(path.join(fixture.paths.archivedChanges, fixture.changeId))).rejects.toThrow();
    } finally { fixture.cleanup(); }
  });

  it('preserves existing archive README and history while appending the new record', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const metadata = ready(fixture); metadata.requirements.added = [{ id: 'MOD-002-REQ-001', module: 'MOD-002' }];
      await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
      await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), '# Current\n');
      await setup(fixture, metadata, '## ADDED\n### MOD-002-REQ-001 title\n**New**\ntext\n#### Scenario: SCN-001 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**ERROR** z-error\n');
      await fs.writeFile(path.join(fixture.paths.archive, 'README.md'), '# Existing archive\nKeep this chapter.\n');
      await fs.writeFile(path.join(fixture.paths.archive, 'history.yaml'), stringify({ version: 1, records: [{ change: 'CHG-20260831-001', status: 'ARCHIVED', archived_at: '2026-08-31T00:00:00.000Z' }] }));
      await archiveChange(fixture.workspace, fixture.changeId);
      await expect(fs.readFile(path.join(fixture.paths.archive, 'README.md'), 'utf8')).resolves.toContain('Keep this chapter.');
      const history = await fs.readFile(path.join(fixture.paths.archive, 'history.yaml'), 'utf8');
      expect(history).toContain('CHG-20260831-001'); expect(history).toContain(fixture.changeId);
      expect(history).toContain('outcome: none');
      const current = await fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), 'utf8');
      expect(current).toContain('- **ERROR** z-error');
      expect(parseCurrentSpec(current).requirements[0].scenarios[0].error).toEqual(['z-error']);
    } finally { fixture.cleanup(); }
  });

  it('rejects a MODIFIED delta when Current differs from Previous without changing files', async () => {
    const fixture = await createWorkflowFixture();
    try {
      await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
      await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), '### MOD-002-REQ-006 title\nB\n');
      const metadata = ready(fixture); metadata.requirements.modified = [{ id: 'MOD-002-REQ-006', module: 'MOD-002' }];
      await setup(fixture, metadata, '## MODIFIED\n### MOD-002-REQ-006 title\n**Previous**\nA\n**New**\nC\n#### Scenario: SCN-006 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**ERROR** z-error\n**Reason**\nfix\n');
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
      await setup(fixture, metadata, '## ADDED\n### MOD-001-REQ-001 title\n**New**\ntext\n#### Scenario: SCN-001 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**ERROR** z-error\n\n## MODIFIED\n### MOD-002-REQ-001 title\n**Previous**\nbad\n**New**\nnew\n#### Scenario: SCN-002 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**ERROR** z-error\n**Reason**\nx\n');
      await expect(archiveChange(fixture.workspace, fixture.changeId)).rejects.toThrow(/conflict/i);
      await expect(fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-001', 'spec.md'), 'utf8')).resolves.toBe('base');
    } finally { fixture.cleanup(); }
  });

  it('rejects a Current Specification Scenario whose ERROR line is missing', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const metadata = ready(fixture);
      metadata.requirements.added = [{ id: 'MOD-002-REQ-001', module: 'MOD-002' }];
      await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
      await fs.writeFile(
        path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'),
        '### MOD-002-REQ-009 existing\n\n#### Scenario: SCN-009 old behavior\n- **GIVEN** old\n- **WHEN** old\n- **THEN** old\n'
      );
      await setup(
        fixture,
        metadata,
        '## ADDED\n### MOD-002-REQ-001 title\n**New**\ntext\n#### Scenario: SCN-001 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**ERROR** recorded\n'
      );

      await expect(archiveChange(fixture.workspace, fixture.changeId)).rejects.toThrow(
        /MOD-002-REQ-009.*SCN-009.*ERROR/i
      );
      await expect(
        fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), 'utf8')
      ).resolves.toContain('SCN-009 old behavior');
    } finally { fixture.cleanup(); }
  });

  it('rejects a Change whose Delta Scenario ERROR is empty', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const metadata = ready(fixture);
      metadata.requirements.added = [{ id: 'MOD-002-REQ-001', module: 'MOD-002' }];
      await setup(
        fixture,
        metadata,
        '## ADDED\n### MOD-002-REQ-001 title\n**New**\ntext\n#### Scenario: SCN-001 test\n**GIVEN** x\n**WHEN** y\n**THEN** z\n**ERROR**\n'
      );

      await expect(archiveChange(fixture.workspace, fixture.changeId)).rejects.toThrow(
        /MOD-002-REQ-001.*SCN-001.*ERROR.*人工补写/i
      );
    } finally { fixture.cleanup(); }
  });
});
