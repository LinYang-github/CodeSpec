import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const webRoot = path.resolve(process.cwd(), 'src/ui/web');

describe('CodeSpec UI web shell', () => {
  it('declares the primary navigation in the top bar', async () => {
    const html = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');

    expect(html).toContain('capabilities');
    expect(html).toContain('id="primary-navigation"');
    expect(html).toContain('data-view="changes"');
    expect(html).toContain('>变更管理</button>');
    expect(html).not.toContain('class="sidebar"');
    expect(html).not.toContain('data-view="active-changes"');
    expect(html).not.toContain('data-view="archiveable-changes"');
    expect(html).not.toContain('data-view="archive-history"');
    expect(html).toContain('theme-toggle');
    expect(html).toContain('command-helper');
    expect(html).toContain('业务功能');
    expect(html).not.toContain('只读观测');
  });

  it('uses two Change tabs and keeps archive actions on eligible active cards', async () => {
    const script = await fs.readFile(path.join(webRoot, 'app.js'), 'utf8');

    expect(script).toContain('renderCapabilities');
    expect(script).toContain('renderChangesWorkspace');
    expect(script).toContain('change-tablist');
    expect(script).not.toContain("{ id: 'archiveable'");
    expect(script).toContain('active-change-card');
    expect(script).toContain('archive-action');
    expect(script).toContain("const archiveButton = button('归档 →', 'archive-action'");
    expect(script).toContain('heading.append(archiveButton)');
    expect(script).toContain('failure-reason');
    expect(script).toContain("setAttribute('role', 'tablist')");
    expect(script).toContain("event.key === 'ArrowRight'");
    expect(script).toContain('openArchiveConfirmation');
    expect(script).toContain('archive-confirmation-dialog');
    expect(script).toContain('archive-transition-action');
    expect(script).toContain('/api/transition/');
    expect(script).toContain('进入归档准备');
    expect(script).toContain("setAttribute('role', 'dialog')");
    expect(script).toContain('change-workspace-header');
    expect(script).toContain('change-workspace-context');
    expect(script).toContain('change-summary');
    expect(script).toContain('change-summary-badge');
    expect(script).toContain('compact-workspace-header');
    expect(script).toContain('business-workspace-header');
    expect(script).toContain('renderWorkspaceSummary');
    expect(script).toContain('business-summary');
    expect(script).toContain('workspace-summary-actions');
    expect(script).toContain('change-workspace-controls');
    expect(script).toContain('/api/archive/');
    expect(script).not.toContain('window.confirm');
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

  it('renders Change artifacts as structured readable views instead of raw source', async () => {
    const script = await fs.readFile(path.join(webRoot, 'app.js'), 'utf8');

    expect(script).toContain('renderMetadataDocument');
    expect(script).toContain('renderTasksDocument');
    expect(script).toContain('renderVerificationDocument');
    expect(script).toContain('renderChangeMarkdownDocument');
    expect(script).toContain('structuredContent');
    expect(script).toContain('document-data-table');
    expect(script).toContain('document-checklist');
    expect(script).toContain('document-section');
    expect(script).toContain("name === 'metadata.yaml'");
    expect(script).toContain("name === 'tasks.yaml'");
    expect(script).toContain("name === 'verification.yaml'");
    expect(script).toContain("name === 'design.md'");
    expect(script).toContain("name === 'spec.md'");
  });

  it('keeps business summary focused on its description and stacks card details vertically', async () => {
    const script = await fs.readFile(path.join(webRoot, 'app.js'), 'utf8');

    expect(script).toContain("], 'business-summary')");
    expect(script).toContain("element('div', 'business-card-details')");
    expect(script).toContain("element('div', 'business-card-row')");
    expect(script).toContain("element('div', 'business-card-actions')");
  });

  it('defines light and dark theme tokens with system-based initial fallback', async () => {
    const styles = await fs.readFile(path.join(webRoot, 'styles.css'), 'utf8');

    expect(styles).toContain('[data-theme="light"]');
    expect(styles).toContain('[data-theme="dark"]');
    expect(styles).toContain(':root:not([data-theme="light"])');
    expect(styles).not.toContain(':root[data-theme="system"]');
  });
});
