#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const runTsc = (args = []) => {
  const tscPath = require.resolve('typescript/bin/tsc');
  execFileSync(process.execPath, [tscPath, ...args], { stdio: 'inherit' });
};

console.log('🔨 Building CodeSpec...\n');

// Clean dist directory
if (existsSync('dist')) {
  console.log('Cleaning dist directory...');
  rmSync('dist', {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

// Run TypeScript compiler (use local version explicitly)
console.log('Compiling TypeScript...');
try {
  runTsc(['--version']);
  runTsc();
  mkdirSync('dist/ui/web/vendor', { recursive: true });
  cpSync('src/ui/web', 'dist/ui/web', { recursive: true });
  cpSync('node_modules/markdown-it/dist/markdown-it.min.js', 'dist/ui/web/vendor/markdown-it.min.js');
  console.log('\n✅ Build completed successfully!');
} catch (error) {
  console.error('\n❌ Build failed!');
  process.exit(1);
}
