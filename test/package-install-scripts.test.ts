import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The published package must ship no npm lifecycle install scripts. Any of these
 * makes `npm install` warn about unapproved install scripts, which reads as a
 * packaging problem to users. The shell-completions tip that used to live in a
 * postinstall script now prints on the CLI's first run instead.
 */
describe('published package install scripts', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8')
  ) as { name?: string; version?: string; bin?: Record<string, string>; scripts?: Record<string, string> };

  it('publishes the CodeSpec 1.0 package and only codespec binary', () => {
    expect(packageJson.name).toBe('@hrhy-ai/codespec');
    expect(packageJson.version).toBe('1.0.0');
    expect(packageJson.bin).toEqual({ codespec: './bin/codespec.js' });
    expect(packageJson.scripts?.typecheck).toBe('tsc --noEmit');
  });

  it.each(['preinstall', 'install', 'postinstall'])(
    'declares no "%s" script',
    (lifecycle) => {
      expect(packageJson.scripts?.[lifecycle]).toBeUndefined();
    }
  );
});
