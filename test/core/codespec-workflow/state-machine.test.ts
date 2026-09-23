import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';

import { loadWorkspace } from '../../../src/core/codespec-workflow/loaders.js';
import {
  canTransition,
  incrementRevision,
  transitionChange,
} from '../../../src/core/codespec-workflow/state-machine.js';
import {
  validateEntryGate,
  validateExitGate,
} from '../../../src/core/codespec-workflow/gates.js';
import { approveStage } from '../../../src/core/codespec-workflow/approvals.js';
import { validateRelations } from '../../../src/core/codespec-workflow/relations.js';
import { recordFreshVerification } from '../../../src/core/codespec-workflow/verification.js';
import { createCurrentArchiveFixture, modification, writeCanonicalChange } from '../../helpers/current-archive.js';
import { parse as parseYaml } from 'yaml';
import { createCanonicalChange } from '../../../src/core/codespec-workflow/change-manager.js';
import { loadChangeArtifacts } from '../../../src/core/codespec-workflow/artifacts.js';
import { approveChangeStage } from '../../../src/core/codespec-workflow/approvals.js';
import { renderCurrentSpecDelta } from '../../../src/core/codespec-workflow/current-spec-delta.js';

describe('canonical Requirement delta boundary at DESIGN and later gates', () => {
  it('takes the shipped Level 1 inline design template through DESIGN approval into PLAN', async () => {
    const f = await createCurrentArchiveFixture();
    try {
      const workspace = await loadWorkspace(f.codespecDir);
      const created = await createCanonicalChange(workspace, { title: 'Small fix', summary: 'Clarify one behavior', mode: 'bugfix', sddLevel: 1 });
      const template = await fs.readFile(path.join(created.changeDir, 'spec.md'), 'utf8');
      const analysis = {
        version: 1, change: created.changeId, revision: 1, problem: 'Fix one behavior', goals: [{ id: 'GOAL-001', statement: 'Reliable behavior' }], nonGoals: [], scope: { in: ['one behavior'], out: ['other modules'] }, actors: ['user'], constraints: [], assumptions: [], openQuestions: [],
        modules: [{ module: 'MOD-002', outcome: 'OWNED', reason: 'Owns behavior' }], requirements: [{ id: 'MOD-002-REQ-001', action: 'MODIFIED', reason: 'Fix behavior' }], acceptanceCriteria: [{ id: 'AC-001', statement: 'Behavior works', priority: 'MUST', requirements: ['MOD-002-REQ-001'] }],
      };
      await fs.writeFile(path.join(created.changeDir, 'analysis.yaml'), stringifyYaml(analysis));
      await approveChangeStage(workspace, await loadChangeArtifacts(f.paths, created.changeId), 'analyze');
      await transitionChange(workspace, await loadChangeArtifacts(f.paths, created.changeId), 'DESIGN', 'analyze approved');
      const delta = renderCurrentSpecDelta(modification());
      const inline = template.replace(/^# Spec\s*/u, '').replace('<!-- 说明本次小范围修复的实现思路。 -->', '仅修复 MOD-002-REQ-001，不修改其他需求。');
      await fs.writeFile(path.join(created.changeDir, 'spec.md'), delta.replace('## 工程文件增量', `${inline.trim()}\n\n## 工程文件增量`));
      const designPath = path.join(created.changeDir, 'design.md');
      await fs.writeFile(designPath, (await fs.readFile(designPath, 'utf8')).replace('# Design', '# Design\n\nMOD-002-REQ-001'));
      const approved = await approveChangeStage(workspace, await loadChangeArtifacts(f.paths, created.changeId), 'design');
      expect(approved.approvals.design.status).toBe('approved');
      expect((await transitionChange(workspace, await loadChangeArtifacts(f.paths, created.changeId), 'PLAN', 'design approved')).change.status).toBe('PLAN');
    } finally { f.cleanup(); }
  });

  it.each(['DESIGN', 'PLAN', 'IMPLEMENT', 'VERIFY', 'ARCHIVE'] as const)('rejects stale Previous at %s', async (state) => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const delta = modification();
      delta.requirements[0].previous!.title = 'stale';
      const artifacts = await writeCanonicalChange(fixture, delta);
      const gate = await validateExitGate(await loadWorkspace(fixture.codespecDir), artifacts, state);
      expect(gate.errors).toContainEqual(expect.stringMatching(/ARCHIVE CONFLICT.*MOD-002-REQ-001/));
    } finally { fixture.cleanup(); }
  });

  it('accepts additive rich changes with matching analysis/metadata and acceptance criteria', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const artifacts = await writeCanonicalChange(fixture, modification());
      expect(await validateExitGate(await loadWorkspace(fixture.codespecDir), artifacts, 'DESIGN')).toMatchObject({ ok: true, errors: [] });
    } finally { fixture.cleanup(); }
  });

  it.each(['analysis', 'metadata', 'acceptanceCriteria'])('rejects an orphan Requirement in %s', async (owner) => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const artifacts = await writeCanonicalChange(fixture, modification());
      if (owner === 'metadata') artifacts.metadata.requirements.modified.push({ id: 'MOD-002-REQ-002', module: 'MOD-002' });
      else {
        const analysis = parseYaml(artifacts.analysis!);
        if (owner === 'analysis') analysis.requirements.push({ id: 'MOD-002-REQ-002', action: 'MODIFIED', reason: 'extra' });
        else analysis.acceptanceCriteria[0].requirements = ['MOD-002-REQ-002'];
        artifacts.analysis = stringifyYaml(analysis);
      }
      const gate = await validateExitGate(await loadWorkspace(fixture.codespecDir), artifacts, 'DESIGN');
      expect(gate.ok).toBe(false);
      expect(gate.errors.join('\n')).toMatch(/analysis|metadata|AC-001/);
    } finally { fixture.cleanup(); }
  });
});

describe('current workflow state machine', () => {
  it('allows implementation retry but has no ordinary archive transition', () => {
    expect(canTransition('VERIFY', 'IMPLEMENT')).toBe(true);
    expect(canTransition('ARCHIVE', 'ARCHIVED' as never)).toBe(false);
  });

  it('increments a revision without mutating the source metadata', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const artifacts = await writeCanonicalChange(fixture, modification());
      const revised = incrementRevision(artifacts.metadata);
      expect(revised.change.revision).toBe(2);
      expect(artifacts.metadata.change.revision).toBe(1);
    } finally {
      fixture.cleanup();
    }
  });

  it('requires rebase before any stale Change transition except abandonment', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const artifacts = await writeCanonicalChange(fixture, modification());
      artifacts.metadata.change.status = 'ANALYZE';
      artifacts.metadata.baseline.stale = true;
      await fs.writeFile(path.join(artifacts.changeDir, 'metadata.yaml'), stringifyYaml(artifacts.metadata));

      await expect(transitionChange(
        await loadWorkspace(fixture.codespecDir),
        artifacts,
        'DESIGN',
        'analysis approved',
      )).rejects.toThrow(/rebase/i);
    } finally {
      fixture.cleanup();
    }
  });
});
