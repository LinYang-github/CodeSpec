import { describe, expect, it } from 'vitest';
import { evaluateMinimumSddLevel } from '../../../src/core/codespec-workflow/sdd-level.js';

describe('SDD level assessment', () => {
  it('permits Level 1 only for a single-module low-risk bugfix', () => {
    expect(evaluateMinimumSddLevel({
      mode: 'bugfix',
      scope: 'single-module',
      ownedModuleCount: 1,
      affectedAreas: ['ui/theme'],
    })).toMatchObject({ minimum: 1, reasons: [] });
  });

  it('requires Level 2 for a feature even when it is contained to one module', () => {
    expect(evaluateMinimumSddLevel({
      mode: 'feature',
      scope: 'single-module',
      ownedModuleCount: 1,
      affectedAreas: [],
    })).toMatchObject({ minimum: 2 });
  });

  it('requires Level 3 when affected areas declare migration or security risk', () => {
    expect(evaluateMinimumSddLevel({
      mode: 'bugfix',
      scope: 'cross-module',
      ownedModuleCount: 2,
      affectedAreas: ['auth/security', 'data-migration'],
    })).toMatchObject({
      minimum: 3,
      reasons: expect.arrayContaining([expect.stringMatching(/security|迁移/i)]),
    });
  });
});
