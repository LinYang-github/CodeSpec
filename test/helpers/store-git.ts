import * as fs from 'node:fs';
import * as path from 'node:path';

import { DEFAULT_CODESPEC_SCHEMA } from '../../src/core/index.js';
import {
  renderBusinessTemplate,
  renderCanonicalWorkspaceConfig,
  renderConfigurationTemplate,
  renderEmptyChangeIndex,
} from '../../src/core/codespec-workflow/default-config.js';

/**
 * Shared fixtures for store tests that touch real Git.
 */

export function createHealthyCodeSpecRoot(root: string, configName = 'config.yaml'): void {
  const codespecRoot = path.join(root, 'codespec');

  if (DEFAULT_CODESPEC_SCHEMA === 'code-spec') {
    fs.mkdirSync(path.join(codespecRoot, 'changes'), { recursive: true });
    fs.mkdirSync(path.join(codespecRoot, '.transactions'), { recursive: true });
    fs.mkdirSync(path.join(codespecRoot, 'archive', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(codespecRoot, 'archive', 'changes'), { recursive: true });
    fs.writeFileSync(path.join(codespecRoot, configName), renderCanonicalWorkspaceConfig('store-fixture'));
    fs.writeFileSync(path.join(codespecRoot, 'business.yaml'), [
      'version: 1',
      'modules:',
      '  - id: MOD-001',
      '    name: Store 测试模块',
      '    status: ACTIVE',
      '    inputs: []',
      '    outputs: []',
      '    relatedModules: []',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(codespecRoot, 'configuration.yaml'), renderConfigurationTemplate());
    // Keep the legacy Markdown registry in fixtures that specifically test
    // preservation of old workspace files; the canonical config points at
    // business.yaml above.
    fs.writeFileSync(
      path.join(codespecRoot, 'business.md'),
      `${renderBusinessTemplate()}| MOD-001 | Store 测试模块 | 测试 Store 工作流 | Store 测试 | Store；测试 |\n`
    );
    fs.writeFileSync(path.join(codespecRoot, 'changes', 'index.yaml'), renderEmptyChangeIndex());
    return;
  }

  fs.mkdirSync(path.join(codespecRoot, 'specs'), { recursive: true });
  fs.mkdirSync(path.join(codespecRoot, 'changes', 'archive'), { recursive: true });
  fs.writeFileSync(path.join(codespecRoot, configName), `schema: ${DEFAULT_CODESPEC_SCHEMA}\n`);
}

/**
 * Isolates real git invocations from the host's gitconfig (signing, hooks,
 * templates) and provides a deterministic commit identity.
 */
export function isolatedGitEnv(tempDir: string): NodeJS.ProcessEnv {
  const emptyConfig = path.join(tempDir, 'gitconfig-empty');
  if (!fs.existsSync(emptyConfig)) {
    fs.writeFileSync(emptyConfig, '');
  }
  return {
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_SYSTEM: emptyConfig,
    GIT_AUTHOR_NAME: 'Store Tester',
    GIT_AUTHOR_EMAIL: 'tester@example.com',
    GIT_COMMITTER_NAME: 'Store Tester',
    GIT_COMMITTER_EMAIL: 'tester@example.com',
  };
}
