import MarkdownIt from 'markdown-it';
import path from 'node:path';
import { createHash } from 'node:crypto';

export interface CurrentSpecTestCase {
  id: string;
  title: string;
  type: string;
  automationTest: string;
  testId: string;
  latestVerification: string;
  engineeringLocations?: string[];
  verificationSource?: string;
  executionCommand?: string;
  verificationEnvironment?: string;
  verificationTime?: string;
  verificationSummary?: string;
  steps: CurrentSpecTestStep[];
}

export interface CurrentSpecTestStep {
  number: string;
  action: string;
  expected: string;
}

export interface CurrentSpecEngineeringFile {
  path: string;
  role: string;
  references: string[];
  module?: string;
  change?: '新增' | '修改' | '删除';
}

export interface CurrentSpecScenario {
  id: string;
  title: string;
  given: string[];
  when: string[];
  then: string[];
  error: string[];
  testCases: CurrentSpecTestCase[];
}

export interface CurrentSpecRequirement {
  id: string;
  title: string;
  scenarios: CurrentSpecScenario[];
}

export interface CurrentSpecification {
  title: string;
  module: string;
  version: 'legacy' | '1';
  requirements: CurrentSpecRequirement[];
  engineeringFiles: CurrentSpecEngineeringFile[];
}

const markdown = new MarkdownIt();
type Token = ReturnType<typeof markdown.parse>[number];

/** Normalize wrapping only when Markdown's inline meaning is unchanged. */
export function normalizeCurrentSpecInline(content: string): string {
  let normalized = content.trim();
  if (!normalized.includes('\n')) return normalized;
  // Soft breaks render as newlines; hard breaks retain an explicit <br>.
  // Comparing rendered inline content also protects whitespace in code spans
  // and avoids treating an escaped backslash as a hard-break marker.
  const semantic = (value: string) => markdown.renderInline(value).replaceAll('\n', ' ');
  const original = semantic(normalized);
  const breaks = [...normalized.matchAll(/[ \t]*\n[ \t]*/gu)].reverse();
  for (const match of breaks) {
    const candidate = normalized.slice(0, match.index) + ' ' + normalized.slice(match.index! + match[0].length);
    if (semantic(candidate) === original) normalized = candidate;
  }
  return normalized;
}

function headingContent(tokens: Token[], index: number, tag: string): string | null {
  if (tokens[index]?.type !== 'heading_open' || tokens[index]?.tag !== tag) return null;
  const inline = tokens[index + 1];
  return inline?.type === 'inline' ? inline.content.trim() : null;
}

function splitRequiredLabel(value: string, label: string): string {
  if (!value.startsWith(label)) throw new Error(`Current specification requires ${label}`);
  const result = value.slice(label.length).trim();
  if (!result) throw new Error(`Current specification ${label} must have a value`);
  return result;
}

function splitIdentifierAndTitle(value: string, separator: string, kind: string): { id: string; title: string } {
  const separatorIndex = value.indexOf(separator);
  if (separatorIndex <= 0) throw new Error(`Malformed ${kind} heading`);
  const id = value.slice(0, separatorIndex).trim();
  const title = value.slice(separatorIndex + separator.length).trim();
  if (!id || !title) throw new Error(`Malformed ${kind} heading`);
  return { id, title };
}

function listItemsAfter(tokens: Token[], index: number): string[] {
  let start = index + 3;
  while (start < tokens.length && tokens[start]?.type !== 'bullet_list_open') {
    if (tokens[start]?.type === 'heading_open') return [];
    start += 1;
  }
  if (tokens[start]?.type !== 'bullet_list_open') return [];

  const depth = tokens[start]?.level;
  const items: string[] = [];
  for (let cursor = start + 1; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor];
    if (token?.type === 'bullet_list_close' && token.level === depth) return items;
    if (token?.type === 'inline' && token.level === depth + 3) items.push(normalizeCurrentSpecInline(token.content));
  }
  throw new Error('Unclosed bullet list in current specification');
}

