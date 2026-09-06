import { describe, it, expect } from 'vitest';
import {
  getSkillReferenceTransformer,
  getTransformerForTool,
  transformCommandInvocations,
  transformToSkillReferences,
} from '../../src/utils/command-references.js';
import type { CommandInvocation } from '../../src/core/command-generation/invocation.js';
import { getApplyChangeSkillTemplate } from '../../src/core/templates/workflows/apply-change.js';

const FLAT_SLASH: CommandInvocation = { style: 'flat', prefix: '/' };
const FLAT_AT: CommandInvocation = { style: 'flat', prefix: '@' };
const NAMESPACED_SLASH: CommandInvocation = { style: 'namespaced', prefix: '/' };

/** The `/codespec-<id>` case, which most flat tools use. */
const transformToHyphenCommands = (text: string): string =>
  transformCommandInvocations(text, FLAT_SLASH);

describe('transformCommandInvocations', () => {
  describe('basic transformations', () => {
    it('should transform single command reference', () => {
      expect(transformToHyphenCommands('/codespec:new')).toBe('/codespec-new');
    });

    it('should transform multiple command references', () => {
      const input = '/codespec:new and /codespec:apply';
      const expected = '/codespec-new and /codespec-apply';
      expect(transformToHyphenCommands(input)).toBe(expected);
    });

    it('should transform command reference in context', () => {
      const input = 'Use /codespec:apply to implement tasks';
      const expected = 'Use /codespec-apply to implement tasks';
      expect(transformToHyphenCommands(input)).toBe(expected);
    });

    it('should handle backtick-quoted commands', () => {
      const input = 'Run `/codespec:continue` to proceed';
      const expected = 'Run `/codespec-continue` to proceed';
      expect(transformToHyphenCommands(input)).toBe(expected);
    });
  });

  describe('edge cases', () => {
    it('should return unchanged text with no command references', () => {
      const input = 'This is plain text without commands';
      expect(transformToHyphenCommands(input)).toBe(input);
    });

    it('should return empty string unchanged', () => {
      expect(transformToHyphenCommands('')).toBe('');
    });

    it('should not transform similar but non-matching patterns', () => {
      const input = '/ops:new codespec: /other:command';
      expect(transformToHyphenCommands(input)).toBe(input);
    });

    it('should handle multiple occurrences on same line', () => {
      const input = '/codespec:new /codespec:continue /codespec:apply';
      const expected = '/codespec-new /codespec-continue /codespec-apply';
      expect(transformToHyphenCommands(input)).toBe(expected);
    });

    it('should leave unknown command references unchanged', () => {
      // Mirrors transformToSkillReferences: an invented id is left as written
      // rather than reshaped into a command that does not exist either.
      const input = 'Try /codespec:unknown-command here';
      expect(transformToHyphenCommands(input)).toBe(input);
    });

    it('should rewrite only the known id on a mixed line', () => {
      expect(transformToHyphenCommands('/codespec:apply and /codespec:bogus')).toBe(
        '/codespec-apply and /codespec:bogus'
      );
    });
  });

  describe('multiline content', () => {
    it('should transform references across multiple lines', () => {
      const input = `Use /codespec:new to start
Then /codespec:continue to proceed
Finally /codespec:apply to implement`;
      const expected = `Use /codespec-new to start
Then /codespec-continue to proceed
Finally /codespec-apply to implement`;
      expect(transformToHyphenCommands(input)).toBe(expected);
    });
  });

  describe('all known commands', () => {
    const commands = [
      'new',
      'continue',
      'apply',
      'update',
      'ff',
      'sync',
      'archive',
      'bulk-archive',
      'verify',
      'explore',
      'onboard',
    ];

    for (const cmd of commands) {
      it(`should transform /codespec:${cmd}`, () => {
        expect(transformToHyphenCommands(`/codespec:${cmd}`)).toBe(`/codespec-${cmd}`);
      });
    }
  });

  describe('non-slash prefixes', () => {
    it("spells Amazon Q's prompt library form, replacing the slash", () => {
      // The whole `/codespec:` is consumed, so no stray slash survives: it is
      // `@codespec-apply`, never `/@codespec-apply` or `@/codespec-apply`.
      expect(transformCommandInvocations('/codespec:apply', FLAT_AT)).toBe('@codespec-apply');
      expect(transformCommandInvocations('Run `/codespec:archive` when done.', FLAT_AT)).toBe(
        'Run `@codespec-archive` when done.'
      );
    });

    it('leaves unknown ids alone under a non-slash prefix too', () => {
      expect(transformCommandInvocations('/codespec:apply and /codespec:bogus', FLAT_AT)).toBe(
        '@codespec-apply and /codespec:bogus'
      );
    });

    it('is a no-op for the canonical namespaced slash form', () => {
      const input = 'Use /codespec:new then /codespec:apply';
      expect(transformCommandInvocations(input, NAMESPACED_SLASH)).toBe(input);
    });
  });
});

