import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  generateSkillContent,
  getCommandContents,
  getSkillTemplates,
} from '../../../src/core/shared/skill-generation.js';
import { STORE_SELECTION_GUIDANCE } from '../../../src/core/templates/workflows/store-selection.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function stripGeneratedVersion(content: string): string {
  return content.replace(/^  generatedBy: "[^"]+"\n/m, '');
}

describe('public skill template parity', () => {
  it('pins the three public template factories to the generated registry', () => {
    const templates = getSkillTemplates();
    expect(templates.map(({ dirName }) => dirName)).toEqual([
      'openspec-workflow',
      'openspec-rebase-change',
      'openspec-archive-change',
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
      expect(content, dirName).toContain('allowed-tools: Bash(openspec:*)');
    }
    for (const command of getCommandContents()) {
      expect(command.body, command.id).toContain(STORE_SELECTION_GUIDANCE);
      expect(command.body, command.id).toContain('openspec-workflow');
    }
  });

  it('does not expose retired phase-specific entries', () => {
    const allContent = [
      ...getSkillTemplates().map(({ template }) => template.instructions),
      ...getCommandContents().map((command) => command.body),
    ].join('\n');
    expect(allContent).not.toContain('openspec-sync-specs');
    expect(allContent).not.toContain('openspec-apply-change');
    expect(allContent).not.toContain('openspec-propose');
  });
});
