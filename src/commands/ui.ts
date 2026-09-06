import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startUiServer } from '../core/ui-server.js';

function openBrowser(url: string): void {
  const child = process.platform === 'darwin' ? spawn('open', [url]) : process.platform === 'win32' ? spawn('cmd', ['/c', 'start', '', url]) : spawn('xdg-open', [url]);
  child.unref();
}

export class UiCommand {
  async execute(targetPath = process.cwd()): Promise<void> {
    const projectRoot = path.resolve(targetPath);
    const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../ui/web');
    const server = await startUiServer({ projectRoot, assetsDir });
    console.log(`CodeSpec UI: ${server.url}`);
    try { openBrowser(server.url); } catch { console.error(`无法自动打开浏览器，请访问 ${server.url}`); }
    const close = async () => { await server.close(); process.exitCode = 0; };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  }
}
