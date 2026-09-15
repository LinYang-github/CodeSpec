import type { CurrentSpecRequirement, CurrentSpecEngineeringFile, CurrentSpecification } from './current-spec-model.js';
import MarkdownIt from 'markdown-it';
import { parseCurrentSpecification, parseRequirementSnapshot, renderRequirementSnapshot, hashRequirementSnapshot, renderCurrentSpecification, normalizeCurrentSpecInline } from './current-spec-model.js';

export interface CurrentRequirementDelta {
  action: 'ADDED' | 'MODIFIED' | 'REMOVED';
  module: string;
  id: string;
  previous?: CurrentSpecRequirement;
  next?: CurrentSpecRequirement;
  reason: string;
}

export interface CurrentSpecDeltaDocument {
  title: string;
  module: string;
  version: 1;
  requirements: CurrentRequirementDelta[];
  engineeringFiles: CurrentSpecEngineeringFile[];
}

const markdown = new MarkdownIt({ html: true });
type Token = ReturnType<typeof markdown.parse>[number];
const actions = ['ADDED', 'MODIFIED', 'REMOVED'] as const;
const fileHeaders = ['文件', '模块编号', '变更', '作用', '关联需求 / 场景 / 测试用例'];

/** H2 actions contain repeated Previous/New/Reason paragraphs, never an outer H3. */
export function parseCurrentSpecDelta(content: string): CurrentSpecDeltaDocument {
  const lines = content.replace(/\r\n?/gu, '\n').split('\n');
  const tokens = markdown.parse(lines.join('\n'), {});
  const blocks: Array<{ token: Token; tokens: Token[]; content: string; label?: string }> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.level !== 0 || token.nesting === -1 || !token.map) continue;
    if (token.type === 'html_block' && token.content.replace(/<!--[\s\S]*?-->/gu, '').trim() === '') continue;
    let end = index + 1;
    if (token.nesting === 1) {
      while (end < tokens.length && !(tokens[end]!.nesting === -1 && tokens[end]!.level === token.level)) end += 1;
      end += 1;
    }
    const children = tokens[index + 1]?.children?.filter((child) => child.type !== 'text' || child.content !== '') ?? [];
    const label = token.type === 'paragraph_open' && children.length === 3 && children[0]?.type === 'strong_open' && children[2]?.type === 'strong_close' && ['Previous', 'New', 'Reason'].includes(children[1]!.content)
      ? children[1]!.content : undefined;
    blocks.push({ token, tokens: tokens.slice(index, end), content: lines.slice(...token.map).join('\n'), label });
    index = end - 1;
  }
  const heading = (index: number, tag: string) => blocks[index]?.token.type === 'heading_open' && blocks[index]?.token.tag === tag ? blocks[index]?.tokens[1]?.content.trim() : undefined;
  if (!heading(0, 'h1') || blocks[1]?.token.type !== 'bullet_list_open') throw new Error('Rich delta requires H1 title and module/version metadata');
  const metadataItem = ['list_item_open', 'paragraph_open', 'inline', 'paragraph_close', 'list_item_close'];
  const metadataTypes = ['bullet_list_open', ...metadataItem, ...metadataItem, 'bullet_list_close'];
  const metadataLevels = [0, 1, 2, 3, 2, 1, 1, 2, 3, 2, 1, 0];
  if (blocks[1]!.tokens.length !== metadataTypes.length || blocks[1]!.tokens.some((token, offset) =>
    token.type !== metadataTypes[offset] || token.level !== metadataLevels[offset]
  )) throw new Error('Rich delta metadata must contain exactly two plain list items; unconsumed nested content is not allowed');
  const metadataFields = blocks[1]!.tokens.filter((token) => token.type === 'inline').map((token) => token.content.trim());
  if (metadataFields.length !== 2 || new Set(metadataFields.map((field) => field.split('：')[0])).size !== 2) throw new Error('Rich delta requires exactly module/version metadata');
  const metadata = parseCurrentSpecification(`${blocks[0]!.content}\n\n${blocks[1]!.content}\n`);
  if (metadata.version !== '1') throw new Error('Rich delta version must be 1');
  const document: CurrentSpecDeltaDocument = { title: metadata.title, module: metadata.module, version: 1, requirements: [], engineeringFiles: [] };
  let index = 2;
  const seen = new Set<string>();
  const readSnapshot = (label: 'Previous' | 'New'): CurrentSpecRequirement => {
    if (blocks[index]?.label !== label) throw new Error(`Requirement delta requires **${label}**`);
    const start = ++index;
    while (index < blocks.length && !blocks[index]?.label && !heading(index, 'h2')) index += 1;
    return parseRequirementSnapshot(blocks.slice(start, index).map((block) => block.content).join('\n\n'), 3);
  };
  while (index < blocks.length) {
    const section = heading(index, 'h2');
    if (section === '工程文件增量') {
      index += 1;
      const table = blocks[index];
      if (table?.token.type !== 'table_open' || index !== blocks.length - 1) throw new Error('工程文件增量 must be the final table');
      const headers = table.tokens.slice(0, table.tokens.findIndex((token) => token.type === 'thead_close')).filter((token) => token.type === 'inline').map((token) => token.content.trim());
      if (headers.join('\0') !== fileHeaders.join('\0')) throw new Error(`工程文件增量 requires columns: ${fileHeaders.join(' / ')}`);
      document.engineeringFiles = parseCurrentSpecification(`# ${metadata.title}\n\n- **模块编号：** ${metadata.module}\n- **规格版本：** 1\n\n### 当前模块工程文件\n\n${table.content}\n`).engineeringFiles;
      index += 1;
      break;
    }
    if (!actions.includes(section as CurrentRequirementDelta['action']) || seen.has(section!)) throw new Error(`Unknown or duplicate rich delta action section: ${section ?? blocks[index]?.content}`);
    const action = section as CurrentRequirementDelta['action'];
    seen.add(action);
    index += 1;
    while (index < blocks.length && !heading(index, 'h2')) {
      const previous = action !== 'ADDED' ? readSnapshot('Previous') : undefined;
      const next = action !== 'REMOVED' ? readSnapshot('New') : undefined;
      if (blocks[index]?.label !== 'Reason') throw new Error('Requirement delta requires **Reason**');
      const reasonStart = ++index;
      while (index < blocks.length && !blocks[index]?.label && !heading(index, 'h2')) {
        if (blocks[index]?.token.type !== 'paragraph_open') throw new Error('Reason must contain standalone prose, not Requirement snapshots or whole Specs');
        index += 1;
      }
      const reason = blocks.slice(reasonStart, index).map((block) => normalizeCurrentSpecInline(block.tokens[1]!.content)).join('\n\n');
      document.requirements.push({ action, module: metadata.module, id: (previous ?? next)!.id, ...(previous ? { previous } : {}), ...(next ? { next } : {}), reason });
    }
  }
  const issues = validateCurrentSpecDelta(document);
  if (issues.length) throw new Error(issues.join('; '));
  return document;
}

