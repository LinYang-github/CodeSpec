import { describe, expect, it } from 'vitest';
import { validateTraceability } from '../../../src/core/openspec-workflow/traceability.js';
import { allocateRequirementIds } from '../../../src/core/openspec-workflow/requirement-allocator.js';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('traceability', () => {
  it('allocates against current specs and active reservations only', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'task5-allocator-')); const currentSpecs = path.join(root, 'specs'); const changes = path.join(root, 'changes');
    await fs.mkdir(currentSpecs, { recursive: true }); await fs.mkdir(changes, { recursive: true });
    await fs.writeFile(path.join(currentSpecs, 'current.md'), 'MOD-002-REQ-016'); await fs.writeFile(path.join(changes, 'reservations.txt'), 'MOD-002-REQ-017');
    await fs.writeFile(path.join(root, 'archive.md'), 'MOD-002-REQ-018'); await fs.writeFile(path.join(changes, 'notes.md'), 'MOD-002-REQ-019');
    await expect(allocateRequirementIds({ paths: { currentSpecs, changes } }, 'MOD-002', 1)).resolves.toEqual(['MOD-002-REQ-018']);
    await fs.rm(root, { recursive: true, force: true });
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
