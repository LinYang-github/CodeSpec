import * as fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkflowFixture } from '../../helpers/openspec-workflow.js';
import { detectStaleChanges } from '../../../src/core/openspec-workflow/stale.js';
import { rebaseChange } from '../../../src/core/openspec-workflow/rebase.js';
import { stringify as stringifyYaml } from 'yaml';
import { captureBaseline } from '../../../src/core/openspec-workflow/baseline.js';

describe('stale changes and rebase', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  it('marks only a Requirement-overlapping Change stale after archive', async () => {
    const fixture = await createWorkflowFixture(); cleanups.push(fixture.cleanup);
    const metadata = fixture.metadataAt('VERIFY');
    metadata.requirements.modified = [{ id: 'MOD-002-REQ-006', module: 'MOD-002' }];
    const dir = path.join(fixture.paths.changes, fixture.changeId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'metadata.yaml'), stringifyYaml(metadata));
    expect(await detectStaleChanges(fixture.workspace, ['MOD-002-REQ-006'])).toEqual([fixture.changeId]);
  });

  it('increments revision and returns a stale Change to DESIGN after semantic rebase', async () => {
    const fixture = await createWorkflowFixture(); cleanups.push(fixture.cleanup);
    const metadata = fixture.metadataAt('VERIFY');
    metadata.change.revision = 1; metadata.baseline.stale = true;
    metadata.requirements.modified = [{ id: 'MOD-002-REQ-006', module: 'MOD-002' }];
    const dir = path.join(fixture.paths.changes, fixture.changeId);
    await fs.mkdir(dir, { recursive: true });
    await Promise.all(['proposal.md', 'design.md', 'spec.md', 'tasks.md', 'verification.md'].map((name) => fs.writeFile(path.join(dir, name), '# artifact\n')));
    await fs.writeFile(path.join(dir, 'metadata.yaml'), stringifyYaml(metadata));
    const result = await rebaseChange(fixture.workspace, fixture.changeId, fixture.latestSpecs);
    expect(result.change.revision).toBe(2);
    expect(result.change.status).toBe('DESIGN');
    expect(result.baseline.stale).toBe(false);
  });

  it('does not stale an unrelated active Change and captures hashes', async () => {
    const fixture = await createWorkflowFixture(); cleanups.push(fixture.cleanup);
    const metadata = fixture.metadataAt('VERIFY'); metadata.modules.confirmed = [{ module: 'MOD-002', outcome: 'OWNED', reason: 'x' }];
    metadata.requirements.modified = [{ id: 'MOD-002-REQ-006', module: 'MOD-002' }];
    await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true }); await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), '### MOD-002-REQ-006\nA');
    const baseline = await captureBaseline(fixture.workspace, metadata);
    expect(baseline.modules['MOD-002'].spec_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(baseline.modules['MOD-002'].requirements['MOD-002-REQ-006']).toMatch(/^[a-f0-9]{64}$/);
    await fs.mkdir(path.join(fixture.paths.changes, fixture.changeId), { recursive: true });
    await fs.writeFile(path.join(fixture.paths.changes, fixture.changeId, 'metadata.yaml'), stringifyYaml(metadata));
    const other = fixture.metadataAt('VERIFY'); other.change.id = 'CHG-20260901-002'; other.requirements.modified = [{ id: 'MOD-001-REQ-001', module: 'MOD-001' }];
    await fs.mkdir(path.join(fixture.paths.changes, other.change.id), { recursive: true }); await fs.writeFile(path.join(fixture.paths.changes, other.change.id, 'metadata.yaml'), stringifyYaml(other));
    expect(await detectStaleChanges(fixture.workspace, ['MOD-002-REQ-006'])).toEqual([fixture.changeId]);
  });
});
