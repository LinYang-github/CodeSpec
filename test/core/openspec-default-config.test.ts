import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { renderCanonicalWorkspaceConfig } from '../../src/core/openspec-workflow/default-config.js';
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
});