function readScenarioSteps(items: string[], scenarioId: string): Pick<CurrentSpecScenario, 'given' | 'when' | 'then' | 'error'> {
  const fields = { given: [] as string[], when: [] as string[], then: [] as string[], error: [] as string[] };
  const labels: Array<[string, keyof typeof fields]> = [
    ['GIVEN ', 'given'], ['WHEN ', 'when'], ['THEN ', 'then'], ['ERROR ', 'error'],
  ];
  for (const item of items) {
    const match = labels.find(([label]) => item.startsWith(label));
    if (!match) throw new Error(`Unconsumed content in Scenario ${scenarioId}`);
    const text = item.slice(match[0].length).trim();
    if (!text) throw new Error(`Scenario ${scenarioId} has an empty ${match[0].trim()} step`);
    fields[match[1]].push(text);
  }
  if (!fields.given.length || !fields.when.length || !fields.then.length || !fields.error.length) {
    throw new Error(`Scenario ${scenarioId} requires GIVEN, WHEN, THEN, and ERROR`);
  }
  return fields;
}

function fieldMap(items: string[]): Map<string, string> {
  const fields = new Map<string, string>();
  for (const item of items) {
    const separator = item.indexOf('：**');
    if (!item.startsWith('**') || separator <= 2) throw new Error(`Malformed test case field: ${item}`);
    const label = item.slice(2, separator);
    const value = item.slice(separator + 3).trim();
    if (!value || fields.has(label)) throw new Error(`Malformed test case field: ${item}`);
    fields.set(label, value);
  }
  return fields;
}

function readCodeValue(value: string, label: string): string {
  if (!value.startsWith('`') || !value.endsWith('`')) throw new Error(`${label} must use inline code`);
  return value.slice(1, -1);
}

function requireField(fields: Map<string, string>, label: string): string {
  const value = fields.get(label);
  if (!value) throw new Error(`Test case requires ${label}`);
  return value;
}

function tableAfter(tokens: Token[], index: number): string[][] {
  let start = index + 3;
  while (start < tokens.length && tokens[start]?.type !== 'table_open') {
    if (tokens[start]?.type === 'heading_open') return [];
    start += 1;
  }
  if (tokens[start]?.type !== 'table_open') return [];

  const rows: string[][] = [];
  let row: string[] | null = null;
  for (let cursor = start + 1; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor];
    if (token?.type === 'table_close') return rows;
    if (token?.type === 'tr_open') row = [];
    if (token?.type === 'inline' && row) row.push(token.content.trim());
    if (token?.type === 'tr_close' && row) {
      rows.push(row);
      row = null;
    }
  }
  throw new Error('Unclosed table in current specification');
}

function requireTableRows(tokens: Token[], index: number, headers: string[]): string[][] {
  const rows = tableAfter(tokens, index);
  if (rows.length === 0 || rows[0]?.join('\u0000') !== headers.join('\u0000')) {
    throw new Error(`Current specification requires table: ${headers.join(' / ')}`);
  }
  if (rows.some((row) => row.length !== headers.length)) {
    throw new Error(`Current specification table has an invalid column count: ${headers.join(' / ')}`);
  }
  return rows.slice(1);
}

function renderTableRow(cells: string[]): string {
  // markdown-it removes the table escape before inline parsing. Restore one
  // escape per pipe, including pipes inside code spans, before joining cells.
  return `| ${cells.map((cell) => cell.replaceAll('|', '\\|')).join(' | ')} |`;
}

function isSafeRepositoryPath(value: string): boolean {
  return Boolean(value) && !value.includes('\0') && !value.includes('\\') && !path.isAbsolute(value) &&
    !/^[A-Za-z]:\//u.test(value) && !value.split('/').includes('..') && !value.split('/').includes('');
}

function readReferenceList(value: string): string[] {
  const references = value.split('；').map((entry) => readCodeValue(entry.trim(), '工程文件关联'));
  if (references.length === 0 || references.some((reference) => !reference)) {
    throw new Error('工程文件必须关联至少一个需求、场景或测试用例');
  }
  return references;
}

