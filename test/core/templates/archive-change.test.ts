import { describe, expect, it } from 'vitest';
import {
  getArchiveChangeSkillTemplate,
  getOpsxArchiveCommandTemplate,
} from '../../../src/core/templates/skill-templates.js';

describe('openspec-archive-change template', () => {
  it('keeps Current Specification writes inside the Core archive transaction', () => {
    const instructions = getArchiveChangeSkillTemplate().instructions;
    expect(instructions).toContain('openspec archive --change');
    expect(instructions).toContain('preflightArchive()');
    expect(instructions).toContain('prepareArchive()');
    expect(instructions).toContain('commitArchive()');
    expect(instructions).toContain('Current Specification');
    expect(instructions).not.toContain('openspec-sync-specs');
    expect(instructions).not.toContain('同步 Spec workflow');
  });

  it('uses the same archive-only contract for the command surface', () => {
    const command = getOpsxArchiveCommandTemplate();
    expect(command.content).toContain('archiveTransaction()');
    expect(command.content).not.toContain('openspec-sync-specs');
  });
});