export function renderCurrentSpecDelta(document: CurrentSpecDeltaDocument): string {
  const issues = validateCurrentSpecDelta(document);
  if (issues.length) throw new Error(issues.join('; '));
  const lines = [`# ${document.title}`, '', `- **模块编号：** ${document.module}`, '- **规格版本：** 1'];
  for (const action of actions) {
    const entries = document.requirements.filter((entry) => entry.action === action);
    if (!entries.length) continue;
    lines.push('', `## ${action}`);
    for (const entry of entries) {
      if (entry.previous) lines.push('', '**Previous**', '', renderRequirementSnapshot(entry.previous, 3).trimEnd());
      if (entry.next) lines.push('', '**New**', '', renderRequirementSnapshot(entry.next, 3).trimEnd());
      lines.push('', '**Reason**', '', entry.reason);
    }
  }
  const files = renderCurrentSpecification({ title: document.title, module: document.module, version: '1', requirements: [], engineeringFiles: document.engineeringFiles });
  const table = document.engineeringFiles.length ? files.slice(files.indexOf('| 文件 |')) : `| ${fileHeaders.join(' | ')} |\n| --- | --- | --- | --- | --- |\n`;
  lines.push('', '## 工程文件增量', '', table.trimEnd());
  return `${lines.join('\n')}\n`;
}

/** Full semantic state. Approval consumers explicitly narrow this projection. */
export function projectCurrentSpecDelta(document: CurrentSpecDeltaDocument): CurrentSpecDeltaDocument {
  return {
    title: document.title, module: document.module, version: document.version,
    requirements: document.requirements.map((entry) => ({
      action: entry.action, module: entry.module, id: entry.id,
      ...(entry.previous ? { previous: parseRequirementSnapshot(renderRequirementSnapshot(entry.previous)) } : {}),
      ...(entry.next ? { next: parseRequirementSnapshot(renderRequirementSnapshot(entry.next)) } : {}),
      reason: entry.reason,
    })).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    engineeringFiles: document.engineeringFiles.map((file) => ({ path: file.path, module: file.module ?? document.module, change: file.change, role: file.role, references: [...file.references].sort() }))
      .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
  };
}

