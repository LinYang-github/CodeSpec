import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isLegacyCodexSkillEquivalentToCurrent } from '../../../src/core/shared/skill-content-equivalence.js';
import { generateSkillContent, getSkillTemplates } from '../../../src/core/shared/skill-generation.js';
import { transformToSkillReferences } from '../../../src/utils/command-references.js';

describe('legacy Codex skill equivalence', () => {
  it('matches every committed skill to its canonical source-generated content', async () => {
    const root = path.resolve(process.cwd());
    for (const { dirName, template } of getSkillTemplates()) {
      const committed = await readFile(path.join(root, 'skills', dirName, 'SKILL.md'), 'utf8');
      const generated = generateSkillContent(template, 'PARITY-BASELINE', transformToSkillReferences);
      expect(committed.replace(/\n  generatedBy: "[^"]+"/, ''), dirName).toBe(generated.replace(/\n  generatedBy: "[^"]+"/, ''));
    }
  });

  it('accepts generated version, BOM, CRLF, and known dual-reference differences', () => {
    const legacy =
      '\uFEFF---\r\nmetadata:\r\n  generatedBy: "0.1.0"\r\n---\r\nUse $openspec-apply-change.\r\n';
    const current =
      '---\nmetadata:\n  generatedBy: "1.7.0-beta.1+build.5"\n---\nUse $openspec-apply-change (Codex) or /openspec-apply-change (other agents).\n';

    expect(isLegacyCodexSkillEquivalentToCurrent(legacy, current)).toBe(true);
  });

  it('preserves custom invocation examples', () => {
    const legacy =
      '---\nmetadata:\n  generatedBy: "1.0.0"\n---\nUse $openspec-personal.\n';
    const current =
      '---\nmetadata:\n  generatedBy: "1.0.0"\n---\nUse $openspec-personal (Codex) or /openspec-personal (other agents).\n';

    expect(isLegacyCodexSkillEquivalentToCurrent(legacy, current)).toBe(false);
  });

  it('preserves non-version generatedBy values', () => {
    const legacy = '---\nmetadata:\n  generatedBy: "custom-a"\n---\nSame body.\n';
    const current = '---\nmetadata:\n  generatedBy: "custom-b"\n---\nSame body.\n';

    expect(isLegacyCodexSkillEquivalentToCurrent(legacy, current)).toBe(false);
  });

  it.each([
    '1.0.0-preview.',
    '1.0.0+build.',
    '1.0.0-.',
    '1.0.0+.',
    '1.0.0-alpha..1',
    '01.0.0',
    '1.01.0',
    '1.0.01',
    '1.0.0-01',
  ])('preserves malformed generatedBy version %s', (version) => {
    const legacy = `---\nmetadata:\n  generatedBy: "${version}"\n---\nSame body.\n`;
    const current = '---\nmetadata:\n  generatedBy: "1.0.0"\n---\nSame body.\n';

    expect(isLegacyCodexSkillEquivalentToCurrent(legacy, current)).toBe(false);
  });

  it('preserves mismatched generatedBy quotes', () => {
    const legacy = `---\nmetadata:\n  generatedBy: "1.0.0'\n---\nSame body.\n`;
    const current = '---\nmetadata:\n  generatedBy: "1.0.0"\n---\nSame body.\n';

    expect(isLegacyCodexSkillEquivalentToCurrent(legacy, current)).toBe(false);
  });
});
