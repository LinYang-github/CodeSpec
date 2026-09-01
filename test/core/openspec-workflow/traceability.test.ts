import { describe, expect, it } from 'vitest';
import { validateTraceability } from '../../../src/core/openspec-workflow/traceability.js';

describe('traceability', () => {
  it('requires equal requirement sets and task coverage', () => {
    expect(validateTraceability({
      modules: ['MOD-002'], changes: ['CHG-20260901-001'], requirements: ['MOD-002-REQ-017'],
      scenarios: ['SCN-001'], tasks: [{ id: 'SP-01', requirementIds: ['MOD-002-REQ-017'] }],
      tests: ['test/payment.test.ts'], evidence: ['RED/GREEN'], currentSpecs: ['archive/specs/MOD-002/spec.md'], archive: ['archive/changes/CHG-20260901-001'],
      metadataRequirements: ['MOD-002-REQ-017'], designRequirements: ['MOD-002-REQ-017'], specRequirements: ['MOD-002-REQ-017'],
    })).toMatchObject({ valid: true });
  });
});
