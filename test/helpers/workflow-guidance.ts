import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { createCurrentArchiveFixture, modification, writeCanonicalChange } from './current-archive.js';
import type { ChangeStatus } from '../../src/core/codespec-workflow/types.js';

export async function createGuidanceFixture(state: ChangeStatus = 'ANALYZE') {
  const fixture = await createCurrentArchiveFixture();
  const artifacts = await writeCanonicalChange(fixture, modification());
  artifacts.metadata.change.status = state;
  const save = async () => {
    for (const key of ['metadata', 'analysis', 'tasks', 'verification'] as const) {
      await fs.writeFile(path.join(artifacts.changeDir, artifacts.metadata.artifacts[key]!.split(/[\\/]/).at(-1)!),
        key === 'metadata' ? stringify(artifacts.metadata) : artifacts[key]!);
    }
    const index = parse(await fs.readFile(fixture.paths.changeIndex, 'utf8'));
    index.changes[0].status = artifacts.metadata.change.status;
    await fs.writeFile(fixture.paths.changeIndex, stringify(index));
  };
  await save();
  return { ...fixture, artifacts, save };
}
