import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseDeltaSpec } from '../../../src/core/openspec-workflow/delta-parser.js';

const scenario = (id: string, name: string) => `#### Scenario: ${id} ${name}
- **GIVEN** 已有前置条件
- **WHEN** 执行业务动作
- **THEN** 产生可观察结果`;

describe('canonical delta parser', () => {
  it('parses every Requirement under every action into complete snapshots', () => {
    const parsed = parseDeltaSpec(`
# 需求增量

## ADDED

### MOD-002-REQ-017 支付
**New**
系统 SHALL 支持支付。
${scenario('SCN-001', '支付成功')}

### MOD-002-REQ-018 退款
**New**
系统 SHALL 支持退款。
${scenario('SCN-002', '退款成功')}

## MODIFIED

### MOD-002-REQ-006 取消
**Previous**
系统 SHALL 使用旧规则。
${scenario('SCN-003', '旧取消规则')}
**New**
系统 SHALL 使用新规则。
${scenario('SCN-004', '新取消规则')}
**Reason**
业务规则变化。

### MOD-002-REQ-007 查询
**Previous**
系统 SHALL 返回旧字段。
${scenario('SCN-005', '旧查询规则')}
**New**
系统 SHALL 返回新字段。
${scenario('SCN-006', '新查询规则')}
**Reason**
接口契约变化。

## REMOVED

### MOD-002-REQ-008 旧接口
**Previous**
系统 SHALL 暴露旧接口。
${scenario('SCN-007', '旧接口调用')}
**Reason**
旧接口已下线。

### MOD-002-REQ-009 旧事件
**Previous**
系统 SHALL 发送旧事件。
${scenario('SCN-008', '旧事件发送')}
**Reason**
旧事件已替代。
`);

    expect(parsed.entries).toHaveLength(6);
    expect(parsed.entries.map(({ action, id }) => [action, id])).toEqual([
      ['ADDED', 'MOD-002-REQ-017'],
      ['ADDED', 'MOD-002-REQ-018'],
      ['MODIFIED', 'MOD-002-REQ-006'],
      ['MODIFIED', 'MOD-002-REQ-007'],
      ['REMOVED', 'MOD-002-REQ-008'],
      ['REMOVED', 'MOD-002-REQ-009'],
    ]);
    expect(parsed.entries[0]).toMatchObject({
      title: '支付',
      action: 'ADDED',
      next: expect.stringContaining('### MOD-002-REQ-017 支付'),
    });
    expect(parsed.entries[2]).toMatchObject({
      action: 'MODIFIED',
      previous: expect.stringContaining('系统 SHALL 使用旧规则。'),
      next: expect.stringContaining('系统 SHALL 使用新规则。'),
      reason: '业务规则变化。',
      scenarios: [{ id: 'SCN-004', name: '新取消规则' }],
    });
    expect(parsed.entries[4]).toMatchObject({
      action: 'REMOVED',
      previous: expect.stringContaining('### MOD-002-REQ-008 旧接口'),
      reason: '旧接口已下线。',
      scenarios: [{ id: 'SCN-007', name: '旧接口调用' }],
    });
  });

  it('uses the same bold control-label grammar as the code-spec template', () => {
    const template = readFileSync(
      path.join(process.cwd(), 'schemas', 'code-spec', 'templates', 'spec.md'),
      'utf8'
    );

    expect(template).toContain('**Previous**');
    expect(template).toContain('**New**');
    expect(template).toContain('**Reason**');
    expect(template).not.toMatch(/^#### (?:Previous|New|Reason)$/mu);
    expect(template.match(/## ADDED[\s\S]*?\*\*New\*\*/u)).toBeTruthy();
  });

  it('rejects malformed or unconsumed content instead of silently dropping it', () => {
    expect(() =>
      parseDeltaSpec(`## ADDED
orphan content
### MOD-002-REQ-017 支付
**New**
规则
${scenario('SCN-001', '成功')}`)
    ).toThrow(/unconsumed|orphan|Requirement/i);

    expect(() =>
      parseDeltaSpec(`## ADDED
### malformed requirement
**New**
规则
${scenario('SCN-001', '成功')}`)
    ).toThrow(/malformed|Requirement/i);

    expect(() =>
      parseDeltaSpec(`## ADDED
### MOD-002-REQ-017 支付
**New**
规则
${scenario('SCN-001', '成功')}
unexpected scenario prose`)
    ).toThrow(/unconsumed|unexpected/i);
  });

  it('rejects duplicate Requirement IDs, duplicate labels, and unknown action sections', () => {
    expect(() =>
      parseDeltaSpec(`## ADDED
### MOD-002-REQ-017 支付
**New**
规则
${scenario('SCN-001', '成功')}
### MOD-002-REQ-017 重复
**New**
规则
${scenario('SCN-002', '重复')}`)
    ).toThrow(/duplicate.*MOD-002-REQ-017/i);

    expect(() =>
      parseDeltaSpec(`## ADDED
### MOD-002-REQ-017 支付
**New**
规则
**New**
重复
${scenario('SCN-001', '成功')}`)
    ).toThrow(/duplicate.*New/i);

    expect(() => parseDeltaSpec('## RENAMED\n### MOD-002-REQ-017 支付')).toThrow(
      /unknown|RENAMED|action/i
    );
  });

  it('requires the exact action-specific sections and complete scenarios', () => {
    expect(() =>
      parseDeltaSpec(`## MODIFIED
### MOD-002-REQ-006 订单取消
**New**
新规则
${scenario('SCN-002', '变更')}
**Reason**
变化`)
    ).toThrow(/Previous/i);

    expect(() =>
      parseDeltaSpec(`## ADDED
### MOD-002-REQ-018 支付
**Previous**
旧规则
${scenario('SCN-003', '旧规则')}
**New**
新规则
${scenario('SCN-004', '新规则')}`)
    ).toThrow(/Previous.*ADDED|unexpected.*Previous/i);

    expect(() =>
      parseDeltaSpec(`## ADDED
### MOD-002-REQ-019 支付
**New**
规则
#### Scenario: SCN-043 不完整
- **GIVEN** 已下单
- **WHEN** 支付`)
    ).toThrow(/THEN/i);
  });
});
