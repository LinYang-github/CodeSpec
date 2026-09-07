#!/usr/bin/env node

import { execFile as execFileCallback, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFile = promisify(execFileCallback);

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function run(command, args, options = {}) {
  try {
    return await execFile(command, args, {
      ...options,
      env: {
        ...process.env,
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        npm_config_progress: 'false',
        ...options.env,
      },
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const detail = [error.stdout, error.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} 执行失败${detail ? `：\n${detail}` : ''}`, { cause: error });
  }
}

async function assertNoSymlinks(root) {
  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        // npm recreates executable shims under .bin after installation. Those
        // links are generated locally and are not part of the tgz payload.
        if (path.basename(current) !== '.bin') throw new Error(`安装结果包含符号链接：${entryPath}`);
        continue;
      }
      if (entry.isDirectory()) await visit(entryPath);
    }
  }
  await visit(root);
}

async function waitForUi(child, projectRoot) {
  let output = '';
  let url;
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
    const match = output.match(/CodeSpec UI:\s+(https?:\/\/\S+)/u);
    if (match) url = match[1];
  });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  const deadline = Date.now() + 10_000;
  while (!url && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!url) throw new Error(`UI 服务未在 10 秒内启动：\n${output}`);

  const response = await fetch(new URL('/api/index', url), { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`UI smoke 请求失败：HTTP ${response.status}`);
  const body = await response.json();
  if (body.projectRoot && path.resolve(body.projectRoot) !== path.resolve(projectRoot)) {
    throw new Error(`UI 返回了错误项目路径：${body.projectRoot}`);
  }
  return url;
}

async function runUiSmoke(binPath, projectRoot) {
  const child = spawn(process.execPath, [binPath, 'ui', projectRoot], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: 'true' },
  });
  try {
    return await waitForUi(child, projectRoot);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('close', resolve));
  }
}

export async function inspectTarball(tgzPath) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-offline-inspect-'));
  try {
    await run(npmCommand(), ['install', '--prefix', root, tgzPath, '--offline', '--no-audit', '--no-fund']);
    const packageRoot = path.join(root, 'node_modules', '@hrhy-ai', 'codespec');
    const manifest = await readJson(path.join(packageRoot, 'package.json'));
    await assertNoSymlinks(packageRoot);
    return {
      manifest,
      packageRoot,
      bundledDependencies: manifest.bundleDependencies === true,
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

export async function verifyOfflineInstall(tgzPath) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-offline-verify-'));
  const prefix = path.join(root, 'prefix');
  const project = path.join(root, 'project');
  await fs.mkdir(project, { recursive: true });
  try {
    await run(npmCommand(), ['install', '--prefix', prefix, tgzPath, '--offline', '--no-audit', '--no-fund']);
    const packageRoot = path.join(prefix, 'node_modules', '@hrhy-ai', 'codespec');
    const manifest = await readJson(path.join(packageRoot, 'package.json'));
    const binPath = path.join(packageRoot, 'bin', 'codespec.js');
    // This is the programmatic equivalent of the user-facing `codespec --version` smoke check.
    const version = (await run(process.execPath, [binPath, '--version'], { cwd: project })).stdout.trim();
    if (version !== manifest.version) throw new Error(`CLI 版本不匹配：${version} != ${manifest.version}`);
    await run(process.execPath, [binPath, 'init', project, '--tools', 'none', '--no-animation', '--force'], { cwd: project });
    await runUiSmoke(binPath, project);
    return { version, initPath: path.join(project, 'codespec') };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

export async function runOfflineVerification(tgzPath) {
  const inspection = await inspectTarball(tgzPath);
  if (!inspection.bundledDependencies) throw new Error('tgz 未内置 production dependencies');
  const install = await verifyOfflineInstall(tgzPath);
  console.log(`离线验证通过：${install.version}`);
  return { inspection, install };
}

async function main() {
  const inputPath = process.argv.slice(2).find((argument) => argument !== '--' && !argument.startsWith('--'));
  if (!inputPath) throw new Error('用法：node scripts/verify-offline-package.mjs <tgz-path-or-directory>');
  const resolvedInput = path.resolve(inputPath);
  const stats = await fs.stat(resolvedInput);
  const tgzPath = stats.isDirectory()
    ? path.join(resolvedInput, (await fs.readdir(resolvedInput)).find((name) => name.endsWith('.tgz')) ?? '')
    : resolvedInput;
  if (!tgzPath || !tgzPath.endsWith('.tgz')) throw new Error(`目录中未找到 tgz：${resolvedInput}`);
  await runOfflineVerification(tgzPath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`离线验证失败：${error.message}`);
    process.exitCode = 1;
  });
}
