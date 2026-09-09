import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const webRoot = path.resolve(process.cwd(), 'src/ui/web');

function parseHtml(html) {
  const root = { tagName: '#root', attributes: {}, children: [] };
  const stack = [root];
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const tokenPattern = /<!--[^]*?-->|<\/?([a-z][\w-]*)([^>]*)>/giu;
  for (const match of html.matchAll(tokenPattern)) {
    const [, tagName, rawAttributes = ''] = match;
    if (!tagName) continue;
    if (match[0].startsWith('</')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attributes = {};
    for (const attribute of rawAttributes.matchAll(/([:\w-]+)(?:\s*=\s*["']([^"']*)["'])?/gu)) {
      attributes[attribute[1]] = attribute[2] ?? '';
    }
    const node = { tagName: tagName.toLowerCase(), attributes, children: [] };
    stack.at(-1).children.push(node);
    if (!voidTags.has(node.tagName) && !rawAttributes.trimEnd().endsWith('/')) stack.push(node);
  }
  return root;
}

function findAll(node, predicate) {
  return node.children.flatMap((child) => [
    ...(predicate(child) ? [child] : []),
    ...findAll(child, predicate),
  ]);
}

function hasClass(node, className) {
  return (node.attributes.class ?? '').split(/\s+/u).includes(className);
}

describe('CodeSpec UI web shell', () => {
  it('declares the reference sidebar and workspace shell', async () => {
    const html = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
    const documentTree = parseHtml(html);
    const sidebar = findAll(documentTree, (node) => node.attributes.id === 'sidebar')[0];
    const workspaceHeader = findAll(documentTree, (node) => hasClass(node, 'workspace-header'))[0];

    expect(sidebar).toBeDefined();
    expect(workspaceHeader).toBeDefined();
    expect(html).toContain('id="sidebar"');
    expect(html).toContain('id="project-tree"');
    expect(html).toContain('class="sidebar-tools"');
    expect(html).toContain('class="workspace-header"');
    expect(html).toContain('class="global-search"');
    expect(html).toContain('id="rebuild"');
    expect(html).not.toContain('id="primary-navigation"');
    expect(html).not.toContain('data-view="capabilities"');
    expect(html).not.toContain('data-view="changes"');
    expect(html).not.toContain('data-view="active-changes"');
    expect(html).not.toContain('data-view="archiveable-changes"');
    expect(html).not.toContain('data-view="archive-history"');
    expect(html).not.toContain('archive-history');
    expect(html).toContain('id="theme-toggle"');
    expect(html).toContain('id="command-helper"');
    expect(html).not.toContain('只读观测');
    expect(findAll(sidebar, (node) => node.attributes.id === 'theme-toggle')).toHaveLength(1);
    expect(findAll(sidebar, (node) => node.attributes.id === 'command-helper')).toHaveLength(1);
    expect(findAll(workspaceHeader, (node) => hasClass(node, 'global-search'))).toHaveLength(1);
    expect(findAll(workspaceHeader, (node) => node.attributes.id === 'rebuild')).toHaveLength(1);
  });

  it('renders the module workspace and unified all-Change management table', async () => {
    const script = await fs.readFile(path.join(webRoot, 'app.js'), 'utf8');
    const styles = await fs.readFile(path.join(webRoot, 'styles.css'), 'utf8');

    expect(script).toContain('renderSidebar');
    expect(script).toContain('renderModuleWorkspace');
    expect(script).toContain('renderAllChangesWorkspace');
    expect(script).toContain('renderChangeRow');
    expect(script).toContain('index.businessModules');
    expect(script).toContain('index.archive.currentSpecs');
    expect(script).toContain('index.allChanges');
    expect(script).toContain('index.currentSpecGraph');
    expect(script).toContain('变更ID');
    expect(script).toContain('变更标题');
    expect(script).toContain('关联模块/需求');
    expect(script).toContain('状态');
    expect(script).toContain('操作');
    expect(script).toContain('查看');
    expect(script).toContain('归档');
    expect(script).toContain("design.md");
    expect(script).toContain('updatedAfter');
    expect(script).toContain('disabled-reason');
    expect(script).toContain("setAttribute('aria-describedby'");
    expect(script).toContain('openArchiveConfirmation');
    const tableDeclaration = script.indexOf("const table = element('table', 'change-table');");
    const emptyTableRow = script.indexOf("element('tr', 'change-table-empty-row')");
    expect(tableDeclaration).toBeGreaterThanOrEqual(0);
    expect(emptyTableRow).toBeGreaterThan(tableDeclaration);
    expect(script).toContain('emptyCell.colSpan = 5');
    expect(script).not.toContain("label: '归档历史'");
    expect(script).not.toContain('active-change-card');
    expect(script).not.toContain('CHANGE_TABS');
    expect(script).toContain("setAttribute('data-node', 'change-management')");
    expect(script).toContain('businessModules');
    expect(script).toContain("type: 'module'");
    expect(script).toContain("type: 'changes'");
    expect(script).toContain("type: 'change'");
    expect(script).toContain("type: 'search'");
    expect(script).not.toContain('let currentView');
    expect(script).not.toContain('function navigate(view, changeTab)');
    expect(script).not.toContain("type: 'view'");
    expect(script).not.toContain("type: 'document'");
    expect(script).not.toContain("currentScreen = { type: 'change', changeId: change.id, options");
    expect(script).not.toContain("currentScreen = { type: 'search', query, documents");
    expect(script).not.toContain('currentScreen.options');
    expect(script).not.toContain('currentScreen.returnScreen');
    expect(script).not.toContain("() => renderChangeDetail(change)");
    expect(script).toContain('documentReturnScreen = activeScreen');
    expect(script).toContain('const activeScreen = returnScreen.type === \'module\' || returnScreen.type === \'change\'');
    expect((script.match(/setAttribute\('data-node', 'change-management'\)/gu) ?? [])).toHaveLength(1);
    expect(script).toContain('renderChangeDetail');
    expect(script).toContain('archive-confirmation-dialog');
    expect(script).toContain("setAttribute('role', 'dialog')");
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
    expect(styles).toContain('.module-workspace');
    expect(styles).toContain('.change-table');
    expect(styles).toContain('.change-table-wrap');
    expect(styles).toContain('.disabled-reason');
    expect(styles).toContain('overflow-x: auto');
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

  it('keeps module facts and empty states grounded in indexed records', async () => {
    const script = await fs.readFile(path.join(webRoot, 'app.js'), 'utf8');

    expect(script).toContain("['模块 ID', module.id]");
    expect(script).toContain("['职责', text(module.responsibility, '未读取')]");
    expect(script).toContain("emptyState('当前 Spec 未建立')");
    expect(script).toContain("emptyState('暂无关联 Change')");
    expect(script).toContain("emptyState('暂无关联关系')");
  });

  it('defines light and dark theme tokens with system-based initial fallback', async () => {
    const styles = await fs.readFile(path.join(webRoot, 'styles.css'), 'utf8');

    expect(styles).toContain('[data-theme="light"]');
    expect(styles).toContain('[data-theme="dark"]');
    expect(styles).toContain(':root:not([data-theme="light"])');
    expect(styles).not.toContain(':root[data-theme="system"]');
  });
});
