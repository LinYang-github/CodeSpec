import { describe, expect, it } from 'vitest';
import {
  getArchiveChangeSkillTemplate,
  getCodespecArchiveCommandTemplate,
} from '../../../src/core/templates/skill-templates.js';

describe('codespec-archive-change template', () => {
  it('keeps Current Specification writes inside the Core archive transaction', () => {
    const instructions = getArchiveChangeSkillTemplate().instructions;
    expect(instructions).toContain('codespec archive "<CHG-ID>"');
    expect(instructions).toContain('preflightArchive()');
    expect(instructions).toContain('prepareArchive()');
    expect(instructions).toContain('commitConfirmedArchive()');
    expect(instructions).not.toContain('commitArchive()');
    expect(instructions).toContain('Current Specification');
    expect(instructions).toContain('交互式终端');
    expect(instructions).toContain('不得替用户调用归档');
    expect(instructions).not.toContain('archive --yes');
    expect(instructions).not.toContain('codespec-sync-specs');
    expect(instructions).not.toContain('同步 Spec workflow');
    expect(instructions).not.toContain('codespec/archive/changes');
    expect(instructions).toContain('活动 Change 已删除');
    expect(instructions).toContain('不得创建 `codespec/archive/`');
  });

  it('uses the same archive-only contract for the command surface', () => {
    const command = getCodespecArchiveCommandTemplate();
    expect(command.content).toContain('commitConfirmedArchive()');
    expect(command.content).not.toContain('commitArchive()');
    expect(command.content).not.toContain('codespec-sync-specs');
  });
});
