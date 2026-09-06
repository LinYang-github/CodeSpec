import * as fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkflowFixture } from '../../helpers/codespec-workflow.js';
import { detectStaleChanges } from '../../../src/core/codespec-workflow/stale.js';
import { rebaseChange } from '../../../src/core/codespec-workflow/rebase.js';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { parseDeltaSpec } from '../../../src/core/codespec-workflow/delta-parser.js';
import { captureBaseline } from '../../../src/core/codespec-workflow/baseline.js';
import { createHash } from 'node:crypto';

describe('stale changes and rebase', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  it('preserves all inline design sections once and invalidates downstream gate approvals on Level 1 rebase', async () => {
    const fixture = await createWorkflowFixture(); cleanups.push(fixture.cleanup);
    const metadata = fixture.metadataAt('VERIFY');
    metadata.change.sdd_level = 1; delete metadata.artifacts.design;
    metadata.baseline.stale = true;
    metadata.modules.confirmed = [{ module: 'MOD-002', outcome: 'OWNED', reason: 'payment' }];
    metadata.requirements.added = [{ id: 'MOD-002-REQ-006', module: 'MOD-002' }];
    for (const gate of Object.values(metadata.gates)) gate.satisfied = true;
    const dir = path.join(fixture.paths.changes, fixture.changeId); await fs.mkdir(dir, { recursive: true });
    const sections = [
      '## 设计说明\nKeep the human design.\n',
      '## SDD 分级依据\nKeep the level rationale.\n',
      '## 归档影响分析\n```yaml\noutcome: none\nreferences: []\nverification: []\n```\n',
    ];
    await fs.writeFile(path.join(dir, 'metadata.yaml'), stringifyYaml(metadata));
    await Promise.all(['proposal.md', 'tasks.md', 'verification.md'].map((file) => fs.writeFile(path.join(dir, file), '# authored artifact\n')));
    await fs.writeFile(path.join(dir, 'spec.md'), sections.join('\n') +
      '\n## ADDED\n### MOD-002-REQ-006 payment\n**New**\nNew rule\n#### Scenario: SCN-001 payment\n- **GIVEN** account\n- **WHEN** paying\n- **THEN** accepted\n- **ERROR** refused\n');
    await rebaseChange(fixture.workspace, fixture.changeId);
    const spec = await fs.readFile(path.join(dir, 'spec.md'), 'utf8');
    for (const section of sections) expect(spec).toContain(section.trim());
    expect(parseDeltaSpec(spec).entries).toHaveLength(1);
    const updated = parseYaml(await fs.readFile(path.join(dir, 'metadata.yaml'), 'utf8'));
    expect(updated.gates.analyze.satisfied).toBe(true);
    for (const key of ['design', 'plan', 'implement', 'verify', 'archive']) expect(updated.gates[key].satisfied).toBe(false);
  });

  it('marks only a Requirement-overlapping Change stale after archive', async () => {
    const fixture = await createWorkflowFixture(); cleanups.push(fixture.cleanup);
    const metadata = fixture.metadataAt('VERIFY');
    metadata.modules.confirmed = [{ module: 'MOD-002', outcome: 'OWNED', reason: 'payment' }];
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
    metadata.modules.confirmed = [{ module: 'MOD-002', outcome: 'OWNED', reason: 'payment' }];
    metadata.requirements.modified = [{ id: 'MOD-002-REQ-006', module: 'MOD-002' }];
    const dir = path.join(fixture.paths.changes, fixture.changeId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'proposal.md'), '# Proposal\nsummary goals scope\n');
    await fs.writeFile(path.join(dir, 'design.md'), '# Design\nMOD-002-REQ-006\n');
    await fs.writeFile(path.join(dir, 'tasks.md'), '# Tasks\n- [x] SP-01 MOD-002-REQ-006 SCN-002 test\n');
    await fs.writeFile(path.join(dir, 'verification.md'), '# Verification\n');
    await fs.writeFile(path.join(dir, 'spec.md'), '## MODIFIED\n### MOD-002-REQ-006 payment\n**Previous**\nOld\n#### Scenario: SCN-001 old\n- **GIVEN** old\n- **WHEN** pay\n- **THEN** old\n- **ERROR** old-error\n**New**\nNew\n#### Scenario: SCN-002 new\n- **GIVEN** new\n- **WHEN** pay\n- **THEN** new\n- **ERROR** new-error-one\n- **ERROR** new-error-two\n**Reason**\nchange\n');
    await fs.writeFile(path.join(dir, 'metadata.yaml'), stringifyYaml(metadata));
    await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
    await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), '### MOD-002-REQ-006 payment\nOld\n');
    await fs.mkdir(`${fixture.paths.changeIndex}.lock`);
    await expect(rebaseChange(fixture.workspace, fixture.changeId, fixture.latestSpecs)).rejects.toThrow(/Change 索引正忙/);
    await fs.rm(`${fixture.paths.changeIndex}.lock`, { recursive: true, force: true });
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

  it('writes merged content and hashes that authored content', async () => {
    const fixture = await createWorkflowFixture(); cleanups.push(fixture.cleanup);
    const metadata = fixture.metadataAt('VERIFY'); metadata.baseline.stale = true;
    metadata.modules.confirmed = [{ module: 'MOD-002', outcome: 'OWNED', reason: 'x' }];
    metadata.requirements.modified = [{ id: 'MOD-002-REQ-006', module: 'MOD-002' }];
    const dir = path.join(fixture.paths.changes, fixture.changeId); await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'metadata.yaml'), stringifyYaml(metadata));
    await Promise.all(['proposal.md', 'design.md', 'tasks.md', 'verification.md'].map((name) => fs.writeFile(path.join(dir, name), '# artifact\n')));
    await fs.writeFile(path.join(dir, 'spec.md'), '## MODIFIED\n### MOD-002-REQ-006 payment\n**Previous**\nOld\n#### Scenario: SCN-001 old\n- **GIVEN** old\n- **WHEN** pay\n- **THEN** old\n- **ERROR** old-error\n**New**\nNew\n#### Scenario: SCN-002 new\n- **GIVEN** new\n- **WHEN** pay\n- **THEN** new\n- **ERROR** new-error-one\n- **ERROR** new-error-two\n**Reason**\nchange\n');
    await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
    await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), '### MOD-002-REQ-006\nCurrent\n');
    const result = await rebaseChange(fixture.workspace, fixture.changeId, ['### MOD-002-REQ-006\nMerged\n']);
    const merged = await fs.readFile(path.join(dir, 'spec.md'), 'utf8');
    expect(merged).toContain('Merged');
    expect(merged).toMatch(/- \*\*ERROR\*\* new-error-one\n- \*\*ERROR\*\* new-error-two/);
    expect(result.baseline.modules['MOD-002'].spec_hash).toBe(createHash('sha256').update('### MOD-002-REQ-006\nMerged\n').digest('hex'));
    expect(result.baseline.modules['MOD-002'].requirements['MOD-002-REQ-006']).toBe(createHash('sha256').update('### MOD-002-REQ-006\nMerged').digest('hex'));
  });
});
