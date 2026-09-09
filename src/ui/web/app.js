const page = document.querySelector('#page');
const projectTree = document.querySelector('#project-tree');
const search = document.querySelector('#search');
const searchSubmit = document.querySelector('#search-submit');
const searchSuggestions = document.querySelector('#search-suggestions');
const themeToggle = document.querySelector('#theme-toggle');
const commandHelperToggle = document.querySelector('#command-helper');
const rebuild = document.querySelector('#rebuild');
const projectName = document.querySelector('#project-name');
const sidebar = document.querySelector('#sidebar');
const sidebarToggle = document.querySelector('#sidebar-toggle');
const lifecycleStatuses = ['ANALYZE', 'DESIGN', 'PLAN', 'IMPLEMENT', 'VERIFY', 'ARCHIVE', 'ARCHIVED'];
let index;
let currentScreen = { type: 'overview' };
let commandHelperOpen = false;
let currentChangeOptions = {};
let currentChangeReturnScreen;
let documentReturnScreen;

const api = async (path, init) => {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? '请求失败');
  return body;
};

function setTheme(value, { persist = true } = {}) {
  const theme = value === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  const labels = { light: '浅色', dark: '深色' };
  const icons = { light: '☀', dark: '☾' };
  themeToggle.textContent = icons[theme];
  themeToggle.setAttribute('aria-label', `当前为${labels[theme]}主题，点击切换`);
  if (persist) localStorage.setItem('codespec-theme', theme);
}

function initTheme() {
  const saved = localStorage.getItem('codespec-theme');
  const systemDefault = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  setTheme(saved === 'light' || saved === 'dark' ? saved : systemDefault, { persist: false });
  themeToggle.onclick = () => {
    const current = document.documentElement.dataset.theme;
    setTheme(current === 'dark' ? 'light' : 'dark');
  };
}

