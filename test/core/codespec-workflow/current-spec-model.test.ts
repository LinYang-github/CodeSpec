import { describe, expect, it } from 'vitest';

import { parseCurrentSpecification, renderCurrentSpecification, validateCurrentDesignOwnership, validateCurrentSpecification, validateCurrentSpecificationTraceability } from '../../../src/core/codespec-workflow/current-spec-model.js';
import * as snapshots from '../../../src/core/codespec-workflow/current-spec-model.js';
import { currentMarkdown, requirementMarkdown, h3Snapshot } from '../../helpers/rich-requirement.js';

describe('shared rich Requirement snapshots', () => {
  it.each([
    [String.raw`选择 A \| B`, '选择 A | B'],
    ['`A \\| B`', '`A | B`'],
    [String.raw`选择 A \\\| B`, String.raw`选择 A \\| B`],
  ])('preserves escaped pipes in every test-step table cell across snapshot round trips: %s', (cell, action) => {
    const source = requirementMarkdown.replace('| 1 | 点击新增用户 | 打开表单 |', `| 1 | ${cell} | 显示 X \\| Y |`);
    const snapshot = snapshots.parseRequirementSnapshot(source);
    expect(snapshot.scenarios[0]!.testCases[0]!.steps[0]).toEqual({ number: '1', action, expected: '显示 X | Y' });
    expect(snapshots.parseRequirementSnapshot(snapshots.renderRequirementSnapshot(snapshot))).toEqual(snapshot);
  });

  it('does not collapse different expectations into one hash when a preceding cell contains an escaped pipe', () => {
    const source = requirementMarkdown.replace('| 1 | 点击新增用户 | 打开表单 |', String.raw`| 1 | 选择 A \| B | 显示结果 X |`);
    const original = snapshots.parseRequirementSnapshot(source);
    const changed = snapshots.parseRequirementSnapshot(source.replace('显示结果 X', '显示结果 Y'));
    expect(snapshots.hashRequirementSnapshot(changed)).not.toBe(snapshots.hashRequirementSnapshot(original));
  });

  it('preserves engineering-file table cells containing escaped pipes', () => {
    const source = currentMarkdown.replace('| 自动化测试 |', String.raw`| 自动化测试 \| 回归验证 |`);
    const current = parseCurrentSpecification(source);
    expect(current.engineeringFiles[0]!.role).toBe('自动化测试 | 回归验证');
    expect(parseCurrentSpecification(renderCurrentSpecification(current))).toEqual(current);
  });

  it('normalizes presentation-only soft wrapping before hashing snapshots', () => {
    const plain = snapshots.parseRequirementSnapshot(requirementMarkdown.replace('THEN 用户出现在列表', 'THEN the user appears in the list'));
    const wrapped = snapshots.parseRequirementSnapshot(requirementMarkdown.replace('THEN 用户出现在列表', 'THEN the user appears\n  in the list'));
    expect(snapshots.hashRequirementSnapshot(wrapped)).toBe(snapshots.hashRequirementSnapshot(plain));
    expect(wrapped).toEqual(plain);
  });

  it.each(['  \n', '\\\n'])('preserves a meaningful hard break %j in snapshot state and hashes', (hardBreak) => {
    const plain = snapshots.parseRequirementSnapshot(requirementMarkdown.replace('THEN 用户出现在列表', 'THEN first line second line'));
    const hard = snapshots.parseRequirementSnapshot(requirementMarkdown.replace('THEN 用户出现在列表', `THEN first line${hardBreak}  second line`));
    expect(hard.scenarios[0]!.then[0]).toContain('\n');
    expect(snapshots.hashRequirementSnapshot(hard)).not.toBe(snapshots.hashRequirementSnapshot(plain));
    expect(snapshots.parseRequirementSnapshot(snapshots.renderRequirementSnapshot(hard))).toEqual(hard);
  });

  it('normalizes soft wrapping alongside inline-code whitespace and a meaningful hard break', () => {
    const plain = requirementMarkdown.replace('THEN 用户出现在列表', 'THEN first **soft** line with `left  \n  right` and hard  \n  break');
    const wrapped = plain.replace('first **soft** line', 'first **soft**\n  line');
    const snapshot = snapshots.parseRequirementSnapshot(wrapped);
    expect(snapshot).toEqual(snapshots.parseRequirementSnapshot(plain));
    expect(snapshot.scenarios[0]!.then[0]).toContain('`left  \nright`');
    expect(snapshot.scenarios[0]!.then[0]).toContain('hard  \nbreak');
  });

  it.each([2, 3] as const)('round-trips exactly one Requirement at H%s, including tests, errors and evidence', (level) => {
    const current = parseCurrentSpecification(currentMarkdown);
    const requirement = snapshots.findCurrentRequirement(current, 'MOD-002-REQ-006')!;
    const rendered = snapshots.renderRequirementSnapshot(requirement, level);
    expect(rendered).not.toContain('REQ-007');
    expect(rendered).not.toContain('当前模块工程文件');
    expect(snapshots.parseRequirementSnapshot(rendered, level)).toEqual(requirement);
    expect(snapshots.parseRequirementSnapshot(level === 2 ? requirementMarkdown : h3Snapshot(), level)).toEqual(requirement);
    expect(requirement.scenarios[0]).toMatchObject({ error: ['重复用户时拒绝创建'], testCases: [{
      engineeringLocations: ['/users', 'src/users.ts'], verificationSource: 'verification.yaml',
      executionCommand: 'pnpm test', verificationEnvironment: 'test', verificationTime: '2026-09-15T00:00:00Z',
      verificationSummary: '列表显示新用户', steps: [{ number: '1', action: '点击新增用户', expected: '打开表单' }, { number: '2', action: '提交有效信息', expected: '用户出现在列表' }],
    }] });
    expect(snapshots.findCurrentRequirement(current, '6')).toBeUndefined();
    expect(snapshots.findCurrentRequirement(current, 'MOD-002-REQ-999')).toBeUndefined();
  });

  it('hashes semantic state independently of line endings, blank lines, heading depth and table padding', () => {
    const baseline = snapshots.parseRequirementSnapshot(requirementMarkdown);
    const reformatted = snapshots.parseRequirementSnapshot(h3Snapshot().replaceAll(' | ', '  |  ').replaceAll('\n', '\r\n'), 3);
    expect(snapshots.hashRequirementSnapshot(reformatted)).toBe(snapshots.hashRequirementSnapshot(baseline));
    const changed = structuredClone(baseline);
    changed.scenarios[0]!.testCases[0]!.steps[0]!.expected = '直接创建用户';
    expect(snapshots.hashRequirementSnapshot(changed)).not.toBe(snapshots.hashRequirementSnapshot(baseline));
    const evidence = structuredClone(baseline);
    evidence.scenarios[0]!.testCases[0]!.verificationSummary = '不同证据';
    expect(snapshots.hashRequirementSnapshot(evidence)).not.toBe(snapshots.hashRequirementSnapshot(baseline));
  });

  it.each([
    currentMarkdown,
    requirementMarkdown + requirementMarkdown.replaceAll('REQ-006', 'REQ-008'),
    requirementMarkdown.replace('MOD-002-REQ-006-SCN-001 有效提交', 'SCN-001 有效提交'),
    requirementMarkdown.replaceAll('MOD-002-REQ-006-SCN-001-TC', 'MOD-002-REQ-007-SCN-001-TC'),
    requirementMarkdown.replace('- ERROR 重复用户时拒绝创建', ''),
    requirementMarkdown + '\n不应丢弃的游离正文\n',
  ])('rejects whole Specs, extra Requirements, short IDs, foreign tests and unconsumed content', (source) => {
    expect(() => snapshots.parseRequirementSnapshot(source)).toThrow();
  });

  it.each([
    requirementMarkdown.replace('- THEN 用户出现在列表', '- THEN 用户出现在列表\n  - 不得忽略的嵌套行为'),
    requirementMarkdown.replace('- **类型：** UI', '- **类型：** UI\n\n  ```text\n  不得忽略的测试说明\n  ```'),
  ])('rejects nested snapshot content that the rich model cannot preserve', (source) => {
    expect(() => snapshots.parseRequirementSnapshot(source)).toThrow(/snapshot|unconsumed|nested/i);
  });
});

