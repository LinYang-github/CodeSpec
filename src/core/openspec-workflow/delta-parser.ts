import { parseRequirementDelta } from './schemas.js';
import type { RequirementDelta, Scenario } from './types.js';

export interface ParsedDeltaSpec { entries: RequirementDelta[] }

const ACTION = /^##\s+(ADDED|MODIFIED|REMOVED)\s*$/u;
const REQUIREMENT = /^###\s+(MOD-\d{3}-REQ-\d{3})\s+(.+)$/u;
const SCENARIO = /^####\s+Scenario:\s*(SCN-\d{3})\s+(.+)$/u;
const CONTROL = /^\*\*(Previous|New|Reason)\*\*\s*$/u;

function text(lines: string[]): string { return lines.join('\n').trim(); }

function parseScenario(lines: string[], requirementId: string): Scenario {
  const header = lines[0]?.match(SCENARIO);
  if (!header) throw new Error(`Malformed Scenario in Requirement ${requirementId}`);
  const bodyLines = lines.slice(1).filter((line) => line.trim() && !/^<!--.*-->$/u.test(line.trim()));
  if (bodyLines.some((line) => !/^\s*[-*]?\s*\*\*(?:GIVEN|WHEN|THEN)\*\*\s+.+$/u.test(line))) {
    throw new Error(`Unconsumed content in Scenario ${header[1]}`);
  }
  const read = (token: 'GIVEN' | 'WHEN' | 'THEN') => lines
    .filter((line) => new RegExp(`^\\s*[-*]?\\s*\\*\\*${token}\\*\\*\\s+`, 'u').test(line))
    .map((line) => line.replace(/^\s*[-*]?\s*\*\*[^*]+\*\*\s+/u, '').trim())
    .filter(Boolean);
  const given = read('GIVEN'); const when = read('WHEN'); const then = read('THEN');
  if (!given.length || !when.length || !then.length) throw new Error(`Scenario ${header[1]} requires GIVEN, WHEN, and THEN`);
  return { id: header[1] as `SCN-${string}`, name: header[2].trim(), given, when, then };
}

