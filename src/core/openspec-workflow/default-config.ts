export const CANONICAL_SCHEMA = 'code-spec';

export function renderCanonicalWorkspaceConfig(projectName: string, context?: string): string {
  const lines = [
    'version: 1',
    `schema: ${CANONICAL_SCHEMA}`,
    'project:',
    `  name: ${JSON.stringify(projectName)}`,
  ];

  if (context) {
    lines.push('context: |');
    for (const line of context.split('\n')) {
      lines.push(`  ${line}`);
    }
  }

  lines.push(
    'paths:',
    '  business: business.md',
    '  changes: changes',
    '  change_index: changes/index.yaml',
    '  archive: archive',
    '  specs: archive/specs',
    '  archived_changes: archive/changes',
    'workflow:',
    '  multiple_active_changes: true',
    'requirements:',
    "  id_format: '{module}-REQ-{sequence:03d}'",
    'changes:',
    "  id_format: 'CHG-{date}-{sequence:03d}'",
    'archive:',
    '  update_index: true',
    '  require_verification: true',
    '  conflict_strategy: optimistic'
  );

  return `${lines.join('\n')}\n`;
}

export function renderBusinessTemplate(): string {
  return [
    '# 业务',
    '',
    '记录系统的业务模块、职责和关键词。',
    '',
    '| 模块 ID | 模块名称 | 描述 | 职责 | 关键词 |',
    '| --- | --- | --- | --- | --- |',
    '',
  ].join('\n');
}

export function renderEmptyChangeIndex(): string {
  return 'version: 1\nchanges: []\n';
}
