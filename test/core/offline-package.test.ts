import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());

describe('offline package contract', () => {
  it('exposes an offline packaging command', async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.['pack:offline']).toBe('node scripts/pack-offline.mjs');
  });

  it('keeps the offline package allowlist and removes build lifecycle scripts', async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as {
      files?: string[];
    };
    const source = await fs.readFile(path.join(root, 'scripts/pack-offline.mjs'), 'utf8');

    expect(pkg.files).toContain('!**/.DS_Store');
    expect(pkg.files).toContain('!**/*.map');
    expect(source).toContain('bundleDependencies');
    expect(source).toContain('prepare');
    expect(source).toContain('prepublishOnly');
    expect(source).toContain('assertPortableTree');
    expect(source).toContain('FORBIDDEN_NAMES');
  });

  it('exposes offline verification and uses npm offline flags', async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const source = await fs.readFile(path.join(root, 'scripts/verify-offline-package.mjs'), 'utf8');

    expect(pkg.scripts?.['verify:offline']).toBe('node scripts/verify-offline-package.mjs');
    expect(source).toContain('--offline');
    expect(source).toContain('--no-audit');
    expect(source).toContain('--no-fund');
    expect(source).toContain('codespec --version');
  });

  it('makes the release version guard consume the bundled offline artifact', async () => {
    const source = await fs.readFile(path.join(root, 'scripts/pack-version-check.mjs'), 'utf8');

    expect(source).toContain('scripts/pack-offline.mjs');
    expect(source).toContain("'--offline'");
  });

  it('ships platform installers with the same offline npm contract', async () => {
    const powershell = await fs.readFile(path.join(root, 'scripts/install-codespec.ps1'), 'utf8');
    const posix = await fs.readFile(path.join(root, 'scripts/install-codespec.sh'), 'utf8');

    for (const source of [powershell, posix]) {
      expect(source).toContain('--offline');
      expect(source).toContain('--no-audit');
      expect(source).toContain('--no-fund');
      expect(source).toContain('20.19.0');
    }
  });

  it('defines a shared-tgz offline verification matrix', async () => {
    const workflow = await fs.readFile(path.join(root, '.github/workflows/offline-package.yml'), 'utf8');

    expect(workflow).toContain('ubuntu-latest');
    expect(workflow).toContain('macos-latest');
    expect(workflow).toContain('windows-latest');
    expect(workflow).toContain('--offline');
    expect(workflow).toContain('upload-artifact');
    expect(workflow).toContain('download-artifact');
  });
});
