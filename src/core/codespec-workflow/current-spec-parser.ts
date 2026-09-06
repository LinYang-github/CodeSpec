import { buildCodeFenceMask } from '../parsers/requirement-text.js';
import type { RequirementId, Scenario } from './types.js';
import { collectEmptyScenarioErrorIssues, parseCanonicalScenario } from './scenario-parser.js';

export interface CurrentSpecificationRequirement {
  id: RequirementId;
  title: string;
  raw: string;
  scenarios: Scenario[];
}

export interface ParsedCurrentSpec {
  requirements: CurrentSpecificationRequirement[];
}

const REQUIREMENT = /^###\s+(MOD-\d{3}-REQ-\d{3})(?:\s+(.+))?$/u;
const SCENARIO = /^####\s+Scenario:\s*(SCN-\d{3})\s+(.+)$/u;

function normalize(content: string): string {
  return content.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
}

export function parseCurrentSpec(content: string): ParsedCurrentSpec {
  const lines = normalize(content).split('\n');
  const fenceMask = buildCodeFenceMask(lines);
  const starts = lines
    .map((line, index) => ({ line, index, match: !fenceMask[index] ? line.match(REQUIREMENT) : null }))
    .filter((item): item is { line: string; index: number; match: RegExpMatchArray } => item.match !== null);
  const requirements: CurrentSpecificationRequirement[] = [];

  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    let end = starts[index + 1]?.index ?? lines.length;
    for (let cursor = start.index + 1; cursor < end; cursor += 1) {
      if (!fenceMask[cursor] && /^#{1,3}\s+/u.test(lines[cursor])) {
        end = cursor;
        break;
      }
    }
    const blockLines = lines.slice(start.index, end);
    const scenarioStarts = blockLines
      .map((line, offset) => ({ line, offset, match: !fenceMask[start.index + offset] ? line.match(SCENARIO) : null }))
      .filter((item): item is { line: string; offset: number; match: RegExpMatchArray } => item.match !== null);
    const scenarios: Scenario[] = [];

    for (let scenarioIndex = 0; scenarioIndex < scenarioStarts.length; scenarioIndex += 1) {
      const scenarioStart = scenarioStarts[scenarioIndex];
      const scenarioEnd = scenarioStarts[scenarioIndex + 1]?.offset ?? blockLines.length;
      scenarios.push(parseCanonicalScenario(
        blockLines.slice(scenarioStart.offset, scenarioEnd),
        start.match[1] as RequirementId,
      ));
    }

    requirements.push({
      id: start.match[1] as RequirementId,
      title: start.match[2]?.trim() ?? '',
      raw: blockLines.join('\n').trim(),
      scenarios,
    });
  }

  return { requirements };
}

export function validateCurrentSpec(content: string, moduleId?: string): string[] {
  try {
    const parsed = parseCurrentSpec(content);
    const issues: string[] = [];
    for (const requirement of parsed.requirements) {
      if (moduleId && !requirement.id.startsWith(`${moduleId}-`)) {
        issues.push(`Requirement ${requirement.id} 不属于模块 ${moduleId}`);
      }
      issues.push(...collectEmptyScenarioErrorIssues(requirement.id, requirement.scenarios));
    }
    return issues;
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}
