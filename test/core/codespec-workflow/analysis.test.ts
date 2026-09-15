import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import {
  parseAnalysisDocument,
  projectAnalysisForApproval,
  renderInitialAnalysis,
  validateAnalysisCompleteness,
} from '../../../src/core/codespec-workflow/analysis.js';

const completeAnalysis = {
  version: 1,
  change: 'CHG-20260915-001',
  revision: 1,
  problem: '在用户列表中显示详情',
  goals: [{ id: 'GOAL-001', statement: '管理员可以在用户列表内查看用户基础详情' }],
  nonGoals: [{ id: 'NON-GOAL-001', statement: '本次不提供用户资料编辑能力' }],
  scope: { in: ['用户列表中的详情查看入口'], out: ['新增后端 API'] },
  actors: ['管理员'],
  constraints: [{ id: 'CONSTRAINT-001', statement: '复用现有用户查询接口', source: '当前系统约束' }],
  assumptions: [{
    id: 'ASSUMPTION-001',
    statement: '当前接口已返回详情所需字段',
    status: 'CONFIRMED' as const,
    requirements: ['MOD-002-REQ-006'],
  }],
  openQuestions: [{
    id: 'QUESTION-001',
    question: '无权限时展示什么结果',
    status: 'RESOLVED' as const,
    resolution: '展示无权限提示并保持列表状态',
  }],
  acceptanceCriteria: [{
    id: 'AC-001',
    statement: '点击用户后在当前页面展示基础详情',
    priority: 'MUST' as const,
    requirements: ['MOD-002-REQ-006'],
  }],
  modules: [{ module: 'MOD-002', outcome: 'OWNED' as const, reason: '用户查看行为由用户管理模块负责' }],
  requirements: [{ id: 'MOD-002-REQ-006', action: 'MODIFIED' as const, reason: '在现有用户查看需求中增加列表内详情场景' }],
};

const complete = () => parseAnalysisDocument(completeAnalysis);

describe('analysis.yaml contract', () => {
  it('parses a complete analysis document and defaults omitted assumption requirements', () => {
    const parsed = parseAnalysisDocument({
      ...completeAnalysis,
      assumptions: [{ ...completeAnalysis.assumptions[0], requirements: undefined }],
    });

    expect(parsed).toMatchObject({
      change: 'CHG-20260915-001',
      acceptanceCriteria: [{ priority: 'MUST', requirements: ['MOD-002-REQ-006'] }],
      assumptions: [{ requirements: [] }],
    });
  });

  it('rejects unknown fields and duplicate stable IDs', () => {
    expect(() => parseAnalysisDocument({ ...completeAnalysis, unexpected: true })).toThrow(/unrecognized|unexpected/i);
    expect(() => parseAnalysisDocument({ ...completeAnalysis, goals: [...completeAnalysis.goals, { ...completeAnalysis.goals[0] }] })).toThrow(/duplicate.*goal/i);
    expect(() => parseAnalysisDocument({ ...completeAnalysis, acceptanceCriteria: [...completeAnalysis.acceptanceCriteria, { ...completeAnalysis.acceptanceCriteria[0] }] })).toThrow(/duplicate.*acceptance criterion/i);
    expect(() => parseAnalysisDocument({ ...completeAnalysis, requirements: [...completeAnalysis.requirements, { ...completeAnalysis.requirements[0] }] })).toThrow(/duplicate.*requirement/i);
  });

  it('requires a valid change ID and positive revision', () => {
    expect(() => parseAnalysisDocument({ ...completeAnalysis, change: '' })).toThrow(/change/i);
    expect(() => parseAnalysisDocument({ ...completeAnalysis, revision: 0 })).toThrow(/revision/i);
  });

  it('renders a parseable draft analysis document', () => {
    const text = renderInitialAnalysis({
      changeId: 'CHG-20260915-001',
      revision: 1,
      problem: '在用户列表中显示详情',
    });
    expect(parseAnalysisDocument(parseYaml(text))).toMatchObject({
      change: 'CHG-20260915-001',
      revision: 1,
    });
  });

  it('makes an approval projection stable across collection ordering and YAML presentation', () => {
    const reordered = parseAnalysisDocument({
      ...completeAnalysis,
      scope: { in: ['第二个范围', '用户列表中的详情查看入口'], out: ['第二个排除范围', '新增后端 API'] },
      actors: ['审核员', '管理员'],
      goals: [
        { id: 'GOAL-002', statement: '审核员可以查看详情' },
        ...completeAnalysis.goals,
      ],
      assumptions: [{
        ...completeAnalysis.assumptions[0],
        requirements: ['MOD-002-REQ-007', 'MOD-002-REQ-006'],
      }],
      requirements: [
        { id: 'MOD-002-REQ-007', action: 'ADDED', reason: '增加审核详情场景' },
        ...completeAnalysis.requirements,
      ],
    });
    const sameMeaningDifferentOrder = parseAnalysisDocument({
      ...reordered,
      scope: { in: [...reordered.scope.in].reverse(), out: [...reordered.scope.out].reverse() },
      actors: [...reordered.actors].reverse(),
      goals: [...reordered.goals].reverse(),
      assumptions: [{ ...reordered.assumptions[0], requirements: [...reordered.assumptions[0]!.requirements].reverse() }],
      requirements: [...reordered.requirements].reverse(),
    });

    expect(projectAnalysisForApproval(reordered)).toEqual(projectAnalysisForApproval(sameMeaningDifferentOrder));
  });
});

