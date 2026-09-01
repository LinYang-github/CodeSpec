import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { getWorkspacePaths } from '../../../src/core/openspec-workflow/paths.js';
import {
  parseBusinessModule,
  parseChangeMetadata,
  parseRequirementDelta,
  parseWorkspaceConfig,
} from '../../../src/core/openspec-workflow/schemas.js';
import { createWorkflowFixture } from '../../helpers/openspec-workflow.js';

describe('openspec workflow contracts', () => {
  it('accepts the canonical workspace config and resolves configured paths', async () => {
    const fixture = await createWorkflowFixture();
    const { paths, workspace } = fixture;
    afterEach(fixture.cleanup);

    const config = parseWorkspaceConfig({
      version: 1,
      project: { name: 'demo' },
      paths: {
        business: 'business.md',
        changes: 'changes',
        change_index: 'changes/index.yaml',
        archive: 'archive',
        specs: 'archive/specs',
        archived_changes: 'archive/changes',
      },
      workflow: { multiple_active_changes: true },
      requirements: { id_format: '{module}-REQ-{sequence:03d}' },
      changes: { id_format: 'CHG-{date}-{sequence:03d}' },
      archive: {
        update_index: true,
        require_verification: true,
        conflict_strategy: 'optimistic',
      },
    });

    expect(getWorkspacePaths('/tmp/project/openspec', config).currentSpecs).toBe(
      path.join('/tmp/project/openspec', 'archive', 'specs')
    );
    expect(paths.currentSpecs).toBe(path.join(workspace.openspecDir, 'archive', 'specs'));
  });

  it('rejects a legacy .openspec.yaml-shaped metadata object', () => {
    expect(() => parseChangeMetadata({ schema: 'code-spec' })).toThrow(/change\.id|metadata/i);
  });

  it('rejects unsafe configured paths', async () => {
    const fixture = await createWorkflowFixture();
    const { paths, workspace } = fixture;
    afterEach(fixture.cleanup);

    expect(paths.archive).toBe(path.join(workspace.openspecDir, 'archive'));

    const config = parseWorkspaceConfig({
      version: 1,
      project: { name: 'demo' },
      paths: {
        business: '../business.md',
        changes: 'changes',
        change_index: 'changes/index.yaml',
        archive: 'archive',
        specs: 'archive/specs',
        archived_changes: 'archive/changes',
      },
      workflow: { multiple_active_changes: true },
      requirements: { id_format: '{module}-REQ-{sequence:03d}' },
      changes: { id_format: 'CHG-{date}-{sequence:03d}' },
      archive: {
        update_index: true,
        require_verification: true,
        conflict_strategy: 'optimistic',
      },
    });

    expect(() => getWorkspacePaths('/tmp/project/openspec', config)).toThrow(/\.\.|relative|path/i);
  });

  it('validates canonical business modules and workflow enums strictly', () => {
    expect(
      parseBusinessModule({
        id: 'MOD-001',
        name: 'Account Management',
        responsibilities: ['Owns account lifecycle'],
        keywords: ['account', 'identity'],
      })
    ).toMatchObject({
      id: 'MOD-001',
      responsibilities: ['Owns account lifecycle'],
    });

    expect(() =>
      parseChangeMetadata({
        schema_version: 1,
        change: {
          id: 'CHG-20260901-001',
          revision: 1,
          title: 'Demo change',
          mode: 'legacy',
          status: 'ANALYZE',
          created_at: '2026-09-01T00:00:00.000Z',
          updated_at: '2026-09-01T00:00:00.000Z',
        },
        baseline: {
          created_at: '2026-09-01T00:00:00.000Z',
          stale: false,
          modules: {},
        },
        relations: {
          depends_on: [],
          related_to: [],
          conflicts_with: [],
          supersedes: [],
        },
        modules: {
          candidates: [],
          confirmed: [],
          dependencies: [],
        },
        requirements: {
          added: [],
          modified: [],
          removed: [],
        },
        tasks: {
          total: 0,
          completed: 0,
          items: {},
        },
        verification: {
          requirements_verified: false,
          tests_passed: false,
          build_passed: false,
          lint_passed: false,
          verified_at: null,
        },
        archive: {
          ready: false,
          conflict: false,
          archived_at: null,
        },
      })
    ).toThrow(/mode/i);
  });

  it('requires canonical requirement delta actions and scenario structure', () => {
    expect(
      parseRequirementDelta({
        id: 'MOD-001-REQ-001',
        module: 'MOD-001',
        action: 'MODIFIED',
        previous: 'Old text',
        next: 'New text',
        scenarios: [
          {
            given: ['a user exists'],
            when: ['the user signs in'],
            then: ['access is granted'],
          },
        ],
      })
    ).toMatchObject({
      action: 'MODIFIED',
    });

    expect(() =>
      parseRequirementDelta({
        id: 'MOD-001-REQ-001',
        module: 'MOD-001',
        action: 'RENAMED',
        previous: 'Old text',
        next: 'New text',
        scenarios: [],
      })
    ).toThrow(/action/i);
  });
});
