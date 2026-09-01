import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readChangeMetadata, resolveSchemaForChange, writeChangeMetadata } from '../../../src/utils/change-metadata.js';
import { tryLoadCanonicalWorkspace } from '../../../src/commands/workflow/shared.js';

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

  it('never writes legacy metadata for a canonical code-spec workspace', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-write-'));
    const changeDir = path.join(root, 'openspec', 'changes', 'CHG-20260901-001');
    fs.mkdirSync(changeDir, { recursive: true });
    expect(() => writeChangeMetadata(changeDir, {} as never, root)).toThrow(/metadata\.yaml|unsupported/i);
    expect(fs.existsSync(path.join(changeDir, '.openspec.yaml'))).toBe(false);
  });

  it('accepts reordered indented canonical YAML structurally', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-indented-'));
    fs.mkdirSync(path.join(root, 'openspec', 'archive', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'openspec', 'archive', 'changes'), { recursive: true });
    fs.mkdirSync(path.join(root, 'openspec', 'changes'), { recursive: true });
    fs.writeFileSync(path.join(root, 'openspec', 'business.md'), '# Business\n\n| Module ID | Module Name | Description | Responsibilities | Keywords |\n| --- | --- | --- | --- | --- |\n| MOD-001 | Demo | Demo module | Demo work | demo |\n');
    fs.writeFileSync(path.join(root, 'openspec', 'changes', 'index.yaml'), 'version: 1\nchanges: []\n');
    fs.writeFileSync(path.join(root, 'openspec', 'config.yaml'), [
      'paths:',
      '  archived_changes: archive/changes',
      '  specs: archive/specs',
      '  archive: archive',
      '  change_index: changes/index.yaml',
      '  changes: changes',
      '  business: business.md',
      'project:',
      '  name: indented-demo',
      'schema: code-spec',
      'version: 1',
      'workflow:',
      '  multiple_active_changes: true',
      'requirements:',
      '  id_format: "{module}-REQ-{sequence:03d}"',
      'changes:',
      '  id_format: "CHG-{date}-{sequence:03d}"',
      'archive:',
      '  update_index: true',
      '  require_verification: true',
      '  conflict_strategy: optimistic',
    ].join('\n'));

    await expect(tryLoadCanonicalWorkspace(root)).resolves.toMatchObject({ config: { schema: 'code-spec' } });
  });

  it('fails explicitly for a present invalid canonical config', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-invalid-'));
    fs.mkdirSync(path.join(root, 'openspec'), { recursive: true });
    fs.writeFileSync(path.join(root, 'openspec', 'config.yaml'), 'version: 1\npaths:\n  changes: [\nschema: code-spec\n');

    await expect(tryLoadCanonicalWorkspace(root)).rejects.toThrow(/Invalid canonical code-spec workspace config/i);
  });
});
