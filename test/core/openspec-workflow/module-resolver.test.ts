import { describe, expect, it } from 'vitest';
import { resolveModuleOwnership } from '../../../src/core/openspec-workflow/module-resolver.js';

describe('module resolution', () => {
  it('classifies candidates by responsibility, dependency, and relevance', () => {
    const registry = {
      modules: [
        { id: 'MOD-001', name: '订单', responsibilities: ['创建和取消订单'], keywords: ['订单'] },
        { id: 'MOD-002', name: '支付', responsibilities: ['支付扣款'], keywords: ['支付'] },
      ],
      byId: new Map(),
      byName: new Map(),
    };
    const result = resolveModuleOwnership(registry, ['订单取消', '支付依赖', '日志'], [{ id: 'MOD-001-REQ-001', module: 'MOD-001', next: '订单取消' }]);
    expect(result.resolutions.map((item) => [item.module, item.outcome])).toEqual([
      ['MOD-001', 'OWNED'],
      ['MOD-002', 'DEPENDENCY'],
      [null, 'IRRELEVANT'],
    ]);
    expect(result.irrelevant).toEqual(['日志']);
  });

  it('reports score ties as ambiguity instead of guessing', () => {
    const registry = { modules: [
      { id: 'MOD-001', name: '订单', responsibilities: ['处理请求'], keywords: ['请求'] },
      { id: 'MOD-002', name: '支付', responsibilities: ['处理请求'], keywords: ['请求'] },
    ], byId: new Map(), byName: new Map() };
    expect(() => resolveModuleOwnership(registry, ['处理请求'], [])).toThrow(/ambiguous|tie/i);
  });

  it('uses responsibility, Requirement semantics, keywords, then name and description precedence', () => {
    const registry = { modules: [
      { id: 'MOD-001', name: '订单', description: '支付描述命中', responsibilities: ['退款审批'], keywords: ['支付'] },
      { id: 'MOD-002', name: '支付', description: '退款描述命中', responsibilities: ['扣款执行'], keywords: ['退款'] },
      { id: 'MOD-003', name: '通知', description: '发送消息', responsibilities: ['通知投递'], keywords: ['消息'] },
    ], byId: new Map(), byName: new Map() };

    const responsibility = resolveModuleOwnership(registry, ['退款审批支付'], []);
    expect(responsibility.resolutions[0]).toMatchObject({ module: 'MOD-001', outcome: 'OWNED' });

    const semantics = resolveModuleOwnership(
      registry,
      ['结算语义'],
      [{ id: 'MOD-002-REQ-001', module: 'MOD-002', next: '结算语义 SHALL 保持一致' }]
    );
    expect(semantics.resolutions[0]).toMatchObject({ module: 'MOD-002', outcome: 'OWNED' });

    const keyword = resolveModuleOwnership(registry, ['消息'], []);
    expect(keyword.resolutions[0]).toMatchObject({ module: 'MOD-003', outcome: 'OWNED' });
  });

  it('honors an explicit candidate outcome and emits an outcome for every candidate', () => {
    const registry = { modules: [
      { id: 'MOD-001', name: '订单', responsibilities: ['订单处理'], keywords: ['订单'] },
    ], byId: new Map(), byName: new Map() };

    const result = resolveModuleOwnership(
      registry,
      [
        { module: 'MOD-001', text: '外部订单调用', outcome: 'DEPENDENCY' },
        { text: '完全无关文本', outcome: 'IRRELEVANT' },
      ],
      []
    );

    expect(result.resolutions).toHaveLength(2);
    expect(result.resolutions[0]).toMatchObject({ module: 'MOD-001', outcome: 'DEPENDENCY' });
    expect(result.resolutions[1]).toMatchObject({ module: null, outcome: 'IRRELEVANT' });
  });
});
