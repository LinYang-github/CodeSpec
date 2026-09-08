import * as fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { validateRelations } from '../../../src/core/codespec-workflow/relations.js';
import { createWorkflowFixture, writeBusinessFile } from '../../helpers/codespec-workflow.js';

describe('current specification relations', () => {
  it('loads and validates the CurrentSpecGraph during current Change archive relation validation', async () => {
    const fixture = await createWorkflowFixture({ configOverrides: { paths: { business: 'business.yaml' } } });
    afterEach(fixture.cleanup);
    await writeBusinessFile(fixture, [
      'version: 1',
      'modules:',
      '  - id: MOD-001',
      '    name: 认证',
      '    status: ACTIVE',
      '    inputs: []',
      '    outputs: []',
      '    relatedModules: []',
      '  - id: MOD-002',
      '    name: 用户管理',
      '    status: ACTIVE',
      '    inputs: []',
      '    outputs: []',
      '    relatedModules: []',
      '',
    ].join('\n'));
    const relation = [
      '  - id: REL-CHG-20260907-001-01',
      '    kind: http',
      '    fromModule: MOD-001',
      '    toModule: MOD-002',
      '    path: /api/users',
      '    method: POST',
      '    input: 新增用户请求',
      '    output: 用户资料',
      '    errors: 用户已存在',
      '    requirements: [MOD-002-REQ-001]',
      '    scenarios: [MOD-002-REQ-001-SCN-001]',
    ].join('\n');
    for (const moduleId of ['MOD-001', 'MOD-002']) {
      const directory = path.join(fixture.paths.currentSpecs, moduleId);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, 'interface.yaml'), `version: 1\nmodule: ${moduleId}\nrelations:\n${relation}\n`);
    }
    await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), [
      '# 用户管理', '', '- **模块编号：** MOD-002', '- **规格版本：** 1', '',
      '## MOD-002-REQ-001：新增用户', '', '#### Scenario: MOD-002-REQ-001-SCN-001 提交新增用户',
      '- GIVEN 已登录', '- WHEN 提交新增用户', '- THEN 创建用户', '- ERROR 用户已存在', '',
      '### 测试用例', '', '### 当前模块工程文件', '',
      '| 文件 | 作用 | 关联需求 / 场景 / 测试用例 |', '| --- | --- | --- |', '',
    ].join('\n'));

    await expect(validateRelations(fixture.workspace, {
      ...fixture.metadataAt('ARCHIVE'),
      artifacts: { metadata: 'changes/CHG-20260901-001/metadata.yaml', spec: 'changes/CHG-20260901-001/spec.md', tasks: 'changes/CHG-20260901-001/tasks.yaml', verification: 'changes/CHG-20260901-001/verification.yaml' },
    })).resolves.toMatchObject({ relations: [expect.objectContaining({ id: 'REL-CHG-20260907-001-01' })] });
  });
});