function text(value, fallback = '—') {
  return value === undefined || value === null || value === '' ? fallback : String(value);
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function button(label, className, handler) {
  const node = element('button', className, label);
  node.type = 'button';
  node.onclick = () => Promise.resolve(handler()).catch(showError);
  return node;
}

function backButton(label, handler) {
  return button(`← ${label}`, 'document-back-button', handler);
}

function screenLabel(screen) {
  if (!screen) return '业务功能';
  if (screen.type === 'overview') return '业务管理';
  if (screen.type === 'module') return moduleLabel(screen.moduleId);
  if (screen.type === 'changes') return '变更管理';
  return '上一级';
}

function currentChange() {
  if (!currentScreen.changeId || !index) return null;
  return (index.allChanges ?? []).find((change) => change.id === currentScreen.changeId) ?? null;
}

function allDocuments() {
  return [
    ...(index?.archive?.currentSpecs ?? []),
    ...(index?.allChanges ?? []).flatMap((change) => change.documents ?? []),
  ];
}

function documentById(id) {
  return allDocuments().find((doc) => doc.id === id) ?? null;
}

function copyScreen(screen) {
  if (!screen) return screen;
  return { ...screen };
}

const AI_WORKFLOW_SKILLS = [
  { label: '开发工作流', description: '在 AI 助手中创建或继续 Change。', command: 'codespec-workflow', category: 'skill' },
  { label: '恢复过期 Change', description: '在 AI 助手中处理 STALE 或基线冲突。', command: 'codespec-rebase-change', category: 'skill' },
  { label: '归档工作流', description: '在 AI 助手中准备验证证据并执行归档。', command: 'codespec-archive-change', category: 'skill' },
];

function commandDefinitions(context = {}) {
  const commands = [
    { label: '列出活动 Change', description: '查看当前项目的活动 Change。', command: 'codespec list --changes', category: 'overview' },
    { label: '列出 Spec', description: '查看当前项目的 Spec。', command: 'codespec list --specs', category: 'overview' },
    { label: '查看全部状态', description: '查看所有活动 Change 的生命周期状态。', command: 'codespec status --all', category: 'overview' },
    { label: '校验全部条目', description: '校验全部 Change 和 Spec。', command: 'codespec validate --all', category: 'overview' },
  ];
  if (context.changeId) {
    commands.push(
      { label: '查看 Change', description: '在终端查看当前 Change。', command: `codespec show ${context.changeId} --type change`, category: 'change' },
      { label: '查看当前状态', description: '查看当前 Change 的生命周期状态。', command: `codespec status --change ${context.changeId}`, category: 'change' },
      { label: '查看下一步指导', description: '获取当前阶段需要的产物和操作建议。', command: `codespec instructions --change ${context.changeId}`, category: 'change' },
      { label: '校验 Change', description: '校验当前 Change。', command: `codespec validate ${context.changeId} --type change`, category: 'change' },
    );
    if (context.archiveable) commands.push({ label: '归档 Change', description: '启动已满足门禁的 Change 归档流程。', command: `codespec archive ${context.changeId}`, category: 'change' });
  }
  return [...commands, ...AI_WORKFLOW_SKILLS];
}

function commandSections(context = {}) {
  const commands = commandDefinitions(context);
  return [
    { id: 'overview', title: '项目概览', hint: '项目内查询和校验', category: 'overview' },
    { id: 'change', title: '当前 Change', hint: context.changeId ?? '打开 Change 详情后显示', category: 'change' },
    { id: 'skills', title: 'AI 工作流技能', hint: '在 AI 助手中使用', category: 'skill' },
  ].map((section) => ({
    ...section,
    commands: commands.filter((command) => command.category === section.category),
  })).filter((section) => section.commands.length > 0);
}

function commandContext() {
  const change = currentChange();
  return {
    changeId: change?.id,
    archiveable: Boolean(change && (index.archive?.candidates ?? []).some((candidate) => candidate.id === change.id && candidate.ready)),
  };
}

async function copyCommand(command, feedback) {
  try {
    await navigator.clipboard.writeText(command);
    feedback.textContent = '已复制';
    setTimeout(() => { feedback.textContent = '复制命令'; }, 1200);
  } catch {
    feedback.textContent = '复制失败，请手动复制';
  }
}

function renderCommandHelper() {
  const existing = document.querySelector('.command-helper-drawer');
  if (existing) existing.remove();
  if (!commandHelperOpen) return;
  const drawer = element('aside', 'command-helper-drawer');
  drawer.setAttribute('aria-label', '命令助手');
  const header = element('div', 'command-helper-header');
  header.append(element('h2', '', '命令助手'));
  header.append(button('关闭', 'quiet-button', () => {
    commandHelperOpen = false;
    renderCommandHelper();
  }));
  drawer.append(header);
  drawer.append(element('p', 'muted', '仅展示和复制 CodeSpec CLI 命令及 AI 技能，不会在页面中执行。'));
  const list = element('div', 'command-helper-list');
  for (const section of commandSections(commandContext())) {
    const sectionNode = element('section', `command-helper-section${section.category === 'skill' ? ' command-helper-skill-section' : ''}`);
    const sectionTitle = element('div', 'command-helper-section-title');
    sectionTitle.append(element('h3', '', section.title), element('span', 'muted', section.hint));
    sectionNode.append(sectionTitle);
    for (const item of section.commands) {
      const card = element('article', `command-helper-command${item.category === 'skill' ? ' command-helper-skill' : ''}`);
      card.append(element('h4', '', item.label));
      card.append(element('p', 'muted', item.description));
      const row = element('div', 'command-code-row');
      row.append(element('code', '', item.command));
      const copyLabel = item.category === 'skill' ? '复制入口' : '复制命令';
      const feedback = button(copyLabel, 'secondary-button', () => copyCommand(item.command, feedback));
      row.append(feedback);
      card.append(row);
      sectionNode.append(card);
    }
    list.append(sectionNode);
  }
  list.append(element('p', 'command-helper-footer muted', 'AI 技能需要在对应 AI 编码工具中调用，不是终端命令。'));
  drawer.append(list);
  document.body.append(drawer);
}

function statusLabel(status) {
  if (status === 'ARCHIVED') return '已归档';
  if (status === 'ABANDONED') return '生命周期失败';
  return text(status, '状态未知');
}

function levelLabel(level) {
  return level === undefined ? 'SDD 未读取' : `SDD Level ${level}`;
}

function statusClass(status) {
  if (status === 'ARCHIVED') return 'status-success';
  if (status === 'ARCHIVE') return 'status-ready';
  if (status === 'ABANDONED') return 'status-danger';
  return 'status-progress';
}

function moduleDefinition(moduleId) {
  return index.businessModules.find((module) => module.id === moduleId);
}

function moduleLabel(moduleId) {
  const module = moduleDefinition(moduleId);
  if (!module) return '未归类';
  return `${module.id} · ${module.name}`;
}

function archiveCandidateFor(change) {
  return (index.archive?.candidates ?? []).find((candidate) => candidate.id === change.id);
}

function sectionHeader(kicker, title, description) {
  const header = element('div', 'section-header');
  header.append(element('p', 'kicker', kicker));
  header.append(element('h1', '', title));
  if (description) header.append(element('p', 'section-description', description));
  return header;
}

function emptyState(message) {
  return element('div', 'empty-state', message);
}

function isArchivedChange(change) {
  return change.status === 'ARCHIVED'
    || Boolean(change.archiveState?.archivedAt)
    || (change.documents ?? []).some((document) => document.category === '归档 Change'
      || document.relativePath.includes('/archive/changes/'));
}

function moduleDocuments(moduleId) {
  const marker = `/${moduleId}/`;
  return index.documents
    .filter((document) => document.category === '当前 Spec' && document.relativePath.includes(marker))
    .sort((left, right) => moduleDocumentOrder(left, right));
}

const MODULE_DOCUMENT_ORDER = ['spec.md', 'api.yaml', 'interface.yaml'];

function moduleDocumentOrder(left, right) {
  const leftName = left.relativePath.split('/').at(-1) ?? '';
  const rightName = right.relativePath.split('/').at(-1) ?? '';
  const leftPosition = MODULE_DOCUMENT_ORDER.indexOf(leftName);
  const rightPosition = MODULE_DOCUMENT_ORDER.indexOf(rightName);
  return (leftPosition < 0 ? MODULE_DOCUMENT_ORDER.length : leftPosition)
    - (rightPosition < 0 ? MODULE_DOCUMENT_ORDER.length : rightPosition)
    || left.relativePath.localeCompare(right.relativePath);
}

async function copyDocumentPath(document, control) {
  try {
    await navigator.clipboard.writeText(document.relativePath);
    control.textContent = '✓';
    control.title = '已复制路径';
  } catch {
    control.textContent = '!';
    control.title = '复制失败';
  }
  setTimeout(() => {
    control.textContent = '⧉';
    control.title = '复制文件路径';
  }, 1200);
}

function createDocumentTab(document, label, activate) {
  const item = element('div', 'document-tab-item');
  const tab = button(label, 'document-tab', () => activate(document, tab));
  const copy = button('⧉', 'document-tab-copy', () => copyDocumentPath(document, copy));
  copy.setAttribute('aria-label', `复制 ${label} 的文件路径`);
  copy.title = '复制文件路径';
  item.append(tab, copy);
  return { item, tab };
}

function activateDocumentTab(tabs, activeTab) {
  for (const item of tabs.children) item.classList.remove('active');
  for (const tab of tabs.querySelectorAll('.document-tab')) tab.classList.remove('active');
  activeTab.classList.add('active');
  activeTab.closest('.document-tab-item')?.classList.add('active');
}

function renderModuleDocumentPanel(moduleId) {
  const documents = moduleDocuments(moduleId);
  const module = moduleDefinition(moduleId);
  const panel = element('section', 'document-panel module-document-panel');
  const documentHeader = element('div', 'document-panel-header');
  documentHeader.append(element('h3', '', module ? `${module.id} · ${module.name}` : moduleId));
  panel.append(documentHeader);
  if (!documents.length) {
    panel.append(emptyState('暂无模块文档。'));
    return panel;
  }
  const tabs = element('nav', 'document-tabs');
  const content = element('div', 'document-content');
  const activeDocumentId = currentScreen.type === 'module' ? currentScreen.activeDocumentId : undefined;
  const activate = async (doc, activeTab) => {
    currentScreen.activeDocumentId = doc.id;
    activateDocumentTab(tabs, activeTab);
    const detail = await api(`/api/documents/${doc.id}`);
    content.replaceChildren();
    renderDocument(detail, content);
  };
  const tabButtons = [];
  documents.forEach((doc, position) => {
    const { item, tab } = createDocumentTab(doc, doc.relativePath.split('/').at(-1) ?? documentTabLabel(doc), activate);
    tab.classList.add('module-document-tab');
    if (doc.id === activeDocumentId || (!activeDocumentId && position === 0)) tab.classList.add('active');
    if (tab.classList.contains('active')) item.classList.add('active');
    tabButtons.push(tab);
    tabs.append(item);
  });
  const activeDocument = documents.find((doc) => doc.id === activeDocumentId) ?? documents[0];
  const activeTab = tabButtons[documents.indexOf(activeDocument)];
  panel.append(tabs, content);
  activate(activeDocument, activeTab).catch(showError);
  return panel;
}

function renderModuleWorkspace(moduleId) {
  const module = moduleDefinition(moduleId);
  if (!module) return emptyState('当前模块不存在，请重新扫描工程索引。');
  const view = element('div', 'module-workspace');
  const header = element('div', 'section-header detail-section-header');
  const summaryRow = element('div', 'detail-summary-row');
  summaryRow.append(backButton('返回业务管理', () => navigateTo({ type: 'overview' })));
  header.append(summaryRow);
  view.append(header, renderModuleDocumentPanel(module.id));
  return view;
}

function businessCanvasEdges(modules) {
  const moduleIds = new Set(modules.map((module) => module.id));
  const edges = new Map();
  for (const relation of index.currentSpecGraph?.relations ?? []) {
    if (!moduleIds.has(relation.fromModule) || !moduleIds.has(relation.toModule)) continue;
    edges.set(`${relation.fromModule}->${relation.toModule}`, {
      from: relation.fromModule,
      to: relation.toModule,
    });
  }
  for (const module of modules) {
    for (const relatedId of module.relatedModules ?? []) {
      if (!moduleIds.has(relatedId) || relatedId === module.id) continue;
      edges.set(`${module.id}->${relatedId}`, { from: module.id, to: relatedId });
    }
  }
  return [...edges.values()];
}

function businessCanvasLayout(modules) {
  const nodeWidth = 208;
  const nodeHeight = 78;
  const horizontalGap = 44;
  const verticalGap = 70;
  const padding = 40;
  const edges = businessCanvasEdges(modules);
  const depths = new Map(modules.map((module) => [module.id, 0]));
  if (edges.length) {
    const incoming = new Map(modules.map((module) => [module.id, 0]));
    const outgoing = new Map(modules.map((module) => [module.id, []]));
    for (const edge of edges) {
      incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
      outgoing.get(edge.from)?.push(edge.to);
    }
    const queue = modules.filter((module) => incoming.get(module.id) === 0).map((module) => module.id);
    const visited = new Set();
    while (queue.length) {
      const moduleId = queue.shift();
      if (visited.has(moduleId)) continue;
      visited.add(moduleId);
      for (const childId of outgoing.get(moduleId) ?? []) {
        depths.set(childId, Math.max(depths.get(childId) ?? 0, (depths.get(moduleId) ?? 0) + 1));
        incoming.set(childId, (incoming.get(childId) ?? 1) - 1);
        if (incoming.get(childId) === 0) queue.push(childId);
      }
    }
  }
  const groups = new Map();
  for (const module of modules) {
    const depth = edges.length ? depths.get(module.id) ?? 0 : Math.floor(modules.indexOf(module) / 4);
    groups.set(depth, [...(groups.get(depth) ?? []), module]);
  }
  const widest = Math.max(...[...groups.values()].map((group) => group.length), 1);
  const width = padding * 2 + widest * nodeWidth + Math.max(widest - 1, 0) * horizontalGap;
  const maxDepth = Math.max(...groups.keys(), 0);
  const height = padding * 2 + (maxDepth + 1) * nodeHeight + maxDepth * verticalGap;
  const nodes = [];
  for (const [depth, group] of [...groups.entries()].sort(([left], [right]) => left - right)) {
    const rowWidth = group.length * nodeWidth + Math.max(group.length - 1, 0) * horizontalGap;
    const offsetX = (width - rowWidth) / 2;
    group.forEach((module, position) => nodes.push({
      module,
      x: offsetX + position * (nodeWidth + horizontalGap),
      y: padding + depth * (nodeHeight + verticalGap),
    }));
  }
  return { nodes, edges, width, height, nodeWidth, nodeHeight };
}

function renderBusinessTable(modules) {
  const wrap = element('div', 'business-table-wrap');
  const table = element('table', 'business-table');
  const head = element('thead');
  const heading = element('tr');
  for (const label of ['序号', '业务模块ID', '业务模块', '关联模块', '最后修改时间', '操作']) heading.append(element('th', '', label));
  head.append(heading);
  const body = element('tbody');
  if (!modules.length) {
    const row = element('tr');
    const cell = element('td', 'business-table-empty', '暂无业务模块。');
    cell.colSpan = 6;
    row.append(cell);
    body.append(row);
  } else {
    modules.forEach((module, position) => {
      const row = element('tr');
      const moduleCell = element('td', 'business-table-module');
      moduleCell.append(element('strong', '', module.name));
      const relatedCell = element('td', 'business-table-related');
      const relatedIds = new Set(module.relatedModules ?? []);
      for (const relation of index.currentSpecGraph?.relations ?? []) {
        if (relation.fromModule === module.id) relatedIds.add(relation.toModule);
        if (relation.toModule === module.id) relatedIds.add(relation.fromModule);
      }
      for (const relatedId of relatedIds) relatedCell.append(element('span', 'module-tag', moduleLabel(relatedId)));
      if (!relatedIds.size) relatedCell.append(element('span', 'muted', '未关联'));
      row.append(
        element('td', 'business-table-sequence', String(position + 1)),
        element('td', 'business-table-id', module.id),
        moduleCell,
        relatedCell,
        element('td', 'business-table-modified-at', formatDateTime(moduleLastModifiedAt(module.id))),
      );
      const actions = element('td', 'business-table-actions');
      actions.append(button('详情', 'table-action view-action', () => navigateTo({ type: 'module', moduleId: module.id })));
      row.append(actions);
      body.append(row);
    });
  }
  table.append(head, body);
  wrap.append(table);
  return wrap;
}

function renderBusinessCanvas(modules) {
  const layout = businessCanvasLayout(modules);
  const workbench = element('section', 'business-canvas-workbench');
  const toolbar = element('div', 'business-canvas-toolbar');
  toolbar.append(element('span', 'canvas-toolbar-hint', '拖动平移 · Ctrl/⌘ + 滚轮缩放 · F 适应'));
  const viewport = element('div', 'business-canvas-viewport');
  viewport.tabIndex = 0;
  viewport.setAttribute('aria-label', '业务模块总览画布');
  const shell = element('div', 'business-canvas-stage-shell');
  const stage = element('div', 'business-canvas-stage');
  const edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  edgeLayer.classList.add('business-canvas-edges');
  edgeLayer.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
  const nodeById = new Map(layout.nodes.map((node) => [node.module.id, node]));
  for (const edge of layout.edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;
    const startX = from.x + layout.nodeWidth / 2;
    const startY = from.y + layout.nodeHeight;
    const endX = to.x + layout.nodeWidth / 2;
    const endY = to.y;
    const middleY = startY + (endY - startY) / 2;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${startX} ${startY} C ${startX} ${middleY}, ${endX} ${middleY}, ${endX} ${endY}`);
    edgeLayer.append(path);
  }
  stage.append(edgeLayer);
  for (const node of layout.nodes) {
    const nodeButton = button('', 'business-canvas-node', () => navigateTo({ type: 'module', moduleId: node.module.id }));
    nodeButton.style.left = `${node.x}px`;
    nodeButton.style.top = `${node.y}px`;
    nodeButton.style.width = `${layout.nodeWidth}px`;
    nodeButton.style.height = `${layout.nodeHeight}px`;
    nodeButton.append(
      element('span', '', node.module.status === 'RETIRED' ? '已退役' : '业务模块'),
      element('strong', '', node.module.name),
      element('small', '', node.module.id),
    );
    stage.append(nodeButton);
  }
  if (!modules.length) viewport.append(element('div', 'business-canvas-empty', '当前还没有可展示的业务模块'));
  else {
    shell.append(stage);
    viewport.append(shell);
  }
  let scale = 1;
  const scaleOutput = element('output', '', '100%');
  const applyScale = () => {
    scaleOutput.textContent = `${Math.round(scale * 100)}%`;
    shell.style.width = `${layout.width * scale}px`;
    shell.style.height = `${layout.height * scale}px`;
    stage.style.width = `${layout.width}px`;
    stage.style.height = `${layout.height}px`;
    stage.style.transform = `scale(${scale})`;
  };
  const changeScale = (delta) => {
    scale = Math.min(1.5, Math.max(0.5, Number((scale + delta).toFixed(2))));
    applyScale();
  };
  const fitCanvas = () => {
    if (!modules.length) return;
    scale = Math.min(1, Math.max(0.5, Number(Math.min(
      (viewport.clientWidth - 24) / layout.width,
      (viewport.clientHeight - 24) / layout.height,
    ).toFixed(2))));
    applyScale();
    viewport.scrollTo({ top: 0, left: 0 });
  };
  toolbar.append(
    button('缩小', 'quiet-button business-canvas-control', () => changeScale(-0.1)),
    scaleOutput,
    button('放大', 'quiet-button business-canvas-control', () => changeScale(0.1)),
    button('适应', 'quiet-button business-canvas-control', fitCanvas),
    button('复位', 'quiet-button business-canvas-control', () => {
      scale = 1;
      applyScale();
      viewport.scrollTo({ top: 0, left: 0 });
    }),
  );
  let pan;
  viewport.onpointerdown = (event) => {
    if (event.target.closest('.business-canvas-node')) return;
    pan = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.classList.add('is-panning');
    viewport.setPointerCapture(event.pointerId);
  };
  viewport.onpointermove = (event) => {
    if (!pan) return;
    viewport.scrollLeft = pan.left - (event.clientX - pan.x);
    viewport.scrollTop = pan.top - (event.clientY - pan.y);
  };
  const endPan = () => {
    pan = undefined;
    viewport.classList.remove('is-panning');
  };
  viewport.onpointerup = endPan;
  viewport.onpointercancel = endPan;
  viewport.onwheel = (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    changeScale(event.deltaY > 0 ? -0.1 : 0.1);
  };
  viewport.onkeydown = (event) => {
    if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      fitCanvas();
    }
  };
  workbench.append(toolbar, viewport);
  applyScale();
  requestAnimationFrame(fitCanvas);
  return workbench;
}

function renderBusinessOverview() {
  const view = element('div', 'business-overview');
  const modules = index.businessModules ?? [];
  const activeView = currentScreen.businessView === 'canvas' ? 'canvas' : 'table';
  const toolbar = element('div', 'business-management-toolbar');
  const switcher = element('div', 'business-view-switch');
  switcher.setAttribute('aria-label', '业务管理视图');
  for (const option of [{ value: 'table', label: '表格' }, { value: 'canvas', label: '画布' }]) {
    const viewButton = button(option.label, `business-view-option${activeView === option.value ? ' active' : ''}`, () => {
      currentScreen = { ...currentScreen, businessView: option.value };
      renderCurrentScreen();
    });
    viewButton.setAttribute('aria-pressed', String(activeView === option.value));
    switcher.append(viewButton);
  }
  toolbar.append(switcher);
  view.append(toolbar, activeView === 'canvas' ? renderBusinessCanvas(modules) : renderBusinessTable(modules));
  return view;
}

function formatDateTime(value) {
  if (!value || Number.isNaN(Date.parse(value))) return '—';
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function moduleLastModifiedAt(moduleId) {
  return moduleDocuments(moduleId).reduce((latest, document) =>
    document.modifiedAt > latest ? document.modifiedAt : latest, '');
}

function changeCreatedAt(change) {
  const metadata = (change.documents ?? []).find((document) =>
    document.relativePath.split('/').at(-1) === 'metadata.yaml');
  return metadata?.structuredContent?.change?.created_at
    ?? metadata?.structuredContent?.created_at
    ?? '';
}

function associationTags(change) {
  const tags = element('div', 'association-tags');
  for (const moduleId of change.modules ?? []) tags.append(element('span', 'module-tag', moduleLabel(moduleId)));
  for (const requirementId of change.requirements ?? []) tags.append(element('span', 'requirement-tag', requirementId));
  if (!tags.children.length) tags.append(element('span', 'muted', '未关联'));
  return tags;
}

function archiveReasonFor(change) {
  const candidate = archiveCandidateFor(change);
  if (candidate?.ready) return null;
  if (candidate?.gateReasons?.[0]) return candidate.gateReasons[0];
  return '归档候选未读取';
}

function renderChangeRow(change, position) {
  const row = element('tr', 'change-table-row');
  row.append(element('td', 'change-table-sequence', String(position + 1)));
  row.append(element('td', 'change-table-id', text(change.id)));
  row.append(element('td', 'change-table-title', text(change.title, '未命名 Change')));
  const associations = element('td', 'change-table-associations');
  associations.append(associationTags(change));
  row.append(associations);
  row.append(element('td', 'change-table-created-at', formatDateTime(changeCreatedAt(change))));
  const status = element('td', 'change-table-status');
  status.append(element('span', `status-pill ${statusClass(change.status)}`, statusLabel(change.status)));
  const archived = isArchivedChange(change);
  const reason = archived ? null : archiveReasonFor(change);
  if (!archived) status.append(element('span', reason ? 'disabled-reason' : 'gate-success', reason ?? '可归档'));
  row.append(status);
  const actions = element('td', 'change-table-actions');
  const firstDocument = firstChangeDocument(change);
  actions.append(button('查看', 'table-action view-action', () => navigateTo({
    type: 'change',
    changeId: change.id,
    ...(firstDocument ? { activeDocumentId: firstDocument.id } : {}),
  }, { changeOptions: { archived: isArchivedChange(change) } })));
  const archiveButton = button('归档', 'table-action archive-action', () => openArchiveConfirmation(archiveCandidateFor(change)));
  archiveButton.setAttribute('aria-label', `归档 ${text(change.title, change.id)}`);
  if (archived || reason) {
    archiveButton.disabled = true;
    if (reason) archiveButton.title = reason;
  }
  actions.append(archiveButton);
  row.append(actions);
  return row;
}

function renderAllChangesWorkspace() {
  const view = element('div', 'changes-workspace-view');
  const tableWrap = element('div', 'change-table-wrap');
  const table = element('table', 'change-table');
  const head = element('thead');
  const heading = element('tr');
  for (const label of ['序号', '变更ID', '变更标题', '关联模块/需求', '创建时间', '状态', '操作']) heading.append(element('th', '', label));
  head.append(heading);
  const body = element('tbody');
  const changes = index.allChanges ?? [];
  if (!changes.length) {
    const emptyRow = element('tr', 'change-table-empty-row');
    const emptyCell = element('td', 'change-table-empty-cell', '暂无 Change');
    emptyCell.colSpan = 7;
    emptyRow.append(emptyCell);
    body.append(emptyRow);
  } else {
    body.append(...changes.map(renderChangeRow));
  }
  table.append(head, body);
  tableWrap.append(table);
  view.append(tableWrap);
  return view;
}

function lifecycleStepper(change) {
  const stepper = element('ol', 'lifecycle-stepper');
  const currentIndex = lifecycleStatuses.indexOf(change.status);
  lifecycleStatuses.forEach((status, position) => {
    const item = element('li', position < currentIndex ? 'complete' : position === currentIndex ? 'current' : 'future', status);
    stepper.append(item);
  });
  if (change.status === 'ABANDONED') stepper.append(element('li', 'abandoned current', 'ABANDONED'));
  return stepper;
}

function documentTabLabel(doc) {
  const name = doc.relativePath.split('/').at(-1) ?? doc.title;
  return name.replace(/\.md$/u, '');
}

function orderedChangeDocuments(change) {
  return [...(change.documents ?? [])];
}

function firstChangeDocument(change) {
  return orderedChangeDocuments(change)[0] ?? null;
}

function renderChangeDetail(change, options = currentChangeOptions, returnScreen = currentChangeReturnScreen) {
  documentReturnScreen = undefined;
  const fallbackReturnScreen = currentScreen.type === 'module'
    || currentScreen.type === 'changes'
    || currentScreen.type === 'search'
    ? copyScreen(currentScreen)
    : { type: 'overview' };
  const detailReturnScreen = returnScreen ?? fallbackReturnScreen;
  const activeDocumentId = currentScreen.type === 'change' && currentScreen.changeId === change.id
    ? currentScreen.activeDocumentId
    : null;
  const view = document.createElement('div');
  view.classList.add('detail-view');
  const archived = options.archived === true || change.status === 'ARCHIVED';
  if (archived) view.classList.add('archived-detail-view');
  const header = element('div', 'section-header detail-section-header');
  const summaryRow = element('div', 'detail-summary-row');
  summaryRow.append(
    backButton(`返回${screenLabel(detailReturnScreen)}`, goBackFromScreen),
    element('span', 'sdd-level-badge', levelLabel(change.sddLevel)),
  );
  header.append(summaryRow);
  view.append(header);
  const documents = orderedChangeDocuments(change);
  const docs = element('section', 'document-panel');
  const documentHeader = element('div', 'document-panel-header');
  documentHeader.append(
    element('h3', '', `${change.id} · ${text(change.title, '未命名 Change')}`),
    lifecycleStepper(change),
  );
  docs.append(documentHeader);
  const tabs = element('nav', 'document-tabs');
  const content = element('div', 'document-content');
  const activate = async (doc, activeButton) => {
    currentScreen.activeDocumentId = doc.id;
    activateDocumentTab(tabs, activeButton);
    const detail = await api(`/api/documents/${doc.id}`);
    content.replaceChildren();
    renderDocument(detail, content);
  };
  if (!documents.length) docs.append(emptyState('暂无 Change 文档'));
  else {
    const tabButtons = [];
    documents.forEach((doc, position) => {
      const { item, tab } = createDocumentTab(doc, documentTabLabel(doc), activate);
      if (doc.id === activeDocumentId || (!activeDocumentId && position === 0)) tab.classList.add('active');
      if (tab.classList.contains('active')) item.classList.add('active');
      tabButtons.push(tab);
      tabs.append(item);
    });
    docs.append(tabs, content);
    const activeDocument = documents.find((doc) => doc.id === activeDocumentId) ?? documents[0];
    const activeTab = tabButtons[documents.indexOf(activeDocument)];
    activate(activeDocument, activeTab).catch(showError);
  }
  view.append(docs);
  page.replaceChildren(view);
}

function documentName(detail) {
  return detail.relativePath.split('/').at(-1) ?? '';
}

function documentValueText(value) {
  if (value === undefined || value === null || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.map(documentValueText).join('、') : '无';
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}: ${documentValueText(item)}`).join('；');
  return String(value);
}

function documentKeyLabel(key) {
  const labels = {
    id: 'ID', title: '标题', status: '状态', mode: '模式', sdd_level: 'SDD 等级',
    created_at: '创建时间', updated_at: '更新时间', change_id: 'Change ID',
    requirements_verified: '需求已验证', tests_passed: '测试通过', build_passed: '构建通过',
    lint_passed: 'Lint 通过', verified_at: '验证时间', evidence_receipt: '验证凭据',
    testCase: 'Test Case', testFile: '测试文件', testId: '测试标识',
    plannedFiles: '计划修改文件', verificationPlan: '验证计划',
  };
  return labels[key] ?? key.replaceAll('_', ' ');
}

function documentValue(value) {
  if (Array.isArray(value)) {
    const list = element('ul', 'document-checklist');
    if (!value.length) list.append(element('li', 'muted', '无'));
    else value.forEach((item) => {
      const row = element('li');
      if (item && typeof item === 'object' && !Array.isArray(item)) row.append(documentObjectList(item));
      else row.textContent = documentValueText(item);
      list.append(row);
    });
    return list;
  }
  if (value && typeof value === 'object') return documentObjectList(value);
  const node = element('span', '', documentValueText(value));
  if (typeof value === 'boolean') node.classList.add('document-badge', value ? 'document-badge-success' : 'document-badge-warn');
  return node;
}

function documentObjectList(record) {
  const list = element('dl', 'document-key-value-list');
  for (const [key, value] of Object.entries(record)) {
    list.append(element('dt', '', documentKeyLabel(key)), element('dd', '', ''));
    list.lastChild.append(documentValue(value));
  }
  return list;
}

function documentSection(title, content) {
  const section = element('section', 'document-section');
  section.append(element('h3', '', title), content);
  return section;
}

function documentRecordSection(title, record) {
  const entries = record && typeof record === 'object' && !Array.isArray(record) ? Object.entries(record) : [];
  const table = element('table', 'document-data-table');
  const body = element('tbody');
  for (const [key, value] of entries) {
    const row = element('tr');
    row.append(element('th', '', documentKeyLabel(key)), element('td', '', ''));
    row.lastChild.append(documentValue(value));
    body.append(row);
  }
  table.append(body);
  return documentSection(title, entries.length ? table : emptyState('暂无数据'));
}

function documentCollectionSection(title, items, columns) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return documentSection(title, emptyState('暂无数据'));
  const wrapper = element('div', 'document-table-scroll');
  const table = element('table', 'document-data-table');
  const head = element('thead');
  const heading = element('tr');
  for (const [, label] of columns) heading.append(element('th', '', label));
  head.append(heading);
  const body = element('tbody');
  for (const item of rows) {
    const row = element('tr');
    for (const [key] of columns) {
      const cell = element('td', '', '');
      cell.append(documentValue(item && typeof item === 'object' ? item[key] : undefined));
      row.append(cell);
    }
    body.append(row);
  }
  table.append(head, body);
  wrapper.append(table);
  return documentSection(title, wrapper);
}