describe('current specification Markdown model', () => {
  it('keeps archived verification logs outside the requirement grammar', () => {
    const archived = `${currentMarkdown.trimEnd()}\n\n### 最近验证摘要\n\n- \`MOD-002-REQ-006-SCN-001-TC-UI-01\`：PASS；TAP version 13
# Subtest: 用户创建
ok 1 - 用户创建
  ---
  duration_ms: 10
  ...
1..1\n`;

    expect(parseCurrentSpecification(archived)).toEqual(parseCurrentSpecification(currentMarkdown));
  });

  it('allows design IDs but rejects duplicated scenario bodies', () => {
    const specification = parseCurrentSpecification(`# 用户管理

- **模块编号：** MOD-002
- **规格版本：** 1

## MOD-002-REQ-001：管理员新增用户

#### Scenario: MOD-002-REQ-001-SCN-001 新增有效用户
- GIVEN 管理员已登录
- WHEN 管理员提交合法用户信息
- THEN 用户列表出现新用户
- ERROR 参数不合法时不创建用户
`);
    expect(validateCurrentDesignOwnership('## 方案\n\n关联 `MOD-002-REQ-001` 与 `MOD-002-REQ-001-SCN-001`。\n', specification)).toEqual([]);
    expect(validateCurrentDesignOwnership('## Scenario\n- GIVEN 已登录\n- WHEN 提交\n- THEN 创建\n- ERROR 拒绝\n', specification))
      .toContainEqual(expect.stringMatching(/重复|scenario|行为/i));
    expect(validateCurrentDesignOwnership('## 方案\n关联 `MOD-002-REQ-999`。\n', specification))
      .toContainEqual(expect.stringMatching(/不存在|unknown/i));
  });
  it('reads the fixed requirement, scenario, and UI test-case hierarchy from Markdown AST', () => {
    const parsed = parseCurrentSpecification(`# 用户管理

- **模块编号：** MOD-002
- **规格版本：** 1

## MOD-002-REQ-001：管理员新增用户

#### Scenario: MOD-002-REQ-001-SCN-001 新增有效用户
- GIVEN 管理员已登录
- WHEN 管理员提交合法用户信息
- THEN 用户列表出现新用户
- ERROR 参数不合法时不创建用户

### 测试用例

#### MOD-002-REQ-001-SCN-001-TC-UI-01：管理员新增有效用户

- **类型：** UI E2E
- **自动化测试：** \`e2e/user-management/add-user.spec.ts\`
- **测试标识：** \`TC-UI-01\`
- **工程定位：** \`/users\`；\`src/pages/UserManagementPage.tsx\`
- **执行命令：** \`pnpm playwright test e2e/user-management/add-user.spec.ts\`
- **验证环境：** test；服务 user-service；浏览器 chromium
- **验证摘要：** 新用户出现在用户列表中
- **最近验证：** PASS

| 步骤 | 用户操作 | 预期结果 |
| --- | --- | --- |
| 1 | 进入“用户管理”界面 | 显示标题和“新增用户”按钮 |

### 当前模块工程文件

| 文件 | 作用 | 关联需求 / 场景 / 测试用例 |
| --- | --- | --- |
| \`src/pages/UserManagementPage.tsx\` | 用户管理页面 | \`MOD-002-REQ-001\`；\`MOD-002-REQ-001-SCN-001\` |
`);

    expect(parsed.module).toBe('MOD-002');
    expect(parsed.requirements[0]).toMatchObject({
      id: 'MOD-002-REQ-001',
      scenarios: [{
        id: 'MOD-002-REQ-001-SCN-001',
        given: ['管理员已登录'],
        when: ['管理员提交合法用户信息'],
        then: ['用户列表出现新用户'],
        error: ['参数不合法时不创建用户'],
        testCases: [{
          id: 'MOD-002-REQ-001-SCN-001-TC-UI-01',
          type: 'UI E2E',
          automationTest: 'e2e/user-management/add-user.spec.ts',
          testId: 'TC-UI-01',
          engineeringLocations: ['/users', 'src/pages/UserManagementPage.tsx'],
          executionCommand: 'pnpm playwright test e2e/user-management/add-user.spec.ts',
          verificationEnvironment: 'test；服务 user-service；浏览器 chromium',
          verificationSummary: '新用户出现在用户列表中',
          steps: [{
            number: '1',
            action: '进入“用户管理”界面',
            expected: '显示标题和“新增用户”按钮',
          }],
        }],
      }],
    });
    expect(parsed.engineeringFiles).toEqual([{
      path: 'src/pages/UserManagementPage.tsx',
      role: '用户管理页面',
      references: ['MOD-002-REQ-001', 'MOD-002-REQ-001-SCN-001'],
    }]);
  });

  it('renders the parsed model back into the fixed readable Markdown structure', () => {
    const source = `# 用户管理

- **模块编号：** MOD-002
- **规格版本：** 1

## MOD-002-REQ-001：管理员新增用户

#### Scenario: MOD-002-REQ-001-SCN-001 新增有效用户
- GIVEN 管理员已登录
- WHEN 管理员提交合法用户信息
- THEN 用户列表出现新用户
- ERROR 参数不合法时不创建用户

### 测试用例

#### MOD-002-REQ-001-SCN-001-TC-UI-01：管理员新增用户

- **类型：** UI E2E
- **自动化测试：** \`e2e/user-management/add-user.spec.ts\`
- **测试标识：** \`TC-UI-01\`
- **最近验证：** PASS

| 步骤 | 用户操作 | 预期结果 |
| --- | --- | --- |
| 1 | 进入用户管理界面 | 显示新增用户按钮 |

### 当前模块工程文件

| 文件 | 作用 | 关联需求 / 场景 / 测试用例 |
| --- | --- | --- |
| \`src/pages/UserManagementPage.tsx\` | 用户管理页面 | \`MOD-002-REQ-001\` |
`;
    const rendered = renderCurrentSpecification(parseCurrentSpecification(source));
    expect(rendered).toContain('## MOD-002-REQ-001：管理员新增用户');
    expect(rendered).toContain('| `src/pages/UserManagementPage.tsx` | 用户管理页面 | `MOD-002-REQ-001` |');
    expect(parseCurrentSpecification(rendered)).toMatchObject({ module: 'MOD-002', requirements: [{ scenarios: [{ testCases: [{ steps: [{ number: '1' }] }] }] }] });
  });

  it('rejects engineering-file references that do not exist in the same specification', () => {
    const parsed = parseCurrentSpecification(`# 用户管理

- **模块编号：** MOD-002
- **规格版本：** 1

### 当前模块工程文件

| 文件 | 作用 | 关联需求 / 场景 / 测试用例 |
| --- | --- | --- |
| \`src/pages/UserManagementPage.tsx\` | 用户管理页面 | \`MOD-002-REQ-404\` |
`);
    expect(validateCurrentSpecificationTraceability(parsed)).toContain(
      '工程文件 src/pages/UserManagementPage.tsx 引用了不存在的 ID：MOD-002-REQ-404'
    );
  });

  it('requires each automated test file to reference its test-case ID', () => {
    const parsed = parseCurrentSpecification(`# 用户管理

- **模块编号：** MOD-002
- **规格版本：** 1

## MOD-002-REQ-001：新增用户

#### Scenario: MOD-002-REQ-001-SCN-001 成功
- GIVEN 已登录
- WHEN 提交
- THEN 创建成功
- ERROR 参数错误

### 测试用例

#### MOD-002-REQ-001-SCN-001-TC-UI-01：新增用户

- **类型：** UI E2E
- **自动化测试：** \`e2e/add-user.spec.ts\`
- **测试标识：** \`TC-UI-01\`
- **最近验证：** PASS

| 步骤 | 用户操作 | 预期结果 |
| --- | --- | --- |
| 1 | 提交 | 成功 |

### 当前模块工程文件

| 文件 | 作用 | 关联需求 / 场景 / 测试用例 |
| --- | --- | --- |
| \`e2e/add-user.spec.ts\` | 自动化测试 | \`MOD-002-REQ-001-SCN-001\` |
`);
    expect(validateCurrentSpecificationTraceability(parsed)).toContain(
      '自动化测试文件 e2e/add-user.spec.ts 未关联测试用例：MOD-002-REQ-001-SCN-001-TC-UI-01'
    );
  });

  it('validates that every global ID belongs to the declared module', () => {
    const parsed = parseCurrentSpecification(`# 用户管理

- **模块编号：** MOD-002
- **规格版本：** 1

## MOD-001-REQ-001：错误归属

### 当前模块工程文件

| 文件 | 作用 | 关联需求 / 场景 / 测试用例 |
| --- | --- | --- |
| \`src/user.ts\` | 用户模块 | \`MOD-001-REQ-001\` |
`);
    expect(validateCurrentSpecification(parsed)).toContain('Requirement MOD-001-REQ-001 不属于模块 MOD-002');
  });

  it('rejects malformed engineering-file tables instead of silently dropping cells', () => {
    expect(() => parseCurrentSpecification(`# 用户管理

- **模块编号：** MOD-002
- **规格版本：** 1

### 当前模块工程文件

| 文件 | 作用 | 关联需求 / 场景 / 测试用例 |
| --- | --- | --- |
| \`src/user.ts\` | 用户模块 |
`)).toThrow(/工程文件关联.*inline code/i);
  });

  it('parses active-change engineering file metadata and renders it back', () => {
    const source = `# 用户管理

- **模块编号：** MOD-002
- **规格版本：** 1

### 当前模块工程文件

| 文件 | 模块编号 | 变更 | 作用 | 关联需求 / 场景 / 测试用例 |
| --- | --- | --- | --- | --- |
| \`src/user.ts\` | MOD-002 | 修改 | 用户服务 | \`MOD-002-REQ-001\` |
| \`src/old-user.ts\` | MOD-002 | 删除 | 旧实现 | \`MOD-002-REQ-001\` |
`;
    const parsed = parseCurrentSpecification(source);
    expect(parsed.engineeringFiles).toEqual([
      { path: 'src/user.ts', module: 'MOD-002', change: '修改', role: '用户服务', references: ['MOD-002-REQ-001'] },
      { path: 'src/old-user.ts', module: 'MOD-002', change: '删除', role: '旧实现', references: ['MOD-002-REQ-001'] },
    ]);
    const rendered = renderCurrentSpecification(parsed);
    expect(rendered).toContain('| 文件 | 模块编号 | 变更 | 作用 | 关联需求 / 场景 / 测试用例 |');
    expect(parseCurrentSpecification(rendered).engineeringFiles).toEqual(parsed.engineeringFiles);
  });

  it('rejects unsafe engineering file paths', () => {
    const parsed = parseCurrentSpecification(`# 用户管理

- **模块编号：** MOD-002
- **规格版本：** 1

### 当前模块工程文件

| 文件 | 作用 | 关联需求 / 场景 / 测试用例 |
| --- | --- | --- |
| \`../outside.ts\` | 越界文件 | \`MOD-002-REQ-001\` |
`);
    expect(validateCurrentSpecification(parsed)).toContain('工程文件路径必须是仓库内相对路径：../outside.ts');
  });
});
