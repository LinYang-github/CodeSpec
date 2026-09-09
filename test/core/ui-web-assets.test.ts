import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const webRoot = path.resolve('src/ui/web');

describe('CodeSpec UI web assets', () => {
  it('uses CodeSpec paths and branding without OpenSpec runtime remnants', async () => {
    const [app, html, styles] = await Promise.all([
      fs.readFile(path.join(webRoot, 'app.js'), 'utf8'),
      fs.readFile(path.join(webRoot, 'index.html'), 'utf8'),
      fs.readFile(path.join(webRoot, 'styles.css'), 'utf8'),
    ]);
    const runtime = `${app}\n${html}`;

    expect(app).toContain('index.businessModules');
    expect(app).toContain('index.archive.currentSpecs');
    expect(app).toContain('index.allChanges');
    expect(app).toContain('renderSidebar');
    expect(app).toContain('renderModuleWorkspace');
    expect(app).toContain('renderAllChangesWorkspace');
    expect(app).toContain('renderChangeRow');
    expect(app).toContain('archiveCandidateFor');
    expect(app).toContain('archive-action');
    expect(app).toContain('change-table');
    expect(app).toContain('变更ID');
    expect(app).toContain('变更标题');
    expect(app).toContain('关联模块/需求');
    expect(app).toContain('状态');
    expect(app).toContain('操作');
    expect(app).toContain('change-association-summary');
    expect(app).toContain('renderDocumentReaderControls');
    expect(app).toContain('结构化');
    expect(app).toContain('源文件');
    expect(app).toContain('navigator.clipboard.writeText');
    expect(app).toContain('/api/reveal/');
    expect(app).toContain('renderArchivePreflightError');
    expect(app).toContain('refreshCurrentScreen');
    expect(app).toContain('commandDefinitions');
    expect(app).toContain('commandSections');
    expect(app).toContain('codespec-workflow');
    expect(app).toContain('codespec-rebase-change');
    expect(app).toContain('codespec-archive-change');
    expect(app).not.toContain('暂无归档 Spec');
    expect(app).not.toContain('openspec/business.md');
    expect(app).not.toContain('.openspec.yaml');
    expect(runtime).not.toMatch(/OpenSpec|openspec/);
    expect(html).toContain('CodeSpec <em>UI</em>');
    expect(html).toContain('id="sidebar"');
    expect(html).toContain('id="project-tree"');
    expect(html).toContain('class="workspace-header"');
    expect(html).toContain('id="rebuild"');
    expect(html).not.toContain('id="primary-navigation"');
    expect(styles).toContain('height: 100dvh;');
    expect(styles).toContain('overflow: hidden;');
    expect(styles).toContain('grid-template-columns: 260px minmax(0, 1fr)');
    expect(styles).toContain('.workspace { min-width: 0; min-height: 0; overflow: auto;');
    expect(styles).toContain('overflow: auto;');
    expect(styles).toContain('.change-table');
    expect(styles).toContain('.change-table-wrap');
    expect(styles).toContain('.document-tabs');
    expect(styles).toContain('flex-wrap: nowrap;');
    expect(styles).toContain('overflow-x: auto;');
    expect(styles).toContain('overflow-y: hidden;');
    expect(styles).toContain('.document-reader-toolbar');
    expect(styles).toContain('.change-association-summary');
    expect(styles).toContain('.inline-error');
    expect(styles).toContain('.command-helper-drawer');
    expect(styles).toContain('.command-helper-section');
    expect(styles).toContain('.command-helper-section-title');
    expect(styles).toContain('.command-helper-skill');
  });
});
