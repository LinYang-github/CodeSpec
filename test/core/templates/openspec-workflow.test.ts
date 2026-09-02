import { describe, expect, it } from 'vitest';
import { getOpsxProposeSkillTemplate } from '../../../src/core/templates/skill-templates.js';
import { getSkillTemplates, getCommandContents } from '../../../src/core/shared/skill-generation.js';
import { renderCanonicalChangeContext } from '../../../src/core/templates/workflows/openspec-workflow.js';
import { createWorkflowFixture } from '../../helpers/openspec-workflow.js';

describe('openspec-workflow integration', () => {
  it('routes OpenSpec code-spec work through openspec-workflow', () => {
    const content = getOpsxProposeSkillTemplate().instructions;
    expect(content).toContain('openspec-workflow');
    expect(content).toContain('CHG-');
    expect(content).toContain('metadata.yaml');
    expect(content).not.toContain('docs/superpowers/specs/');
  });

  it('injects concrete canonical context resolution into every lifecycle surface', () => {
    for (const { template } of getSkillTemplates()) {
      expect(template.instructions).toContain('openspec context --json');
      expect(template.instructions).toContain('openspec status --change "<CHG-ID>" --json');
      expect(template.instructions).toContain('metadata.yaml');
      expect(template.instructions).toContain('Requirement ID');
      expect(template.instructions).toContain('Scenario ID');
      expect(template.instructions).toContain('Task ID');
      expect(template.instructions).toContain('明确失败并停止');
    }
    for (const command of getCommandContents()) {
      expect(command.body).toContain('openspec-workflow');
      expect(command.body).toContain('openspec context --json');
    }
  });

  it('does not duplicate store-selection guidance in generated adapter content', () => {
    const content = getSkillTemplates().find(({ dirName }) => dirName === 'openspec-workflow')!.template.instructions;
    expect(content.match(/\*\*Store 选择：\*\*/g)).toHaveLength(1);
  });

  it('renders stable scenario IDs and names from the loaded spec artifact', async () => {
    const fixture = await createWorkflowFixture();
    const context = renderCanonicalChangeContext(fixture.metadataAt('VERIFY'), '#### Scenario: [SCN-042] Login succeeds\n- **GIVEN** a user\n');
    expect(context).toContain('Scenarios=SCN-042');
    expect(context).not.toContain('Scenarios=MOD-001-REQ-001');
    await fixture.cleanup();
  });

  it('does not map unsupported workflows to continue guidance', () => {
    for (const workflowId of ['update', 'sync', 'onboard']) {
      const template = getSkillTemplates().find(entry => entry.workflowId === workflowId)!.template.instructions;
      expect(template).toContain(`不支持的 canonical 阶段：${workflowId}`);
      expect(template).not.toContain('### continue stage adapter');
    }
  });
});