describe('transformToSkillReferences', () => {
  describe('all known commands', () => {
    const mappings: Array<[string, string]> = [
      ['explore', '/codespec-explore'],
      ['new', '/codespec-new-change'],
      ['continue', '/codespec-continue-change'],
      ['apply', '/codespec-apply-change'],
      ['update', '/codespec-update-change'],
      ['ff', '/codespec-ff-change'],
      ['sync', '/codespec-sync-specs'],
      ['archive', '/codespec-archive-change'],
      ['bulk-archive', '/codespec-bulk-archive-change'],
      ['verify', '/codespec-verify-change'],
      ['onboard', '/codespec-onboard'],
      ['propose', '/codespec-propose'],
    ];

    for (const [cmd, skillRef] of mappings) {
      it(`should transform /codespec:${cmd} to ${skillRef}`, () => {
        expect(transformToSkillReferences(`/codespec:${cmd}`)).toBe(skillRef);
      });
    }
  });

  describe('basic transformations', () => {
    it('should transform command reference in context', () => {
      const input = 'Use /codespec:apply to implement tasks';
      const expected = 'Use /codespec-apply-change to implement tasks';
      expect(transformToSkillReferences(input)).toBe(expected);
    });

    it('should transform multiple command references', () => {
      const input = 'Run /codespec:apply then /codespec:archive';
      const expected = 'Run /codespec-apply-change then /codespec-archive-change';
      expect(transformToSkillReferences(input)).toBe(expected);
    });

    it('should handle backtick-quoted commands', () => {
      const input = 'Run `/codespec:continue` to proceed';
      const expected = 'Run `/codespec-continue-change` to proceed';
      expect(transformToSkillReferences(input)).toBe(expected);
    });

    it('should transform references across multiple lines', () => {
      const input = `Use /codespec:new to start
Then /codespec:apply to implement`;
      const expected = `Use /codespec-new-change to start
Then /codespec-apply-change to implement`;
      expect(transformToSkillReferences(input)).toBe(expected);
    });
  });

  describe('edge cases', () => {
    it('should return unchanged text with no command references', () => {
      const input = 'This is plain text without commands';
      expect(transformToSkillReferences(input)).toBe(input);
    });

    it('should return empty string unchanged', () => {
      expect(transformToSkillReferences('')).toBe('');
    });

    it('should leave unknown command references unchanged', () => {
      const input = 'Try /codespec:unknown-command here';
      expect(transformToSkillReferences(input)).toBe(input);
    });

    it('should not transform similar but non-matching patterns', () => {
      const input = '/ops:new codespec: /other:command';
      expect(transformToSkillReferences(input)).toBe(input);
    });

    it('should transform longest matching command (bulk-archive vs archive)', () => {
      const input = '/codespec:bulk-archive and /codespec:archive';
      const expected = '/codespec-bulk-archive-change and /codespec-archive-change';
      expect(transformToSkillReferences(input)).toBe(expected);
    });
  });
});

