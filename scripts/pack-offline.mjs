#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFile = promisify(execFileCallback);
const RUNTIME_FILES = ['dist', 'bin', 'schemas', 'LICENSE', 'README.md'];
const FORBIDDEN_NAMES = new Set(['.DS_Store']);
const FORBIDDEN_SUFFIXES = ['.map', '.test.js', '.test.ts'];
const FORBIDDEN_DIRECTORIES = new Set(['.bin', 'test', 'tests', '__tests__']);

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function parseArgs(argv) {
  const outputIndex = argv.indexOf('--output');
  if (outputIndex === -1) return { outputDir: process.cwd() };
  const outputDir = argv[outputIndex + 1];
  if (!outputDir || outputDir.startsWith('--')) throw new Error('--output 需要指定目录');
  return { outputDir: path.resolve(outputDir) };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function shouldCopy(sourcePath) {
  const name = path.basename(sourcePath);
  return !FORBIDDEN_NAMES.has(name) && !FORBIDDEN_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

async function copyRuntimeFiles(projectRoot, stagingRoot) {
  for (const relativePath of RUNTIME_FILES) {
    const source = path.join(projectRoot, relativePath);
    try {
      await fs.access(source);
    } catch {
      if (relativePath === 'README.md') continue;
      throw new Error(`缺少发布文件：${relativePath}`);
    }
    await fs.cp(source, path.join(stagingRoot, relativePath), {
      recursive: true,
      filter: shouldCopy,
    });
  }
}

function createStagingManifest(sourcePackage) {
  const {
    name,
    version,
    description,
    keywords,
    license,
    author,
    type,
    exports,
    bin,
    engines,
    dependencies = {},
  } = sourcePackage;
  // prepare and prepublishOnly are deliberately omitted so the target machine
  // never needs pnpm or a build tool during npm install.
  return {
    name,
    version,
    description,
    keywords,
    license,
    author,
    type,
    exports,
    bin,
    engines,
    files: ['dist', 'bin', 'schemas', 'LICENSE', 'README.md'],
    dependencies,
    bundleDependencies: true,
  };
}

async function assertPortableTree(root) {
  const violations = [];
  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        violations.push(`${entryPath}（符号链接）`);
        continue;
      }
      if (FORBIDDEN_NAMES.has(entry.name) || FORBIDDEN_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
        violations.push(`${entryPath}（禁止文件）`);
        continue;
      }
      if (entry.isDirectory()) await visit(entryPath);
    }
  }
  await visit(root);
  if (violations.length) throw new Error(`发布目录包含不可移植内容：\n${violations.join('\n')}`);
}

async function pruneNonRuntimeEntries(root) {
  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isSymbolicLink() || FORBIDDEN_NAMES.has(entry.name)
        || FORBIDDEN_DIRECTORIES.has(entry.name)
        || FORBIDDEN_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
        await fs.rm(entryPath, { recursive: true, force: true });
        continue;
      }
      if (entry.isDirectory()) await visit(entryPath);
    }
  }
  await visit(root);
}

async function runNpm(cwd, args) {
  try {
    return await execFile(npmCommand(), args, {
      cwd,
      env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false', npm_config_progress: 'false' },
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const detail = [error.stdout, error.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`npm ${args.join(' ')} 执行失败${detail ? `：\n${detail}` : ''}`, { cause: error });
  }
}

async function packStaging(stagingRoot, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  const result = await runNpm(stagingRoot, ['pack', '--json', '--silent', '--pack-destination', outputDir]);
  let metadata;
  try {
    const parsed = JSON.parse(result.stdout);
    metadata = Array.isArray(parsed) ? parsed.at(-1) : parsed;
  } catch {
    metadata = null;
  }
  const filename = metadata?.filename;
  if (!filename) throw new Error(`npm pack 未返回 tgz 文件名：${result.stdout}`);
  return path.join(outputDir, filename);
}

async function verifyTarballContents(tarballPath, dependencies) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-offline-tarball-'));
  try {
    await runNpm(temp, ['install', '--prefix', temp, tarballPath, '--offline', '--ignore-scripts', '--no-audit', '--no-fund']);
    const manifestPath = path.join(temp, 'node_modules', '@hrhy-ai', 'codespec', 'package.json');
    const manifest = await readJson(manifestPath);
    if (manifest.bundleDependencies !== true) throw new Error('tgz manifest 未启用 bundleDependencies');
    const packageRoot = path.dirname(manifestPath);
    for (const dependency of dependencies) {
      await fs.access(path.join(packageRoot, 'node_modules', dependency)).catch(() => {
        throw new Error(`tgz 缺少 production dependency：${dependency}`);
      });
    }
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

export async function packOffline({ projectRoot = process.cwd(), outputDir = projectRoot } = {}) {
  const sourcePackage = await readJson(path.join(projectRoot, 'package.json'));
  const stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-offline-'));
  try {
    await copyRuntimeFiles(projectRoot, stagingRoot);
    const manifest = createStagingManifest(sourcePackage);
    await writeJson(path.join(stagingRoot, 'package.json'), manifest);
    await runNpm(stagingRoot, ['install', '--omit=dev', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund']);
    const dependenciesRoot = path.join(stagingRoot, 'node_modules');
    await pruneNonRuntimeEntries(dependenciesRoot);
    await assertPortableTree(dependenciesRoot);
    const tarballPath = await packStaging(stagingRoot, outputDir);
    await verifyTarballContents(tarballPath, Object.keys(manifest.dependencies));
    return { tarballPath, packageName: manifest.name, version: manifest.version };
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
}

async function main() {
  const { outputDir } = parseArgs(process.argv.slice(2));
  const result = await packOffline({ outputDir });
  console.log(`离线包已生成：${result.tarballPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`离线打包失败：${error.message}`);
    process.exitCode = 1;
  });
}
