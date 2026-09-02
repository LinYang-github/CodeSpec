import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import {
  renderBusinessTemplate,
  renderCanonicalWorkspaceConfig,
} from '../../src/core/openspec-workflow/default-config.js';
import { parseWorkspaceConfig } from '../../src/core/openspec-workflow/schemas.js';

describe('canonical workspace configuration', () => {
  it('renders a complete canonical code-spec config', () => {
    const config = parseWorkspaceConfig(
      parseYaml(renderCanonicalWorkspaceConfig('demo'))
    );

    expect(config.schema).toBe('code-spec');
    expect(config.project.name).toBe('demo');
    expect(config.paths).toEqual({
      business: 'business.md',
      changes: 'changes',
      change_index: 'changes/index.yaml',
      archive: 'archive',
      specs: 'archive/specs',
      archived_changes: 'archive/changes',
    });
  });

  it('preserves project names with YAML special characters', () => {
    const projectName = '演示: # "发布"';
    const config = parseWorkspaceConfig(
      parseYaml(renderCanonicalWorkspaceConfig(projectName))
    );

    expect(config.project.name).toBe(projectName);
  });

  it('renders a Chinese business template for workspace authors', () => {
    expect(renderBusinessTemplate()).toContain('# 业务');
    expect(renderBusinessTemplate()).toContain('记录系统的业务模块、职责和关键词。');
    expect(renderBusinessTemplate()).toContain(
      '| 模块 ID | 模块名称 | 描述 | 职责 | 关键词 |'
    );
  });
});
