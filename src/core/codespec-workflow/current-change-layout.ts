import path from 'node:path';

export interface CurrentChangeArtifactPaths {
  metadata: string;
  design: string;
  spec: string;
  tasks: string;
  verification: string;
}

export function getCurrentChangeArtifactPaths(changeDirectory: string): CurrentChangeArtifactPaths {
  return {
    metadata: path.join(changeDirectory, 'metadata.yaml'),
    design: path.join(changeDirectory, 'design.md'),
    spec: path.join(changeDirectory, 'spec.md'),
    tasks: path.join(changeDirectory, 'tasks.yaml'),
    verification: path.join(changeDirectory, 'verification.yaml'),
  };
}

export function renderInitialCurrentTasks(): string {
  return [
    'version: 1',
    'tasks: []',
    'moduleDeltas: []',
    'moduleRegistrations:',
    '  upsert: []',
    '  retire: []',
    '',
  ].join('\n');
}

export function renderInitialCurrentVerification(): string {
  return 'version: 1\ntestCases: []\n';
}
