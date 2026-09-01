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
});