function renderMetadataDocument(data, target) {
  target.classList.add('structured-document', 'metadata-document');
  target.append(
    documentRecordSection('Change 信息', data?.change),
    documentRecordSection('影响范围', data?.impact),
    documentRecordSection('基线与关系', { baseline: data?.baseline, relations: data?.relations }),
    documentRecordSection('模块与需求', { modules: data?.modules, requirements: data?.requirements }),
    documentRecordSection('产物', data?.artifacts),
    documentRecordSection('任务与验证', { tasks: data?.tasks, verification: data?.verification }),
    documentRecordSection('门禁与归档', { gates: data?.gates, archive: data?.archive }),
  );
}

function renderTasksDocument(data, target) {
  target.classList.add('structured-document', 'tasks-document');
  target.append(
    documentCollectionSection('任务清单', data?.tasks, [
      ['id', '任务 ID'],
      ['title', '任务'],
      ['status', '状态'],
      ['module', '模块'],
      ['requirements', 'Requirements'],
      ['scenarios', 'Scenarios'],
      ['testCases', 'Test Cases'],
      ['plannedFiles', '计划修改文件'],
      ['verificationPlan', '验证计划'],
    ]),
    documentCollectionSection('模块变更', data?.moduleDeltas, [
      ['module', '模块'],
      ['interfaces', '接口变更'],
      ['configurationChanges', '配置变更'],
    ]),
    documentRecordSection('模块注册', data?.moduleRegistrations),
  );
}

