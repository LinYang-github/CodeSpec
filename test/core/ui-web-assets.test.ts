import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const webRoot = path.resolve('src/ui/web');

describe('CodeSpec UI web assets', () => {
  it('uses CodeSpec paths and branding without OpenSpec runtime remnants', async () => {
    const [app, html] = await Promise.all([
      fs.readFile(path.join(webRoot, 'app.js'), 'utf8'),
      fs.readFile(path.join(webRoot, 'index.html'), 'utf8'),
    ]);
    const runtime = `${app}\n${html}`;

    expect(app).toContain('index.businessDocument');
    expect(app).toContain('archive.currentSpecs');
    expect(app).toContain('当前生效 Spec');
    expect(app).not.toContain('暂无归档 Spec');
    expect(app).not.toContain('openspec/business.md');
    expect(app).not.toContain('.openspec.yaml');
    expect(runtime).not.toMatch(/OpenSpec|openspec/);
    expect(html).toContain('CodeSpec <em>UI</em>');
  });
});
