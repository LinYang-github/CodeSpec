import { describe, expect, it } from 'vitest';

import { validateCurrentArchivePreflight } from '../../../src/core/codespec-workflow/current-archive-preflight.js';
import { validateCurrentSpecDeltaAgainstCurrent } from '../../../src/core/codespec-workflow/current-spec-delta.js';
import { applyCurrentSpecDelta } from '../../../src/core/codespec-workflow/current-archive-merge.js';
import { currentSpecification, modification, requirement } from '../../helpers/current-archive.js';

describe('rich delta conflicts against live Current', () => {
  it.each([
    ['ADDED existing Requirement', 'MOD-002-REQ-001', (delta: ReturnType<typeof modification>) => { delta.requirements[0] = { ...delta.requirements[0], action: 'ADDED', previous: undefined }; }],
    ['MODIFIED missing Requirement', 'MOD-002-REQ-003', (delta: ReturnType<typeof modification>) => { delta.requirements[0] = { ...delta.requirements[0], id: 'MOD-002-REQ-003', previous: requirement('MOD-002-REQ-003'), next: requirement('MOD-002-REQ-003', ['C']) }; }],
    ['REMOVED missing Requirement', 'MOD-002-REQ-003', (delta: ReturnType<typeof modification>) => { delta.requirements[0] = { ...delta.requirements[0], action: 'REMOVED', id: 'MOD-002-REQ-003', previous: requirement('MOD-002-REQ-003'), next: undefined }; }],
    ['stale Previous', 'MOD-002-REQ-001', (delta: ReturnType<typeof modification>) => { delta.requirements[0].previous = requirement('MOD-002-REQ-001', ['X']); }],
    ['no-op MODIFIED', 'MOD-002-REQ-001', (delta: ReturnType<typeof modification>) => { delta.requirements[0].next = delta.requirements[0].previous; }],
    ['changed New ID', 'MOD-002-REQ-001', (delta: ReturnType<typeof modification>) => { delta.requirements[0].next = requirement('MOD-002-REQ-003', ['C']); }],
    ['ADDED existing file', 'src/one.ts', (delta: ReturnType<typeof modification>) => { delta.engineeringFiles[0].change = '新增'; }],
    ['MODIFIED missing file', 'src/missing.ts', (delta: ReturnType<typeof modification>) => { delta.engineeringFiles[0].path = 'src/missing.ts'; }],
    ['REMOVED missing file', 'src/missing.ts', (delta: ReturnType<typeof modification>) => { delta.engineeringFiles[0].path = 'src/missing.ts'; delta.engineeringFiles[0].change = '删除'; }],
  ])('rejects %s before mutation', (_label, id, mutate) => {
    const current = currentSpecification();
    const before = structuredClone(current);
    const delta = modification();
    mutate(delta);
    const errors = validateCurrentSpecDeltaAgainstCurrent(current, delta);
    expect(errors.some((error) => error.startsWith('ARCHIVE CONFLICT') && error.includes(id))).toBe(true);
    expect(() => applyCurrentSpecDelta(current, delta)).toThrow(/ARCHIVE CONFLICT/);
    expect(current).toEqual(before);
  });
});

describe('current archive preflight', () => {
  it('rejects a current Change until task approval, task completion, and successful verification all exist', () => {
    expect(validateCurrentArchivePreflight({
      planApproved: false,
      taskStatuses: ['DONE'],
      verificationErrors: [],
    })).toContainEqual(expect.stringMatching(/approval/i));
    expect(validateCurrentArchivePreflight({
      designApproved: true,
      planApproved: true,
      taskStatuses: ['DONE'],
      verificationErrors: [],
    })).toEqual([]);
    expect(validateCurrentArchivePreflight({
      designApproved: false,
      planApproved: true,
      taskStatuses: ['DONE'],
      verificationErrors: [],
    })).toContainEqual(expect.stringMatching(/Design approval/i));
  });
});