describe('getSkillReferenceTransformer', () => {
  it('uses the default /<name> form for tools without a custom prefix', () => {
    expect(getSkillReferenceTransformer('vibe')).toBe(transformToSkillReferences);
    expect(getSkillReferenceTransformer('hermes')('/codespec:apply')).toBe('/codespec-apply-change');
  });

  it('uses /skill:<name> for Kimi Code, per its documented invocation syntax', () => {
    const transformer = getSkillReferenceTransformer('kimi');
    expect(transformer('/codespec:propose')).toBe('/skill:codespec-propose');
    expect(transformer('Run `/codespec:apply` then /codespec:archive')).toBe(
      'Run `/skill:codespec-apply-change` then /skill:codespec-archive-change'
    );
    expect(transformer('/codespec:unknown-command')).toBe('/codespec:unknown-command');
  });

  it('uses $<name> for direct Codex invocation hints', () => {
    const transformer = getSkillReferenceTransformer('codex');
    expect(transformer('/codespec:propose')).toBe('$codespec-propose');
    expect(transformer('/codespec:unknown-command')).toBe('/codespec:unknown-command');
  });

  it('uses natural-language references for Rovo Dev, which has no slash surface', () => {
    const transformer = getSkillReferenceTransformer('rovodev');
    expect(transformer('/codespec:propose')).toBe('the codespec-propose skill');
    expect(transformer('Run `/codespec:apply` then /codespec:archive')).toBe(
      'Run `the codespec-apply-change skill` then the codespec-archive-change skill'
    );
    // No `/codespec-*` or other slash-command form is ever emitted.
    expect(transformer('/codespec:propose')).not.toMatch(/\/codespec-/);
    expect(transformer('/codespec:unknown-command')).toBe('/codespec:unknown-command');
  });
});

describe('getTransformerForTool', () => {
  it('selects skill references for skills-only delivery for every tool', () => {
    expect(getTransformerForTool('claude', 'skills', 'adapter-backed', NAMESPACED_SLASH)).toBe(
      transformToSkillReferences
    );
    // hyphen-command tools must not fall back to hyphen commands when no commands are generated
    expect(getTransformerForTool('opencode', 'skills', 'adapter-backed', FLAT_SLASH)).toBe(transformToSkillReferences);
    expect(getTransformerForTool('pi', 'skills', 'adapter-backed', FLAT_SLASH)).toBe(transformToSkillReferences);
    expect(getTransformerForTool('oh-my-pi', 'skills', 'adapter-backed', FLAT_SLASH)).toBe(transformToSkillReferences);
  });

  it('selects skill references for tools without a command surface, regardless of delivery', () => {
    // Tools like Kimi Code or Mistral Vibe have no command adapter, so their
    // skills must never reference /codespec:* commands that were not generated.
    expect(getTransformerForTool('vibe', 'both', 'none', undefined)).toBe(transformToSkillReferences);
    expect(getTransformerForTool('hermes', 'both', 'none', undefined)).toBe(transformToSkillReferences);
    // Kimi Code documents /skill:<name> invocations (docs/supported-tools.md)
    for (const delivery of ['both', 'commands', 'skills'] as const) {
      const transformer = getTransformerForTool('kimi', delivery, 'none', undefined);
      expect(transformer?.('/codespec:propose')).toBe('/skill:codespec-propose');
    }
  });

  it('selects hyphen commands for every flat-invocation tool when commands are generated', () => {
    // These tools invoke commands by filename (/codespec-<id>), so skills must
    // reference the hyphen form their command files actually answer to.
    for (const toolId of ['bob', 'cursor', 'github-copilot', 'oh-my-pi', 'opencode', 'pi', 'qwen'] as const) {
      for (const delivery of ['both', 'commands'] as const) {
        const transformer = getTransformerForTool(toolId, delivery, 'adapter-backed', FLAT_SLASH);
        expect(transformer?.('/codespec:apply'), `${toolId} ${delivery}`).toBe('/codespec-apply');
      }
      // ...but must not fall back to hyphen commands when no commands are generated
      expect(getTransformerForTool(toolId, 'skills', 'adapter-backed', FLAT_SLASH)).toBe(transformToSkillReferences);
    }
  });

  it('selects skill references for devin whenever skills are generated', () => {
    // The Devin Local agent has no workflows, so Devin skill bodies and the
    // getting-started hint must name `/codespec-*` skills, which both Devin
    // agents accept. Workflow bodies get the hyphen form from the generator,
    // like every other flat-invocation tool.
    expect(getTransformerForTool('devin', 'both', 'adapter-backed', FLAT_SLASH)).toBe(
      transformToSkillReferences
    );
    expect(getTransformerForTool('devin', 'skills', 'adapter-backed', FLAT_SLASH)).toBe(
      transformToSkillReferences
    );
    // Under commands-only delivery no Devin skills exist to point at, so the
    // hint falls back to the workflow name Devin registers.
    const commandsOnly = getTransformerForTool('devin', 'commands', 'adapter-backed', FLAT_SLASH);
    expect(commandsOnly?.('/codespec:propose')).toBe('/codespec-propose');
  });

  it("selects Amazon Q's @-prefixed prompt form when commands are generated", () => {
    // Amazon Q loads .amazonq/prompts/codespec-<id>.md into its prompt library,
    // which is invoked with @ — it registers no slash command at all.
    for (const delivery of ['both', 'commands'] as const) {
      const transformer = getTransformerForTool('amazon-q', delivery, 'adapter-backed', FLAT_AT);
      expect(transformer?.('/codespec:apply'), delivery).toBe('@codespec-apply');
      expect(transformer?.('Run /codespec:archive next'), delivery).toBe('Run @codespec-archive next');
    }
    // Skills-only delivery generates no prompt files, so point at the skill.
    expect(getTransformerForTool('amazon-q', 'skills', 'adapter-backed', FLAT_AT)).toBe(
      transformToSkillReferences
    );
  });

  it('selects no transformer for namespaced tools when commands are generated', () => {
    expect(getTransformerForTool('claude', 'both', 'adapter-backed', NAMESPACED_SLASH)).toBeUndefined();
    expect(getTransformerForTool('claude', 'commands', 'adapter-backed', NAMESPACED_SLASH)).toBeUndefined();
  });

  it('selects shared-tree-safe Codex skill references in every delivery mode', () => {
    // Codex needs $<name>, while generic consumers of the same canonical
    // .agents tree need /<name>. Keep both explicit so neither target breaks.
    for (const delivery of ['both', 'commands', 'skills'] as const) {
      const transformer = getTransformerForTool('codex', delivery, 'skills-invocable', undefined);
      expect(transformer?.('/codespec:propose')).toBe(
        '$codespec-propose (Codex) or /codespec-propose (other agents)'
      );
      expect(transformer?.('Run /codespec:apply next')).toBe(
        'Run $codespec-apply-change (Codex) or /codespec-apply-change (other agents) next'
      );
    }
  });
});