describe('analysis completeness', () => {
  it('reports field paths for each incomplete analyze exit condition', () => {
    const incomplete = parseAnalysisDocument({
      ...completeAnalysis,
      problem: '',
      goals: [],
      nonGoals: [],
      scope: { in: [], out: [] },
      assumptions: [{ ...completeAnalysis.assumptions[0], status: 'PROPOSED', requirements: [] }],
      openQuestions: [{ ...completeAnalysis.openQuestions[0], status: 'OPEN', resolution: undefined }],
      acceptanceCriteria: [],
      modules: [{ ...completeAnalysis.modules[0], outcome: 'DEPENDENCY' }],
      requirements: [],
    });

    expect(validateAnalysisCompleteness(incomplete)).toEqual(expect.objectContaining({
      ok: false,
      errors: expect.arrayContaining([
        expect.stringMatching(/^problem:/),
        expect.stringMatching(/^goals:/),
        expect.stringMatching(/^nonGoals:/),
        expect.stringMatching(/^scope\.in:/),
        expect.stringMatching(/^scope\.out:/),
        expect.stringMatching(/^assumptions\[0\]\.status:/),
        expect.stringMatching(/^openQuestions\[0\]\.status:/),
        expect.stringMatching(/^acceptanceCriteria:/),
        expect.stringMatching(/^modules:/),
        expect.stringMatching(/^requirements:/),
      ]),
    }));
  });

  it('requires every MUST acceptance criterion to map to an affected requirement', () => {
    const withoutMapping = parseAnalysisDocument({
      ...completeAnalysis,
      acceptanceCriteria: [{ ...completeAnalysis.acceptanceCriteria[0], requirements: [] }],
    });
    const missingRequirement = parseAnalysisDocument({
      ...completeAnalysis,
      acceptanceCriteria: [{ ...completeAnalysis.acceptanceCriteria[0], requirements: ['MOD-002-REQ-999'] }],
    });

    expect(validateAnalysisCompleteness(withoutMapping).errors).toContainEqual(expect.stringMatching(/^acceptanceCriteria\[0\]\.requirements:/));
    expect(validateAnalysisCompleteness(missingRequirement).errors).toContainEqual(expect.stringMatching(/^acceptanceCriteria\[0\]\.requirements\[0\]:/));
  });

  it('accepts rejected assumptions and resolved questions without blocking completion', () => {
    const analysis = parseAnalysisDocument({
      ...completeAnalysis,
      assumptions: [{ ...completeAnalysis.assumptions[0], status: 'REJECTED' }],
      openQuestions: [{ ...completeAnalysis.openQuestions[0], status: 'RESOLVED' }],
    });

    expect(validateAnalysisCompleteness(analysis)).toEqual({ ok: true, errors: [] });
  });

  it('rejects affected requirements outside confirmed owned modules', () => {
    const analysis = parseAnalysisDocument({
      ...completeAnalysis,
      requirements: [{ id: 'MOD-003-REQ-001', action: 'ADDED', reason: '新增需求' }],
    });

    expect(validateAnalysisCompleteness(analysis).errors).toContainEqual(expect.stringMatching(/^requirements\[0\]\.id:/));
  });

  it('accepts a complete analysis document', () => {
    expect(validateAnalysisCompleteness(complete())).toEqual({ ok: true, errors: [] });
  });
});
