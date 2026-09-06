import { describe, expect, it } from 'vitest';

import {
  resolveControlledVerificationCommands,
  requiredVerificationKinds,
} from '../../../src/core/codespec-workflow/verification-policy.js';
import { parseWorkspaceConfig } from '../../../src/core/codespec-workflow/schemas.js';

describe('Level-aware verification policy', () => {
  it('keeps a Level 1 single-module bugfix to the minimum controlled checks', () => {
    expect(requiredVerificationKinds({ level: 1, affectedAreas: [], archiveAffected: false })).toEqual([
      'unit', 'typecheck', 'build', 'lint',
    ]);
  });

  it('adds BDD and integration coverage for Level 2', () => {
    expect(requiredVerificationKinds({ level: 2, affectedAreas: [], archiveAffected: false })).toEqual([
      'unit', 'typecheck', 'build', 'lint', 'bdd', 'integration',
    ]);
  });

  it('adds only applicable Level 3 NFR checks and archive regression', () => {
    expect(requiredVerificationKinds({
      level: 3,
      affectedAreas: ['auth/login', 'data migration', 'performance'],
      archiveAffected: true,
    })).toEqual([
      'unit', 'typecheck', 'build', 'lint', 'bdd', 'integration',
      'security', 'migration', 'performance', 'archive-regression',
    ]);
  });

  it('refuses a required category that the workspace neither configures nor marks inapplicable', () => {
    expect(() => resolveControlledVerificationCommands(
      { unit: { command: 'pnpm test:unit' }, typecheck: { command: 'pnpm typecheck' }, build: { command: 'pnpm build' }, lint: { command: 'pnpm lint' } },
      { level: 2, affectedAreas: [], archiveAffected: false },
    )).toThrow('bdd');
  });

  it('keeps an explicit inapplicable reason as evidence instead of silently skipping it', () => {
    expect(resolveControlledVerificationCommands(
      {
        unit: { command: 'pnpm test:unit' }, typecheck: { command: 'pnpm typecheck' },
        build: { command: 'pnpm build' }, lint: { command: 'pnpm lint' },
        bdd: { not_applicable_reason: '项目没有独立 BDD runner；Scenario 由集成测试覆盖。' },
        integration: { command: 'pnpm test:integration' },
      },
      { level: 2, affectedAreas: [], archiveAffected: false },
    )).toEqual([
      { kind: 'unit', command: 'pnpm test:unit' }, { kind: 'typecheck', command: 'pnpm typecheck' },
      { kind: 'build', command: 'pnpm build' }, { kind: 'lint', command: 'pnpm lint' },
      { kind: 'bdd', notApplicableReason: '项目没有独立 BDD runner；Scenario 由集成测试覆盖。' },
      { kind: 'integration', command: 'pnpm test:integration' },
    ]);
  });

  it('rejects a workspace declaration that ambiguously supplies both a command and an inapplicable reason', () => {
    expect(() => parseWorkspaceConfig({
      version: 1, schema: 'code-spec', project: { name: 'demo' },
      paths: { business: 'business.md', changes: 'changes', change_index: 'changes/index.yaml', archive: 'archive', specs: 'specs', archived_changes: 'archive/changes' },
      workflow: { multiple_active_changes: true }, requirements: { id_format: '{module}-REQ-{sequence:03d}' }, changes: { id_format: 'CHG-{date}-{sequence:03d}' },
      archive: { update_index: true, require_verification: true, conflict_strategy: 'optimistic' },
      verification: { commands: { unit: { command: 'pnpm test:unit', not_applicable_reason: 'no runner' } } },
    })).toThrow(/command.*not_applicable_reason/i);
  });
});
