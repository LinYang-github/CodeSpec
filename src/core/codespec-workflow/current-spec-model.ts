import MarkdownIt from 'markdown-it';

export interface CurrentSpecTestCase {
  id: string;
  title: string;
  type: string;
  automationTest: string;
  testId: string;
  latestVerification: string;
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
    if (token?.type === 'inline' && token.level === depth + 3) items.push(token.content.trim());
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

function readReferenceList(value: string): string[] {
  const references = value.split('；').map((entry) => readCodeValue(entry.trim(), '工程文件关联'));
  if (references.length === 0 || references.some((reference) => !reference)) {
    throw new Error('工程文件必须关联至少一个需求、场景或测试用例');
  }
  return references;
}

export function parseCurrentSpecification(content: string): CurrentSpecification {
  const tokens = markdown.parse(content, {});
  const title = headingContent(tokens, 0, 'h1');
  if (!title) throw new Error('Current specification must start with an H1 module title');

  const metadataItems = listItemsAfter(tokens, 0);
  const module = splitRequiredLabel(metadataItems.find((item) => item.startsWith('**模块编号：**')) ?? '', '**模块编号：**');
  const rawVersion = splitRequiredLabel(metadataItems.find((item) => item.startsWith('**规格版本：**')) ?? '', '**规格版本：**');
  if (rawVersion !== 'legacy' && rawVersion !== '1') throw new Error('规格版本 must be legacy or 1');

  const requirements: CurrentSpecRequirement[] = [];
  const scenarios = new Map<string, CurrentSpecScenario>();
  let engineeringFiles: CurrentSpecEngineeringFile[] = [];
  let activeRequirement: CurrentSpecRequirement | undefined;
  let inTestCases = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const requirementHeading = headingContent(tokens, index, 'h2');
    if (requirementHeading) {
      const parsed = splitIdentifierAndTitle(requirementHeading, '：', 'requirement');
      activeRequirement = { ...parsed, scenarios: [] };
      requirements.push(activeRequirement);
      inTestCases = false;
      continue;
    }
    const h3 = headingContent(tokens, index, 'h3');
    if (h3 === '测试用例') {
      if (!activeRequirement) throw new Error('测试用例 must belong to a requirement');
      inTestCases = true;
      continue;
    }
    if (h3 === '当前模块工程文件') {
      engineeringFiles = requireTableRows(tokens, index, ['文件', '作用', '关联需求 / 场景 / 测试用例'])
        .map(([filePath, role, references]) => ({
          path: readCodeValue(filePath!, '工程文件'),
          role: role!,
          references: readReferenceList(references!),
        }));
      continue;
    }
    const h4 = headingContent(tokens, index, 'h4');
    if (!h4 || !activeRequirement) continue;

    if (!inTestCases && h4.startsWith('Scenario: ')) {
      const parsed = splitIdentifierAndTitle(h4.slice('Scenario: '.length), ' ', 'scenario');
      const scenario: CurrentSpecScenario = {
        ...parsed,
        ...readScenarioSteps(listItemsAfter(tokens, index), parsed.id),
        testCases: [],
      };
      activeRequirement.scenarios.push(scenario);
      scenarios.set(scenario.id, scenario);
      continue;
    }
    if (!inTestCases) continue;

    const parsed = splitIdentifierAndTitle(h4, '：', 'test case');
    const scenarioSeparator = parsed.id.lastIndexOf('-TC-');
    if (scenarioSeparator <= 0) throw new Error(`Test case ${parsed.id} has no scenario identifier`);
    const scenario = scenarios.get(parsed.id.slice(0, scenarioSeparator));
    if (!scenario) throw new Error(`Test case ${parsed.id} must follow its Scenario`);
    const fields = fieldMap(listItemsAfter(tokens, index));
    const steps = requireTableRows(tokens, index, ['步骤', '用户操作', '预期结果'])
      .map(([number, action, expected]) => ({ number: number!, action: action!, expected: expected! }));
    scenario.testCases.push({
      ...parsed,
      type: requireField(fields, '类型'),
      automationTest: readCodeValue(requireField(fields, '自动化测试'), '自动化测试'),
      testId: readCodeValue(requireField(fields, '测试标识'), '测试标识'),
      latestVerification: requireField(fields, '最近验证'),
      steps,
    });
  }

  return { title, module, version: rawVersion, requirements, engineeringFiles };
}

export function renderCurrentSpecification(specification: CurrentSpecification): string {
  const lines = [
    `# ${specification.title}`,
    '',
    `- **模块编号：** ${specification.module}`,
    `- **规格版本：** ${specification.version}`,
  ];
  for (const requirement of specification.requirements) {
    lines.push('', `## ${requirement.id}：${requirement.title}`);
    for (const scenario of requirement.scenarios) {
      lines.push('', `#### Scenario: ${scenario.id} ${scenario.title}`);
      for (const value of scenario.given) lines.push(`- GIVEN ${value}`);
      for (const value of scenario.when) lines.push(`- WHEN ${value}`);
      for (const value of scenario.then) lines.push(`- THEN ${value}`);
      for (const value of scenario.error) lines.push(`- ERROR ${value}`);
    }
    lines.push('', '### 测试用例');
    for (const scenario of requirement.scenarios) {
      for (const testCase of scenario.testCases) {
        lines.push('', `#### ${testCase.id}：${testCase.title}`, '', `- **类型：** ${testCase.type}`,
          `- **自动化测试：** \`${testCase.automationTest}\``, `- **测试标识：** \`${testCase.testId}\``,
          `- **最近验证：** ${testCase.latestVerification}`, '', '| 步骤 | 用户操作 | 预期结果 |', '| --- | --- | --- |');
        for (const step of testCase.steps) lines.push(`| ${step.number} | ${step.action} | ${step.expected} |`);
      }
    }
  }
  lines.push('', '### 当前模块工程文件', '', '| 文件 | 作用 | 关联需求 / 场景 / 测试用例 |', '| --- | --- | --- |');
  for (const file of specification.engineeringFiles) {
    lines.push(`| \`${file.path}\` | ${file.role} | ${file.references.map((reference) => `\`${reference}\``).join('；')} |`);
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
