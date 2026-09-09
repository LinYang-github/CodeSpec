import { describe, expect, it } from 'vitest';

import { validateCurrentArchivePreflight } from '../../../src/core/codespec-workflow/current-archive-preflight.js';

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
