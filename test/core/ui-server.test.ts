import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stringify } from 'yaml';

import { startUiServer } from '../../src/core/ui-server.js';
import { recordFreshVerification } from '../../src/core/codespec-workflow/verification.js';
import { createWorkflowFixture } from '../helpers/codespec-workflow.js';

describe('startUiServer', () => {
  const tempRoots: string[] = [];
  const servers: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it('serves indexed documents only through opaque IDs on the loopback interface', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-server-'));
    const assetsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-assets-'));
    tempRoots.push(root, assetsDir);
    await fs.mkdir(path.join(root, 'codespec'), { recursive: true });
    await fs.writeFile(path.join(root, 'codespec', 'business.md'), '# 业务说明\n\n本机浏览。');
    await fs.writeFile(path.join(assetsDir, 'index.html'), '<!doctype html><title>CodeSpec UI</title>');

    const server = await startUiServer({ projectRoot: root, assetsDir, port: 0 });
    servers.push(server);
    const index = await (await fetch(`${server.url}/api/index`)).json() as {
      documents: Array<{ id: string; relativePath: string }>;
    };
    const document = index.documents[0];

    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(document.relativePath).toBe('codespec/business.md');
    expect((await fetch(`${server.url}/api/documents/${document.id}`)).status).toBe(200);
    expect((await fetch(`${server.url}/api/documents/../../etc/passwd`)).status).toBe(404);
  });

  it('searches indexed content and refreshes the index only on an explicit request', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-server-'));
    const assetsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-assets-'));
    tempRoots.push(root, assetsDir);
    await fs.mkdir(path.join(root, 'codespec'), { recursive: true });
    await fs.writeFile(path.join(root, 'codespec', 'release.md'), '# 发布计划\n\n初始内容。');
    await fs.writeFile(path.join(assetsDir, 'index.html'), '<!doctype html><title>CodeSpec UI</title>');

    const revealed: string[] = [];
    const server = await startUiServer({ projectRoot: root, assetsDir, port: 0, revealDocument: async (filePath) => { revealed.push(filePath); } });
    servers.push(server);
    const before = await (await fetch(`${server.url}/api/search?q=%E5%8F%91%E5%B8%83`)).json() as {
      documents: Array<{ relativePath: string }>;
    };
    await fs.writeFile(path.join(root, 'codespec', 'new.md'), '# 新文档\n\n重新扫描后可见。');
    const rebuild = await fetch(`${server.url}/api/rebuild`, { method: 'POST' });
    const after = await (await fetch(`${server.url}/api/index`)).json() as {
      documents: Array<{ relativePath: string }>;
    };

    expect(before.documents.map((document) => document.relativePath)).toEqual(['codespec/release.md']);
    expect(rebuild.status).toBe(200);
    expect(after.documents.map((document) => document.relativePath)).toContain('codespec/new.md');
  });

  it('accepts reveal requests only for an indexed document ID', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-server-'));
    const assetsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-assets-'));
    tempRoots.push(root, assetsDir);
    await fs.mkdir(path.join(root, 'codespec'), { recursive: true });
    await fs.writeFile(path.join(root, 'codespec', 'business.md'), '# 业务说明');
    await fs.writeFile(path.join(assetsDir, 'index.html'), '<!doctype html>');
    const revealed: string[] = [];
    const server = await startUiServer({ projectRoot: root, assetsDir, port: 0, revealDocument: async (filePath) => { revealed.push(filePath); } });
    servers.push(server);
    const index = await (await fetch(`${server.url}/api/index`)).json() as { documents: Array<{ id: string }> };

    expect((await fetch(`${server.url}/api/reveal/../../etc/passwd`, { method: 'POST' })).status).toBe(404);
    expect((await fetch(`${server.url}/api/reveal/${index.documents[0].id}`, { method: 'POST' })).status).toBe(200);
    expect(revealed).toEqual([path.join(root, 'codespec', 'business.md')]);
  });

  it('rejects archive requests that do not use a canonical Change ID', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-server-'));
    const assetsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-assets-'));
    tempRoots.push(root, assetsDir);
    await fs.mkdir(path.join(root, 'codespec'), { recursive: true });
    await fs.writeFile(path.join(assetsDir, 'index.html'), '<!doctype html>');
    const server = await startUiServer({ projectRoot: root, assetsDir, port: 0 });
    servers.push(server);

    const preview = await fetch(`${server.url}/api/archive/not-a-change`);
    const commit = await fetch(`${server.url}/api/archive/not-a-change`, { method: 'POST' });

    expect(preview.status).toBe(400);
    expect(commit.status).toBe(400);
    expect(await preview.json()).toMatchObject({ error: 'invalid_change_id' });
  });

  it('rejects archive-transition requests that do not use a canonical Change ID', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-server-'));
    const assetsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-assets-'));
    tempRoots.push(root, assetsDir);
    await fs.mkdir(path.join(root, 'codespec'), { recursive: true });
    await fs.writeFile(path.join(assetsDir, 'index.html'), '<!doctype html>');
    const server = await startUiServer({ projectRoot: root, assetsDir, port: 0 });
    servers.push(server);

    const response = await fetch(`${server.url}/api/transition/not-a-change`, { method: 'POST' });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_change_id' });
  });

  it('fails closed for a canonical Change when the workspace cannot pass archive preflight', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-server-'));
    const assetsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-assets-'));
    tempRoots.push(root, assetsDir);
    await fs.mkdir(path.join(root, 'codespec'), { recursive: true });
    await fs.writeFile(path.join(assetsDir, 'index.html'), '<!doctype html>');
    const server = await startUiServer({ projectRoot: root, assetsDir, port: 0 });
    servers.push(server);

    const response = await fetch(`${server.url}/api/archive/CHG-20260906-001`);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'archive_preflight_failed' });
  });

  it('returns canonical archive preview fields for an eligible Change', async () => {
    const fixture = await createWorkflowFixture();
    const assetsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-assets-'));
    tempRoots.push(fixture.tempDir, assetsDir);
    await fs.writeFile(path.join(assetsDir, 'index.html'), '<!doctype html>');

    const changeDir = path.join(fixture.paths.changes, fixture.changeId);
    const metadata = fixture.metadataAt('ARCHIVE');
    metadata.archive.ready = true;
    metadata.gates.archive.satisfied = true;
    metadata.tasks = { total: 1, completed: 1, items: { 'SP-01': { status: 'DONE' } } };
    metadata.modules.confirmed = [{ module: 'MOD-002', outcome: 'OWNED', reason: 'test' }];
    metadata.requirements.added = [{ id: 'MOD-002-REQ-001', module: 'MOD-002' }];
    const spec = [
      '## ADDED',
      '### MOD-002-REQ-001 新需求',
      '**New**',
      '新增行为。',
      '#### Scenario: SCN-001 新场景',
      '**GIVEN** 前置条件',
      '**WHEN** 执行操作',
      '**THEN** 得到结果',
      '**ERROR** 返回错误',
      '',
    ].join('\n');
    await fs.mkdir(changeDir, { recursive: true });
    await fs.mkdir(path.join(fixture.paths.currentSpecs, 'MOD-002'), { recursive: true });
    await fs.writeFile(path.join(fixture.paths.currentSpecs, 'MOD-002', 'spec.md'), '# Current\n');
    await fs.writeFile(path.join(changeDir, 'proposal.md'), '# 新增注册功能\n');
    await fs.writeFile(path.join(changeDir, 'design.md'), '# Design\n\nMOD-002-REQ-001\n\n## 归档影响分析\n\n```yaml\noutcome: none\nreferences: []\nverification: []\n```\n');
    await fs.writeFile(path.join(changeDir, 'spec.md'), spec);
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] SP-01 MOD-002-REQ-001 SCN-001 test/spec.test.ts\n');
    await fs.writeFile(path.join(changeDir, 'verification.md'), '# Verification\n');
    await fs.writeFile(path.join(changeDir, 'metadata.yaml'), stringify(metadata));
    await recordFreshVerification(fixture.workspace, fixture.changeId, [
      { kind: 'unit', command: 'node -e "process.exit(0)"', requirementIds: ['MOD-002-REQ-001'], scenarioIds: ['SCN-001'] },
      { kind: 'typecheck', command: 'node -e "process.exit(0)"' },
      { kind: 'build', command: 'node -e "process.exit(0)"' },
      { kind: 'lint', command: 'node -e "process.exit(0)"' },
      { kind: 'bdd', command: 'node -e "process.exit(0)"' },
      { kind: 'integration', command: 'node -e "process.exit(0)"' },
    ]);

    const server = await startUiServer({ projectRoot: fixture.tempDir, assetsDir, port: 0 });
    servers.push(server);
    const response = await fetch(`${server.url}/api/archive/${fixture.changeId}`);
    const preview = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(preview).toMatchObject({
      changeId: fixture.changeId,
      title: 'Demo change',
      sddLevel: 2,
      status: 'ARCHIVE',
      modules: ['MOD-002'],
      requirements: ['MOD-002-REQ-001'],
      archiveTarget: `codespec/archive/changes/${fixture.changeId}`,
      archiveImpact: { outcome: 'none', references: [], verification: [] },
    });
    expect(typeof preview.verificationReceipt).toBe('string');
  });

  it('rejects an ineligible current-spec Change with 409 and does not commit', async () => {
    const fixture = await createWorkflowFixture({ v1: true });
    const assetsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codespec-ui-assets-'));
    tempRoots.push(fixture.tempDir, assetsDir);
    await fs.writeFile(path.join(assetsDir, 'index.html'), '<!doctype html>');
    const changeDir = path.join(fixture.paths.changes, fixture.changeId);
    const metadata = fixture.metadataAt('VERIFY');
    metadata.artifacts = {
      metadata: path.relative(fixture.paths.codespecDir, path.join(changeDir, 'metadata.yaml')),
      design: path.relative(fixture.paths.codespecDir, path.join(changeDir, 'design.md')),
      spec: path.relative(fixture.paths.codespecDir, path.join(changeDir, 'spec.md')),
      tasks: path.relative(fixture.paths.codespecDir, path.join(changeDir, 'tasks.yaml')),
      verification: path.relative(fixture.paths.codespecDir, path.join(changeDir, 'verification.yaml')),
    };
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(path.join(changeDir, 'metadata.yaml'), stringify(metadata));
    await fs.writeFile(path.join(changeDir, 'design.md'), '# Current-spec design\n');
    await fs.writeFile(path.join(changeDir, 'spec.md'), '# Current-spec change\n');
    await fs.writeFile(path.join(changeDir, 'tasks.yaml'), 'version: 1\ntasks: []\n');
    await fs.writeFile(path.join(changeDir, 'verification.yaml'), 'version: 1\ntestCases: []\n');

    const server = await startUiServer({ projectRoot: fixture.tempDir, assetsDir, port: 0 });
    servers.push(server);
    const preview = await fetch(`${server.url}/api/archive/${fixture.changeId}`);
    const commit = await fetch(`${server.url}/api/archive/${fixture.changeId}`, { method: 'POST' });

    expect(preview.status, JSON.stringify(await preview.clone().json())).toBe(409);
    expect(commit.status).toBe(409);
    await expect(fs.access(changeDir)).resolves.toBeUndefined();
    await expect(fs.access(path.join(fixture.paths.archivedChanges, fixture.changeId))).rejects.toThrow();
  });
});