export function validateCurrentSpecDelta(document: CurrentSpecDeltaDocument): string[] {
  const issues: string[] = [];
  if (!document.title.trim() || !/^MOD-\d{3}$/u.test(document.module) || document.version !== 1) issues.push('Invalid rich delta title, module or version');
  if (!document.requirements.length) issues.push('Rich delta requires at least one Requirement');
  const ids = new Set<string>();
  const known = new Set<string>();
  for (const entry of document.requirements) {
    if (!actions.includes(entry.action)) issues.push(`Invalid Requirement delta action: ${entry.action}`);
    if (ids.has(entry.id)) issues.push(`Duplicate Requirement delta ID: ${entry.id}`);
    ids.add(entry.id);
    if (entry.module !== document.module || !/^MOD-\d{3}-REQ-\d{3}$/u.test(entry.id) || !entry.id.startsWith(`${document.module}-REQ-`)) issues.push(`Requirement ${entry.id} must belong to module ${document.module}`);
    if (!entry.reason.trim()) issues.push(`Requirement ${entry.id} requires Reason`);
    if (Boolean(entry.previous) !== (entry.action !== 'ADDED')) issues.push(`${entry.action} ${entry.id}: invalid or missing Previous`);
    if (Boolean(entry.next) !== (entry.action !== 'REMOVED')) issues.push(`${entry.action} ${entry.id}: invalid or missing New`);
    for (const snapshot of [entry.previous, entry.next]) {
      if (!snapshot) continue;
      if (snapshot.id !== entry.id) issues.push(`Previous/New Requirement IDs must equal ${entry.id}`);
      if (!snapshot.scenarios.length) issues.push(`Requirement ${entry.id} snapshot requires Scenarios`);
      try { parseRequirementSnapshot(renderRequirementSnapshot(snapshot)); }
      catch (error) { issues.push(error instanceof Error ? error.message : String(error)); }
      known.add(snapshot.id);
      for (const scenario of snapshot.scenarios) {
        known.add(scenario.id);
        for (const testCase of scenario.testCases) known.add(testCase.id);
      }
    }
    if (entry.previous && entry.next) {
      try {
        if (hashRequirementSnapshot(entry.previous) === hashRequirementSnapshot(entry.next)) issues.push(`MODIFIED ${entry.id}: Previous and New must differ`);
      } catch { /* Snapshot validation above reports malformed state. */ }
    }
  }
  const files = new Set<string>();
  for (const file of document.engineeringFiles) {
    if (files.has(file.path)) issues.push(`Duplicate engineering file path: ${file.path}`);
    files.add(file.path);
    if (!file.path || file.path.includes('\0') || file.path.includes('\\') || /^[A-Za-z]:/u.test(file.path) || file.path.split('/').some((part) => ['', '.', '..'].includes(part))) issues.push(`Unsafe engineering file path: ${file.path}`);
    if (file.module !== undefined && file.module !== document.module) issues.push(`Engineering file ${file.path} must belong to ${document.module}`);
    if (!['新增', '修改', '删除'].includes(file.change ?? '')) issues.push(`Engineering file ${file.path} requires explicit change action`);
    if (!file.role.trim() || !file.references.length) issues.push(`Engineering file ${file.path} requires role and references`);
    for (const id of file.references) if (!known.has(id)) issues.push(`Engineering file ${file.path} references unrelated ID ${id}`);
  }
  return issues;
}

/** Check every operation against live Current before applying any of them. */
export function validateCurrentSpecDeltaAgainstCurrent(current: CurrentSpecification, delta: CurrentSpecDeltaDocument): string[] {
  const errors = validateCurrentSpecDelta(delta).map((issue) => `ARCHIVE CONFLICT: ${issue}`);
  if (current.module !== delta.module) errors.push(`ARCHIVE CONFLICT: ${delta.module} does not match Current module ${current.module}`);
  const requirements = new Map(current.requirements.map((requirement) => [requirement.id, requirement]));
  for (const entry of delta.requirements) {
    const existing = requirements.get(entry.id);
    if (entry.action === 'ADDED') {
      if (existing) errors.push(`ARCHIVE CONFLICT: ${entry.id} already exists in Current`);
    } else if (!existing) {
      errors.push(`ARCHIVE CONFLICT: ${entry.id} does not exist in Current`);
    } else if (entry.previous) {
      try {
        if (hashRequirementSnapshot(existing) !== hashRequirementSnapshot(entry.previous)) {
          errors.push(`ARCHIVE CONFLICT: ${entry.id} Current does not match Previous`);
        }
      } catch (error) { errors.push(`ARCHIVE CONFLICT: ${entry.id}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  const paths = new Set(current.engineeringFiles.map((file) => file.path));
  for (const file of delta.engineeringFiles) {
    if (file.change === '新增' && paths.has(file.path)) errors.push(`ARCHIVE CONFLICT: ${file.path} already exists in Current`);
    if ((file.change === '修改' || file.change === '删除') && !paths.has(file.path)) errors.push(`ARCHIVE CONFLICT: ${file.path} does not exist in Current`);
  }
  return errors;
}