function parseRequirement(action: RequirementDelta['action'], lines: string[]): RequirementDelta {
  const header = lines[0]?.match(REQUIREMENT);
  if (!header) throw new Error(`Malformed Requirement heading in ${action}`);
  const id = header[1] as RequirementDelta['id'];
  const module = id.split('-REQ-')[0] as RequirementDelta['module'];
  const labels = new Map<string, string[]>(); let label: string | undefined;
  const scenarios: Scenario[] = []; const previousScenarios: Scenario[] = []; const nextScenarios: Scenario[] = [];
  const scenarioIds = new Set<string>(); let currentScenario: string[] | undefined; let currentScenarioLabel: string | undefined;
  const flushScenario = () => {
    if (!currentScenario) return;
    const parsed = parseScenario(currentScenario, id);
    if (scenarioIds.has(parsed.id)) throw new Error(`Duplicate Scenario ID ${parsed.id}`);
    scenarioIds.add(parsed.id); scenarios.push(parsed);
    if (currentScenarioLabel === 'Previous') previousScenarios.push(parsed);
    else if (currentScenarioLabel === 'New') nextScenarios.push(parsed);
    else throw new Error(`Scenario ${parsed.id} must follow Previous or New in ${id}`);
    currentScenario = undefined; currentScenarioLabel = undefined;
  };
  const unconsumed: string[] = [];
  for (const line of lines.slice(1)) {
    const control = line.match(CONTROL);
    if (control) {
      flushScenario();
      if (labels.has(control[1])) throw new Error(`Duplicate ${control[1]} label in ${id}`);
      label = control[1]; labels.set(label, []); continue;
    }
    if (SCENARIO.test(line)) { flushScenario(); if (!label) throw new Error(`Scenario in ${id} is missing New/Previous section`); currentScenarioLabel = label; currentScenario = [line]; continue; }
    if (currentScenario) { currentScenario.push(line); continue; }
    if (!line.trim() || /^<!--.*-->$/u.test(line.trim())) continue;
    if (!label) unconsumed.push(line); else labels.get(label)!.push(line);
  }
  flushScenario();
  if (unconsumed.length) throw new Error(`Unconsumed content in Requirement ${id}: ${text(unconsumed)}`);
  const previous = labels.has('Previous') ? text(labels.get('Previous')!) : undefined;
  const next = labels.has('New') ? text(labels.get('New')!) : undefined;
  const reason = labels.has('Reason') ? text(labels.get('Reason')!) : undefined;
  if (action === 'ADDED' && !next) throw new Error(`ADDED ${id} requires New`);
  if (action === 'MODIFIED' && (!previous || !next || !reason)) throw new Error(`MODIFIED ${id} requires Previous, New, and Reason`);
  if (action === 'REMOVED' && (!previous || !reason)) throw new Error(`REMOVED ${id} requires Previous and Reason`);
  if (action === 'ADDED' && labels.has('Previous')) throw new Error(`Unexpected Previous label in ADDED ${id}`);
  if (action === 'ADDED' && labels.has('Reason')) throw new Error(`Unexpected Reason label in ADDED ${id}`);
  if (action === 'REMOVED' && labels.has('New')) throw new Error(`Unexpected New label in REMOVED ${id}`);
  const requiredScenarios = action === 'REMOVED' ? previousScenarios : nextScenarios;
  if (!requiredScenarios.length) throw new Error(`${action} ${id} requires at least one scenario in its ${action === 'REMOVED' ? 'Previous' : 'New'} section`);
  const render = (value: string | undefined, renderScenarios: Scenario[]) => {
    if (!value) return undefined;
    const renderedScenarios = renderScenarios.map((item) => [
      `#### Scenario: ${item.id} ${item.name ?? ''}`.trimEnd(),
      ...item.given.map((part) => `- **GIVEN** ${part}`), ...item.when.map((part) => `- **WHEN** ${part}`), ...item.then.map((part) => `- **THEN** ${part}`),
    ].join('\n')).join('\n');
    return [`### ${id} ${header[2].trim()}`, value, renderedScenarios].filter(Boolean).join('\n').trim();
  };
  return parseRequirementDelta({ id, module, title: header[2].trim(), action, previous: render(previous, previousScenarios), next: render(next, nextScenarios), reason, scenarios: requiredScenarios });
}

export function parseDeltaSpec(content: string): ParsedDeltaSpec {
  const lines = content.replace(/^\uFEFF/u, '').split(/\r?\n/u);
  const sections: Array<{ action: RequirementDelta['action']; lines: string[] }> = []; let current: typeof sections[number] | undefined;
  for (const line of lines) {
    const action = line.match(ACTION);
    if (action) { current = { action: action[1] as RequirementDelta['action'], lines: [] }; sections.push(current); continue; }
    if (/^##\s+/u.test(line) && line.trim()) throw new Error(`Unknown delta action section: ${line}`);
    current?.lines.push(line);
  }
  if (!sections.length) throw new Error('Delta spec must contain at least one action section');
  const entries: RequirementDelta[] = []; const ids = new Set<string>();
  for (const section of sections) {
    const starts = section.lines.map((line, index) => ({ line, index })).filter(({ line }) => /^###\s+/u.test(line));
    if (!starts.length) throw new Error(`${section.action} must contain at least one Requirement`);
    const preamble = section.lines.slice(0, starts[0].index).filter((line) => line.trim() && !/^<!--.*-->$/u.test(line.trim()));
    if (preamble.length) throw new Error(`Unconsumed content before first Requirement in ${section.action}`);
    for (let i = 0; i < starts.length; i += 1) {
      const block = section.lines.slice(starts[i].index, starts[i + 1]?.index ?? section.lines.length);
      const match = block[0].match(REQUIREMENT);
      if (!match) throw new Error(`Malformed Requirement heading: ${block[0]}`);
      if (ids.has(match[1])) throw new Error(`Duplicate Requirement ID ${match[1]}`);
      ids.add(match[1]); entries.push(parseRequirement(section.action, block));
    }
  }
  return { entries };
}
