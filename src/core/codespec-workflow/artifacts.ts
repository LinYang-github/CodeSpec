import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { parseAnalysisDocument } from './analysis.js';
import { parseChangeMetadata } from './schemas.js';
import type { ChangeMetadata } from './types.js';
import type { WorkspacePaths } from './paths.js';

export interface ChangeArtifacts {
  changeId: string;
  changeDir: string;
  metadata: ChangeMetadata;
  analysis: string;
  design: string;
  spec: string;
  tasks: string;
  verification: string;
}

function resolveWorkspaceRelativePath(
  codespecDir: string,
  relativePath: string,
  label: string
): string {
  if (path.isAbsolute(relativePath) || relativePath.includes('\0')) {
    throw new Error(`${label} must be a safe relative path under codespec`);
  }

  const resolvedPath = path.resolve(codespecDir, relativePath);
  const relative = path.relative(codespecDir, resolvedPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must resolve under codespec`);
  }

  return resolvedPath;
}

async function assertCanonicalArtifactPath(
  changeDir: string,
  logicalChangeDir: string,
  codespecDir: string,
  declared: string,
  label: string,
  filename: string
): Promise<string> {
  const expected = path.relative(codespecDir, path.join(logicalChangeDir, filename));
  if (path.normalize(declared) !== path.normalize(expected)) {
    throw new Error(`${label} must equal the canonical path for the selected Change`);
  }
  resolveWorkspaceRelativePath(codespecDir, declared, label);
  const artifactPath = path.join(changeDir, filename);
  const changeReal = await fs.realpath(changeDir);
  const fileReal = await fs.realpath(artifactPath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return path.join(changeReal, filename);
    throw error;
  });
  const relative = path.relative(changeReal, fileReal);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must remain inside the selected Change (possible symlink or containment violation)`);
  }
  const stat = await fs.lstat(artifactPath);
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symlink`);
  return artifactPath;
}

async function findChangeDirectory(paths: WorkspacePaths, changeId: string): Promise<string> {
  const activeDir = path.join(paths.changes, changeId);
  const activeStat = await fs.lstat(activeDir).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (activeStat) {
    if (activeStat.isSymbolicLink()) throw new Error(`Change directory must not be a symlink: ${changeId}`);
    return activeDir;
  }
  throw new Error(`活动 Change 不存在：${changeId}`);
}

async function readChangeMetadata(changeDir: string): Promise<ChangeMetadata> {
  const metadataPath = path.join(changeDir, 'metadata.yaml');
  return parseChangeMetadata(parseYaml(await fs.readFile(metadataPath, 'utf8')));
}

export async function loadChangeArtifacts(
  paths: WorkspacePaths,
  changeId: string
): Promise<ChangeArtifacts> {
  if (!/^CHG-\d{8}-\d{3}$/.test(changeId)) {
    throw new Error('Change ID 必须匹配 CHG-YYYYMMDD-NNN');
  }
  const changeDir = await findChangeDirectory(paths, changeId);
  const logicalChangeDir = path.join(paths.changes, changeId);
  const metadata = await readChangeMetadata(changeDir);
  if (metadata.change.id !== changeId) {
    throw new Error(`Change directory ${changeId} does not match metadata change.id ${metadata.change.id}`);
  }

  await assertCanonicalArtifactPath(changeDir, logicalChangeDir, paths.codespecDir, metadata.artifacts.metadata, 'metadata artifact path', 'metadata.yaml');
  const analysisPath = await assertCanonicalArtifactPath(changeDir, logicalChangeDir, paths.codespecDir, metadata.artifacts.analysis, 'analysis artifact path', 'analysis.yaml');
  const designPath = await assertCanonicalArtifactPath(changeDir, logicalChangeDir, paths.codespecDir, metadata.artifacts.design, 'design artifact path', 'design.md');
  const specPath = await assertCanonicalArtifactPath(changeDir, logicalChangeDir, paths.codespecDir, metadata.artifacts.spec, 'spec artifact path', 'spec.md');
  const tasksPath = await assertCanonicalArtifactPath(changeDir, logicalChangeDir, paths.codespecDir, metadata.artifacts.tasks, 'tasks artifact path', 'tasks.yaml');
  const verificationPath = await assertCanonicalArtifactPath(changeDir, logicalChangeDir, paths.codespecDir, metadata.artifacts.verification, 'verification artifact path', 'verification.yaml');

  const [analysis, design, spec, tasks, verification] = await Promise.all([
    fs.readFile(analysisPath, 'utf8'),
    fs.readFile(designPath, 'utf8'),
    fs.readFile(specPath, 'utf8'),
    fs.readFile(tasksPath, 'utf8'),
    fs.readFile(verificationPath, 'utf8'),
  ]);
  parseAnalysisDocument(parseYaml(analysis));

  return {
    changeId,
    changeDir,
    metadata,
    analysis,
    design,
    spec,
    tasks,
    verification,
  };
}
