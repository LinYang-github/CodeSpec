import { describe, expect, it } from 'vitest';

import { buildCurrentSpecGraph, incomingRelations, outgoingRelations, projectApi, projectBusiness } from '../../../src/core/codespec-workflow/current-spec-graph.js';
import { parseModuleInterface } from '../../../src/core/codespec-workflow/current-spec-yaml.js';

const httpRelation = {
  id: 'REL-CHG-20260907-001-01',
  kind: 'http' as const,
  fromModule: 'MOD-001',
  toModule: 'MOD-002',
  path: '/api/users',
  method: 'POST',
  input: '用户管理请求',
  output: '用户资料',
  errors: '参数不合法时不创建用户',
  requirements: ['MOD-002-REQ-001'],
  scenarios: ['MOD-002-REQ-001-SCN-001'],
};

const eventRelation = {
  id: 'REL-CHG-20260907-001-02',
  kind: 'event' as const,
  fromModule: 'MOD-002',
  toModule: 'MOD-003',
  event: 'user.created',
  triggeredBy: [{ path: '/api/users', method: 'POST' }],
  input: '用户生命周期事件',
  output: '通知结果',
  errors: '通知失败记录重试状态',
  requirements: ['MOD-002-REQ-001'],
  scenarios: ['MOD-002-REQ-001-SCN-001'],
};

describe('current specification relation graph', () => {
  it('derives business concepts and route-level input/output modules from mirrored relations', () => {
    const graph = buildCurrentSpecGraph({
      modules: [
        { id: 'MOD-001', name: '认证', status: 'ACTIVE' },
        { id: 'MOD-002', name: '用户管理', status: 'ACTIVE' },
        { id: 'MOD-003', name: '通知', status: 'ACTIVE' },
      ],
      interfaces: [
        parseModuleInterface({ version: 1, module: 'MOD-001', relations: [httpRelation] }),
        parseModuleInterface({ version: 1, module: 'MOD-002', relations: [httpRelation, eventRelation] }),
        parseModuleInterface({ version: 1, module: 'MOD-003', relations: [eventRelation] }),
      ],
    });

    expect(projectBusiness(graph).modules).toEqual([
      { id: 'MOD-001', name: '认证', status: 'ACTIVE', inputs: [], outputs: ['用户管理请求'], relatedModules: ['MOD-002'] },
      { id: 'MOD-002', name: '用户管理', status: 'ACTIVE', inputs: ['用户管理请求'], outputs: ['用户生命周期事件', '用户资料'], relatedModules: ['MOD-001', 'MOD-003'] },
      { id: 'MOD-003', name: '通知', status: 'ACTIVE', inputs: ['用户生命周期事件'], outputs: ['通知结果'], relatedModules: ['MOD-002'] },
    ]);
    expect(projectApi('MOD-002', graph)).toEqual({
      version: 1,
      module: 'MOD-002',
      routes: [{ path: '/api/users', inputModules: ['MOD-001'], outputModules: ['MOD-003'] }],
    });
    expect(incomingRelations('MOD-002', graph).map((relation) => relation.id)).toEqual(['REL-CHG-20260907-001-01']);
    expect(outgoingRelations('MOD-002', graph).map((relation) => relation.id)).toEqual(['REL-CHG-20260907-001-02']);
  });

  it('rejects relations that are not identically mirrored at both endpoints', () => {
    expect(() => buildCurrentSpecGraph({
      modules: [
        { id: 'MOD-001', name: '认证', status: 'ACTIVE' },
        { id: 'MOD-002', name: '用户管理', status: 'ACTIVE' },
      ],
      interfaces: [
        parseModuleInterface({ version: 1, module: 'MOD-001', relations: [httpRelation] }),
        parseModuleInterface({ version: 1, module: 'MOD-002', relations: [] }),
      ],
    })).toThrow(/mirror/i);
  });

  it('aggregates same-path HTTP methods into one route projection', () => {
    const getRelation = { ...httpRelation, id: 'REL-CHG-20260907-001-03', method: 'GET' };
    const graph = buildCurrentSpecGraph({
      modules: [
        { id: 'MOD-001', name: '认证', status: 'ACTIVE' },
        { id: 'MOD-002', name: '用户管理', status: 'ACTIVE' },
      ],
      interfaces: [
        parseModuleInterface({ version: 1, module: 'MOD-001', relations: [httpRelation, getRelation] }),
        parseModuleInterface({ version: 1, module: 'MOD-002', relations: [httpRelation, getRelation] }),
      ],
    });
    expect(projectApi('MOD-002', graph).routes).toEqual([
      { path: '/api/users', inputModules: ['MOD-001'], outputModules: [] },
    ]);
  });

  it('keeps retired modules out of API projections and rejects their relations', () => {
    const graph = buildCurrentSpecGraph({
      modules: [{ id: 'MOD-001', name: '旧用户管理', status: 'RETIRED' }],
      interfaces: [{ version: 1, module: 'MOD-001', relations: [] }],
    });
    expect(projectBusiness(graph).modules[0]).toMatchObject({ status: 'RETIRED', inputs: [], outputs: [] });
    expect(() => projectApi('MOD-001', graph)).toThrow(/No active API/i);
  });
});
