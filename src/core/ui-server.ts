import { createServer, type Server, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { buildUiIndex, findUiDocument, searchUiIndex, type UiIndex } from './ui-content-index.js';

export interface UiServer {
  url: string;
  close(): Promise<void>;
  rebuild(): Promise<UiIndex>;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

export async function startUiServer(options: {
  projectRoot: string;
  assetsDir: string;
  port?: number;
  revealDocument?: (filePath: string) => Promise<void>;
}): Promise<UiServer> {
  let index = await buildUiIndex(options.projectRoot);
  const assetsDir = path.resolve(options.assetsDir);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/api/index') {
      sendJson(response, 200, index);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/search') {
      const source = url.searchParams.get('source');
      const documents = searchUiIndex(
        index,
        url.searchParams.get('q') ?? '',
        source === 'openspec' || source === 'superpowers-plans' ? source : undefined
      );
      sendJson(response, 200, { documents });
      return;
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/documents/')) {
      const document = findUiDocument(index, decodeURIComponent(url.pathname.slice('/api/documents/'.length)));
      if (!document) sendJson(response, 404, { error: 'document_not_found' });
      else sendJson(response, 200, document);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/rebuild') {
      index = await buildUiIndex(options.projectRoot);
      sendJson(response, 200, index);
      return;
    }
    if (request.method === 'POST' && url.pathname.startsWith('/api/reveal/')) {
      const document = findUiDocument(index, decodeURIComponent(url.pathname.slice('/api/reveal/'.length)));
      if (!document) sendJson(response, 404, { error: 'document_not_found' });
      else {
        const reveal = options.revealDocument ?? ((filePath: string) => new Promise<void>((resolve, reject) => {
          const child = process.platform === 'darwin'
            ? spawn('open', ['-R', filePath])
            : process.platform === 'win32'
              ? spawn('explorer', [`/select,${filePath}`])
              : spawn('xdg-open', [path.dirname(filePath)]);
          child.once('error', reject);
          child.once('spawn', () => { child.unref(); resolve(); });
        }));
        try {
          await reveal(path.join(options.projectRoot, document.relativePath));
          sendJson(response, 200, { status: 'revealed' });
        } catch {
          sendJson(response, 502, { error: 'reveal_failed' });
        }
      }
      return;
    }
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/app.js' || url.pathname === '/styles.css' || url.pathname === '/vendor/markdown-it.min.js')) {
      try {
        const fileName = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        response.writeHead(200, { 'content-type': fileName.endsWith('.css') ? 'text/css; charset=utf-8' : fileName.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' });
        response.end(await fs.readFile(path.join(assetsDir, fileName)));
      } catch {
        sendJson(response, 404, { error: 'asset_not_found' });
      }
      return;
    }
    sendJson(response, 404, { error: 'not_found' });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('UI server did not provide a TCP address');
  const url = `http://127.0.0.1:${address.port}`;

  return {
    url,
    close: () => closeServer(server),
    async rebuild() {
      index = await buildUiIndex(options.projectRoot);
      return index;
    },
  };
}
