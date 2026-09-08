import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  resolveControlledVerificationCommands,
  requiredVerificationKinds,
  validateRuntimeConfiguration,
} from '../../../src/core/codespec-workflow/verification-policy.js';
import { parseWorkspaceConfig } from '../../../src/core/codespec-workflow/schemas.js';
import { parseConfiguration } from '../../../src/core/codespec-workflow/current-spec-yaml.js';

describe('Level-aware verification policy', () => {
  const temporaryDirectories: string[] = [];
  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
  });

  it('resolves dotenv, JSON, and YAML configuration sources without leaking sensitive endpoints', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-runtime-config-'));
    temporaryDirectories.push(root);
    await fs.writeFile(path.join(root, '.env.test'), 'USER_URL=https://users.test.example\n');
    await fs.writeFile(path.join(root, 'services.json'), JSON.stringify({ billing: { url: 'https://billing.test.example' } }));
    await fs.writeFile(path.join(root, 'services.yaml'), 'notify:\n  url: https://notify.test.example\n');
    const configuration = parseConfiguration({
      version: 1,
      profiles: [{ id: 'test', services: [
        { id: 'billing', hostAlias: '账单服务', endpoint: 'https://billing.test.example', routeBindings: [{ module: 'MOD-001', path: '/api/billing' }], source: { kind: 'repo-file', file: 'services.json', format: 'json', key: '/billing/url' } },
        { id: 'notify', hostAlias: '通知服务', endpointFingerprint: 'sha256:a5fcfe237301bf15e9744e740eb101b8b759f663b4e0d05b61e61e46331e6cdf', routeBindings: [{ module: 'MOD-001', path: '/api/notify' }], source: { kind: 'repo-file', file: 'services.yaml', format: 'yaml', key: '/notify/url' } },
        { id: 'users', hostAlias: '用户服务', endpoint: 'https://users.test.example', routeBindings: [{ module: 'MOD-001', path: '/api/users' }], source: { kind: 'repo-file', file: '.env.test', format: 'dotenv', key: 'USER_URL' } },
      ] }],
    });

    expect(await validateRuntimeConfiguration(root, configuration)).toEqual([]);
    await fs.writeFile(path.join(root, 'services.yaml'), 'notify:\n  url: https://notify.changed.example\n');
    const fingerprintErrors = await validateRuntimeConfiguration(root, configuration);
    expect(fingerprintErrors.join('\n')).toMatch(/通知服务.*fingerprint/i);
    expect(fingerprintErrors.join('\n')).not.toContain('https://notify.changed.example');
    await fs.writeFile(path.join(root, '.env.test'), 'USER_URL=${UNSAFE}\n');
    const errors = await validateRuntimeConfiguration(root, configuration);
    expect(errors.join('\n')).toMatch(/用户服务.*USER_URL/i);
    expect(errors.join('\n')).not.toContain('https://users.test.example');
  });

  it('rejects unsupported runtime configuration source formats before execution', () => {
    expect(() => parseConfiguration({
      version: 1,
      profiles: [{ id: 'test', services: [{
        id: 'users', hostAlias: '用户服务', endpoint: 'https://users.test.example',
        routeBindings: [{ module: 'MOD-001', path: '/api/users' }],
        source: { kind: 'repo-file', file: '.env.test', format: 'http', key: 'USERS_URL' },
      }] }],
    })).toThrow(/format/i);
  });

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
