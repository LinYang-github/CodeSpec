import * as fs from 'node:fs/promises';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { createWorkflowFixture } from './codespec-workflow.js';
import { currentMarkdown } from './rich-requirement.js';

/** Historical canonical five-artifact input, deliberately not a rich delta. */
export async function createMigrationFixture() {
  const fixture = await createWorkflowFixture({ v1: true });
  const dir = path.join(fixture.paths.changes, fixture.changeId);
  const file = (name: string) => path.join(dir, name);
  await fs.mkdir(dir);
  const metadata = fixture.metadataAt('VERIFY');
  delete metadata.artifacts.proposal;
  metadata.artifacts.tasks = path.relative(fixture.codespecDir, file('tasks.yaml'));
  metadata.artifacts.verification = path.relative(fixture.codespecDir, file('verification.yaml'));
  metadata.impact.summary = 'Explicit user problem';
  metadata.impact.affected_areas = ['Candidate area, not confirmed scope'];
  const owner = { module: 'MOD-001', outcome: 'OWNED', reason: 'Explicit ownership' } as const;
  metadata.modules = { candidates: [owner], confirmed: [owner], dependencies: [] };
  metadata.requirements = { added: [], modified: [{ id: 'MOD-001-REQ-001', module: 'MOD-001' }], removed: [] };
  for (const stage of ['design', 'plan'] as const) metadata.approvals[stage] = {
    status: 'approved', revision: 1, content_hash: 'a'.repeat(64), approved_at: '2026-09-01T00:00:00.000Z',
  };
  for (const gate of Object.values(metadata.gates)) gate.satisfied = true;
  metadata.verification = { requirements_verified: true, tests_passed: true, build_passed: true, lint_passed: true, verified_at: '2026-09-01T00:00:00.000Z' };
  metadata.archive.ready = true;
  await fs.writeFile(file('metadata.yaml'), stringifyYaml(metadata));
  await fs.writeFile(file('design.md'), '# Design\nUnapproved inferred goals and scope\n');
  const fullModule = currentMarkdown.replaceAll('MOD-002', 'MOD-001').replaceAll('REQ-006', 'REQ-001').replaceAll('REQ-007', 'REQ-002');
  await fs.writeFile(file('spec.md'), fullModule);
  await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-001', 'spec.md'), fullModule);
  await fs.writeFile(file('tasks.yaml'), 'version: 1\nchangeRevision: 1\ntasks: []\n');
  await fs.writeFile(file('verification.yaml'), 'version: 1\ntestCases: []\n# stale evidence\n');
  await fs.writeFile(fixture.paths.changeIndex, stringifyYaml({ version: 1, changes: [{ id: fixture.changeId, title: metadata.change.title, mode: 'feature', status: 'VERIFY', updated_at: metadata.change.updated_at }] }));
  return { ...fixture, dir, file, metadata };
}

export async function snapshotFiles(directory: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const [key, value] of Object.entries(await snapshotFiles(target))) snapshot[path.join(entry.name, key)] = value;
    } else snapshot[entry.name] = await fs.readFile(target, 'utf8');
  }
  return snapshot;
}
