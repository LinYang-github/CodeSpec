import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const webRoot = path.resolve(process.cwd(), 'src/ui/web');

describe('CodeSpec UI web shell', () => {
  it('declares the approved navigation, theme control, and read-only boundary', async () => {
    const html = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');

    expect(html).toContain('capabilities');
    expect(html).toContain('active-changes');
    expect(html).toContain('archiveable-changes');
    expect(html).toContain('archive-history');
    expect(html).toContain('theme');
    expect(html).toContain('只读');
  });

  it('contains view and system-theme behavior in the browser script', async () => {
    const script = await fs.readFile(path.join(webRoot, 'app.js'), 'utf8');

    expect(script).toContain('renderCapabilities');
    expect(script).toContain('renderActiveChanges');
    expect(script).toContain('renderArchiveableChanges');
    expect(script).toContain('renderArchiveHistory');
    expect(script).toContain('renderArchivePreview');
    expect(script).toContain('/api/archive/');
    expect(script).toContain('window.confirm');
    expect(script).toContain('dataset.theme');
    expect(script).toContain('localStorage');
  });

  it('defines light, dark, and system theme tokens', async () => {
    const styles = await fs.readFile(path.join(webRoot, 'styles.css'), 'utf8');

    expect(styles).toContain('[data-theme="light"]');
    expect(styles).toContain('[data-theme="dark"]');
    expect(styles).toContain('@media (prefers-color-scheme: dark)');
  });
});