function renderVerificationDocument(data, target) {
  target.classList.add('structured-document', 'verification-document');
  target.append(
    documentRecordSection('验证摘要', { version: data?.version, testCases: Array.isArray(data?.testCases) ? data.testCases.length : 0 }),
    documentCollectionSection('测试用例', data?.testCases, [
      ['testCase', 'Test Case'],
      ['id', 'ID'],
      ['result', '结果'],
      ['testFile', '测试文件'],
      ['testId', '测试标识'],
      ['command', '命令'],
      ['profile', 'Profile'],
      ['services', '服务'],
      ['browser', '浏览器'],
      ['exitCode', 'Exit Code'],
      ['summary', '摘要'],
      ['executedAt', '执行时间'],
      ['cleanupSucceeded', '清理'],
    ]),
  );
}

function renderChangeMarkdownDocument(detail, target) {
  const name = documentName(detail);
  target.classList.add('structured-document', 'markdown-document', name === 'design.md' ? 'design-document' : 'spec-document');
  const rendered = element('div', 'document-markdown-body');
  rendered.insertAdjacentHTML('beforeend', markdownit({ html: false }).render(detail.content));
  target.append(rendered);
}

function supportsStructuredDocument(detail) {
  return detail.contentType === 'markdown'
    || (detail.contentType === 'yaml' && detail.structuredContent !== undefined);
}

