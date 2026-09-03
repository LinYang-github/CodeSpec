import { describe, expect, it } from 'vitest';
import {
  getRebaseChangeSkillTemplate,
  getOpsxRebaseCommandTemplate,
} from '../../../src/core/templates/skill-templates.js';

describe('openspec-rebase-change template', () => {
  it('routes only stale and baseline recovery through Core rebase', () => {
    const instructions = getRebaseChangeSkillTemplate().instructions;
    expect(instructions).toContain('openspec rebase --change');
    expect(instructions).toContain('STALE');
    expect(instructions).toContain('openspec-workflow');
    expect(instructions).not.toContain('openspec-sync-specs');
    expect(instructions).toContain('不写 Current Specification');
  });

  it('provides a command with the same rebase contract', () => {
    const command = getOpsxRebaseCommandTemplate();
    expect(command.description).toContain('STALE');
    expect(command.content).toContain('openspec rebase --change');
  });
});
