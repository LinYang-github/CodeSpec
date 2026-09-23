import { describe, expect, it } from 'vitest';
import { validateCurrentSpecGraphTraceability, validateTraceRows } from '../../../src/core/codespec-workflow/traceability.js';
import { buildCurrentSpecGraph } from '../../../src/core/codespec-workflow/current-spec-graph.js';
import { parseModuleInterface } from '../../../src/core/codespec-workflow/current-spec-yaml.js';
import { allocateRequirementIds } from '../../../src/core/codespec-workflow/requirement-allocator.js';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  createWorkflowFixture,
  writeChangeArtifacts,
} from '../../helpers/codespec-workflow.js';

describe('traceability', () => {
  it('rejects duplicate and unknown evidence rows while retaining historical rows without AC', () => {
    const row = { requirement_id: 'MOD-002-REQ-001', scenario_id: 'SCN-001', task_id: 'SP-1', test_id: 'test/a.test.ts', evidence_id: 'E-1', result: 'PASS' as const };
    const requirements = [{ requirementId: row.requirement_id, scenarioIds: ['SCN-001'] }];
    expect(validateTraceRows([row], requirements)).toEqual([]);
    expect(validateTraceRows([row, row], requirements).join('\n')).toMatch(/duplicate/i);
    expect(validateTraceRows([row, { ...row, scenario_id: 'SCN-099' }], requirements).join('\n')).toMatch(/unknown/i);
  });
  it('traces relation requirements and scenarios through the current specification graph', () => {
    const relation = {
      id: 'REL-CHG-20260907-001-01',
      kind: 'http' as const,
      fromModule: 'MOD-001',
      toModule: 'MOD-002',
      path: '/api/users',
      method: 'POST',
      input: '新增用户请求',
      output: '用户资料',
      errors: '用户已存在',
      requirements: ['MOD-002-REQ-001'],
      scenarios: ['MOD-002-REQ-001-SCN-001'],
    };
    const graph = buildCurrentSpecGraph({
      modules: [
        { id: 'MOD-001', name: '认证', status: 'ACTIVE' },
        { id: 'MOD-002', name: '用户管理', status: 'ACTIVE' },
      ],
      interfaces: [
        parseModuleInterface({ version: 1, module: 'MOD-001', relations: [relation] }),
        parseModuleInterface({ version: 1, module: 'MOD-002', relations: [relation] }),
      ],
    });

    expect(validateCurrentSpecGraphTraceability(graph, [{
      title: '认证',
      module: 'MOD-001',
      version: '1',
      requirements: [],
      engineeringFiles: [{ path: 'src/shared/user-contract.ts', role: '共享用户契约', references: [] }],
    }, {
      title: '用户管理',
      module: 'MOD-002',
      version: '1',
      requirements: [{
        id: 'MOD-002-REQ-001',
        title: '新增用户',
        scenarios: [{
          id: 'MOD-002-REQ-001-SCN-001', title: '提交新增用户', given: ['已登录'], when: ['提交'], then: ['创建'], error: ['用户已存在'], testCases: [],
        }],
      }],
      engineeringFiles: [{ path: 'src/shared/user-contract.ts', role: '共享用户契约', references: [] }],
    }])).toMatchObject({
      valid: true,
      links: {
        Relation: ['REL-CHG-20260907-001-01'],
        Requirement: ['MOD-002-REQ-001'],
        Scenario: ['MOD-002-REQ-001-SCN-001'],
        'Engineering File': ['src/shared/user-contract.ts'],
      },
    });

    expect(validateCurrentSpecGraphTraceability(graph, []).issues.join('\n')).toMatch(/REL-CHG-20260907-001-01.*Requirement|REL-CHG-20260907-001-01.*Scenario/i);
  });

  it('rejects a Scenario that has no Test-to-Evidence trace row', () => {
    expect(validateTraceRows(
      [{ requirement_id: 'MOD-002-REQ-017', scenario_id: 'SCN-001', task_id: 'SP-01', test_id: 'test/payment.test.ts', evidence_id: 'EV-001', result: 'PASS' }],
      [{ requirementId: 'MOD-002-REQ-017', scenarioIds: ['SCN-001', 'SCN-002'] }],
    ).join('\n')).toContain('SCN-002');
  });

  it('atomically reserves concurrent allocations in canonical Change metadata', async () => {
    const fixture = await createWorkflowFixture();
    try {
      await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
      await fs.writeFile(
        path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'),
        '### MOD-002-REQ-016 已有需求\n系统 SHALL 保留。\n'
      );
      await writeChangeArtifacts(fixture);
      const second = { ...fixture, changeId: 'CHG-20260901-002' };
      await writeChangeArtifacts(second);

      const [firstIds, secondIds] = await Promise.all([
        allocateRequirementIds(fixture.workspace, fixture.changeId, 'MOD-002', 1),
        allocateRequirementIds(fixture.workspace, second.changeId, 'MOD-002', 1),
      ]);

      expect(new Set([...firstIds, ...secondIds])).toEqual(
        new Set(['MOD-002-REQ-017', 'MOD-002-REQ-018'])
      );
      for (const changeId of [fixture.changeId, second.changeId]) {
        const metadata = parseYaml(
          await fs.readFile(path.join(fixture.paths.changes, changeId, 'metadata.yaml'), 'utf8')
        ) as { requirements: { added: Array<{ id: string }> }; approvals: Record<string, unknown> };
        expect(metadata.requirements.added).toHaveLength(1);
        expect(metadata.approvals.analyze).toBeDefined();
      }
      await expect(fs.access(path.join(fixture.paths.changes, 'reservations.txt'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      fixture.cleanup();
    }
  });

  it('fails closed when an active canonical reservation cannot be parsed', async () => {
    const fixture = await createWorkflowFixture();
    try {
      await writeChangeArtifacts(fixture);
      const malformed = path.join(fixture.paths.changes, 'CHG-20260901-002');
      await fs.mkdir(malformed, { recursive: true });
      await fs.writeFile(path.join(malformed, 'metadata.yaml'), 'not: canonical\n');

      await expect(
        allocateRequirementIds(fixture.workspace, fixture.changeId, 'MOD-002', 1)
      ).rejects.toThrow(/metadata|reservation|canonical/i);
    } finally {
      fixture.cleanup();
    }
  });
});