function readCodeList(value: string, label: string): string[] {
  const references = value.split('；').map((entry) => readCodeValue(entry.trim(), label));
  if (references.length === 0 || references.some((reference) => !reference)) throw new Error(`${label} 必须至少包含一个引用`);
  return references;
}

export function parseCurrentSpecification(content: string): CurrentSpecification {
  content = content.replace(/\r\n?/gu, '\n');
  const tokens = markdown.parse(content, {});
  const title = headingContent(tokens, 0, 'h1');
  if (!title) throw new Error('Current specification must start with an H1 module title');

  const metadataItems = listItemsAfter(tokens, 0);
  const module = splitRequiredLabel(metadataItems.find((item) => item.startsWith('**模块编号：**')) ?? '', '**模块编号：**');
  const rawVersion = splitRequiredLabel(metadataItems.find((item) => item.startsWith('**规格版本：**')) ?? '', '**规格版本：**');
  if (rawVersion !== 'legacy' && rawVersion !== '1') throw new Error('规格版本 must be legacy or 1');

  const requirements: CurrentSpecRequirement[] = [];
  let engineeringFiles: CurrentSpecEngineeringFile[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const requirementHeading = headingContent(tokens, index, 'h2');
    if (requirementHeading) {
      let end = index + 3;
      while (end < tokens.length && !headingContent(tokens, end, 'h2') && headingContent(tokens, end, 'h3') !== '当前模块工程文件') end += 1;
      requirements.push(parseRequirementSnapshot(content.split('\n').slice(tokens[index]!.map![0], tokens[end]?.map?.[0]).join('\n')));
      index = end - 1;
      continue;
    }
    const h3 = headingContent(tokens, index, 'h3');
    if (h3 === '当前模块工程文件') {
      const rows = tableAfter(tokens, index);
      const headers = rows[0] ?? [];
      const fileIndex = headers.indexOf('文件');
      const roleIndex = headers.indexOf('作用');
      const referencesIndex = headers.indexOf('关联需求 / 场景 / 测试用例');
      const moduleIndex = headers.indexOf('模块编号');
      const changeIndex = headers.indexOf('变更');
      if (fileIndex < 0 || roleIndex < 0 || referencesIndex < 0) {
        throw new Error('Current specification requires table: 文件 / 作用 / 关联需求 / 场景 / 测试用例');
      }
      const dataRows = rows.slice(1);
      if (dataRows.some((row) => row.length !== headers.length)) {
        throw new Error(`Current specification table has an invalid column count: ${headers.join(' / ')}`);
      }
      engineeringFiles = dataRows.map((row) => {
        const filePath = readCodeValue(row[fileIndex]!, '工程文件');
        const entry: CurrentSpecEngineeringFile = {
          path: filePath,
          role: row[roleIndex]!,
          references: readReferenceList(row[referencesIndex]!),
        };
        if (moduleIndex >= 0) {
          const moduleValue = row[moduleIndex]!.trim();
          if (!/^MOD-\d{3}$/u.test(moduleValue)) throw new Error(`工程文件模块编号无效：${moduleValue}`);
          entry.module = moduleValue;
        }
        if (changeIndex >= 0) {
          const change = row[changeIndex]!.trim();
          if (change !== '新增' && change !== '修改' && change !== '删除') throw new Error(`工程文件变更无效：${change}`);
          entry.change = change;
        }
        return entry;
      });
      continue;
    }
  }

  return { title, module, version: rawVersion, requirements, engineeringFiles };
}

export function findCurrentRequirement(specification: CurrentSpecification, requirementId: string): CurrentSpecRequirement | undefined {
  return specification.requirements.find((requirement) => requirement.id === requirementId);
}

