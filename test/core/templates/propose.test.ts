import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import {
  getOpsxProposeSkillTemplate,
  getOpsxProposeCommandTemplate,
  getFfChangeSkillTemplate,
  getOpsxFfCommandTemplate,
} from '../../../src/core/templates/skill-templates.js';
import { generateSkillContent, getCommandContents } from '../../../src/core/shared/skill-generation.js';
import { loadSchema } from '../../../src/core/artifact-graph/schema.js';
import { CommandAdapterRegistry } from '../../../src/core/command-generation/registry.js';
import { generateCommand } from '../../../src/core/command-generation/generator.js';

const proposeBodies: Array<[string, string]> = [
  ['propose skill', generateSkillContent(getOpsxProposeSkillTemplate(), 'TEST')],
  ['propose command', getOpsxProposeCommandTemplate().content],
];
const loopBodies: Array<[string, string]> = [
  ...proposeBodies,
  ['ff skill', getFfChangeSkillTemplate().instructions],
  ['ff command', getOpsxFfCommandTemplate().content],
];

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const defaultSchema = loadSchema(path.join(repoRoot, 'schemas', 'code-spec', 'schema.yaml'));

describe('canonical code-spec templates', () => {
  it('advertise every default artifact in Chinese', () => {
    for (const [label, body] of proposeBodies) {
      expect(body, label).toContain('默认 `code-spec` schema');
      expect(body, label).toContain('**规划边界**');
      expect(body, label).toContain('不得编辑项目代码');
      expect(body, label).not.toContain('spec-driven schema');

      for (const artifact of defaultSchema.artifacts) {
        expect(body, `${label} 缺少 ${artifact.id}`).toContain(`\`${artifact.generates}\``);
      }
    }
  });

  it('keeps planning and implementation as separate user actions', () => {
    for (const [label, body] of proposeBodies) {
      expect(body, label).toContain('等待用户发起新的请求后，再进入 apply 工作流');
      expect(body, label).toContain('准备实现时，运行 `/opsx:apply`');
    }
  });

  it('keeps default and explicit schema creation forms', () => {
    for (const [label, body] of proposeBodies) {
      expect(body, label).toContain('openspec new change "<name>"');
      expect(body, label).toContain('openspec new change "<name>" --schema "<schema-name>"');
      expect(body, label).toContain('openspec context --json');
      expect(body, label).toContain('openspec schemas --json');
    }
  });

  it('preserves canonical dependency-closure safeguards in both workflows', () => {
    for (const [label, body] of loopBodies) {
      expect(body, label).toContain('沿 `status --json` 的 `requires` 边可达的全部传递依赖');
      expect(body, label).toContain('`status` 只反映文件存在性');
      expect(body, label).toMatch(/每个工件的 `requires` 边.*`status`/);
      expect(body, label).toMatch(/(?:status 已报告 `skipped`|已显示 `status: "skipped"`)/);
      expect(body, label).toContain('不得自行判断');
      expect(body, label).toContain('依赖是启用条件而非阻塞门槛');
      expect(body, label).toContain('`resolvedOutputPath`');
      expect(body, label).toContain('glob');
    }
  });

  it('carries the Chinese planning boundary through command adapters', () => {
    const propose = getCommandContents(['propose'])[0];
    expect(propose?.id).toBe('propose');

    for (const adapter of CommandAdapterRegistry.getAll()) {
      const generated = generateCommand(propose, adapter).fileContent;
      expect(generated, adapter.toolId).toContain('本工作流只授权规划');
      expect(generated, adapter.toolId).toContain('不得编辑项目代码');
      expect(generated, adapter.toolId).toContain('等待用户发起新的请求后');
    }
  });
});
