import { describe, expect, it } from 'vitest';

describe('CodeSpec runtime identity', () => {
  it('exports the codespec workspace identity', async () => {
    const config = await import('../../src/core/config.js') as Record<string, unknown>;

    expect(config.CODESPEC_DIR_NAME).toBe('codespec');
    expect(config.CODESPEC_SKILL_NAMES).toEqual([
      'codespec-workflow',
      'codespec-rebase-change',
      'codespec-archive-change',
    ]);
  });

  it('exports a resolver for a codespec project configuration', async () => {
    const projectConfig = await import('../../src/core/project-config.js') as Record<string, unknown>;

    expect(typeof projectConfig.resolveCodeSpecConfigFilePath).toBe('function');
  });
});
