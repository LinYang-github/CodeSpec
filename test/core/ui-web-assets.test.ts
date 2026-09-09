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
    expect(app).toContain('renderArchiveHistory');
    expect(app).toContain('changeButton(change, { archived: true })');
    expect(app).toContain('groupChangesByModule');
    expect(app).toContain("'BUSINESS MANAGEMENT'");
    expect(app).toContain("'业务功能'");
    expect(app).toContain('change-module-group');
    expect(app).toContain('active-change-grid');
    expect(app).toContain('active-change-card');
    expect(app).toContain('archiveCandidateFor');
    expect(app).toContain('archive-action');
    expect(app).toContain('failure-reason');
    expect(app).toContain('change-workspace-header');
    expect(app).toContain('change-workspace-context');
    expect(app).toContain('change-summary');
    expect(app).toContain('change-summary-badge');
    expect(app).toContain('module-spec-action');
    expect(app).toContain('backButton');
    expect(app).toContain('goBackFromScreen');
    expect(app).toContain('refreshCurrentScreen');
    expect(app).toContain('commandDefinitions');
    expect(app).toContain('commandSections');
    expect(app).toContain('codespec-workflow');
    expect(app).toContain('codespec-rebase-change');
    expect(app).toContain('codespec-archive-change');
    expect(app).toContain('navigator.clipboard.writeText');
    expect(app).not.toContain('暂无归档 Spec');
    expect(app).not.toContain('openspec/business.md');
    expect(app).not.toContain('.openspec.yaml');
    expect(runtime).not.toMatch(/OpenSpec|openspec/);
    expect(html).toContain('CodeSpec <em>UI</em>');
    expect(html).toContain('primary-navigation');
    expect(styles).toContain('height: 100dvh;');
    expect(styles).toContain('overflow: hidden;');
    expect(styles).toContain('flex: 1 1 auto; grid-template-columns');
    expect(styles).toContain('.workspace { min-width: 0; min-height: 0;');
    expect(styles).toContain('.workspace { min-width: 0; min-height: 0; overflow: hidden;');
    expect(styles).toContain('overflow: auto;');
    expect(app).toContain('archive-history-list');
    expect(app).toContain('archived-detail-view');
    expect(app).toContain('detail-meta-row');
    expect(app).toContain('detail-header-row');
    expect(app).toContain('detail-subrow');
    expect(styles).toContain('.primary-navigation');
    expect(styles).toContain('.active-change-grid');
    expect(styles).toContain('.archive-action');
    expect(styles).toContain('.change-failure-panel');
    expect(styles).toContain('.compact-workspace-header');
    expect(styles).toContain('.change-summary');
    expect(styles).toContain('.capability-card, .active-change-card');
    expect(styles).toContain('height: 220px;');
    expect(styles).toContain('.capability-grid, .active-change-grid');
    expect(styles).toContain('.business-card-details');
    expect(styles).toContain('.business-card-row');
    expect(styles).toContain('.business-card-actions');
    expect(styles).toContain('padding-bottom: 32px;');
    expect(styles).toContain('.document-panel { max-height:');
    expect(styles).toContain('.document-content { min-width: 0; min-height: 0; overflow: auto;');
    expect(styles).toContain('.detail-subrow');
    expect(styles).toContain('.archived-detail-view .document-content');
    expect(styles).toContain('.change-module-list');
    expect(styles).toContain('.detail-view .detail-columns');
    expect(styles).toContain('.detail-header-row');
    expect(styles).toContain('.detail-subrow');
    expect(styles).toContain('.page > .detail-view');
    expect(styles).toContain('.search-view .search-results');
    expect(styles).toContain('.document-back-button');
    expect(styles).toContain('.command-helper-drawer');
    expect(styles).toContain('.command-helper-section');
    expect(styles).toContain('.command-helper-section-title');
    expect(styles).toContain('.command-helper-skill');
  });
});
