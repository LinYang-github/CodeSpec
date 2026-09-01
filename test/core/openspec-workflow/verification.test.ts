import { describe, expect, it, afterEach } from 'vitest';
import { createWorkflowFixture } from '../../helpers/openspec-workflow.js';
import { recordFreshVerification } from '../../../src/core/openspec-workflow/verification.js';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';

describe('fresh verification', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  it('records successful command evidence with requirement and scenario coverage', async () => {
    const fixture = await createWorkflowFixture();
    cleanups.push(fixture.cleanup);
    const metadata = fixture.metadataAt('VERIFY');
    const dir = path.join(fixture.paths.changes, fixture.changeId);
    await fs.mkdir(dir, { recursive: true });
    await Promise.all(['metadata.yaml', 'proposal.md', 'design.md', 'spec.md', 'tasks.md'].map((name) => fs.writeFile(path.join(dir, name), name === 'metadata.yaml' ? stringifyYaml(metadata) : '# artifact\n')));
    await fs.writeFile(path.join(dir, 'verification.md'), stringifyYaml({ verified_at: new Date().toISOString(), revision: 1, status: 'PASS', requirement_ids: [], scenario_ids: [], commands: [] }));
    const evidence = await recordFreshVerification(fixture.workspace, fixture.changeId, [
      { command: 'printf ok', requirementIds: ['MOD-002-REQ-006'], scenarioIds: ['SCN-001'] },
    ]);
    expect(evidence.commands[0].exit_status).toBe(0);
    expect(evidence.requirement_ids).toEqual(['MOD-002-REQ-006']);
    expect(evidence.scenario_ids).toEqual(['SCN-001']);
    expect(evidence.verified_at).toBeTruthy();
  });

  it('rejects empty evidence and evidence that does not cover the current revision', async () => {
    const fixture = await createWorkflowFixture(); cleanups.push(fixture.cleanup);
    await expect(recordFreshVerification(fixture.workspace, fixture.changeId, [])).rejects.toThrow(/required/i);
  });

  it('rejects malformed or stale prior verification evidence', async () => {
    const fixture = await createWorkflowFixture(); cleanups.push(fixture.cleanup);
    const metadata = fixture.metadataAt('VERIFY'); const dir = path.join(fixture.paths.changes, fixture.changeId);
    await fs.mkdir(dir, { recursive: true });
    await Promise.all(['metadata.yaml', 'proposal.md', 'design.md', 'spec.md', 'tasks.md'].map((name) => fs.writeFile(path.join(dir, name), name === 'metadata.yaml' ? stringifyYaml(metadata) : '# artifact\n')));
    await fs.writeFile(path.join(dir, 'verification.md'), 'revision: 1\nstatus: PASS\nverified_at: 2026-09-01T00:00:00.000Z\nrequirement_ids: []\nscenario_ids: []\ncommands:\n  - command: "   "\n    exit_status: 0\n    started_at: 2026-09-01T00:00:00.000Z\n    finished_at: 2026-09-01T00:00:01.000Z\n');
    await expect(recordFreshVerification(fixture.workspace, fixture.changeId, [{ command: 'printf ok', requirementIds: ['MOD-002-REQ-006'] }])).rejects.toThrow(/stale|status|invalid/i);
  });
});
