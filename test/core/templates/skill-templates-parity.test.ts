import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  generateSkillContent,
  getCommandContents,
  getSkillTemplates,
} from '../../../src/core/shared/skill-generation.js';
import { STORE_SELECTION_GUIDANCE } from '../../../src/core/templates/workflows/store-selection.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const EXPECTED_GENERATED_SKILL_CONTENT_HASHES: Record<string, string> = {
  'codespec-workflow': '0ed5bf06fca7fd404504b770dee0515138c3e7ee874c8be01d7564cca67fc7ef',
  'codespec-rebase-change': '60fbb09c759e1c18f190b41027b96375a04111a6573ab4ea85fbc8914fb31f9c',
  'codespec-archive-change': '7f898c808d46ad998dc9a204eaa231aa942e03db7d707d1dcc6765c72ec62d09',
};

function stripGeneratedVersion(content: string): string {
  return content.replace(/^  generatedBy: "[^"]+"\n/m, '');
}

describe('public skill template parity', () => {
  it('pins generated content for every registered public skill', () => {
    expect(Object.keys(EXPECTED_GENERATED_SKILL_CONTENT_HASHES).sort()).toEqual(getSkillTemplates().map(({ dirName }) => dirName).sort());
    for (const { template, dirName } of getSkillTemplates()) {
      const hash = createHash('sha256').update(generateSkillContent(template, 'PARITY-BASELINE')).digest('hex');
      expect(hash, dirName).toBe(EXPECTED_GENERATED_SKILL_CONTENT_HASHES[dirName]);
    }
  });
  it('generates the clarification command and artifact contract in every public skill', () => {
    for (const { template } of getSkillTemplates()) {
      const generated = generateSkillContent(template, 'PARITY-BASELINE');
      for (const token of ['analysis.yaml', 'metadata.yaml', 'design.md', 'spec.md', 'tasks.yaml', 'verification.yaml',
        'codespec approve --change "<CHG-ID>" --stage analyze', 'Previous', 'New', 'Reason', 'MUST', 'SHOULD', 'COULD',
        'codespec rebase --change "<CHG-ID>"', 'codespec migrate --change "<CHG-ID>"']) {
        expect(generated, `${template.name}: ${token}`).toContain(token);
      }
    }
  });
  it('pins the three public template factories to the generated registry', () => {
    const templates = getSkillTemplates();
    expect(templates.map(({ dirName }) => dirName)).toEqual([
      'codespec-workflow',
      'codespec-rebase-change',
      'codespec-archive-change',
    ]);
    expect(templates.every(({ template }) => template.instructions.length > 0)).toBe(true);
  });

  it('keeps committed skills in sync with live templates', () => {
    for (const { template, dirName } of getSkillTemplates()) {
      const expected = stripGeneratedVersion(generateSkillContent(template, 'skills.sh'));
      const committedPath = join(repoRoot, 'skills', dirName, 'SKILL.md');
      const committed = stripGeneratedVersion(readFileSync(committedPath, 'utf8'));
      expect(committed, `${dirName} is stale — run pnpm generate:skills`).toBe(expected);
    }
  });

  it('commits exactly one SKILL.md for each public entry', () => {
    const skillsRoot = join(repoRoot, 'skills');
    const expectedDirs = getSkillTemplates().map(({ dirName }) => dirName).sort();
    const entries = readdirSync(skillsRoot, { withFileTypes: true });
    const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const files = entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();

    expect(dirs).toEqual(expectedDirs);
    expect(files).toEqual(['README.md']);
    for (const dir of dirs) {
      expect(readdirSync(join(skillsRoot, dir)).filter((name) => !name.startsWith('.')))
        .toEqual(['SKILL.md']);
    }
  });

  it('teaches store selection and CLI approval in every public skill and command', () => {
    for (const { template, dirName } of getSkillTemplates()) {
      const content = generateSkillContent(template, 'PARITY-BASELINE');
      expect(content, dirName).toContain(STORE_SELECTION_GUIDANCE);
      expect(content, dirName).toContain('allowed-tools: Bash(codespec:*)');
    }
    for (const command of getCommandContents()) {
      expect(command.body, command.id).toContain(STORE_SELECTION_GUIDANCE);
      expect(command.body, command.id).toContain('codespec-workflow');
    }
  });

  it('does not expose retired phase-specific entries', () => {
    const allContent = [
      ...getSkillTemplates().map(({ template }) => template.instructions),
      ...getCommandContents().map((command) => command.body),
    ].join('\n');
    expect(allContent).not.toContain('codespec-sync-specs');
    expect(allContent).not.toContain('codespec-apply-change');
    expect(allContent).not.toContain('codespec-propose');
  });
});
