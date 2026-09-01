import { describe, expect, it } from 'vitest';
import { parseDeltaSpec } from '../../../src/core/openspec-workflow/delta-parser.js';

describe('canonical delta parser', () => {
  it('parses actions, full blocks, and GIVEN/WHEN/THEN scenarios', () => {
    const parsed = parseDeltaSpec(`## ADDED\n### MOD-002-REQ-017 支付\n**New**\n系统 SHALL 支持支付。\n#### Scenario: 成功\n- **GIVEN** 已下单\n- **WHEN** 支付\n- **THEN** 完成\n\n## MODIFIED\n### MOD-002-REQ-006 取消\n**Previous**\n旧规则\n**New**\n新规则\n**Reason**\n业务变化`);
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0]).toMatchObject({ action: 'ADDED', id: 'MOD-002-REQ-017', next: '系统 SHALL 支持支付。' });
    expect(parsed.entries[0].scenarios[0]).toMatchObject({ given: ['已下单'], when: ['支付'], then: ['完成'] });
    expect(parsed.entries[1]).toMatchObject({ action: 'MODIFIED', previous: '旧规则', next: '新规则', reason: '业务变化' });
  });

  it('requires Previous for MODIFIED and REMOVED entries', () => {
    expect(() => parseDeltaSpec('## MODIFIED\n### MOD-002-REQ-006 订单取消\n**New**\n新规则')).toThrow(/Previous/i);
  });
});
