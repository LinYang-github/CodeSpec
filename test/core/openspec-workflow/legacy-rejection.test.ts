import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readChangeMetadata, resolveSchemaForChange } from '../../../src/utils/change-metadata.js';

describe('canonical code-spec legacy rejection', () => {
  it('rejects a slug Change with legacy metadata and names the canonical command', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-legacy-'));
    const changeDir = path.join(root, 'openspec', 'changes', 'add-login');
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(root, 'openspec', 'config.yaml'), 'schema: code-spec\n');
    fs.writeFileSync(path.join(changeDir, '.openspec.yaml'), 'schema: spec-driven\n');

    expect(() => readChangeMetadata(changeDir, root)).toThrow(/CHG-|openspec new change/i);
  });

  it('does not resolve a canonical Change through the old spec-driven fallback', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-canonical-'));
    const changeDir = path.join(root, 'openspec', 'changes', 'CHG-20260901-001');
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, '.openspec.yaml'), 'schema: spec-driven\n');

    expect(() => resolveSchemaForChange(changeDir, undefined, root)).toThrow(/metadata\.yaml|canonical|CHG-/i);
  });
});
