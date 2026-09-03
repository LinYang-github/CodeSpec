import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../..');

describe('code-spec spec template', () => {
  it('documents error handling for every scenario', () => {
    const template = fs.readFileSync(
      path.join(repoRoot, 'schemas/code-spec/templates/spec.md'),
      'utf8',
    );
    const scenarios = template.split('#### Scenario:').slice(1);

    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios.every(scenario => scenario.includes('- **ERROR**'))).toBe(true);
  });

  it('declares ERROR as a code-spec protocol token', () => {
    const schema = fs.readFileSync(path.join(repoRoot, 'schemas/code-spec/schema.yaml'), 'utf8');

    expect(schema).toContain('GIVEN WHEN THEN ERROR');
  });
});
