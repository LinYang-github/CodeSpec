import { describe, expect, it } from 'vitest';
import { parseDeltaSpec } from '../../../src/core/openspec-workflow/delta-parser.js';

describe('canonical delta parser', () => {
  it('parses actions, full blocks, and GIVEN/WHEN/THEN scenarios', () => {
    const parsed = parseDeltaSpec(`## ADDED\n### MOD-002-REQ-017 支付\n**New**\n系统 SHALL 支持支付。\n#### Scenario: SCN-001 成功\n- **GIVEN** 已下单\n- **WHEN** 支付\n- **THEN** 完成\n\n## MODIFIED\n### MOD-002-REQ-006 取消\n**Previous**\n旧规则\n**New**\n新规则\n**Reason**\n业务变化\n#### Scenario: SCN-002 变更\n- **GIVEN** 旧状态\n- **WHEN** 操作\n- **THEN** 新状态`);
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0]).toMatchObject({ action: 'ADDED', id: 'MOD-002-REQ-017', next: '系统 SHALL 支持支付。' });
    expect(parsed.entries[0].scenarios[0]).toMatchObject({ given: ['已下单'], when: ['支付'], then: ['完成'] });
    expect(parsed.entries[1]).toMatchObject({ action: 'MODIFIED', previous: '旧规则', next: '新规则', reason: '业务变化' });
  });

  it('requires Previous for MODIFIED and REMOVED entries', () => {
    expect(() => parseDeltaSpec('## MODIFIED\n### MOD-002-REQ-006 订单取消\n**New**\n新规则')).toThrow(/Previous/i);
  });

  it('requires a non-empty Reason for MODIFIED entries', () => {
    expect(() => parseDeltaSpec(`## MODIFIED
### MOD-002-REQ-006 订单取消
**Previous**
旧规则
**New**
新规则
**Reason**
#### Scenario: SCN-002 变更
- **GIVEN** 旧状态
- **WHEN** 操作
- **THEN** 新状态`)).toThrow('MODIFIED MOD-002-REQ-006 requires Reason');
  });

  it('preserves explicit scenario identity and rejects incomplete scenarios', () => {
    const parsed = parseDeltaSpec('## ADDED\n### MOD-002-REQ-017 支付\n**New**\n规则\n#### Scenario: SCN-042 支付成功\n- **GIVEN** 已下单\n- **WHEN** 支付\n- **THEN** 完成');
    expect(parsed.entries[0].scenarios[0]).toMatchObject({ id: 'SCN-042', name: '支付成功' });
    expect(() => parseDeltaSpec('## ADDED\n### MOD-002-REQ-018 支付\n**New**\n规则\n#### Scenario: SCN-043 不完整\n- **GIVEN** 已下单\n- **WHEN** 支付')).toThrow(/THEN/i);
  });

  it('rejects an ID-only scenario header because the scenario name is stable identity', () => {
    expect(() => parseDeltaSpec(`## ADDED
### MOD-002-REQ-017 支付
**New**
规则
#### Scenario: SCN-042
- **GIVEN** 已下单
- **WHEN** 支付
- **THEN** 完成`)).toThrow(/scenarios\.0\.name.*Too small/i);
  });

  it('requires New for ADDED and rejects empty sections', () => {
    expect(() => parseDeltaSpec('## ADDED\n### MOD-002-REQ-019 支付')).toThrow(/New/i);
    expect(() => parseDeltaSpec('## REMOVED\n### MOD-002-REQ-020 支付\n**Previous**\n旧\n**Reason**\n')).toThrow(/empty|scenario|Reason/i);
  });
});
