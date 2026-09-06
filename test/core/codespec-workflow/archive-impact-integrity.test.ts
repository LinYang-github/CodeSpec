import { describe, expect, it } from 'vitest';
import { parseArchiveImpact, validateArchiveImpactDeltas } from '../../../src/core/codespec-workflow/archive-impact.js';
import { parseDeltaSpec } from '../../../src/core/codespec-workflow/delta-parser.js';

const scenario = (id: string, result = 'allowed') => `#### Scenario: ${id} login\n- **GIVEN** an account\n- **WHEN** signing in\n- **THEN** ${result}\n- **ERROR** access denied`;
const old = `### MOD-001-REQ-001 Login\nOld rule\n${scenario('SCN-001')}`;
const modified = `## MODIFIED\n### MOD-001-REQ-001 Login\n**Previous**\nOld rule\n${scenario('SCN-001')}\n**New**\nNew rule\n${scenario('SCN-002', 'locked')}\n**Reason**\nCorrect policy`;
const reference = {
  current_requirement: 'MOD-001-REQ-001', current_scenario: 'SCN-001', disposition: 'modified',
  replacement_requirement: 'MOD-001-REQ-001', replacement_scenario: 'SCN-002',
};
const document = (value: unknown) => `## 归档影响分析\n\n\`\`\`yaml\n${JSON.stringify(value)}\n\`\`\`\n`;
const affected = () => parseArchiveImpact(document({ outcome: 'affected', references: [reference], verification: ['archive-regression'] }));

describe('archive impact integrity', () => {
  it('rejects none when a delta changes Current Specification', () => {
    const impact = parseArchiveImpact(document({ outcome: 'none', references: [], verification: [] }));
    expect(validateArchiveImpactDeltas(impact, parseDeltaSpec(modified).entries, new Map([['MOD-001', old]])).join('\n')).toMatch(/MOD-001-REQ-001.*映射/);
  });

  it('requires the disposition to match the actual delta action', () => {
    const impact = affected();
    impact.references[0].disposition = 'superseded';
    expect(validateArchiveImpactDeltas(impact, parseDeltaSpec(modified).entries, new Map([['MOD-001', old]])).join('\n')).toMatch(/REMOVED.*ADDED/);
  });

  it('rejects duplicate mappings and duplicate impact sections', () => {
    expect(() => parseArchiveImpact(document({ outcome: 'affected', references: [reference, reference], verification: ['archive-regression'] }))).toThrow(/重复/);
    const content = document({ outcome: 'none', references: [], verification: [] });
    expect(() => parseArchiveImpact(content + content)).toThrow(/唯一|重复/);
  });

  it('does not accept a section that appears only in a fenced example', () => {
    expect(() => parseArchiveImpact('````markdown\n' + document({ outcome: 'none', references: [], verification: [] }) + '````')).toThrow(/缺少/);
  });

  it('rejects reusing a Scenario ID for changed acceptance behavior', () => {
    const content = modified.replace('SCN-002', 'SCN-001');
    const impact = affected(); impact.references[0].replacement_scenario = 'SCN-001';
    expect(validateArchiveImpactDeltas(impact, parseDeltaSpec(content).entries, new Map([['MOD-001', old]])).join('\n')).toMatch(/SCN-001.*新.*ID/);
  });

  it('reads deltas after inline design sections without silently losing them', () => {
    const content = document({ outcome: 'none', references: [], verification: [] }) + '\n## 设计说明\nA design\n\n' + modified;
    expect(parseDeltaSpec(content).entries.map((entry) => entry.id)).toEqual(['MOD-001-REQ-001']);
  });

  it('accepts a complete modified mapping', () => {
    expect(validateArchiveImpactDeltas(affected(), parseDeltaSpec(modified).entries, new Map([['MOD-001', old]]))).toEqual([]);
  });
});