/** Consume exactly one top-level Markdown block, so stray prose cannot disappear. */
function consumeBlock(tokens: Token[], index: number, type: string): number {
  if (tokens[index]?.type !== `${type}_open`) throw new Error(`Requirement snapshot requires ${type}`);
  const level = tokens[index]!.level;
  let end = index + 1;
  while (end < tokens.length && !(tokens[end]?.type === `${type}_close` && tokens[end]?.level === level)) end += 1;
  if (end === tokens.length) throw new Error(`Unclosed ${type} in Requirement snapshot`);
  if (type === 'bullet_list') {
    const itemTypes = ['list_item_open', 'paragraph_open', 'inline', 'paragraph_close', 'list_item_close'];
    const itemLevels = [1, 2, 3, 2, 1];
    if ((end - index - 1) % itemTypes.length !== 0 || tokens.slice(index + 1, end).some((token, offset) =>
      token.type !== itemTypes[offset % itemTypes.length] || token.level !== level + itemLevels[offset % itemLevels.length]!
    )) throw new Error('Unconsumed nested content in Requirement snapshot list');
  }
  return end + 1;
}

/** A snapshot owns exactly one Requirement, its Scenarios and their test cases. */
export function parseRequirementSnapshot(content: string, headingLevel: 2 | 3 = 2): CurrentSpecRequirement {
  const tokens = markdown.parse(content, {});
  const heading = headingContent(tokens, 0, `h${headingLevel}`);
  if (!heading) throw new Error(`Requirement snapshot must start with one H${headingLevel} Requirement`);
  const parsed = splitIdentifierAndTitle(heading, '：', 'Requirement snapshot');
  if (!/^MOD-\d{3}-REQ-\d{3}$/u.test(parsed.id)) throw new Error(`Invalid Requirement snapshot ID: ${parsed.id}`);
  const requirement: CurrentSpecRequirement = { ...parsed, scenarios: [] };
  const scenarios = new Map<string, CurrentSpecScenario>();
  const known = new Set([parsed.id]);
  let inTests = false;
  let index = 3;
  while (index < tokens.length) {
    if (headingContent(tokens, index, `h${headingLevel + 1}`) === '测试用例') {
      if (inTests) throw new Error('Duplicate 测试用例 section in Requirement snapshot');
      inTests = true;
      index += 3;
      continue;
    }
    const title = headingContent(tokens, index, `h${headingLevel + 2}`);
    if (!title) throw new Error('Unconsumed content in Requirement snapshot; only one Requirement is allowed');
    if (!inTests) {
      if (!title.startsWith('Scenario: ')) throw new Error('Requirement snapshot requires a Scenario heading');
      const scenario = splitIdentifierAndTitle(title.slice('Scenario: '.length), ' ', 'Scenario');
      if (!new RegExp(`^${requirement.id}-SCN-\\d{3}$`, 'u').test(scenario.id)) throw new Error(`Scenario ${scenario.id} must use a full stable ID belonging to ${requirement.id}`);
      if (known.has(scenario.id)) throw new Error(`Duplicate Scenario ID: ${scenario.id}`);
      known.add(scenario.id);
      const value = { ...scenario, ...readScenarioSteps(listItemsAfter(tokens, index), scenario.id), testCases: [] };
      requirement.scenarios.push(value);
      scenarios.set(scenario.id, value);
      index = consumeBlock(tokens, index + 3, 'bullet_list');
      continue;
    }
    const testCase = splitIdentifierAndTitle(title, '：', 'test case');
    const scenario = scenarios.get(testCase.id.slice(0, testCase.id.lastIndexOf('-TC-')));
    if (!scenario || !new RegExp(`^${scenario.id}-TC-[A-Z]+-\\d{2}$`, 'u').test(testCase.id)) throw new Error(`Test case ${testCase.id} must belong to a Scenario in this Requirement snapshot`);
    if (known.has(testCase.id)) throw new Error(`Duplicate test case ID: ${testCase.id}`);
    known.add(testCase.id);
    const fields = fieldMap(listItemsAfter(tokens, index));
    const allowed = ['类型', '自动化测试', '测试标识', '最近验证', '工程定位', '验证来源', '执行命令', '验证环境', '验证时间', '验证摘要'];
    for (const key of fields.keys()) if (!allowed.includes(key)) throw new Error(`Unconsumed test case field: ${key}`);
    const steps = requireTableRows(tokens, index, ['步骤', '用户操作', '预期结果'])
      .map(([number, action, expected]) => ({ number: number!, action: action!, expected: expected! }));
    scenario.testCases.push({
      ...testCase,
      type: requireField(fields, '类型'),
      automationTest: readCodeValue(requireField(fields, '自动化测试'), '自动化测试'),
      testId: readCodeValue(requireField(fields, '测试标识'), '测试标识'),
      latestVerification: requireField(fields, '最近验证'),
      ...(fields.has('工程定位') ? { engineeringLocations: readCodeList(fields.get('工程定位')!, '工程定位') } : {}),
      ...(fields.has('验证来源') ? { verificationSource: requireField(fields, '验证来源') } : {}),
      ...(fields.has('执行命令') ? { executionCommand: readCodeValue(requireField(fields, '执行命令'), '执行命令') } : {}),
      ...(fields.has('验证环境') ? { verificationEnvironment: requireField(fields, '验证环境') } : {}),
      ...(fields.has('验证时间') ? { verificationTime: requireField(fields, '验证时间') } : {}),
      ...(fields.has('验证摘要') ? { verificationSummary: requireField(fields, '验证摘要') } : {}),
      steps,
    });
    index = consumeBlock(tokens, consumeBlock(tokens, index + 3, 'bullet_list'), 'table');
  }
  return requirement;
}

