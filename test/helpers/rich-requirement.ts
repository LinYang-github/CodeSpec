/** Authored rich fixture; no production parser/renderer participates in its construction. */
export const requirementMarkdown = `## MOD-002-REQ-006：新增用户

#### Scenario: MOD-002-REQ-006-SCN-001 有效提交
- GIVEN 已登录
- WHEN 提交用户
- THEN 用户出现在列表
- ERROR 重复用户时拒绝创建

### 测试用例

#### MOD-002-REQ-006-SCN-001-TC-UI-01：提交用户
- **类型：** UI
- **自动化测试：** \`e2e/users.spec.ts\`
- **测试标识：** \`data-testid=add-user\`
- **工程定位：** \`/users\`；\`src/users.ts\`
- **验证来源：** verification.yaml
- **执行命令：** \`pnpm test\`
- **验证环境：** test
- **验证时间：** 2026-09-15T00:00:00Z
- **验证摘要：** 列表显示新用户
- **最近验证：** PASS

| 步骤 | 用户操作 | 预期结果 |
| --- | --- | --- |
| 1 | 点击新增用户 | 打开表单 |
| 2 | 提交有效信息 | 用户出现在列表 |
`;

export const currentMarkdown = `# 用户管理

- **模块编号：** MOD-002
- **规格版本：** 1

${requirementMarkdown}
## MOD-002-REQ-007：无关需求

#### Scenario: MOD-002-REQ-007-SCN-001 无关场景
- GIVEN 就绪
- WHEN 查询
- THEN 显示状态
- ERROR 提示重试

### 测试用例

### 当前模块工程文件

| 文件 | 作用 | 关联需求 / 场景 / 测试用例 |
| --- | --- | --- |
| \`e2e/users.spec.ts\` | 自动化测试 | \`MOD-002-REQ-006-SCN-001-TC-UI-01\` |
`;

export function h3Snapshot(source = requirementMarkdown): string {
  return source.replace(/^(#{2,4}) /gm, '#$1 ');
}

export function richDelta(action: 'ADDED' | 'MODIFIED' | 'REMOVED' = 'ADDED', source = requirementMarkdown): string {
  return `# 用户管理增量\n\n- **模块编号：** MOD-002\n- **规格版本：** 1\n\n## ${action}\n\n` +
    (action !== 'ADDED' ? `**Previous**\n\n${h3Snapshot(source)}\n` : '') +
    (action !== 'REMOVED' ? `**New**\n\n${h3Snapshot(action === 'MODIFIED' ? source.replace('THEN 用户出现在列表', 'THEN 用户出现在列表顶部') : source)}\n` : '') +
    '**Reason**\n\n支持用户管理。\n\n## 工程文件增量\n\n' +
    '| 文件 | 模块编号 | 变更 | 作用 | 关联需求 / 场景 / 测试用例 |\n| --- | --- | --- | --- | --- |\n' +
    '| `e2e/users.spec.ts` | MOD-002 | 修改 | 自动化测试 | `MOD-002-REQ-006-SCN-001-TC-UI-01` |\n';
}
