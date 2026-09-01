import path from 'node:path';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import type { ArchivePlan, ChangeId } from '../../../src/core/openspec-workflow/types.js';

import { getWorkspacePaths } from '../../../src/core/openspec-workflow/paths.js';
import {
  parseBusinessModule,
  parseArchivePlan,
  parseChangeIndexEntry,
  parseChangeMetadata,
  parseRequirementDelta,
  parseWorkspaceConfig,
} from '../../../src/core/openspec-workflow/schemas.js';
import { createWorkflowFixture } from '../../helpers/openspec-workflow.js';

function validMetadata() {
  return {
    schema_version: 1,
    change: {
      id: 'CHG-20260901-001',
      revision: 1,
      title: 'Demo change',
      mode: 'feature',
      status: 'ANALYZE',
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    },
    impact: {
      summary: 'Introduce account recovery flow',
      mode: 'feature',
      scope: 'cross-module',
    },
    baseline: {
      created_at: '2026-09-01T00:00:00.000Z',
      stale: false,
      modules: {
        'MOD-001': {
          outcome: 'OWNED',
          latest_change: 'CHG-20260831-001',
          requirement_ids: ['MOD-001-REQ-001'],
        },
      },
    },
    relations: {
      depends_on: ['CHG-20260831-002'],
      related_to: ['CHG-20260830-001'],
      conflicts_with: [],
      supersedes: [],
    },
    gates: {
      analyze: { required: true, satisfied: false },
      design: { required: true, satisfied: false },
      plan: { required: true, satisfied: false },
      implement: { required: true, satisfied: false },
      verify: { required: true, satisfied: false },
      archive: { required: true, satisfied: false },
    },
    modules: {
      candidates: [
        {
          module: 'MOD-001',
          outcome: 'OWNED',
          reason: 'Owns account lifecycle requirements',
        },
      ],
      confirmed: [
        {
          module: 'MOD-001',
          outcome: 'OWNED',
          reason: 'Primary owner of the changed requirement',
        },
      ],
      dependencies: [
        {
          module: 'MOD-002',
          outcome: 'DEPENDENCY',
          reason: 'Notification delivery participates in the flow',
        },
      ],
    },
    requirements: {
      added: [{ id: 'MOD-001-REQ-001', module: 'MOD-001' }],
      modified: [],
      removed: [],
    },
    artifacts: {
      metadata: 'changes/CHG-20260901-001/metadata.yaml',
      proposal: 'changes/CHG-20260901-001/proposal.md',
      design: 'changes/CHG-20260901-001/design.md',
      spec: 'changes/CHG-20260901-001/spec.md',
      tasks: 'changes/CHG-20260901-001/tasks.md',
      verification: 'changes/CHG-20260901-001/verification.md',
    },
    tasks: {
      total: 1,
      completed: 0,
      items: {
        'SP-01': {
          title: 'Define recovery requirements',
          status: 'TODO',
        },
      },
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
  };
}

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
      parseBusinessModule({
        id: 'account-module',
        name: 'Account Management',
        responsibilities: ['Owns account lifecycle'],
        keywords: ['account', 'identity'],
      })
    ).toThrow(/MOD-\d{3}|id/i);

    expect(() =>
      parseChangeMetadata({
        ...validMetadata(),
        change: {
          ...validMetadata().change,
          mode: 'legacy',
        },
      })
    ).toThrow(/mode/i);
  });

  it('parses canonical change index entries', () => {
    expect(
      parseChangeIndexEntry({
        id: 'CHG-20260901-001',
        title: 'Demo change',
        mode: 'feature',
        status: 'ANALYZE',
        updated_at: '2026-09-01T00:00:00.000Z',
      })
    ).toMatchObject({
      id: 'CHG-20260901-001',
      status: 'ANALYZE',
    });
  });

  it('rejects invalid canonical ids in change index and metadata', () => {
    expect(() =>
      parseChangeIndexEntry({
        id: 'chg-demo',
        title: 'Demo change',
        mode: 'feature',
        status: 'ANALYZE',
        updated_at: '2026-09-01T00:00:00.000Z',
      })
    ).toThrow(/CHG-\d{8}-\d{3}|id/i);

    expect(() =>
      parseChangeMetadata({
        ...validMetadata(),
        change: {
          ...validMetadata().change,
          id: 'change-1',
        },
      })
    ).toThrow(/CHG-\d{8}-\d{3}|change\.id/i);
  });

  it('requires canonical requirement delta actions and scenario ids', () => {
    expect(
      parseRequirementDelta({
        id: 'MOD-001-REQ-001',
        module: 'MOD-001',
        action: 'MODIFIED',
        previous: 'Old text',
        next: 'New text',
        scenarios: [
          {
            id: 'SCN-001',
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

    expect(() =>
      parseRequirementDelta({
        id: 'REQ-001',
        module: 'module-a',
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
    ).toThrow(/MOD-\d{3}|REQ-\d{3}|scenario|id/i);
  });

  it('requires complete canonical metadata sections for requirements, gates, modules, and artifacts', () => {
    expect(parseChangeMetadata(validMetadata())).toMatchObject({
      impact: {
        mode: 'feature',
      },
      gates: {
        verify: { required: true, satisfied: false },
      },
      modules: {
        confirmed: [{ module: 'MOD-001', outcome: 'OWNED' }],
      },
      artifacts: {
        verification: 'changes/CHG-20260901-001/verification.md',
      },
    });

    expect(() => {
      const metadata = validMetadata();
      delete (metadata as { impact?: unknown }).impact;
      parseChangeMetadata(metadata);
    }).toThrow(/impact/i);

    expect(() =>
      parseChangeMetadata({
        ...validMetadata(),
        baseline: {
          ...validMetadata().baseline,
          modules: {
            'MOD-001': {
              outcome: 'PRIMARY',
              latest_change: 'CHG-20260831-001',
              requirement_ids: ['MOD-001-REQ-001'],
            },
          },
        },
      })
    ).toThrow(/OWNED|DEPENDENCY|IRRELEVANT|outcome/i);

    expect(() =>
      parseChangeMetadata({
        ...validMetadata(),
        artifacts: {
          ...validMetadata().artifacts,
          verification: '/tmp/verification.md',
        },
      })
    ).toThrow(/artifact|path|relative/i);
  });

  it('types and parses archive plans with canonical change ids', () => {
    expectTypeOf<ArchivePlan['changeId']>().toEqualTypeOf<ChangeId>();

    const validPlan: ArchivePlan = parseArchivePlan({
      changeId: 'CHG-20260901-001',
      ready: true,
      conflict: false,
      reasons: [],
    });

    expect(validPlan.changeId).toBe('CHG-20260901-001');

    expect(() =>
      parseArchivePlan({
        changeId: 'change-1',
        ready: false,
        conflict: true,
        reasons: ['invalid id'],
      })
    ).toThrow(/CHG-\d{8}-\d{3}|changeId|change id/i);
  });
});