function renderDocumentReaderControls(detail, getMode, setMode) {
  const toolbar = element('div', 'document-reader-toolbar');
  const modeControls = element('div', 'document-view-modes');
  const structuredButton = button('结构化', 'document-view-toggle structured-view', () => setMode('structured'));
  const sourceButton = button('源文件', 'document-view-toggle source-view', () => setMode('source'));
  structuredButton.disabled = !supportsStructuredDocument(detail);
  const updateMode = () => {
    const mode = getMode();
    structuredButton.classList.toggle('active', mode === 'structured');
    sourceButton.classList.toggle('active', mode === 'source');
    structuredButton.setAttribute('aria-pressed', String(mode === 'structured'));
    sourceButton.setAttribute('aria-pressed', String(mode === 'source'));
  };
  structuredButton.setAttribute('aria-label', '切换到结构化视图');
  sourceButton.setAttribute('aria-label', '切换到源文件视图');
  modeControls.append(structuredButton, sourceButton);
  toolbar.append(modeControls);
  updateMode();
  return { toolbar, updateMode };
}

function renderDocument(detail, target) {
  let mode = supportsStructuredDocument(detail) ? 'structured' : 'source';
  const body = element('div', 'document-reader-body');
  const controls = renderDocumentReaderControls(detail, () => mode, (nextMode) => {
    mode = nextMode;
    renderBody();
    controls.updateMode();
  });
  const renderBody = () => {
    body.replaceChildren();
    if (mode === 'structured' && supportsStructuredDocument(detail)) renderStructuredDocument(detail, body);
    else body.append(element('pre', '', detail.content));
  };
  const renderStructuredDocument = (documentDetail, structuredTarget) => {
    const name = documentName(documentDetail);
    if (documentDetail.contentType === 'yaml' && documentDetail.structuredContent !== undefined) {
      if (name === 'metadata.yaml') renderMetadataDocument(documentDetail.structuredContent, structuredTarget);
      else if (name === 'tasks.yaml') renderTasksDocument(documentDetail.structuredContent, structuredTarget);
      else if (name === 'verification.yaml') renderVerificationDocument(documentDetail.structuredContent, structuredTarget);
      else structuredTarget.append(documentRecordSection('文档内容', documentDetail.structuredContent));
      return;
    }
    if (documentDetail.contentType === 'markdown') {
      if (name === 'design.md' || name === 'spec.md') renderChangeMarkdownDocument(documentDetail, structuredTarget);
      else structuredTarget.insertAdjacentHTML('beforeend', markdownit({ html: false }).render(documentDetail.content));
      return;
    }
    structuredTarget.append(element('pre', '', documentDetail.content));
  };
  target.append(controls.toolbar, body);
  renderBody();
}

