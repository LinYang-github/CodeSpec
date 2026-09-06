import { describe, expect, it } from 'vitest';
import {
  parseArchiveImpact,
  validateArchiveImpactMappings,
} from '../../../src/core/codespec-workflow/archive-impact.js';

describe('archive impact', () => {
  it('parses an affected mapping and archive regression declaration', () => {
    const impact = parseArchiveImpact(`## 归档影响分析

\`\`\`yaml
outcome: affected
references:
  - current_requirement: MOD-001-REQ-001
    current_scenario: SCN-001
    disposition: modified
    replacement_requirement: MOD-001-REQ-001
    replacement_scenario: SCN-002
verification: [archive-regression]
\`\`\``);

    expect(impact.outcome).toBe('affected');
    expect(impact.references).toHaveLength(1);
  });

  it('rejects a none outcome with references', () => {
    expect(() => parseArchiveImpact('## 归档影响分析\n```yaml\noutcome: none\nreferences: [bad]\nverification: []\n```'))
      .toThrow(/references/i);
  });

  it('requires each archived reference and its replacement to exist in the corresponding Current Specification', () => {
    const impact = parseArchiveImpact(`## 归档影响分析

\`\`\`yaml
outcome: affected
references:
  - current_requirement: MOD-001-REQ-001
    current_scenario: SCN-001
    disposition: superseded
    replacement_requirement: MOD-001-REQ-002
    replacement_scenario: SCN-002
verification: [archive-regression]
\`\`\``);
    const before = new Map([['MOD-001', `# Current

### MOD-001-REQ-001 Legacy

#### Scenario: SCN-001 legacy
- **GIVEN** an account exists
- **WHEN** the old flow runs
- **THEN** it succeeds
- **ERROR** it reports an error
`]]);
    const after = new Map([['MOD-001', `# Current

### MOD-001-REQ-002 Replacement

#### Scenario: SCN-002 replacement
- **GIVEN** an account exists
- **WHEN** the new flow runs
- **THEN** it succeeds
- **ERROR** it reports an error
`]]);

    expect(validateArchiveImpactMappings(impact, before, after)).toEqual([]);
  });
});
