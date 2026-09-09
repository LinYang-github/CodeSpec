import { describe, expect, it } from 'vitest';

import {
  getCurrentChangeArtifactPaths,
  renderInitialCurrentTasks,
  renderInitialCurrentVerification,
} from '../../../src/core/codespec-workflow/current-change-layout.js';

describe('current Change artifact layout', () => {
  it('defines only the five active Change artifacts', () => {
    expect(getCurrentChangeArtifactPaths('/workspace/codespec/changes/CHG-20260907-001')).toEqual({
      metadata: '/workspace/codespec/changes/CHG-20260907-001/metadata.yaml',
      design: '/workspace/codespec/changes/CHG-20260907-001/design.md',
      spec: '/workspace/codespec/changes/CHG-20260907-001/spec.md',
      tasks: '/workspace/codespec/changes/CHG-20260907-001/tasks.yaml',
      verification: '/workspace/codespec/changes/CHG-20260907-001/verification.yaml',
    });
    expect(renderInitialCurrentTasks()).toContain('moduleRegistrations:');
    expect(renderInitialCurrentVerification()).toBe('version: 1\ntestCases: []\n');
  });
});