async function openDocument(doc, returnScreen = currentScreen) {
  const activeScreen = returnScreen.type === 'module' || returnScreen.type === 'change'
    ? { ...returnScreen, activeDocumentId: doc.id }
    : copyScreen(returnScreen);
  documentReturnScreen = activeScreen;
  if (returnScreen.type === 'module' || returnScreen.type === 'change') {
    currentScreen = activeScreen;
  }
  const detail = await api(`/api/documents/${doc.id}`);
  const view = document.createElement('div');
  view.classList.add('document-view');
  const header = sectionHeader('DOCUMENT', doc.title, '只读文档内容');
  header.prepend(backButton(`返回${screenLabel(returnScreen)}`, goBackFromScreen));
  view.append(header);
  const content = element('div', 'document-content standalone-document');
  renderDocument(detail, content);
  view.append(content);
  page.replaceChildren(view);
}

function goBackFromScreen() {
  const target = documentReturnScreen
    ?? (currentScreen.type === 'change' ? currentChangeReturnScreen : undefined)
    ?? { type: 'overview' };
  documentReturnScreen = undefined;
  navigateTo(target);
}

function renderArchivePreviewSummary(preview) {
  const summary = element('form', 'archive-preview-form');
  summary.onsubmit = (event) => event.preventDefault();
  const section = (title, entries) => {
    const panel = element('fieldset', 'archive-preview-section');
    panel.append(element('legend', '', title));
    const details = element('div', 'archive-preview-fields');
    for (const [label, value] of entries) {
      const resolvedValue = text(value, '未读取');
      const field = element('label', `archive-preview-field${resolvedValue.length > 38 ? ' archive-preview-field-wide' : ''}`);
      const control = document.createElement('input');
      control.type = 'text';
      control.readOnly = true;
      control.value = resolvedValue;
      field.append(element('span', 'archive-preview-label', label), control);
      details.append(field);
    }
    panel.append(details);
    return panel;
  };
  summary.append(
    section('Change 信息', [['Change ID', preview.changeId], ['标题', preview.title]]),
    section('关联模块/需求', [
      ['模块', (preview.modules ?? []).join('、') || '无'],
      ['Requirement', (preview.requirements ?? []).join('、') || '无'],
    ]),
  );
  return summary;
}