/** Full state, including evidence and locators. Approval projections are narrower. */
export function hashRequirementSnapshot(requirement: CurrentSpecRequirement): string {
  const normalized = parseRequirementSnapshot(renderRequirementSnapshot(requirement));
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function renderCurrentSpecification(specification: CurrentSpecification): string {
  const lines = [
    `# ${specification.title}`,
    '',
    `- **模块编号：** ${specification.module}`,
    `- **规格版本：** ${specification.version}`,
  ];
  for (const requirement of specification.requirements) {
    lines.push('', renderRequirementSnapshot(requirement).trimEnd());
  }
  const hasActivity = specification.engineeringFiles.some((file) => file.module || file.change);
  lines.push('', '### 当前模块工程文件', '');
  if (hasActivity) {
    lines.push('| 文件 | 模块编号 | 变更 | 作用 | 关联需求 / 场景 / 测试用例 |', '| --- | --- | --- | --- | --- |');
  } else {
    lines.push('| 文件 | 作用 | 关联需求 / 场景 / 测试用例 |', '| --- | --- | --- |');
  }
  for (const file of specification.engineeringFiles) {
    if (hasActivity) {
      lines.push(renderTableRow([`\`${file.path}\``, file.module ?? specification.module, file.change ?? '修改', file.role, file.references.map((reference) => `\`${reference}\``).join('；')]));
    } else {
      lines.push(renderTableRow([`\`${file.path}\``, file.role, file.references.map((reference) => `\`${reference}\``).join('；')]));
    }
  }
  return `${lines.join('\n')}\n`;
}

export function renderRequirementSnapshot(requirement: CurrentSpecRequirement, headingLevel: 2 | 3 = 2): string {
  const heading = '#'.repeat(headingLevel);
  const lines = [`${heading} ${requirement.id}：${requirement.title}`];
  for (const scenario of requirement.scenarios) {
    lines.push('', `${heading}## Scenario: ${scenario.id} ${scenario.title}`);
    for (const value of scenario.given) lines.push(`- GIVEN ${value}`);
    for (const value of scenario.when) lines.push(`- WHEN ${value}`);
    for (const value of scenario.then) lines.push(`- THEN ${value}`);
    for (const value of scenario.error) lines.push(`- ERROR ${value}`);
  }
  lines.push('', `${heading}# 测试用例`);
  for (const scenario of requirement.scenarios) {
    for (const testCase of scenario.testCases) {
      lines.push('', `${heading}## ${testCase.id}：${testCase.title}`, '', `- **类型：** ${testCase.type}`,
        `- **自动化测试：** \`${testCase.automationTest}\``, `- **测试标识：** \`${testCase.testId}\``,
        ...(testCase.engineeringLocations?.length ? [`- **工程定位：** ${testCase.engineeringLocations.map((value) => `\`${value}\``).join('；')}`] : []),
        ...(testCase.verificationSource ? [`- **验证来源：** ${testCase.verificationSource}`] : []),
        ...(testCase.executionCommand ? [`- **执行命令：** \`${testCase.executionCommand}\``] : []),
        ...(testCase.verificationEnvironment ? [`- **验证环境：** ${testCase.verificationEnvironment}`] : []),
        ...(testCase.verificationTime ? [`- **验证时间：** ${testCase.verificationTime}`] : []),
        ...(testCase.verificationSummary ? [`- **验证摘要：** ${testCase.verificationSummary}`] : []),
        `- **最近验证：** ${testCase.latestVerification}`, '', '| 步骤 | 用户操作 | 预期结果 |', '| --- | --- | --- |');
      for (const step of testCase.steps) lines.push(renderTableRow([step.number, step.action, step.expected]));
    }
  }
  return `${lines.join('\n')}\n`;
}

