import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { buildArchiveProjection } from '../../../src/core/codespec-workflow/archive-projection.js';
import {
  parseBusinessRegistry,
  parseConfiguration,
  parseModuleApi,
  parseModuleInterface,
} from '../../../src/core/codespec-workflow/current-spec-yaml.js';

const relation = {
  id: 'REL-CHG-20260909-001-01',
  kind: 'http' as const,
  fromModule: 'MOD-001',
  toModule: 'MOD-002',
  path: '/users',
  method: 'POST',
  input: '用户创建请求',
  output: '用户资料',
  errors: '请求无效',
  requirements: ['MOD-002-REQ-001'],
  scenarios: ['MOD-002-REQ-001-SCN-001'],
};

describe('archive projection builder', () => {
  it('serializes every module projection and derives global business/API files', () => {
    const result = buildArchiveProjection({
      specs: new Map([
        ['MOD-002', '# 用户管理\n'],
        ['MOD-001', '# 认证\n'],
      ]),
      business: parseBusinessRegistry({
        version: 1,
        modules: [
          { id: 'MOD-001', name: '认证', status: 'ACTIVE', inputs: [], outputs: [], relatedModules: [] },
          { id: 'MOD-002', name: '用户管理', status: 'ACTIVE', inputs: [], outputs: [], relatedModules: [] },
        ],
      }),
      interfaces: new Map([
        ['MOD-002', parseModuleInterface({ version: 1, module: 'MOD-002', relations: [relation] })],
        ['MOD-001', parseModuleInterface({ version: 1, module: 'MOD-001', relations: [relation] })],
      ]),
      configuration: parseConfiguration({ version: 1, profiles: [] }),
    });

    expect([...result.modules.keys()]).toEqual(['MOD-001', 'MOD-002']);
    expect(parseModuleInterface(parseYaml(result.modules.get('MOD-001')!.interface))).toMatchObject({
      module: 'MOD-001',
      relations: [relation],
    });
    expect(parseModuleApi(parseYaml(result.modules.get('MOD-002')!.api))).toEqual({
      version: 1,
      module: 'MOD-002',
      routes: [{ path: '/users', inputModules: ['MOD-001'], outputModules: [] }],
    });
    expect(parseBusinessRegistry(parseYaml(result.business)).modules).toEqual([
      { id: 'MOD-001', name: '认证', status: 'ACTIVE', inputs: [], outputs: ['用户创建请求'], relatedModules: ['MOD-002'] },
      { id: 'MOD-002', name: '用户管理', status: 'ACTIVE', inputs: ['用户创建请求'], outputs: ['用户资料'], relatedModules: ['MOD-001'] },
    ]);
    expect(parseConfiguration(parseYaml(result.configuration))).toEqual({ version: 1, profiles: [] });
  });

  it('keeps a no-relation module in the three-file projection with an empty API route list', () => {
    const result = buildArchiveProjection({
      specs: new Map([['MOD-003', '# 通知\n']]),
      business: parseBusinessRegistry({
        version: 1,
        modules: [{ id: 'MOD-003', name: '通知', status: 'ACTIVE', inputs: [], outputs: [], relatedModules: [] }],
      }),
      interfaces: new Map([
        ['MOD-003', parseModuleInterface({ version: 1, module: 'MOD-003', relations: [] })],
      ]),
      configuration: parseConfiguration({ version: 1, profiles: [] }),
    });

    expect(parseModuleApi(parseYaml(result.modules.get('MOD-003')!.api))).toEqual({
      version: 1,
      module: 'MOD-003',
      routes: [],
    });
  });

  it('allows a newly registered module to bootstrap an empty interface document', () => {
    const result = buildArchiveProjection({
      specs: new Map([['MOD-003', '# 通知\n']]),
      business: parseBusinessRegistry({
        version: 1,
        modules: [{ id: 'MOD-003', name: '通知', status: 'ACTIVE', inputs: [], outputs: [], relatedModules: [] }],
      }),
      interfaces: new Map(),
      newModuleIds: new Set(['MOD-003']),
      configuration: parseConfiguration({ version: 1, profiles: [] }),
    });

    expect(parseModuleInterface(parseYaml(result.modules.get('MOD-003')!.interface))).toEqual({
      version: 1,
      module: 'MOD-003',
      relations: [],
    });
  });

  it('rejects an existing module with no interface document', () => {
    expect(() => buildArchiveProjection({
      specs: new Map([['MOD-003', '# 通知\n']]),
      business: parseBusinessRegistry({
        version: 1,
        modules: [{ id: 'MOD-003', name: '通知', status: 'ACTIVE', inputs: [], outputs: [], relatedModules: [] }],
      }),
      interfaces: new Map(),
      configuration: parseConfiguration({ version: 1, profiles: [] }),
    })).toThrow(/Missing interface\.yaml/);
  });
});
