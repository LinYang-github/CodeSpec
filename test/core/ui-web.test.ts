import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const webRoot = path.resolve(process.cwd(), 'src/ui/web');

describe('CodeSpec UI web shell', () => {
  it('declares the compact navigation, icon controls, and business-function entry', async () => {
    const html = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');

    expect(html).toContain('capabilities');
    expect(html).toContain('active-changes');
    expect(html).toContain('archiveable-changes');
    expect(html).toContain('archive-history');
    expect(html).toContain('theme-toggle');
    expect(html).toContain('command-helper');
    expect(html).toContain('业务功能');
    expect(html).not.toContain('只读观测');
  });

  it('contains light-dark theme behavior and grouped command helper entries', async () => {
    const script = await fs.readFile(path.join(webRoot, 'app.js'), 'utf8');

    expect(script).toContain('renderCapabilities');
    expect(script).toContain('renderActiveChanges');
    expect(script).toContain('renderArchiveableChanges');
    expect(script).toContain('renderArchiveHistory');
    expect(script).toContain('renderArchivePreview');
    expect(script).toContain('/api/archive/');
    expect(script).toContain('window.confirm');
    expect(script).toContain('matchMedia');
    expect(script).toContain("saved === 'light' || saved === 'dark'");
    expect(script).not.toContain("labels = { system");
    expect(script).toContain('localStorage');
    expect(script).toContain('renderCurrentScreen');
    expect(script).toContain('refreshCurrentScreen');
    expect(script).toContain('backButton');
    expect(script).toContain('goBackFromScreen');
    expect(script).toContain('commandDefinitions');
    expect(script).toContain('commandSections');
    expect(script).toContain('codespec status --change');
    expect(script).toContain('codespec instructions --change');
    expect(script).toContain('codespec-workflow');
    expect(script).toContain('codespec-rebase-change');
    expect(script).toContain('codespec-archive-change');
    expect(script).toContain('navigator.clipboard.writeText');
    expect(script).not.toContain('/api/exec');
    expect(script).not.toContain('child_process');
  });

  it('defines light and dark theme tokens with system-based initial fallback', async () => {
    const styles = await fs.readFile(path.join(webRoot, 'styles.css'), 'utf8');

    expect(styles).toContain('[data-theme="light"]');
    expect(styles).toContain('[data-theme="dark"]');
    expect(styles).toContain(':root:not([data-theme="light"])');
    expect(styles).not.toContain(':root[data-theme="system"]');
  });
});
