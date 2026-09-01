import { describe, expect, it } from 'vitest';
import { validateTraceability } from '../../../src/core/openspec-workflow/traceability.js';
import { allocateRequirementIds } from '../../../src/core/openspec-workflow/requirement-allocator.js';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  createWorkflowFixture,
  writeChangeArtifacts,
} from '../../helpers/openspec-workflow.js';

describe('traceability', () => {
  it('atomically reserves concurrent allocations in canonical Change metadata', async () => {
    const fixture = await createWorkflowFixture();
    try {
      await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
      await fs.writeFile(
        path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'),
        '### MOD-002-REQ-016 已有需求\n系统 SHALL 保留。\n'
      );
      await writeChangeArtifacts(fixture);
      const second = { ...fixture, changeId: 'CHG-20260901-002' };
      await writeChangeArtifacts(second);

      const [firstIds, secondIds] = await Promise.all([
        allocateRequirementIds(fixture.workspace, fixture.changeId, 'MOD-002', 1),
        allocateRequirementIds(fixture.workspace, second.changeId, 'MOD-002', 1),
      ]);

      expect(new Set([...firstIds, ...secondIds])).toEqual(
        new Set(['MOD-002-REQ-017', 'MOD-002-REQ-018'])
      );
      for (const changeId of [fixture.changeId, second.changeId]) {
        const metadata = parseYaml(
          await fs.readFile(path.join(fixture.paths.changes, changeId, 'metadata.yaml'), 'utf8')
        ) as { requirements: { added: Array<{ id: string }> } };
        expect(metadata.requirements.added).toHaveLength(1);
      }
      await expect(fs.access(path.join(fixture.paths.changes, 'reservations.txt'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      fixture.cleanup();
    }
  });

  it('fails closed when an active canonical reservation cannot be parsed', async () => {
    const fixture = await createWorkflowFixture();
    try {
      await writeChangeArtifacts(fixture);
      const malformed = path.join(fixture.paths.changes, 'CHG-20260901-002');
      await fs.mkdir(malformed, { recursive: true });
      await fs.writeFile(path.join(malformed, 'metadata.yaml'), 'not: canonical\n');

      await expect(
        allocateRequirementIds(fixture.workspace, fixture.changeId, 'MOD-002', 1)
      ).rejects.toThrow(/metadata|reservation|canonical/i);
    } finally {
      fixture.cleanup();
    }
  });
  it('requires equal requirement sets and task coverage', () => {
    expect(validateTraceability({
      modules: ['MOD-002'], changes: ['CHG-20260901-001'], requirements: ['MOD-002-REQ-017'],
      scenarios: ['SCN-001'], tasks: [{ id: 'SP-01', requirementIds: ['MOD-002-REQ-017'] }],
      tests: ['test/payment.test.ts'], evidence: ['RED/GREEN'], currentSpecs: ['archive/specs/MOD-002/spec.md'], archive: ['archive/changes/CHG-20260901-001'],
      metadataRequirements: ['MOD-002-REQ-017'], designRequirements: ['MOD-002-REQ-017'], specRequirements: ['MOD-002-REQ-017'],
      edges: {
        moduleToChange: [['MOD-002', 'CHG-20260901-001']], changeToRequirement: [['CHG-20260901-001', 'MOD-002-REQ-017']], requirementToScenario: [['MOD-002-REQ-017', 'SCN-001']], scenarioToTask: [['SCN-001', 'SP-01']], taskToTest: [['SP-01', 'test/payment.test.ts']], testToEvidence: [['test/payment.test.ts', 'RED/GREEN']], evidenceToCurrentSpec: [['RED/GREEN', 'archive/specs/MOD-002/spec.md']], currentSpecToArchive: [['archive/specs/MOD-002/spec.md', 'archive/changes/CHG-20260901-001']]
      },
    })).toMatchObject({ valid: true });
  });

  it('rejects disconnected edge chains', () => {
    const result = validateTraceability({ modules: ['MOD-002'], changes: ['CHG-20260901-001'], requirements: ['MOD-002-REQ-017'], scenarios: ['SCN-001'], tasks: [{ id: 'SP-01', requirementIds: ['MOD-002-REQ-017'] }], tests: ['t'], evidence: ['e'], currentSpecs: ['s'], archive: ['a'], metadataRequirements: ['MOD-002-REQ-017'], designRequirements: ['MOD-002-REQ-017'], specRequirements: ['MOD-002-REQ-017'], edges: { moduleToChange: [], changeToRequirement: [], requirementToScenario: [], scenarioToTask: [], taskToTest: [], testToEvidence: [], evidenceToCurrentSpec: [], currentSpecToArchive: [] } });
    expect(result.valid).toBe(false);
    expect(result.issues.join(' ')).toMatch(/edge|connected/i);
  });
});
