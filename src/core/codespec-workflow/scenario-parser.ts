import type { RequirementId, Scenario } from './types.js';

const SCENARIO_LINE = /^\s*[-*]?\s*\*\*(GIVEN|WHEN|THEN|ERROR)\*\*(?:\s+(.*))?$/u;

export function parseCanonicalScenario(lines: string[], requirementId: RequirementId): Scenario {
  const header = lines[0]?.match(/^####\s+Scenario:\s*(SCN-\d{3})\s+(.+)$/u);
  if (!header) throw new Error(`Malformed Scenario in Requirement ${requirementId}`);
  const bodyLines = lines.slice(1).filter((line) => line.trim() && !/^<!--.*-->$/u.test(line.trim()));
  if (bodyLines.some((line) => !SCENARIO_LINE.test(line))) {
    throw new Error(`Unconsumed content in Scenario ${header[1]}`);
  }
  const read = (token: 'GIVEN' | 'WHEN' | 'THEN' | 'ERROR') => lines
    .map((line) => ({ match: line.match(SCENARIO_LINE) }))
    .filter(({ match }) => match?.[1] === token)
    .map(({ match }) => match?.[2]?.trim() ?? '')
    .filter(Boolean);
  const given = read('GIVEN');
  const when = read('WHEN');
  const then = read('THEN');
  const error = read('ERROR');
  if (!given.length || !when.length || !then.length) {
    throw new Error(`Scenario ${header[1]} requires GIVEN, WHEN, and THEN`);
  }
  if (!lines.slice(1).some((line) => line.match(SCENARIO_LINE)?.[1] === 'ERROR')) {
    throw new Error(`Requirement ${requirementId} Scenario ${header[1]} 缺少 ERROR 行`);
  }
  return {
    id: header[1] as `SCN-${string}`,
    name: header[2].trim(),
    given,
    when,
    then,
    error,
  };
}

export function renderCanonicalScenario(scenario: Scenario): string {
  return [
    `#### Scenario: ${scenario.id} ${scenario.name ?? ''}`.trimEnd(),
    ...scenario.given.map((part) => `- **GIVEN** ${part}`),
    ...scenario.when.map((part) => `- **WHEN** ${part}`),
    ...scenario.then.map((part) => `- **THEN** ${part}`),
    ...(scenario.error.length ? scenario.error.map((part) => `- **ERROR** ${part}`) : ['- **ERROR**']),
  ].join('\n');
}

export function collectEmptyScenarioErrorIssues(
  requirementId: string,
  scenarios: Scenario[],
  changeId?: string,
): string[] {
  return scenarios
    .filter((scenario) => scenario.error.length === 0)
    .map((scenario) => `${changeId ? `Change ${changeId} ` : ''}Requirement ${requirementId} Scenario ${scenario.id} 的 ERROR 为空，请人工补写异常处理`);
}