function renderArchivePreflightError(error, dialog) {
  const existingDialogError = dialog.querySelector('.archive-preflight-error');
  if (existingDialogError) existingDialogError.remove();
  dialog.querySelector('.archive-loading')?.remove();
  const message = `归档预检失败：${error.message}`;
  const dialogError = element('div', 'inline-error archive-preflight-error', message);
  dialogError.setAttribute('role', 'alert');
  dialog.append(dialogError);
  const workspace = page.querySelector('.changes-workspace-view');
  if (workspace) {
    workspace.querySelector('.archive-preflight-error')?.remove();
    const workspaceError = element('div', 'inline-error archive-preflight-error', message);
    workspaceError.setAttribute('role', 'alert');
    workspace.prepend(workspaceError);
  }
}

async function openArchiveConfirmation(candidate) {
  const returnScreen = currentScreen.type === 'changes' ? copyScreen(currentScreen) : { type: 'changes' };
  const backdrop = element('div', 'archive-confirmation-backdrop');
  const dialog = element('section', 'archive-confirmation-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'archive-confirmation-title');
  const header = element('div', 'archive-confirmation-header');
  const title = element('h2', '', '读取归档信息');
  title.id = 'archive-confirmation-title';
  const closeButton = button('×', 'archive-confirmation-close', () => backdrop.remove());
  closeButton.setAttribute('aria-label', '关闭归档弹窗');
  closeButton.title = '关闭';
  header.append(title, closeButton);
  dialog.append(header, element('p', 'archive-loading muted', '正在重新检查归档门禁，请稍候。'));
  backdrop.append(dialog);
  document.body.append(backdrop);
  try {
    const preview = await api(`/api/archive/${encodeURIComponent(candidate?.id ?? '')}`);
    title.textContent = '确认归档 Change';
    dialog.querySelector('.archive-loading')?.remove();
    dialog.append(renderArchivePreviewSummary(preview));
    const impactConfirmation = document.createElement('input');
    impactConfirmation.type = 'checkbox';
    impactConfirmation.id = 'archive-impact-confirmation';
    const impactLabel = element('label', 'archive-impact-confirmation');
    impactLabel.append(impactConfirmation, element('span', '', '我已确认归档此 Change。'));
    dialog.append(impactLabel);
    const actions = element('div', 'card-actions archive-confirmation-actions');
    const confirmButton = button('确认归档', 'primary-button', async () => {
      try {
        const result = await api(`/api/archive/${encodeURIComponent(preview.changeId)}`, { method: 'POST' });
        index = result.index;
        backdrop.remove();
        navigateTo(returnScreen);
      } catch (error) {
        const existing = dialog.querySelector('.inline-error');
        if (existing) existing.remove();
        dialog.append(element('div', 'inline-error', `归档失败：${error.message}`));
      }
    });
    const cancelButton = button('取消', 'quiet-button', () => backdrop.remove());
    confirmButton.disabled = true;
    impactConfirmation.onchange = () => { confirmButton.disabled = !impactConfirmation.checked; };
    actions.append(confirmButton, cancelButton);
    dialog.append(actions);
    confirmButton.focus();
  } catch (error) {
    renderArchivePreflightError(error, dialog);
    const actions = element('div', 'card-actions archive-confirmation-actions');
    actions.append(button('取消', 'quiet-button', () => backdrop.remove()));
    dialog.append(actions);
  }
}

function closeSearchSuggestions() {
  searchSuggestions.replaceChildren();
  searchSuggestions.hidden = true;
  search.setAttribute('aria-expanded', 'false');
}

function renderSearchSuggestions(documents, query) {
  searchSuggestions.replaceChildren();
  searchSuggestions.hidden = false;
  search.setAttribute('aria-expanded', 'true');
  if (!documents.length) {
    searchSuggestions.append(element('p', 'search-suggestion-empty', '没有匹配的文件'));
    return;
  }
  for (const doc of documents) {
    const option = button('', 'search-suggestion', async () => {
      closeSearchSuggestions();
      await openDocument(doc, copyScreen(currentScreen));
    });
    option.setAttribute('role', 'option');
    option.append(
      element('strong', '', text(doc.title, doc.relativePath.split('/').at(-1))),
      element('small', '', doc.relativePath),
    );
    searchSuggestions.append(option);
  }
  searchSuggestions.dataset.query = query;
}

function renderSidebar() {
  projectTree.replaceChildren();
  const activeScreen = currentScreen;
  const businessNode = element('button', 'tree-node', '业务管理');
  businessNode.type = 'button';
  businessNode.setAttribute('data-node', 'business-overview');
  const businessActive = activeScreen.type === 'overview' || activeScreen.type === 'module';
  businessNode.classList.toggle('active', businessActive);
  businessNode.setAttribute('aria-current', businessActive ? 'page' : 'false');

  const changeNode = element('button', 'tree-node', '变更管理');
  changeNode.type = 'button';
  changeNode.setAttribute('data-node', 'change-management');
  const changesActive = activeScreen.type === 'changes' || activeScreen.type === 'change';
  changeNode.classList.toggle('active', changesActive);
  changeNode.setAttribute('aria-current', changesActive ? 'page' : 'false');
  projectTree.append(businessNode, changeNode);
}

function renderCurrentScreen() {
  renderSidebar();
  if (currentScreen.type === 'overview') {
    page.replaceChildren(renderBusinessOverview());
    return;
  }
  if (currentScreen.type === 'module') {
    page.replaceChildren(currentScreen.moduleId
      ? renderModuleWorkspace(currentScreen.moduleId)
      : emptyState('暂无业务模块。请通过 AI 工作流建立 codespec/business.yaml。'));
    return;
  }
  if (currentScreen.type === 'changes') {
    page.replaceChildren(renderAllChangesWorkspace());
    return;
  }
  if (currentScreen.type === 'change') {
    const change = currentChange();
    if (change) renderChangeDetail(change);
    else showError(new Error('当前 Change 已不存在，请返回列表。'));
    return;
  }
}

function navigateTo(screen, { changeOptions } = {}) {
  documentReturnScreen = undefined;
  const nextScreen = copyScreen(screen);
  if (nextScreen.type === 'change'
    && currentScreen.type === 'change'
    && currentScreen.changeId === nextScreen.changeId
    && nextScreen.activeDocumentId === undefined) {
    nextScreen.activeDocumentId = currentScreen.activeDocumentId;
  }
  if (nextScreen.type === 'change') {
    const sameChange = currentScreen.type === 'change' && currentScreen.changeId === nextScreen.changeId;
    currentChangeOptions = changeOptions ?? (sameChange ? currentChangeOptions : {});
    currentChangeReturnScreen = currentChangeReturnScreen ?? (currentScreen.type === 'change'
      ? undefined
      : copyScreen(currentScreen));
  } else {
    currentChangeOptions = {};
    currentChangeReturnScreen = undefined;
  }
  currentScreen = nextScreen;
  renderCurrentScreen();
}

function showError(error) {
  page.replaceChildren(element('div', 'error-state', `无法加载内容：${error.message}`));
}

function showInlineError(error) {
  const existing = page.querySelector('.inline-error');
  if (existing) existing.remove();
  page.prepend(element('div', 'inline-error', `无法刷新内容：${error.message}`));
}

async function refreshCurrentScreen() {
  index = await api('/api/rebuild', { method: 'POST' });
  renderCurrentScreen();
  if (commandHelperOpen) renderCommandHelper();
}

async function load() {
  try {
    index = await api('/api/index');
    projectName.textContent = index.projectName ?? '当前工程';
    renderCurrentScreen();
  } catch (error) {
    showError(error);
  }
}

projectTree.onclick = (event) => {
  const target = event.target.closest('[data-node]');
  if (!target || !projectTree.contains(target)) return;
  if (target.dataset.node === 'business-module') {
    navigateTo({ type: 'module', moduleId: target.dataset.moduleId });
  }
  if (target.dataset.node === 'business-overview') {
    navigateTo({ type: 'overview' });
  }
  if (target.dataset.node === 'change-management') {
    navigateTo({ type: 'changes' });
  }
};

sidebarToggle.onclick = () => {
  const open = sidebar.classList.toggle('is-open');
  sidebarToggle.setAttribute('aria-expanded', String(open));
  sidebarToggle.setAttribute('aria-label', open ? '关闭工程树' : '打开工程树');
};

let searchTimer;
async function searchFiles(query) {
  try {
    const result = await api(`/api/search?q=${encodeURIComponent(query)}`);
    if (search.value.trim() === query) renderSearchSuggestions(result.documents, query);
  } catch (error) {
    searchSuggestions.hidden = false;
    searchSuggestions.replaceChildren(element('p', 'search-suggestion-empty', `搜索失败：${error.message}`));
    search.setAttribute('aria-expanded', 'true');
  }
}

search.oninput = () => {
  clearTimeout(searchTimer);
  const query = search.value.trim();
  if (!query) {
    closeSearchSuggestions();
    return;
  }
  searchTimer = setTimeout(() => searchFiles(query), 200);
};

search.onkeydown = (event) => {
  if (event.key === 'Escape') closeSearchSuggestions();
  if (event.key === 'Enter') {
    event.preventDefault();
    clearTimeout(searchTimer);
    const query = search.value.trim();
    if (query) searchFiles(query);
  }
};

searchSubmit.onclick = () => {
  clearTimeout(searchTimer);
  const query = search.value.trim();
  if (query) searchFiles(query);
  else {
    closeSearchSuggestions();
    search.focus();
  }
};

document.addEventListener('click', (event) => {
  if (!event.target.closest('.sidebar-search')) closeSearchSuggestions();
});

commandHelperToggle.onclick = () => {
  commandHelperOpen = !commandHelperOpen;
  renderCommandHelper();
};

rebuild.onclick = async () => {
  rebuild.disabled = true;
  rebuild.dataset.loading = 'true';
  try {
    await refreshCurrentScreen();
  } catch (error) {
    showInlineError(error);
  } finally {
    rebuild.disabled = false;
    delete rebuild.dataset.loading;
  }
};

initTheme();
load();
