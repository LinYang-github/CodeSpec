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

async function assertCanonicalArtifactPath(
  changeDir: string,
  openspecDir: string,
  declared: string,
  label: string,
  filename: string
): Promise<string> {
  const expected = path.relative(openspecDir, path.join(changeDir, filename));
  if (path.normalize(declared) !== path.normalize(expected)) {
    throw new Error(`${label} must equal the canonical path for the selected Change`);
  }
  const resolved = resolveWorkspaceRelativePath(openspecDir, declared, label);
  const changeReal = await fs.realpath(changeDir);
  const fileReal = await fs.realpath(resolved).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return resolved;
    throw error;
  });
  const relative = path.relative(changeReal, fileReal);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must remain inside the selected Change (possible symlink or containment violation)`);
  }
  const stat = await fs.lstat(resolved);
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symlink`);
  return resolved;
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
  if (!/^CHG-\d{8}-\d{3}$/.test(changeId)) {
    throw new Error('Change ID 必须匹配 CHG-YYYYMMDD-NNN');
  }
  const changeDir = path.join(paths.changes, changeId);
  const changeStat = await fs.lstat(changeDir);
  if (changeStat.isSymbolicLink()) throw new Error(`Change directory must not be a symlink: ${changeId}`);
  const metadata = await readChangeMetadata(changeDir);
  if (metadata.change.id !== changeId) {
    throw new Error(`Change directory ${changeId} does not match metadata change.id ${metadata.change.id}`);
  }

  await assertCanonicalArtifactPath(changeDir, paths.openspecDir, metadata.artifacts.metadata, 'metadata artifact path', 'metadata.yaml');
  const proposalPath = await assertCanonicalArtifactPath(changeDir, paths.openspecDir, metadata.artifacts.proposal, 'proposal artifact path', 'proposal.md');
  const designPath = await assertCanonicalArtifactPath(changeDir, paths.openspecDir, metadata.artifacts.design, 'design artifact path', 'design.md');
  const specPath = await assertCanonicalArtifactPath(changeDir, paths.openspecDir, metadata.artifacts.spec, 'spec artifact path', 'spec.md');
  const tasksPath = await assertCanonicalArtifactPath(changeDir, paths.openspecDir, metadata.artifacts.tasks, 'tasks artifact path', 'tasks.md');
  const verificationPath = await assertCanonicalArtifactPath(changeDir, paths.openspecDir, metadata.artifacts.verification, 'verification artifact path', 'verification.md');

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
