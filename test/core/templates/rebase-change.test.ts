import { describe, expect, it } from 'vitest';
import {
  getRebaseChangeSkillTemplate,
  getCodespecRebaseCommandTemplate,
} from '../../../src/core/templates/skill-templates.js';

describe('codespec-rebase-change template', () => {
  it('routes only stale and baseline recovery through Core rebase', () => {
    const instructions = getRebaseChangeSkillTemplate().instructions;
    expect(instructions).toContain('codespec rebase --change');
    expect(instructions).toContain('STALE');
    expect(instructions).toContain('codespec-workflow');
    expect(instructions).not.toContain('codespec-sync-specs');
    expect(instructions).toContain('不写 Current Specification');
  });

  it('provides a command with the same rebase contract', () => {
    const command = getCodespecRebaseCommandTemplate();
    expect(command.description).toContain('STALE');
    expect(command.content).toContain('codespec rebase --change');
  });
});
