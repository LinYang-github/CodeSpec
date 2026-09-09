import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildUiIndex, findUiDocument, searchUiIndex } from '../../src/core/ui-content-index.js';
import { parseBusinessModules } from '../../src/core/ui-content-index.js';

describe('buildUiIndex', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it('extracts supported business modules from the registration table', () => {
    const content = [
      '# 业务',
      '',
      '示例：',
      '```markdown',
      '| MOD-999 | 示例模块 | 不应显示 | 示例职责 | 示例关键词 |',
      '```',
      '',
      '| 模块 ID | 模块名称 | 描述 | 职责 | 关键词 |',
      '| --- | --- | --- | --- | --- |',
      '| MOD-001 | 账户 | 管理账户 | 管理用户 | 登录；权限 |',
    ].join('\n');
    expect(parseBusinessModules(content)).toEqual([
      {
        id: 'MOD-001',
        name: '账户',
        description: '管理账户',
        responsibility: '管理用户',
        keywords: ['登录', '权限'],
      },
    ]);
  });

  it('exposes business modules parsed from codespec/business.md in the UI index', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-index-'));
    tempRoots.push(root);

    await fs.mkdir(path.join(root, 'codespec'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'codespec', 'business.md'),
      '# 业务\n\n| 模块 ID | 模块名称 | 描述 | 职责 | 关键词 |\n| --- | --- | --- | --- | --- |\n| MOD-001 | 账户 | 管理账户 | 管理用户 | 登录；权限 |\n'
    );

    const index = await buildUiIndex(root);
    expect(index.businessDocument?.relativePath).toBe('codespec/business.md');
    expect(index.businessModules).toEqual([
      {
        id: 'MOD-001',
        name: '账户',
        description: '管理账户',
        responsibility: '管理用户',
        keywords: ['登录', '权限'],
      },
    ]);
  });

  it('exposes the generated current specification graph to the UI', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-index-'));
    tempRoots.push(root);
    const codespec = path.join(root, 'codespec');
    await fs.mkdir(path.join(codespec, 'specs', 'MOD-001'), { recursive: true });
    await fs.mkdir(path.join(codespec, 'specs', 'MOD-002'), { recursive: true });
    await fs.writeFile(path.join(codespec, 'config.yaml'), [
      'version: 1', 'schema: code-spec', 'project:', '  name: graph-ui', 'paths:',
      '  business: business.yaml', '  changes: changes', '  change_index: changes/index.yaml', '  archive: archive', '  specs: specs', '  archived_changes: archive/changes',
      'workflow:', '  multiple_active_changes: true', 'requirements:', "  id_format: '{module}-REQ-{sequence:03d}'", 'changes:', "  id_format: 'CHG-{date}-{sequence:03d}'", 'archive:', '  update_index: true', '  require_verification: true', '  conflict_strategy: optimistic', '',
    ].join('\n'));
    await fs.writeFile(path.join(codespec, 'business.yaml'), [
      'version: 1', 'modules:',
      '  - id: MOD-001', '    name: 认证', '    status: ACTIVE', '    inputs: []', '    outputs: []', '    relatedModules: []',
      '  - id: MOD-002', '    name: 用户管理', '    status: ACTIVE', '    inputs: []', '    outputs: []', '    relatedModules: []', '',
    ].join('\n'));
    const relation = [
      '  - id: REL-CHG-20260907-001-01', '    kind: http', '    fromModule: MOD-001', '    toModule: MOD-002', '    path: /api/users', '    method: POST', '    input: 新增用户请求', '    output: 用户资料', '    errors: 用户已存在', '    requirements: [MOD-002-REQ-001]', '    scenarios: [MOD-002-REQ-001-SCN-001]',
    ].join('\n');
    await Promise.all(['MOD-001', 'MOD-002'].map((moduleId) => fs.writeFile(path.join(codespec, 'specs', moduleId, 'interface.yaml'), `version: 1\nmodule: ${moduleId}\nrelations:\n${relation}\n`)));

    const index = await buildUiIndex(root);
    expect(index.currentSpecGraph?.modules).toContainEqual(expect.objectContaining({ id: 'MOD-001', outputs: ['新增用户请求'] }));
    expect(index.currentSpecGraph?.relations).toContainEqual(expect.objectContaining({ id: 'REL-CHG-20260907-001-01', path: '/api/users' }));
  });

  it('indexes v1 business.yaml modules with their generated projections', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-index-'));
    tempRoots.push(root);
    const codespec = path.join(root, 'codespec');
    await fs.mkdir(path.join(codespec, 'specs', 'MOD-001'), { recursive: true });
    await fs.writeFile(path.join(codespec, 'config.yaml'), [
      'version: 1', 'schema: code-spec', 'project:', '  name: yaml-ui', 'paths:',
      '  business: business.yaml', '  configuration: configuration.yaml', '  changes: changes', '  change_index: changes/index.yaml', '  specs: specs', '  transactions: .transactions',
      'workflow:', '  multiple_active_changes: true', 'requirements:', "  id_format: '{module}-REQ-{sequence:03d}'", 'changes:', "  id_format: 'CHG-{date}-{sequence:03d}'", 'archive:', '  update_index: true', '  require_verification: true', '  conflict_strategy: optimistic', '',
    ].join('\n'));
    await fs.writeFile(path.join(codespec, 'business.yaml'), [
      'version: 1', 'modules:',
      '  - id: MOD-001', '    name: 账户', '    status: ACTIVE', '    inputs: [登录请求]', '    outputs: [账户资料]', '    relatedModules: []', '',
    ].join('\n'));

    const index = await buildUiIndex(root);
    expect(index.businessDocument?.relativePath).toBe('codespec/business.yaml');
    expect(index.businessModules).toEqual([expect.objectContaining({
      id: 'MOD-001', name: '账户', status: 'ACTIVE', inputs: ['登录请求'], outputs: ['账户资料'],
    })]);
  });

  it('indexes only CodeSpec content and Superpowers plans', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-index-'));
    tempRoots.push(root);

    await fs.mkdir(path.join(root, 'codespec', 'changes', 'CHG-001'), { recursive: true });
    await fs.mkdir(path.join(root, 'docs', 'superpowers', 'plans'), { recursive: true });
    await fs.mkdir(path.join(root, 'docs'), { recursive: true });
    await fs.writeFile(path.join(root, 'codespec', 'business.md'), '# 业务说明\n\n核心业务内容。');
    await fs.writeFile(path.join(root, 'codespec', 'changes', 'CHG-001', 'proposal.md'), '# 发布计划\n\n变更内容。');
    await fs.writeFile(path.join(root, 'docs', 'superpowers', 'plans', 'release.md'), '# 发布实施计划\n\n执行步骤。');
    await fs.writeFile(path.join(root, 'docs', 'other.md'), '# 不应显示\n\n范围外内容。');

    const index = await buildUiIndex(root);
    expect(index.documents.map((document) => document.relativePath)).toEqual([
      'codespec/business.md',
      'codespec/changes/CHG-001/proposal.md',
      'docs/superpowers/plans/release.md',
    ]);
    expect(index.documents.find((document) => document.relativePath === 'codespec/business.md')).toMatchObject({
      source: 'codespec',
      category: '业务说明',
      contentType: 'markdown',
      title: '业务说明',
      labels: [],
    });
  });

  it('marks module API and interface YAML as structured-readable documents', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-index-'));
    tempRoots.push(root);
    const moduleDir = path.join(root, 'codespec', 'specs', 'MOD-001');
    await fs.mkdir(moduleDir, { recursive: true });
    await fs.writeFile(path.join(root, 'codespec', 'business.md'), [
      '# 业务',
      '',
      '| 模块 ID | 模块名称 | 描述 | 职责 | 关键词 |',
      '| --- | --- | --- | --- | --- |',
      '| MOD-001 | 账户 | 管理账户 | 管理账户 | 账户 |',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(moduleDir, 'spec.md'), '# 账户规范\n');
    await fs.writeFile(path.join(moduleDir, 'api.yaml'), 'version: 1\nmodule: MOD-001\nroutes: []\n');
    await fs.writeFile(path.join(moduleDir, 'interface.yaml'), 'version: 1\nmodule: MOD-001\nrelations: []\n');

    const index = await buildUiIndex(root);

    expect(index.documents.filter((document) => document.relativePath.includes('/MOD-001/'))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relativePath: 'codespec/specs/MOD-001/api.yaml', structuredContent: expect.any(Object) }),
        expect.objectContaining({ relativePath: 'codespec/specs/MOD-001/interface.yaml', structuredContent: expect.any(Object) }),
      ])
    );
  });

  it('groups archive Spec snapshots separately from archived Change history', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-index-'));
    tempRoots.push(root);

    await fs.mkdir(path.join(root, 'codespec', 'archive', 'specs', 'cli-init'), { recursive: true });
    await fs.mkdir(path.join(root, 'codespec', 'archive', 'changes', '2025-08-06-add-init-command', 'specs', 'cli-init'), { recursive: true });
    await fs.mkdir(path.join(root, 'codespec', 'changes', 'CHG-20260903-001', 'specs', 'cli-init'), { recursive: true });
    await fs.mkdir(path.join(root, 'codespec', 'changes', 'archive', '2025-08-07-legacy-change'), { recursive: true });
    await fs.writeFile(path.join(root, 'codespec', 'archive', 'specs', 'cli-init', 'spec.md'), '# CLI 初始化规范');
    await fs.writeFile(path.join(root, 'codespec', 'archive', 'specs', 'README.md'), '# 归档说明');
    await fs.writeFile(path.join(root, 'codespec', 'archive', 'changes', '2025-08-06-add-init-command', 'proposal.md'), '# 初始化命令');
    await fs.writeFile(path.join(root, 'codespec', 'archive', 'changes', '2025-08-06-add-init-command', 'specs', 'cli-init', 'spec.md'), '# 历史规格');
    await fs.writeFile(path.join(root, 'codespec', 'changes', 'CHG-20260903-001', 'proposal.md'), '# 当前变更');
    await fs.writeFile(path.join(root, 'codespec', 'changes', 'CHG-20260903-001', 'tasks.md'), '# 任务');
    await fs.writeFile(path.join(root, 'codespec', 'changes', 'CHG-20260903-001', 'specs', 'cli-init', 'spec.md'), '# 当前规格');
    await fs.writeFile(path.join(root, 'codespec', 'changes', 'index.yaml'), 'changes: []\n');
    await fs.writeFile(path.join(root, 'codespec', 'changes', 'archive', '2025-08-07-legacy-change', 'proposal.md'), '# 旧归档');

    const index = await buildUiIndex(root);
    const archive = index as typeof index & {
      archive: { currentSpecs: Array<{ relativePath: string }>; legacySpecSnapshots: Array<{ relativePath: string }>; history: Array<{ relativePath: string }>; historyCount: number };
    };

    expect(archive.archive.currentSpecs.map((document) => document.relativePath)).toEqual([]);
    expect(archive.archive.legacySpecSnapshots.map((document) => document.relativePath)).toEqual([
      'codespec/archive/specs/cli-init/spec.md',
    ]);
    expect(archive.archive.history.map((document) => document.relativePath)).toEqual([
      'codespec/archive/changes/2025-08-06-add-init-command/proposal.md',
      'codespec/archive/changes/2025-08-06-add-init-command/specs/cli-init/spec.md',
      'codespec/changes/archive/2025-08-07-legacy-change/proposal.md',
    ]);
    expect(archive.archive.historyCount).toBe(2);
    expect((index as typeof index & { changes: Array<{ id: string; documents: Array<{ relativePath: string }> }> }).changes.map((change) => ({
      id: change.id,
      documents: change.documents.map((document) => ({ relativePath: document.relativePath })),
    }))).toEqual([
      {
        id: 'CHG-20260903-001',
        documents: [
          { relativePath: 'codespec/changes/CHG-20260903-001/proposal.md' },
          { relativePath: 'codespec/changes/CHG-20260903-001/specs/cli-init/spec.md' },
          { relativePath: 'codespec/changes/CHG-20260903-001/tasks.md' },
        ],
      },
    ]);
    expect((archive.archive as typeof archive.archive & { historyChanges: Array<{ id: string }> }).historyChanges.map((change) => ({ id: change.id }))).toEqual([
      { id: '2025-08-06-add-init-command' },
      { id: '2025-08-07-legacy-change' },
    ]);
  });

  it('exposes SDD level for active and archived Change groups', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-index-'));
    tempRoots.push(root);

    await fs.mkdir(path.join(root, 'codespec', 'changes', 'CHG-20260906-001'), { recursive: true });
    await fs.mkdir(path.join(root, 'codespec', 'archive', 'changes', 'CHG-20260905-001'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'codespec', 'changes', 'CHG-20260906-001', 'metadata.yaml'),
      [
        'change:',
        '  id: CHG-20260906-001',
        '  title: 当前变更',
        '  mode: feature',
        '  sdd_level: 3',
        '  status: ARCHIVE',
        'impact:',
        '  scope: cross-module',
        'modules:',
        '  confirmed:',
        '    - module: MOD-001',
        '      outcome: OWNED',
        'tasks:',
        '  total: 2',
        '  completed: 1',
        'verification:',
        '  requirements_verified: true',
        '  tests_passed: true',
        '  build_passed: true',
        '  lint_passed: false',
        '  verified_at: 2026-09-06T10:00:00.000Z',
        'archive:',
        '  ready: false',
        '  conflict: false',
        'gates:',
        '  archive:',
        '    required: true',
        '    satisfied: false',
        '',
      ].join('\n')
    );
    await fs.writeFile(path.join(root, 'codespec', 'changes', 'CHG-20260906-001', 'proposal.md'), '# 当前变更');
    await fs.writeFile(path.join(root, 'codespec', 'archive', 'changes', 'CHG-20260905-001', 'metadata.yaml'), 'change:\n  sdd_level: 1\n');
    await fs.writeFile(path.join(root, 'codespec', 'archive', 'changes', 'CHG-20260905-001', 'proposal.md'), '# 已归档变更');

    const index = await buildUiIndex(root);

    expect(index.changes).toEqual([
      expect.objectContaining({
        id: 'CHG-20260906-001',
        title: '当前变更',
        mode: 'feature',
        sddLevel: 3,
        status: 'ARCHIVE',
        modules: ['MOD-001'],
        taskProgress: { total: 2, completed: 1 },
        verification: expect.objectContaining({ lintPassed: false }),
        archiveState: expect.objectContaining({ ready: false, conflict: false }),
      }),
    ]);
    expect(index.archive.candidates).toEqual([
      expect.objectContaining({
        id: 'CHG-20260906-001',
        ready: false,
        gateReasons: expect.arrayContaining(['ARCHIVE 门禁尚未满足', '存在未完成任务', '缺少 lint 验证证据']),
      }),
    ]);
    expect(index.archive.historyChanges).toEqual([
      expect.objectContaining({ id: 'CHG-20260905-001', sddLevel: 1 }),
    ]);
  });

  it('exposes canonical requirement IDs and merges active and archived Change rows', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-index-'));
    tempRoots.push(root);
    const activeChange = path.join(root, 'codespec', 'changes', 'CHG-20260909-001');
    const archivedChange = path.join(root, 'codespec', 'archive', 'changes', 'CHG-20260909-001');
    await Promise.all([
      fs.mkdir(activeChange, { recursive: true }),
      fs.mkdir(archivedChange, { recursive: true }),
    ]);
    await fs.writeFile(path.join(activeChange, 'metadata.yaml'), [
      'change:',
      '  id: CHG-20260909-001',
      '  title: 新增注册功能',
      '  status: ARCHIVE',
      'modules:',
      '  confirmed:',
      '    - module: MOD-001',
      'requirements:',
      '  added:',
      '    - id: MOD-001-REQ-001',
      '    - 42',
      '    - id: 42',
      '  modified:',
      '    - null',
      '    - id: null',
      '    - id: MOD-001-REQ-002',
      '  removed:',
      '    - scalar-entry',
      '    - id: scalar',
      '    - id: MOD-001-REQ-003',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(activeChange, 'proposal.md'), '# 新增注册功能');
    await fs.writeFile(path.join(archivedChange, 'metadata.yaml'), [
      'change:',
      '  id: CHG-20260909-001',
      '  title: 历史注册功能',
      '  status: ARCHIVED',
      'requirements:',
      '  added:',
      '    - id: MOD-001-REQ-999',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(archivedChange, 'proposal.md'), '# 历史注册功能');

    const index = await buildUiIndex(root);

    expect(index.changes).toEqual([
      expect.objectContaining({
        id: 'CHG-20260909-001',
        modules: ['MOD-001'],
        requirements: ['MOD-001-REQ-001', 'MOD-001-REQ-002', 'MOD-001-REQ-003'],
      }),
    ]);
    expect(index.archive.historyChanges).toEqual([
      expect.objectContaining({
        id: 'CHG-20260909-001',
        title: '历史注册功能',
        status: 'ARCHIVED',
        requirements: ['MOD-001-REQ-999'],
      }),
    ]);
    expect(index.allChanges).toEqual([
      expect.objectContaining({
        id: 'CHG-20260909-001',
        title: '新增注册功能',
        status: 'ARCHIVE',
        modules: ['MOD-001'],
        requirements: ['MOD-001-REQ-001', 'MOD-001-REQ-002', 'MOD-001-REQ-003'],
      }),
    ]);
    expect(index.archive.candidates.map((candidate) => candidate.id)).toEqual(['CHG-20260909-001']);
  });

  it('marks a VERIFY Change with fresh successful evidence as ready to enter ARCHIVE', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-index-'));
    tempRoots.push(root);
    const changeDir = path.join(root, 'codespec', 'changes', 'CHG-20260908-001');
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(path.join(changeDir, 'metadata.yaml'), [
      'change:',
      '  id: CHG-20260908-001',
      '  title: 验证完成的变更',
      '  mode: feature',
      '  status: VERIFY',
      'modules:',
      '  confirmed:',
      '    - module: MOD-001',
      '      outcome: OWNED',
      'tasks:',
      '  total: 1',
      '  completed: 1',
      'verification:',
      '  requirements_verified: true',
      '  tests_passed: true',
      '  build_passed: true',
      '  lint_passed: true',
      '  verified_at: 2026-09-08T10:00:00.000Z',
      'archive:',
      '  ready: false',
      '  conflict: false',
      'gates:',
      '  archive:',
      '    required: true',
      '    satisfied: false',
      '',
    ].join('\n'));

    const index = await buildUiIndex(root);

    expect(index.archive.candidates).toEqual([
      expect.objectContaining({ id: 'CHG-20260908-001', ready: false, transitionable: true }),
    ]);
  });

  it('uses configured specs and archived changes paths as the archive data source', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-index-'));
    tempRoots.push(root);

    await fs.mkdir(path.join(root, 'codespec', 'current-specs', 'cli-init'), { recursive: true });
    await fs.mkdir(path.join(root, 'codespec', 'meta'), { recursive: true });
    await fs.mkdir(path.join(root, 'codespec', 'history', 'CHG-20260906-001'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'codespec', 'config.yaml'),
      [
        'version: 1',
        'schema: code-spec',
        'project:',
        '  name: ui-test',
        'paths:',
        '  business: meta/business.md',
        '  changes: changes',
        '  change_index: changes/index.yaml',
        '  archive: archive',
        '  specs: current-specs',
        '  archived_changes: history',
        'workflow:',
        '  multiple_active_changes: true',
        'requirements:',
        "  id_format: '{module}-REQ-{sequence:03d}'",
        'changes:',
        "  id_format: 'CHG-{date}-{sequence:03d}'",
        'archive:',
        '  update_index: true',
        '  require_verification: true',
        '  conflict_strategy: optimistic',
        '',
      ].join('\n')
    );
    await fs.writeFile(path.join(root, 'codespec', 'meta', 'business.md'), '# 业务\n\n| 模块 ID | 模块名称 | 描述 | 职责 | 关键词 |\n| --- | --- | --- | --- | --- |\n| MOD-001 | 账户 | 管理账户 | 管理用户 | 登录；权限 |\n');
    await fs.writeFile(path.join(root, 'codespec', 'current-specs', 'cli-init', 'spec.md'), '# 当前 CLI 规范');
    await fs.writeFile(path.join(root, 'codespec', 'history', 'CHG-20260906-001', 'proposal.md'), '# 已归档变更');

    const index = await buildUiIndex(root);

    expect(index.archive.currentSpecs.map((document) => document.relativePath)).toEqual([
      'codespec/current-specs/cli-init/spec.md',
    ]);
    expect(index.archive.history.map((document) => document.relativePath)).toEqual([
      'codespec/history/CHG-20260906-001/proposal.md',
    ]);
    expect(index.archive.historyChanges.map((change) => change.id)).toEqual(['CHG-20260906-001']);
    expect(index.businessDocument?.relativePath).toBe('codespec/meta/business.md');
    expect(index.businessModules.map((module) => module.id)).toEqual(['MOD-001']);
    expect(index.documents.find((document) => document.relativePath === 'codespec/current-specs/cli-init/spec.md')).toMatchObject({
      category: '当前 Spec',
    });
    expect(index.documents.find((document) => document.relativePath === 'codespec/history/CHG-20260906-001/proposal.md')).toMatchObject({
      category: '归档 Change',
    });
  });

  it('ranks title matches before body matches and extracts YAML metadata labels', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-index-'));
    tempRoots.push(root);

    await fs.mkdir(path.join(root, 'codespec'), { recursive: true });
    await fs.writeFile(path.join(root, 'codespec', 'body.md'), '# 概览\n\n发布准备事项。');
    await fs.writeFile(path.join(root, 'codespec', 'title.md'), '# 发布计划\n\n其他内容。');
    await fs.writeFile(
      path.join(root, 'codespec', 'metadata.yaml'),
      'id: CHG-001\nstatus: PLAN\nupdated_at: 2026-09-04\n'
    );

    const index = await buildUiIndex(root);
    const results = searchUiIndex(index, '发布');
    const metadata = index.documents.find((document) => document.relativePath === 'codespec/metadata.yaml');

    expect(results.map((document) => document.relativePath)).toEqual([
      'codespec/title.md',
      'codespec/body.md',
    ]);
    expect(metadata).toMatchObject({
      contentType: 'yaml',
      labels: ['CHG-001', 'PLAN', '2026-09-04'],
      structuredContent: {
        id: 'CHG-001',
        status: 'PLAN',
        updated_at: '2026-09-04',
      },
    });
  });

  it('skips unsafe files while resolving indexed documents by opaque ID', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-index-'));
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-outside-'));
    tempRoots.push(root, outsideRoot);

    await fs.mkdir(path.join(root, 'codespec'), { recursive: true });
    await fs.writeFile(path.join(root, 'codespec', 'safe.md'), '# 安全文档');
    await fs.writeFile(path.join(root, 'codespec', 'binary.md'), Buffer.from([0x61, 0x00, 0x62]));
    await fs.writeFile(path.join(root, 'codespec', 'large.md'), 'a'.repeat(1_048_577));
    await fs.writeFile(path.join(outsideRoot, 'outside.md'), '# 范围外');
    await fs.symlink(path.join(outsideRoot, 'outside.md'), path.join(root, 'codespec', 'outside.md'));

    const index = await buildUiIndex(root);
    const safeDocument = index.documents.find((document) => document.relativePath === 'codespec/safe.md');

    expect(index.documents.map((document) => document.relativePath)).toEqual(['codespec/safe.md']);
    expect(index.skipped).toEqual([
      { relativePath: 'codespec/binary.md', reason: 'binary' },
      { relativePath: 'codespec/large.md', reason: 'too_large' },
      { relativePath: 'codespec/outside.md', reason: 'outside_root' },
    ]);
    expect(safeDocument).toBeDefined();
    expect(findUiDocument(index, safeDocument!.id)).toEqual(safeDocument);
    expect(findUiDocument(index, '../../etc/passwd')).toBeUndefined();
  });
});