// Regression for #1153/#1514: the apply skill template must author its
// continue/apply/archive references as canonical /codespec:* tokens so the
// generator can rewrite them per target. Bare "codespec-continue-change"
// prose is invisible to the transformers, which left skills.sh, Codex, and
// Kimi with dead text and no archive/input invocation after a naive revert.
describe('apply skill template generates valid per-target invocations', () => {
  const skill = getApplyChangeSkillTemplate().instructions;

  it('authors invocation references as transformable /codespec:* tokens', () => {
    expect(skill).toContain('/codespec:apply add-auth');
    expect(skill).toContain('suggest using `/codespec:continue`');
    expect(skill).toContain('archive this change with `/codespec:archive`');
    // No bare, non-transformable skill-name prose remains.
    expect(skill).not.toContain('suggest using codespec-continue-change');
  });

  const cases = [
    { tool: 'default (skills.sh)', transform: transformToSkillReferences, cont: '/codespec-continue-change', arch: '/codespec-archive-change', apply: '/codespec-apply-change' },
    { tool: 'codex', transform: getSkillReferenceTransformer('codex'), cont: '$codespec-continue-change', arch: '$codespec-archive-change', apply: '$codespec-apply-change' },
    { tool: 'kimi', transform: getSkillReferenceTransformer('kimi'), cont: '/skill:codespec-continue-change', arch: '/skill:codespec-archive-change', apply: '/skill:codespec-apply-change' },
  ];

  for (const { tool, transform, cont, arch, apply } of cases) {
    it(`emits ${tool} skill invocations for continue, apply, and archive`, () => {
      const out = transform(skill);
      expect(out).toContain(cont);
      expect(out).toContain(arch);
      expect(out).toContain(`${apply} add-auth`);
      // No canonical token survives the rewrite.
      expect(out).not.toMatch(/\/codespec:(continue|apply|archive)/);
    });
  }
});
