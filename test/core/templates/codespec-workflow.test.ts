import { describe, expect, it } from 'vitest';
import { getCodeSpecWorkflowSkillTemplate } from '../../../src/core/templates/skill-templates.js';
import { getSkillTemplates, getCommandContents } from '../../../src/core/shared/skill-generation.js';
import { renderCanonicalChangeContext } from '../../../src/core/templates/workflows/codespec-workflow.js';
import { createWorkflowFixture } from '../../helpers/codespec-workflow.js';

describe('codespec-workflow integration', () => {
  it('routes CodeSpec code-spec work through codespec-workflow', () => {
    const content = getCodeSpecWorkflowSkillTemplate().instructions;
    expect(content).toContain('codespec-workflow');
    expect(content).toContain('CHG-');
    expect(content).toContain('metadata.yaml');
    expect(content).not.toContain('docs/superpowers/specs/');
  });

  it('describes the five-file active Change layout and keeps PLAN compatibility-only', () => {
    const content = getCodeSpecWorkflowSkillTemplate().instructions;
    expect(content).toContain('metadata.yaml');
    expect(content).toContain('design.md');
    expect(content).toContain('spec.md');
    expect(content).toContain('tasks.yaml');
    expect(content).toContain('verification.yaml');
    expect(content).toContain('PLAN');
    expect(content).toContain('兼容');
    expect(content).not.toContain('proposal.md');
    expect(content).not.toContain('tasks.md');
    expect(content).not.toContain('verification.md');
  });

  it('keeps development orchestration in the single workflow entry', () => {
    const content = getCodeSpecWorkflowSkillTemplate().instructions;
    expect(content).toContain('createChange()');
    expect(content).toContain('resolveChange()');
    expect(content).toContain('superpowers:brainstorming');
    expect(content).toContain('superpowers:writing-plans');
    expect(content).toContain('Current Specification');
    expect(content).toContain('codespec-rebase-change');
    expect(content).toContain('codespec-archive-change');
  });

  it('requires a separate user confirmation after design and plan before continuing', () => {
    const skill = getCodeSpecWorkflowSkillTemplate().instructions;
    expect(skill).toContain('DESIGN 完成后必须停止');
    expect(skill).toContain('PLAN 完成后必须停止');
    expect(skill).toContain('独立的新用户消息');
    expect(skill).toContain('codespec approve --change "<CHG-ID>" --stage design');
    expect(skill).toContain('codespec approve --change "<CHG-ID>" --stage plan');

    const command = getCommandContents().find((entry) => entry.id === 'workflow')!;
    expect(command.body).toContain('DESIGN 完成后必须停止');
    expect(command.body).toContain('PLAN 完成后必须停止');
  });

  it('injects concrete canonical context resolution into every lifecycle surface', () => {
    for (const { template } of getSkillTemplates()) {
      expect(template.instructions).toContain('codespec context --json');
      expect(template.instructions).toContain('codespec status --change "<CHG-ID>" --json');
      expect(template.instructions).toContain('metadata.yaml');
      expect(template.instructions).toContain('Requirement ID');
      expect(template.instructions).toContain('Scenario ID');
      expect(template.instructions).toContain('Task ID');
      expect(template.instructions).toContain('明确失败并停止');
    }
    for (const command of getCommandContents()) {
      expect(command.body).toContain('codespec-workflow');
      expect(command.body).toContain('codespec context --json');
    }
  });

  it('does not duplicate store-selection guidance in generated adapter content', () => {
    const content = getSkillTemplates().find(({ dirName }) => dirName === 'codespec-workflow')!.template.instructions;
    expect(content.match(/\*\*Store 选择：\*\*/g)).toHaveLength(1);
  });

  it('renders stable scenario IDs and names from the loaded spec artifact', async () => {
    const fixture = await createWorkflowFixture();
    const context = renderCanonicalChangeContext(fixture.metadataAt('VERIFY'), '#### Scenario: [SCN-042] Login succeeds\n- **GIVEN** a user\n');
    expect(context).toContain('Scenarios=SCN-042');
    expect(context).not.toContain('Scenarios=MOD-001-REQ-001');
    await fixture.cleanup();
  });

  it('does not expose retired phase-specific skill entries', () => {
    const ids = getSkillTemplates().map((entry) => entry.workflowId);
    expect(ids).toEqual(['workflow', 'rebase', 'archive']);
    expect(ids).not.toContain('sync');
    expect(ids).not.toContain('apply');
  });
});
