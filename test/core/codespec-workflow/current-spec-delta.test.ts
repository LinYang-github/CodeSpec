import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as delta from '../../../src/core/codespec-workflow/current-spec-delta.js';
import { projectCurrentSpecForDesignApproval, projectCurrentSpecForPlanApproval } from '../../../src/core/codespec-workflow/current-change-yaml.js';
import { currentMarkdown, h3Snapshot, richDelta } from '../../helpers/rich-requirement.js';

describe('canonical rich Requirement deltas', () => {
  it('parses the authoring template as exactly one rich Requirement delta', () => {
    const source = readFileSync('schemas/code-spec/templates/spec.md', 'utf8');
    const parsed = delta.parseCurrentSpecDelta(source);
    expect(parsed.requirements).toHaveLength(1);
    expect(parsed.requirements[0]?.next?.scenarios[0]?.testCases[0]?.steps).toHaveLength(1);
    expect(delta.parseCurrentSpecDelta(delta.renderCurrentSpecDelta(parsed))).toEqual(parsed);
  });

  it('preserves independent Previous/New titles and reports invalid programmatic delta state', () => {
    const source = richDelta('MODIFIED');
    const marker = source.indexOf('**New**');
    const renamed = source.slice(0, marker) + source.slice(marker).replace('：新增用户', '：批量新增用户');
    const document = delta.parseCurrentSpecDelta(renamed);
    expect(document.requirements[0]?.previous?.title).toBe('新增用户');
    expect(document.requirements[0]?.next?.title).toBe('批量新增用户');
    document.requirements[0]!.next!.id = 'MOD-002-REQ-007';
    expect(delta.validateCurrentSpecDelta(document).join('\n')).toMatch(/Previous\/New Requirement IDs/);
    expect(() => delta.renderCurrentSpecDelta(document)).toThrow();
  });

  it('returns validation issues for malformed module strings without compiling them as regexes', () => {
    const document = delta.parseCurrentSpecDelta(richDelta());
    document.module = '[';
    document.requirements[0]!.module = '[';
    expect(delta.validateCurrentSpecDelta(document).join('\n')).toMatch(/module/);
  });
  it.each(['ADDED', 'MODIFIED', 'REMOVED'] as const)('round-trips %s with complete stable snapshots and explicit file actions', (action) => {
    const parsed = delta.parseCurrentSpecDelta(richDelta(action));
    expect(parsed).toMatchObject({ module: 'MOD-002', version: 1, requirements: [{
      id: 'MOD-002-REQ-006', module: 'MOD-002', action, reason: '支持用户管理。',
    }], engineeringFiles: [{ path: 'e2e/users.spec.ts', module: 'MOD-002', change: '修改' }] });
    const entry = parsed.requirements[0]!;
    if (action !== 'ADDED') expect(entry.previous?.scenarios[0]?.testCases[0]?.steps).toHaveLength(2);
    if (action === 'ADDED') expect(entry.previous).toBeUndefined();
    if (action === 'REMOVED') expect(entry.next).toBeUndefined();
    else expect(entry.next?.scenarios[0]?.id).toBe('MOD-002-REQ-006-SCN-001');
    expect(delta.validateCurrentSpecDelta(parsed)).toEqual([]);
    expect(delta.parseCurrentSpecDelta(delta.renderCurrentSpecDelta(parsed))).toEqual(parsed);
  });

  it('groups repeated label sequences and all three actions without extra outer Requirement headings', () => {
    const added = richDelta('ADDED');
    const second = added.slice(added.indexOf('**New**'), added.indexOf('## 工程文件增量')).replaceAll('REQ-006', 'REQ-008');
    const modified = richDelta('MODIFIED').slice(richDelta('MODIFIED').indexOf('## MODIFIED'), richDelta('MODIFIED').indexOf('## 工程文件增量')).replaceAll('REQ-006', 'REQ-009');
    const removed = richDelta('REMOVED').slice(richDelta('REMOVED').indexOf('## REMOVED'), richDelta('REMOVED').indexOf('## 工程文件增量')).replaceAll('REQ-006', 'REQ-010');
    const source = added.replace('## 工程文件增量', second + modified + removed + '## 工程文件增量');
    expect(delta.parseCurrentSpecDelta(source).requirements.map(({ action, id }) => [action, id])).toEqual([
      ['ADDED', 'MOD-002-REQ-006'], ['ADDED', 'MOD-002-REQ-008'], ['MODIFIED', 'MOD-002-REQ-009'], ['REMOVED', 'MOD-002-REQ-010'],
    ]);
  });

  it.each([
    ['missing New', richDelta().replace('**New**', '')],
    ['missing Previous', richDelta('MODIFIED').replace('**Previous**', '')],
    ['missing Reason', richDelta().replace('**Reason**\n\n支持用户管理。', '')],
    ['empty Reason', richDelta().replace('支持用户管理。', '')],
    ['identical snapshots', richDelta('MODIFIED').replace('THEN 用户出现在列表顶部', 'THEN 用户出现在列表')],
    ['cross-module ID', richDelta().replaceAll('MOD-002-REQ', 'MOD-003-REQ')],
    ['unequal IDs', richDelta('MODIFIED').replace('### MOD-002-REQ-006：', '### MOD-002-REQ-008：')],
    ['whole Spec', richDelta().replace(h3Snapshot(), currentMarkdown)],
    ['short Scenario ID', richDelta().replace('Scenario: MOD-002-REQ-006-SCN-001', 'Scenario: SCN-001')],
    ['second Requirement snapshot', richDelta().replace('**Reason**', h3Snapshot().replaceAll('REQ-006', 'REQ-007') + '\n**Reason**')],
    ['duplicate Requirement', richDelta().replace('## 工程文件增量', richDelta().slice(richDelta().indexOf('**New**'), richDelta().indexOf('## 工程文件增量')) + '## 工程文件增量')],
    ['duplicate file path', richDelta() + '| `e2e/users.spec.ts` | MOD-002 | 新增 | duplicate | `MOD-002-REQ-006` |\n'],
    ['missing file action', richDelta().replace(' | 修改 | ', ' |  | ')],
    ['unsafe file path', richDelta().replaceAll('e2e/users.spec.ts', '../users.ts')],
    ['unrelated file reference', richDelta().replace(' | `MOD-002-REQ-006-SCN-001-TC-UI-01` |', ' | `MOD-002-REQ-999` |')],
    ['fenced snapshot', richDelta().replace(h3Snapshot(), '```md\n' + h3Snapshot() + '```\n')],
  ])('rejects %s', (_label, source) => {
    expect(() => delta.parseCurrentSpecDelta(source)).toThrow();
  });

  it('compares projections semantically while approvals distinguish behavior, plans and execution evidence', () => {
    const source = richDelta('MODIFIED');
    const formatted = source.replaceAll(' | ', '  |  ').replaceAll('\n', '\r\n');
    expect(delta.projectCurrentSpecDelta(delta.parseCurrentSpecDelta(formatted))).toEqual(delta.projectCurrentSpecDelta(delta.parseCurrentSpecDelta(source)));
    for (const project of [projectCurrentSpecForDesignApproval, projectCurrentSpecForPlanApproval]) {
      expect(project(formatted)).toEqual(project(source));
      expect(project(source.replace('THEN 用户出现在列表顶部', 'THEN 用户已禁用'))).not.toEqual(project(source));
      expect(project(source.replace('支持用户管理。', '支持批量创建。'))).not.toEqual(project(source));
    }
    const plan = source.replace('打开表单', '打开完整表单');
    expect(projectCurrentSpecForDesignApproval(plan)).toEqual(projectCurrentSpecForDesignApproval(source));
    expect(projectCurrentSpecForPlanApproval(plan)).not.toEqual(projectCurrentSpecForPlanApproval(source));
    const evidence = source.replaceAll('**自动化测试：** `e2e/users.spec.ts`', '**自动化测试：** `e2e/renamed.spec.ts`').replaceAll('data-testid=add-user', 'data-testid=create-user').replaceAll('PASS', 'FAIL').replaceAll('2026-09-15T00:00:00Z', '2026-09-16T00:00:00Z');
    expect(projectCurrentSpecForPlanApproval(evidence)).toEqual(projectCurrentSpecForPlanApproval(source));
    expect(delta.projectCurrentSpecDelta(delta.parseCurrentSpecDelta(evidence))).not.toEqual(delta.projectCurrentSpecDelta(delta.parseCurrentSpecDelta(source)));
    const fileDelta = source.replace('| `e2e/users.spec.ts` |', '| `e2e/new-file.spec.ts` |');
    expect(projectCurrentSpecForDesignApproval(fileDelta)).toEqual(projectCurrentSpecForDesignApproval(source));
    expect(projectCurrentSpecForPlanApproval(fileDelta)).not.toEqual(projectCurrentSpecForPlanApproval(source));
  });
});
