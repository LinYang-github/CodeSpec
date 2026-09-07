#!/usr/bin/env node
// Guard: Ensure the packed tarball's CLI `--version` matches package.json.
//
// The release guard uses the same dependency-bundled packer as the offline
// artifact, then installs that exact tgz with npm offline before checking the
// CLI version.

import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

function log(msg) {
  if (process.env.CI) return; // keep CI logs quiet by default
  console.log(msg);
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function main() {
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
  const expected = pkg.version;

  let work;
  let tgzPath;

  try {
    work = mkdtempSync(path.join(tmpdir(), 'codespec-pack-check-'));
    log(`Temp dir: ${work}`);

    log(`Packing offline @hrhy-ai/codespec@${expected}...`);
    const artifactDir = path.join(work, 'artifact');
    const packOutput = run(process.execPath, [
      path.join(process.cwd(), 'scripts/pack-offline.mjs'),
      '--output',
      artifactDir,
    ], { cwd: process.cwd() });
    const match = packOutput.match(/离线包已生成：(.+)\s*$/mu);
    if (!match) throw new Error(`离线打包器未返回 tgz 路径：${packOutput}`);
    tgzPath = path.resolve(match[1].trim());
    log(`Created: ${tgzPath}`);

    // Make a tiny project
    writeFileSync(
      path.join(work, 'package.json'),
      JSON.stringify({ name: 'pack-check', private: true }, null, 2)
    );

    // Try to avoid noisy output and speed up
    const env = {
      ...process.env,
      npm_config_loglevel: 'silent',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_progress: 'false',
    };

    // Install the tarball
    run('npm', ['install', tgzPath, '--silent', '--offline', '--no-audit', '--no-fund'], { cwd: work, env });

    // Run the installed CLI via Node to avoid bin resolution/platform issues
    const binRel = path.join('node_modules', '@hrhy-ai', 'codespec', 'bin', 'codespec.js');
    const actual = run(process.execPath, [binRel, '--version'], { cwd: work }).trim();

    if (actual !== expected) {
      throw new Error(
        `Packed CLI version mismatch: expected ${expected}, got ${actual}. ` +
          'Ensure the dist is built and the CLI reads version from package.json.'
      );
    }

    log('Version check passed.');
  } finally {
    // Always attempt cleanup
    if (work) {
      try { rmSync(work, { recursive: true, force: true }); } catch {}
    }
    if (tgzPath) {
      try { rmSync(tgzPath, { force: true }); } catch {}
    }
  }
}

try {
  main();
  console.log('✅ pack-version-check: OK');
} catch (err) {
  console.error(`❌ pack-version-check: ${err.message}`);
  process.exit(1);
}
