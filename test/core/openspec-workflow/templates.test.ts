import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(file, 'utf8');
const root = process.cwd();

describe('canonical code-spec schema and templates', () => {
  it('declares canonical code-spec artifacts and protocol tokens', () => {
    const schema = read(`${root}/schemas/code-spec/schema.yaml`);
    expect(schema).toContain('metadata.yaml');
    expect(schema).toContain('verification.md');
    expect(schema).toContain('MODIFIED');
    expect(schema).not.toContain('skip_specs');
    expect(schema).not.toContain('.openspec.yaml');
    expect(schema).toContain('archive/specs');
    expect(schema).toContain('archive/changes');
  });

  it('uses Chinese guidance with English protocol tokens in every template', () => {
    for (const name of ['proposal', 'design', 'spec', 'tasks', 'verification']) {
      const content = read(`${root}/schemas/code-spec/templates/${name}.md`);
      expect(content).toMatch(/[\u4e00-\u9fff]/);
      expect(content).toContain('GIVEN');
      expect(content).toContain('WHEN');
      expect(content).toContain('THEN');
      expect(content).toContain('Requirement ID');
      expect(content).not.toContain('openspec/specs/');
      expect(content).not.toContain('changes/archive');
      expect(content).not.toContain('skip_specs');
      expect(content).not.toContain('.openspec.yaml');
    }
    const spec = read(`${root}/schemas/code-spec/templates/spec.md`);
    expect(spec).toContain('Previous');
    expect(spec).toContain('New');
    expect(spec).toContain('Reason');
    expect(spec).toContain('SCN-');
    expect(spec).toContain('ERROR 可以暂时留空');

    const verification = read(`${root}/schemas/code-spec/templates/verification.md`);
    expect(verification).toContain('ERROR 必须已填写');
    expect(verification).toContain('不得归档');
  });

  it('documents the canonical workspace and multiple active Changes', () => {
    const config = read(`${root}/openspec/config.yaml`);
    const docs = ['docs/overview.md', 'docs/workflows.md', 'docs/concepts.md', 'docs/cli.md']
      .map((file) => read(`${root}/${file}`)).join('\n');
    expect(config).toContain('multiple_active_changes: true');
    expect(config).toContain('archived_changes: archive/changes');
    expect(docs).toContain('metadata.yaml');
    expect(docs).toContain('Requirement ID');
    expect(docs).toContain('verification.md');
  });

  it('teaches generated workflow guidance to validate ERROR before verification and archive', async () => {
    const { getOpenSpecWorkflowSkillTemplate } = await import('../../../src/core/templates/workflows/openspec-workflow.js');
    const template = getOpenSpecWorkflowSkillTemplate().instructions;
    expect(template).toContain('ERROR');
    expect(template).toContain('人工补写');
    expect(template).toContain('不得归档');
  });
});
