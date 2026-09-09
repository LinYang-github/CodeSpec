import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import { mergeCurrentModuleDeltas } from '../../../src/core/codespec-workflow/current-archive-merge.js';
import { parseCurrentTasks } from '../../../src/core/codespec-workflow/current-change-yaml.js';
import { parseBusinessRegistry, parseConfiguration, parseModuleInterface } from '../../../src/core/codespec-workflow/current-spec-yaml.js';
import { installCurrentArchiveFiles } from '../../../src/core/codespec-workflow/archive-transaction.js';
import { createWorkflowFixture } from '../../helpers/codespec-workflow.js';

describe('current archive module-delta merge', () => {
  it('mirrors relations and derives API, business, and configuration projections', () => {
    const tasks = parseCurrentTasks({
      version: 1,
      tasks: [],
      moduleRegistrations: { upsert: [], retire: [] },
      moduleDeltas: [{
        module: 'MOD-002',
        interfaces: { upsert: [{
          id: 'REL-CHG-20260907-001-01', kind: 'http', fromModule: 'MOD-001', toModule: 'MOD-002',
          path: '/api/users', method: 'POST', input: '用户管理请求', output: '用户资料', errors: '参数错误',
          requirements: ['MOD-002-REQ-001'], scenarios: ['MOD-002-REQ-001-SCN-001'],
        }], remove: [] },
        configurationChanges: { upsert: [{
          profile: 'test', service: {
            id: 'user-service', hostAlias: '用户服务测试', endpoint: 'https://users.test.example',
            routeBindings: [{ module: 'MOD-002', path: '/api/users' }],
            source: { kind: 'repo-file', file: '.env.test', format: 'dotenv', key: 'USER_SERVICE_URL' },
          },
        }], remove: [] },
      }],
    });
    const result = mergeCurrentModuleDeltas({
      business: parseBusinessRegistry({ version: 1, modules: [
        { id: 'MOD-001', name: '门户', status: 'ACTIVE', inputs: [], outputs: [], relatedModules: [] },
        { id: 'MOD-002', name: '用户管理', status: 'ACTIVE', inputs: [], outputs: [], relatedModules: [] },
      ] }),
      interfaces: new Map([
        ['MOD-001', parseModuleInterface({ version: 1, module: 'MOD-001', relations: [] })],
        ['MOD-002', parseModuleInterface({ version: 1, module: 'MOD-002', relations: [] })],
      ]),
      configuration: parseConfiguration({ version: 1, profiles: [] }),
      moduleDeltas: tasks.moduleDeltas,
    });

    expect(result.interfaces.get('MOD-001')?.relations).toHaveLength(1);
    expect(result.interfaces.get('MOD-002')?.relations).toHaveLength(1);
    expect(result.apis.get('MOD-002')?.routes).toEqual([{ path: '/api/users', inputModules: ['MOD-001'], outputModules: [] }]);
    expect(result.business.modules).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'MOD-001', outputs: ['用户管理请求'], relatedModules: ['MOD-002'] }),
      expect.objectContaining({ id: 'MOD-002', inputs: ['用户管理请求'], outputs: ['用户资料'], relatedModules: ['MOD-001'] }),
    ]));
    expect(result.configuration.profiles[0]).toMatchObject({ id: 'test', services: [{ id: 'user-service' }] });
  });

  it('installs merged current files, removes the Change from the index, then deletes the active Change', async () => {
    const fixture = await createWorkflowFixture();
    try {
      const changeDir = path.join(fixture.paths.changes, fixture.changeId);
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'metadata.yaml'), 'change: active\n');
      await fs.writeFile(fixture.paths.changeIndex, stringifyYaml({ version: 1, changes: [{ id: fixture.changeId }] }));
      const business = { version: 1, modules: [{ id: 'MOD-002', name: '用户管理', status: 'ACTIVE', inputs: [], outputs: [], relatedModules: [] }] };
      const configuration = { version: 1, profiles: [] };

      await installCurrentArchiveFiles({
        paths: fixture.paths,
        changeId: fixture.changeId,
        changeDir,
        moduleFiles: new Map([['MOD-002', {
          spec: '# 用户管理\n',
          interface: stringifyYaml({ version: 1, module: 'MOD-002', relations: [] }),
          api: stringifyYaml({ version: 1, module: 'MOD-002', routes: [] }),
        }]]),
        business: stringifyYaml(business),
        configuration: stringifyYaml(configuration),
      });

      await expect(fs.readFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), 'utf8')).resolves.toBe('# 用户管理\n');
      expect(parseYaml(await fs.readFile(fixture.paths.changeIndex, 'utf8'))).toEqual({ version: 1, changes: [] });
      await expect(fs.access(changeDir)).rejects.toThrow();
    } finally { fixture.cleanup(); }
  });

  it('rejects configuration bindings that do not resolve to a generated API route', () => {
    expect(() => mergeCurrentModuleDeltas({
      business: parseBusinessRegistry({ version: 1, modules: [
        { id: 'MOD-001', name: '门户', status: 'ACTIVE', inputs: [], outputs: [], relatedModules: [] },
        { id: 'MOD-002', name: '用户管理', status: 'ACTIVE', inputs: [], outputs: [], relatedModules: [] },
      ] }),
      interfaces: new Map([
        ['MOD-001', parseModuleInterface({ version: 1, module: 'MOD-001', relations: [] })],
        ['MOD-002', parseModuleInterface({ version: 1, module: 'MOD-002', relations: [] })],
      ]),
      configuration: parseConfiguration({ version: 1, profiles: [{ id: 'test', services: [{
        id: 'user-service', hostAlias: '用户服务', endpoint: 'https://users.test.example',
        routeBindings: [{ module: 'MOD-002', path: '/api/missing' }],
        source: { kind: 'repo-file', file: '.env.test', format: 'dotenv', key: 'USER_SERVICE_URL' },
      }] }] }),
      moduleDeltas: [],
    })).toThrow(/unresolved route/i);
  });
});
