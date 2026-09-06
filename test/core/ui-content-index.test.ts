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
      archive: { specSnapshots: Array<{ relativePath: string }>; history: Array<{ relativePath: string }>; historyCount: number };
    };

    expect(archive.archive.specSnapshots.map((document) => document.relativePath)).toEqual([
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
