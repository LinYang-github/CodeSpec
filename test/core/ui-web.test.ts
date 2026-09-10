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

    expect(sidebar).toBeDefined();
    expect(html).toContain('id="sidebar"');
    expect(html).toContain('id="project-tree"');
    expect(html).toContain('class="sidebar-tools"');
    expect(html).toContain('class="sidebar-search"');
    expect(html).toContain('id="search-submit"');
    expect(html).toContain('id="search-suggestions"');
    expect(html).not.toContain('class="workspace-header"');
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
    expect(html).toContain('<title>CodeSpec</title>');
    expect(html).not.toContain('CodeSpec UI');
    expect(html).not.toContain('只读观测');
    expect(findAll(sidebar, (node) => node.attributes.id === 'theme-toggle')).toHaveLength(1);
    expect(findAll(sidebar, (node) => node.attributes.id === 'command-helper')).toHaveLength(1);
    expect(findAll(sidebar, (node) => node.attributes.id === 'rebuild')).toHaveLength(1);
    expect(html).toContain('data-tooltip="主题"');
    expect(html).toContain('data-tooltip="命令行"');
    expect(html).toContain('data-tooltip="重新扫描"');
    expect(html).toContain('class="icon-button sidebar-rebuild-button"');
    expect(html.indexOf('id="theme-toggle"')).toBeLessThan(html.indexOf('id="command-helper"'));
    expect(html.indexOf('id="command-helper"')).toBeLessThan(html.indexOf('id="rebuild"'));
    expect(findAll(sidebar, (node) => hasClass(node, 'global-search'))).toHaveLength(1);
    expect(findAll(sidebar, (node) => node.attributes.id === 'search')).toHaveLength(1);
    expect(findAll(sidebar, (node) => node.attributes.id === 'search-submit')).toHaveLength(1);
  });

  it('renders the module workspace and unified all-Change management table', async () => {
    const script = await fs.readFile(path.join(webRoot, 'app.js'), 'utf8');
    const styles = await fs.readFile(path.join(webRoot, 'styles.css'), 'utf8');

    expect(script).toContain('renderSidebar');
    expect(script).toContain('renderBusinessOverview');
    expect(script).toContain('renderBusinessTable');
    expect(script).toContain('renderBusinessCanvas');
    expect(script).toContain("{ value: 'table', label: '表格' }");
    expect(script).toContain("{ value: 'canvas', label: '画布' }");
    expect(script).toContain('business-view-switch');
    expect(script).toContain('business-canvas-viewport');
    expect(script).toContain('business-canvas-node');
    expect(script).toContain('Ctrl/⌘ + 滚轮缩放');
    expect(script).toContain("for (const label of ['序号', '业务模块ID', '业务模块', '关联模块', '最后修改时间', '操作'])");
    expect(script).toContain('activeChangesForModule');
    expect(script).toContain('openBusinessChangesModal');
    expect(script).toContain("button('查看变更'");
    expect(script).toContain('business-change-modal-list');
    expect(script).toContain("dialog.setAttribute('role', 'dialog')");
    expect(script).toContain("change.status !== 'ABANDONED'");
    expect(script).toContain('changeId: change.id');
    expect(styles).toContain('.business-change-modal-backdrop');
    expect(styles).toContain('.business-change-modal-item');
    expect(script).not.toContain('business-change-disclosure');
    expect(script).toContain('renderModuleWorkspace');
    expect(script).toContain('renderModuleDocumentPanel');
    expect(styles).toContain('.page > .module-workspace');
    expect(styles).toContain('.document-panel.module-document-panel { max-height: none; }');
    expect(script).not.toContain('BUSINESS MANAGEMENT');
    expect(script).not.toContain('业务总览');
    expect(script).not.toContain('业务关系');
    expect(script).toContain('module-document-tab');
    expect(script).toContain("element('button', 'tree-node', '业务管理')");
    expect(script).toContain("element('button', 'tree-node', '变更管理')");
    expect(script).toContain('renderAllChangesWorkspace');
    expect(script).toContain('renderChangeRow');
    expect(script).toContain("for (const label of ['序号', '变更ID', '变更标题', '关联模块/需求', '创建时间', '状态', '操作'])");
    expect(script).toContain('moduleLastModifiedAt');
    expect(script).toContain('changeCreatedAt');
    expect(script).toContain('index.businessModules');
    expect(script).toContain('index.allChanges');
    expect(script).toContain('变更ID');
    expect(script).toContain('序号');
    expect(script).toContain('变更标题');
    expect(script).toContain('关联模块/需求');
    expect(script).toContain('状态');
    expect(script).toContain('操作');
    expect(script).toContain('查看');
    expect(script).toContain('归档');
    expect(script).toContain("design.md");
    expect(script).not.toContain("kicker: 'CHANGE MANAGEMENT'");
    expect(script).not.toContain('change-filters');
    expect(script).toContain('disabled-reason');
    expect(script).not.toContain('已归档 Change 不可再次归档');
    expect(script).toContain('openArchiveConfirmation');
    expect(script).toContain('Change 信息');
    expect(script).toContain('关联模块/需求');
    const archiveSummary = script.slice(
      script.indexOf('function renderArchivePreviewSummary'),
      script.indexOf('function renderArchivePreflightError'),
    );
    expect(archiveSummary).not.toContain('SDD 等级与状态');
    expect(archiveSummary).not.toContain('门禁结果');
    expect(archiveSummary).not.toContain('Spec 影响');
    expect(archiveSummary).not.toContain('归档目标');
    expect(archiveSummary).not.toContain('Verification Receipt');
    expect(script).toContain('我已确认归档此 Change。');
    expect(script).toContain('确认归档');
    expect(script).toContain("element('form', 'archive-preview-form')");
    expect(script).toContain('control.readOnly = true');
    expect(script).toContain("element('div', 'card-actions archive-confirmation-actions')");
    expect(script).toContain('actions.append(confirmButton, cancelButton)');
    expect(script).toContain("button('×', 'archive-confirmation-close'");
    expect(script).toContain("setAttribute('aria-label', '关闭归档弹窗')");
    expect(script).toContain('archive-impact-confirmation');
    expect(script).toContain('impactConfirmation.checked');
    expect(script).toContain("openArchiveConfirmation(archiveCandidateFor(change))");
    const tableDeclaration = script.indexOf("const table = element('table', 'change-table');");
    const emptyTableRow = script.indexOf("element('tr', 'change-table-empty-row')");
    expect(tableDeclaration).toBeGreaterThanOrEqual(0);
    expect(emptyTableRow).toBeGreaterThan(tableDeclaration);
    expect(script).toContain('emptyCell.colSpan = 7');
    expect(script).not.toContain("label: '归档历史'");
    expect(script).not.toContain('active-change-card');
    expect(script).not.toContain('CHANGE_TABS');
    expect(script).toContain("setAttribute('data-node', 'change-management')");
    expect(script).toContain('businessModules');
    expect(script).toContain("type: 'module'");
    expect(script).toContain("type: 'changes'");
    expect(script).toContain("type: 'change'");
    expect(script).not.toContain("type: 'search'");
    expect(script).not.toContain('let currentView');
    expect(script).not.toContain('function navigate(view, changeTab)');
    expect(script).not.toContain("type: 'view'");
    expect(script).not.toContain("type: 'document'");
    expect(script).toContain("type: 'overview'");
    expect(script).not.toContain("element('h2', '', '当前 Spec')");
    expect(script).not.toContain("element('h2', '', '关联 Change')");
    expect(script).not.toContain("element('h2', '', '最近归档')");
    expect(script).not.toContain("element('h2', '', '依赖关系')");
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
    expect(script).not.toContain('/api/edit');
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
    expect(script).not.toContain('/api/transition/');
    expect(script).not.toContain('child_process');
    expect(styles).toContain('.module-workspace');
    expect(styles).toContain('.business-table');
    expect(styles).toContain('.business-canvas-viewport');
    expect(styles).toContain('.business-canvas-node');
    expect(styles).toContain('flex-direction: column; gap: 4px;');
    expect(styles).toContain('.change-table');
    expect(styles).toContain('.change-table-wrap');
    expect(styles).toContain('position: sticky;');
    expect(styles).toContain('text-align: center;');
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

  it('keeps rejected archive preflight errors inline without replacing the Change workspace', async () => {
    const script = await fs.readFile(path.join(webRoot, 'app.js'), 'utf8');
    const start = script.indexOf('async function openArchiveConfirmation');
    const end = script.indexOf('\nfunction closeSearchSuggestions', start);
    const archiveFlow = script.slice(start, end);

    expect(script).toContain('renderArchivePreflightError');
    expect(script).toContain('archive-preflight-error');
    expect(archiveFlow).toContain('catch (error)');
    expect(archiveFlow).toContain('renderArchivePreflightError');
    expect(archiveFlow).not.toContain('showError(error)');
  });

  it('keeps document tabs in one horizontally scrollable row on narrow screens', async () => {
    const styles = await fs.readFile(path.join(webRoot, 'styles.css'), 'utf8');

    const tabsRule = styles.slice(styles.indexOf('.document-tabs {'), styles.indexOf('.document-tab {'));
    expect(tabsRule).toContain('flex-wrap: nowrap;');
    expect(tabsRule).toContain('overflow-x: auto;');
    expect(tabsRule).toContain('overflow-y: hidden;');
  });

  it('exposes read-only document reader controls in the simplified Change detail', async () => {
    const script = await fs.readFile(path.join(webRoot, 'app.js'), 'utf8');

    expect(script).toContain('renderDocumentReaderControls');
    expect(script).toContain('structured-view');
    expect(script).toContain('source-view');
    expect(script).toContain('document-tab-copy');
    expect(script).toContain('复制文件路径');
    expect(script).not.toContain('在文件管理器中定位');
    expect(script).not.toContain('/api/reveal/');
    expect(script).not.toContain("element('p', 'document-path'");
    const detailStart = script.indexOf('function renderChangeDetail');
    const detailEnd = script.indexOf('\nfunction documentName', detailStart);
    const detailFlow = script.slice(detailStart, detailEnd);
    expect(detailFlow).not.toContain('CHANGE DETAIL');
    expect(detailFlow).not.toContain('本等级要求');
    expect(detailFlow).not.toContain('归档路径：');
    expect(detailFlow).not.toContain('归档时间：');
    expect(detailFlow).not.toContain('Verification Receipt：');
    expect(detailFlow).toContain('lifecycleStepper(change)');
    expect(detailFlow).toContain('levelLabel(change.sddLevel)');
    expect(script).toContain('return [...(change.documents ?? [])]');
    expect(script).not.toContain('/api/edit');
    expect(script).not.toContain('/api/exec');
  });

  it('keeps the module document workspace grounded in indexed records', async () => {
    const script = await fs.readFile(path.join(webRoot, 'app.js'), 'utf8');

    expect(script).toContain("element('h3', '', module ? `${module.id} · ${module.name}` : moduleId)");
    expect(script).toContain("emptyState('暂无模块文档。')");
    expect(script).toContain('moduleDocumentOrder');
    expect(script).toContain("document.category === '当前 Spec'");
    expect(script).toContain("button('详情'");
  });

  it('defines light and dark theme tokens with system-based initial fallback', async () => {
    const styles = await fs.readFile(path.join(webRoot, 'styles.css'), 'utf8');

    expect(styles).toContain('[data-theme="light"]');
    expect(styles).toContain('[data-theme="dark"]');
    expect(styles).toContain(':root:not([data-theme="light"])');
    expect(styles).not.toContain(':root[data-theme="system"]');
  });
});
