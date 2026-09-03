import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { runCLI } from '../helpers/run-cli.js';
import { createWorkflowFixture } from '../helpers/openspec-workflow.js';

const specWithError = (error: string) => `# Payment

### MOD-002-REQ-006 Payment
The system MUST support payment.
#### Scenario: SCN-001 Payment failure
- **GIVEN** payment is unavailable
- **WHEN** the customer pays
- **THEN** the system shows a failure
${error}
`;

describe('canonical Current Specification validation', () => {
  it('finds canonical archive specs and rejects an empty ERROR', async () => {
    const fixture = await createWorkflowFixture();
    try {
      await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
      await fs.writeFile(
        path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'),
        specWithError('- **ERROR**')
      );

      const result = await runCLI(['validate', '--specs', '--json'], { cwd: fixture.tempDir });
      const output = JSON.parse(result.stdout);

      expect(result.exitCode).toBe(1);
      expect(output.items).toHaveLength(1);
      expect(output.items[0].valid).toBe(false);
      expect(JSON.stringify(output.items[0].issues)).toMatch(
        /MOD-002-REQ-006.*SCN-001.*ERROR.*人工补写/i
      );
    } finally {
      fixture.cleanup();
    }
  });

  it('accepts a canonical Current Specification with non-empty ERROR', async () => {
    const fixture = await createWorkflowFixture();
    try {
      await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
      await fs.writeFile(
        path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'),
        specWithError('- **ERROR** record the failure and allow retry')
      );

      const result = await runCLI(['validate', '--specs', '--json'], { cwd: fixture.tempDir });
      const output = JSON.parse(result.stdout);

      expect(result.exitCode).toBe(0);
      expect(output.items).toHaveLength(1);
      expect(output.items[0].valid).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });
});
