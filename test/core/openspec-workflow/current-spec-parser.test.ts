import { describe, expect, it } from 'vitest';

import { parseCurrentSpec, validateCurrentSpec } from '../../../src/core/openspec-workflow/current-spec-parser.js';

const currentSpec = (error = '- **ERROR** 系统记录异常上下文') => `# 用户管理

### MOD-002-REQ-006 用户详情
系统 MUST 展示用户详情。
#### Scenario: SCN-001 查询失败
- **GIVEN** 用户详情服务不可用
- **WHEN** 管理员打开详情
- **THEN** 系统显示失败提示
${error}
`;

describe('canonical current specification parser', () => {
  it('parses ERROR into the canonical Scenario model', () => {
    const parsed = parseCurrentSpec(currentSpec());

    expect(parsed.requirements[0].scenarios[0]).toMatchObject({
      id: 'SCN-001',
      error: ['系统记录异常上下文'],
    });
    expect(validateCurrentSpec(currentSpec())).toEqual([]);
  });

  it('preserves an explicitly empty ERROR for editing but reports it as incomplete', () => {
    const content = currentSpec('- **ERROR**');

    expect(parseCurrentSpec(content).requirements[0].scenarios[0].error).toEqual([]);
    expect(validateCurrentSpec(content).join(' ')).toMatch(
      /MOD-002-REQ-006.*SCN-001.*ERROR.*人工补写/i
    );
  });

  it('rejects a Scenario that has no ERROR line', () => {
    const content = currentSpec('');

    expect(() => parseCurrentSpec(content)).toThrow(
      /MOD-002-REQ-006.*SCN-001.*ERROR/i
    );
    expect(validateCurrentSpec(content).join(' ')).toMatch(
      /MOD-002-REQ-006.*SCN-001.*ERROR/i
    );
  });

  it('keeps multiple ERROR lines in source order', () => {
    const content = currentSpec('- **ERROR** first\n- **ERROR** second');

    expect(parseCurrentSpec(content).requirements[0].scenarios[0].error).toEqual([
      'first',
      'second',
    ]);
  });

  it('ignores fenced Scenario examples when validating the Current Specification', () => {
    const content = `${currentSpec()}
## Example

~~~markdown
#### Scenario: SCN-999 fenced example
- **GIVEN** example
- **WHEN** example
- **THEN** example
- **ERROR** example
~~~
`;

    const parsed = parseCurrentSpec(content);
    expect(parsed.requirements[0].scenarios).toHaveLength(1);
    expect(validateCurrentSpec(content)).toEqual([]);
  });
});
