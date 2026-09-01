import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { parseChangeMetadata } from './schemas.js';
import type { ChangeMetadata } from './types.js';
import type { WorkspacePaths } from './paths.js';

export interface ChangeArtifacts {
  changeId: string;
  changeDir: string;
  metadata: ChangeMetadata;
  proposal: string;
  design: string;
  spec: string;
  tasks: string;
  verification: string;
}

function resolveWorkspaceRelativePath(
  openspecDir: string,
  relativePath: string,
  label: string
): string {
  if (path.isAbsolute(relativePath) || relativePath.includes('\0')) {
    throw new Error(`${label} must be a safe relative path under openspec`);
  }

  const resolvedPath = path.resolve(openspecDir, relativePath);
  const relative = path.relative(openspecDir, resolvedPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must resolve under openspec`);
  }

  return resolvedPath;
}

async function readChangeMetadata(changeDir: string): Promise<ChangeMetadata> {
  const metadataPath = path.join(changeDir, 'metadata.yaml');

  try {
    return parseChangeMetadata(parseYaml(await fs.readFile(metadataPath, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const legacyMetadataPath = path.join(changeDir, '.openspec.yaml');
      try {
        await fs.access(legacyMetadataPath);
        throw new Error(
          `Legacy change metadata is unsupported for canonical code-spec loading: ${legacyMetadataPath}`
        );
      } catch (legacyError) {
        if ((legacyError as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw legacyError;
        }
      }
    }
    throw error;
  }
}

export async function loadChangeArtifacts(
  paths: WorkspacePaths,
  changeId: string
): Promise<ChangeArtifacts> {
  const changeDir = path.join(paths.changes, changeId);
  const metadata = await readChangeMetadata(changeDir);

  const proposalPath = resolveWorkspaceRelativePath(
    paths.openspecDir,
    metadata.artifacts.proposal,
    'proposal artifact path'
  );
  const designPath = resolveWorkspaceRelativePath(
    paths.openspecDir,
    metadata.artifacts.design,
    'design artifact path'
  );
  const specPath = resolveWorkspaceRelativePath(
    paths.openspecDir,
    metadata.artifacts.spec,
    'spec artifact path'
  );
  const tasksPath = resolveWorkspaceRelativePath(
    paths.openspecDir,
    metadata.artifacts.tasks,
    'tasks artifact path'
  );
  const verificationPath = resolveWorkspaceRelativePath(
    paths.openspecDir,
    metadata.artifacts.verification,
    'verification artifact path'
  );

  const [proposal, design, spec, tasks, verification] = await Promise.all([
    fs.readFile(proposalPath, 'utf8'),
    fs.readFile(designPath, 'utf8'),
    fs.readFile(specPath, 'utf8'),
    fs.readFile(tasksPath, 'utf8'),
    fs.readFile(verificationPath, 'utf8'),
  ]);

  return {
    changeId,
    changeDir,
    metadata,
    proposal,
    design,
    spec,
    tasks,
    verification,
  };
}
