import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
  recordFreshVerification,
  validateCurrentVerificationArtifacts,
} from '../../../src/core/codespec-workflow/verification.js';
import { createCurrentArchiveFixture, modification, writeCanonicalChange } from '../../helpers/current-archive.js';
import { loadChangeArtifacts } from '../../../src/core/codespec-workflow/loaders.js';

type PlannedTask = {
  verificationPlan: Array<{ testCase: string; command: string }>;
};

function plannedCommands(tasks: string) {
  return (parseYaml(tasks).tasks as PlannedTask[]).flatMap((task) => task.verificationPlan);
}

describe('current Change verification', () => {
  it('records structured evidence directly in verification.yaml', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const artifacts = await writeCanonicalChange(fixture, modification());
      const evidence = await recordFreshVerification(
        fixture.workspace,
        fixture.changeId,
        plannedCommands(artifacts.tasks),
      );

      expect(evidence.status).toBe('PASS');
      expect(evidence.trace_rows).toHaveLength(3);
      expect(evidence.trace_rows?.every((row) => row.acceptance_id === 'AC-001')).toBe(true);

      const verificationPath = path.join(artifacts.changeDir, 'verification.yaml');
      const document = parseYaml(await fs.readFile(verificationPath, 'utf8'));
      expect(document).toMatchObject({
        version: 1,
        changeRevision: 1,
        artifactIdentity: expect.stringMatching(/^[a-f0-9]{64}$/u),
      });
      expect(document.testCases).toHaveLength(3);
      await expect(fs.access(path.join(artifacts.changeDir, 'verification.md'))).rejects.toThrow();

      const updated = await loadChangeArtifacts(fixture.paths, fixture.changeId);
      await expect(validateCurrentVerificationArtifacts(fixture.workspace, updated)).resolves.toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it('invalidates evidence after an approved artifact changes', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const artifacts = await writeCanonicalChange(fixture, modification());
      await recordFreshVerification(fixture.workspace, fixture.changeId, plannedCommands(artifacts.tasks));
      const updated = await loadChangeArtifacts(fixture.paths, fixture.changeId);
      updated.design += '\n新的行为';

      expect((await validateCurrentVerificationArtifacts(fixture.workspace, updated)).join('\n'))
        .toMatch(/identity.*stale/i);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects a verification run when its command edits the Change', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      const artifacts = await writeCanonicalChange(fixture, modification());
      const tasks = parseYaml(artifacts.tasks);
      const first = tasks.tasks[0].verificationPlan[0];
      const relativeTasks = path.relative(fixture.tempDir, path.join(artifacts.changeDir, 'tasks.yaml'));
      first.command = `node -e "require('node:fs').appendFileSync('${relativeTasks}', ' ')"`;
      tasks.tasks[0].verificationPlan[0] = first;
      artifacts.tasks = stringifyYaml(tasks);
      await fs.writeFile(path.join(artifacts.changeDir, 'tasks.yaml'), artifacts.tasks);

      await expect(recordFreshVerification(
        fixture.workspace,
        fixture.changeId,
        plannedCommands(artifacts.tasks),
      )).rejects.toThrow(/验证期间 Change 产物.*变化|重新验证/i);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects missing planned commands before publishing evidence', async () => {
    const fixture = await createCurrentArchiveFixture();
    try {
      await writeCanonicalChange(fixture, modification());
      await expect(recordFreshVerification(
        fixture.workspace,
        fixture.changeId,
        [{ testCase: 'unknown-test', command: 'node -e "process.exit(0)"' }],
      )).rejects.toThrow(/缺少 .*验证命令/);
    } finally {
      fixture.cleanup();
    }
  });
});
