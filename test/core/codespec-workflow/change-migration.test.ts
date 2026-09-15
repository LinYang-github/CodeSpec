import * as fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { loadWorkspace, loadChangeArtifacts } from '../../../src/core/codespec-workflow/loaders.js';
import { validateExitGate } from '../../../src/core/codespec-workflow/gates.js';
import { renderInitialAnalysis } from '../../../src/core/codespec-workflow/analysis.js';
import { migrateActiveChangeAnalysis as migrate } from '../../../src/core/codespec-workflow/change-migration.js';
import { createMigrationFixture, snapshotFiles } from '../../helpers/change-migration.js';

vi.mock('node:fs/promises', async (original) => ({ ...await original<typeof fs>() }));
afterEach(() => vi.restoreAllMocks());

async function prepared() {
  const fixture = await createMigrationFixture();
  afterEach(fixture.cleanup);
  return { ...fixture, workspace: await loadWorkspace(fixture.codespecDir) };
}

describe('active Change analysis migration', () => {
  it('copies only explicit facts, preserves whole-module spec and stale tasks, and invalidates all authority', async () => {
    const f = await prepared();
    const before = await snapshotFiles(f.dir);
    const result = await migrate(f.workspace, f.changeId);
    expect(result).toMatchObject({ changeId: f.changeId, fromArtifacts: 5, toArtifacts: 6, route: 'ANALYZE', unresolvedQuestionId: 'Q-MIGRATION-001' });
    expect(result.message).toMatch(/rich Requirement delta/);
    const artifacts = await loadChangeArtifacts(f.paths, f.changeId);
    const analysis = parseYaml(artifacts.analysis!);
    expect(analysis).toMatchObject({ revision: 2, problem: 'Explicit user problem', goals: [], nonGoals: [], scope: { in: [], out: [] }, actors: [], constraints: [], assumptions: [], acceptanceCriteria: [], modules: [{ module: 'MOD-001', outcome: 'OWNED', reason: 'Explicit ownership' }], requirements: [{ id: 'MOD-001-REQ-001', action: 'MODIFIED' }], openQuestions: [{ id: 'Q-MIGRATION-001', status: 'OPEN' }] });
    expect(analysis.openQuestions[0].question).toMatch(/核对|补充/);
    expect(artifacts.metadata.change).toMatchObject({ revision: 2, status: 'ANALYZE' });
    expect(artifacts.metadata.baseline).toEqual(f.metadata.baseline);
    for (const stage of ['analyze', 'design', 'plan'] as const) {
      expect(['pending', 'revoked']).toContain(artifacts.metadata.approvals[stage].status);
      expect(artifacts.metadata.approvals[stage].content_hash).toBe('');
    }
    expect(Object.values(artifacts.metadata.gates).every((gate) => !gate.satisfied)).toBe(true);
    expect(artifacts.metadata.verification.tests_passed).toBe(false);
    expect(artifacts.metadata.verification.verified_at).toBeNull();
    expect(artifacts.metadata.archive.ready).toBe(false);
    expect(parseYaml(artifacts.verification)).toEqual({ version: 1, testCases: [] });
    expect(artifacts.tasks).toBe(before['tasks.yaml']);
    expect(artifacts.spec).toBe(before['spec.md']);
    expect(artifacts.design).toBe(before['design.md']);
    expect((await validateExitGate(f.workspace, artifacts, 'ANALYZE')).ok).toBe(false);
    expect((await validateExitGate(f.workspace, artifacts, 'DESIGN')).ok).toBe(false);
    expect((await loadWorkspace(f.codespecDir)).index.byId.get(f.changeId)?.status).toBe('ANALYZE');
    expect((await fs.readdir(f.dir)).sort()).toEqual(['analysis.yaml', 'design.md', 'metadata.yaml', 'spec.md', 'tasks.yaml', 'verification.yaml']);
    // Even resolving the migration question and completing analysis cannot
    // turn the retained whole-module document into an accepted rich delta.
    analysis.goals = [{ id: 'GOAL-001', statement: 'User-confirmed goal' }];
    analysis.nonGoals = [{ id: 'NON-GOAL-001', statement: 'User-confirmed boundary' }];
    analysis.scope.in = ['User-confirmed scope'];
    analysis.acceptanceCriteria = [{ id: 'AC-001', statement: 'User-confirmed outcome', priority: 'MUST', requirements: ['MOD-001-REQ-001'] }];
    analysis.openQuestions[0].status = 'RESOLVED';
    analysis.openQuestions[0].resolution = 'User reviewed the migrated facts';
    artifacts.analysis = stringifyYaml(analysis);
    expect((await validateExitGate(f.workspace, artifacts, 'ANALYZE')).ok).toBe(true);
    artifacts.metadata.gates.design.satisfied = true;
    const designGate = await validateExitGate(f.workspace, artifacts, 'DESIGN');
    expect(designGate.errors.join(' ')).toMatch(/delta|ADDED|MODIFIED|whole.module/i);
  });

  it.each(['archived', 'terminal', 'six', 'proposal', 'missing', 'extra', 'undeclared-analysis', 'missing-declaration', 'extra-declaration', 'foreign-path', 'symlink', 'legacy-schema'])('rejects %s before writing anything', async (kind) => {
    const f = await prepared();
    const metadata = parseYaml(await fs.readFile(f.file('metadata.yaml'), 'utf8'));
    if (kind === 'archived') await fs.rename(f.dir, path.join(f.paths.archivedChanges, f.changeId));
    else {
      if (kind === 'terminal') metadata.change.status = 'ABANDONED';
      if (kind === 'six' || kind === 'undeclared-analysis') {
        await fs.writeFile(f.file('analysis.yaml'), renderInitialAnalysis({ changeId: f.changeId, revision: 1, problem: 'existing' }));
        if (kind === 'six') metadata.artifacts.analysis = path.relative(f.codespecDir, f.file('analysis.yaml'));
      }
      if (kind === 'proposal') { metadata.artifacts.proposal = path.relative(f.codespecDir, f.file('proposal.md')); await fs.writeFile(f.file('proposal.md'), '# Proposal'); }
      if (kind === 'missing') await fs.rm(f.file('spec.md'));
      if (kind === 'extra') await fs.writeFile(f.file('notes.md'), 'Author notes');
      if (kind === 'missing-declaration') { delete metadata.artifacts.design; metadata.change.sdd_level = 1; }
      if (kind === 'extra-declaration') metadata.artifacts.notes = 'notes.md';
      if (kind === 'foreign-path') metadata.artifacts.spec = 'specs/MOD-001/spec.md';
      if (kind === 'symlink') { await fs.rm(f.file('spec.md')); await fs.symlink(path.join(f.paths.currentSpecs, 'MOD-001', 'spec.md'), f.file('spec.md')); }
      if (kind === 'legacy-schema') f.workspace.config.schema = 'spec-driven';
      await fs.writeFile(f.file('metadata.yaml'), stringifyYaml(metadata));
    }
    const before = await snapshotFiles(f.codespecDir);
    await expect(migrate(f.workspace, f.changeId)).rejects.toThrow();
    expect(await snapshotFiles(f.codespecDir)).toEqual(before);
  });

  it('rolls back all artifacts and index after a partial installation failure', async () => {
    const f = await prepared();
    const before = await snapshotFiles(f.dir);
    const index = await fs.readFile(f.paths.changeIndex, 'utf8');
    const link = fs.link;
    let failed = false;
    vi.spyOn(fs, 'link').mockImplementation(async (source, target) => {
      if (!failed && String(target) === f.paths.changeIndex) { failed = true; throw new Error('injected migration failure'); }
      return link(source, target);
    });
    await expect(migrate(f.workspace, f.changeId)).rejects.toThrow(/injected migration failure/);
    expect(await snapshotFiles(f.dir)).toEqual(before);
    expect(await fs.readFile(f.paths.changeIndex, 'utf8')).toBe(index);
    expect(await fs.readdir(f.paths.transactions)).toEqual([]);
  });

  it('preserves concurrent author edits while rolling back owned writes', async () => {
    const f = await prepared();
    const link = fs.link;
    vi.spyOn(fs, 'link').mockImplementation(async (source, target) => {
      const result = await link(source, target);
      if (String(target) === f.file('analysis.yaml')) await fs.writeFile(f.file('spec.md'), 'Concurrent author spec');
      return result;
    });
    await expect(migrate(f.workspace, f.changeId)).rejects.toThrow(/conflict|changed/i);
    expect(await fs.readFile(f.file('spec.md'), 'utf8')).toBe('Concurrent author spec');
    expect(parseYaml(await fs.readFile(f.file('metadata.yaml'), 'utf8')).change.revision).toBe(1);
    await expect(fs.access(f.file('analysis.yaml'))).rejects.toThrow();
  });

  it('retains writes through a preexisting metadata handle in durable manual-only escrow', async () => {
    const f = await prepared();
    const handle = await fs.open(f.file('metadata.yaml'), 'r+');
    try {
      await migrate(f.workspace, f.changeId);
      await handle.writeFile('late author metadata');
      const escrow = await snapshotFiles(path.join(f.paths.archive, '.recovery-escrow'));
      expect(Object.values(escrow).some((text) => text.startsWith('late author metadata'))).toBe(true);
      expect(Object.values(escrow).some((text) => text.includes('manual-only'))).toBe(true);
      expect(parseYaml(await fs.readFile(f.file('metadata.yaml'), 'utf8')).change.revision).toBe(2);
    } finally { await handle.close(); }
  });
});