export function validateCurrentSpecificationTraceability(specification: CurrentSpecification): string[] {
  const known = new Set<string>();
  for (const requirement of specification.requirements) {
    known.add(requirement.id);
    for (const scenario of requirement.scenarios) {
      known.add(scenario.id);
      for (const testCase of scenario.testCases) known.add(testCase.id);
    }
  }
  const issues: string[] = [];
  for (const file of specification.engineeringFiles) {
    if (!isSafeRepositoryPath(file.path)) issues.push(`工程文件路径必须是仓库内相对路径：${file.path}`);
    for (const reference of file.references) {
      if (!known.has(reference)) {
        issues.push(`工程文件 ${file.path} 引用了不存在的 ID：${reference}`);
      }
    }
  }
  for (const requirement of specification.requirements) {
    for (const scenario of requirement.scenarios) {
      for (const testCase of scenario.testCases) {
        const file = specification.engineeringFiles.find((candidate) => candidate.path === testCase.automationTest);
        if (!file || !file.references.includes(testCase.id)) {
          issues.push(`自动化测试文件 ${testCase.automationTest} 未关联测试用例：${testCase.id}`);
        }
      }
    }
  }
  return issues;
}

/** Ensures design.md points at the canonical spec instead of becoming a second behavior source. */
export function validateCurrentDesignOwnership(design: string, specification: CurrentSpecification): string[] {
  const known = new Set<string>();
  for (const requirement of specification.requirements) {
    known.add(requirement.id);
    for (const scenario of requirement.scenarios) {
      known.add(scenario.id);
      for (const testCase of scenario.testCases) known.add(testCase.id);
    }
  }
  const issues: string[] = [];
  const ids = design.match(/MOD-\d{3}-REQ-\d{3}(?:-SCN-\d{3}(?:-TC-[A-Z]+-\d{2})?)?/gu) ?? [];
  for (const id of ids) if (!known.has(id)) issues.push(`design.md 引用了当前 spec.md 不存在的 ID：${id}`);
  if (/^#{2,6}\s*(?:Scenario\b|测试用例|Requirement\b)/mu.test(design) ||
      /^(?:\s*)-\s*(?:GIVEN|WHEN|THEN|ERROR)\b/mu.test(design) ||
      /^\s*\|\s*步骤\s*\|/mu.test(design)) {
    issues.push('design.md 不得重复 Scenario、测试用例或行为步骤；请引用 spec.md ID');
  }
  return issues;
}

export function validateCurrentSpecification(specification: CurrentSpecification): string[] {
  const issues = validateCurrentSpecificationTraceability(specification);
  for (const requirement of specification.requirements) {
    if (!requirement.id.startsWith(`${specification.module}-`)) {
      issues.push(`Requirement ${requirement.id} 不属于模块 ${specification.module}`);
    }
    for (const scenario of requirement.scenarios) {
      if (!scenario.id.startsWith(`${requirement.id}-SCN-`)) {
        issues.push(`Scenario ${scenario.id} 不属于 Requirement ${requirement.id}`);
      }
      for (const testCase of scenario.testCases) {
        if (!testCase.id.startsWith(`${scenario.id}-TC-`)) {
          issues.push(`Test case ${testCase.id} 不属于 Scenario ${scenario.id}`);
        }
      }
    }
  }
  return issues;
}
