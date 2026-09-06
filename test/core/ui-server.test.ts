import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startUiServer } from '../../src/core/ui-server.js';

describe('startUiServer', () => {
  const tempRoots: string[] = [];
  const servers: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it('serves indexed documents only through opaque IDs on the loopback interface', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-ui-server-'));
    const assetsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-ui-assets-'));
    tempRoots.push(root, assetsDir);
    await fs.mkdir(path.join(root, 'openspec'), { recursive: true });
    await fs.writeFile(path.join(root, 'openspec', 'business.md'), '# 业务说明\n\n本机浏览。');
    await fs.writeFile(path.join(assetsDir, 'index.html'), '<!doctype html><title>OpenSpec UI</title>');

    const server = await startUiServer({ projectRoot: root, assetsDir, port: 0 });
    servers.push(server);
    const index = await (await fetch(`${server.url}/api/index`)).json() as {
      documents: Array<{ id: string; relativePath: string }>;
    };
    const document = index.documents[0];

    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(document.relativePath).toBe('openspec/business.md');
    expect((await fetch(`${server.url}/api/documents/${document.id}`)).status).toBe(200);
    expect((await fetch(`${server.url}/api/documents/../../etc/passwd`)).status).toBe(404);
  });

  it('searches indexed content and refreshes the index only on an explicit request', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-ui-server-'));
    const assetsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-ui-assets-'));
    tempRoots.push(root, assetsDir);
    await fs.mkdir(path.join(root, 'openspec'), { recursive: true });
    await fs.writeFile(path.join(root, 'openspec', 'release.md'), '# 发布计划\n\n初始内容。');
    await fs.writeFile(path.join(assetsDir, 'index.html'), '<!doctype html><title>OpenSpec UI</title>');

    const revealed: string[] = [];
    const server = await startUiServer({ projectRoot: root, assetsDir, port: 0, revealDocument: async (filePath) => { revealed.push(filePath); } });
    servers.push(server);
    const before = await (await fetch(`${server.url}/api/search?q=%E5%8F%91%E5%B8%83`)).json() as {
      documents: Array<{ relativePath: string }>;
    };
    await fs.writeFile(path.join(root, 'openspec', 'new.md'), '# 新文档\n\n重新扫描后可见。');
    const rebuild = await fetch(`${server.url}/api/rebuild`, { method: 'POST' });
    const after = await (await fetch(`${server.url}/api/index`)).json() as {
      documents: Array<{ relativePath: string }>;
    };

    expect(before.documents.map((document) => document.relativePath)).toEqual(['openspec/release.md']);
    expect(rebuild.status).toBe(200);
    expect(after.documents.map((document) => document.relativePath)).toContain('openspec/new.md');
  });

  it('accepts reveal requests only for an indexed document ID', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-ui-server-'));
    const assetsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-ui-assets-'));
    tempRoots.push(root, assetsDir);
    await fs.mkdir(path.join(root, 'openspec'), { recursive: true });
    await fs.writeFile(path.join(root, 'openspec', 'business.md'), '# 业务说明');
    await fs.writeFile(path.join(assetsDir, 'index.html'), '<!doctype html>');
    const revealed: string[] = [];
    const server = await startUiServer({ projectRoot: root, assetsDir, port: 0, revealDocument: async (filePath) => { revealed.push(filePath); } });
    servers.push(server);
    const index = await (await fetch(`${server.url}/api/index`)).json() as { documents: Array<{ id: string }> };

    expect((await fetch(`${server.url}/api/reveal/../../etc/passwd`, { method: 'POST' })).status).toBe(404);
    expect((await fetch(`${server.url}/api/reveal/${index.documents[0].id}`, { method: 'POST' })).status).toBe(200);
    expect(revealed).toEqual([path.join(root, 'openspec', 'business.md')]);
  });
});
