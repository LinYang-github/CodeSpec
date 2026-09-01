import * as fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkflowFixture } from '../../helpers/openspec-workflow.js';
import { detectStaleChanges } from '../../../src/core/openspec-workflow/stale.js';
import { rebaseChange } from '../../../src/core/openspec-workflow/rebase.js';
import { stringify as stringifyYaml } from 'yaml';

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
});
