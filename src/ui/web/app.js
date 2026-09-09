const page = document.querySelector('#page');
const projectTree = document.querySelector('#project-tree');
const search = document.querySelector('#search');
const themeToggle = document.querySelector('#theme-toggle');
const commandHelperToggle = document.querySelector('#command-helper');
const rebuild = document.querySelector('#rebuild');
const projectName = document.querySelector('#project-name');
const sidebar = document.querySelector('#sidebar');
const sidebarToggle = document.querySelector('#sidebar-toggle');
const lifecycleStatuses = ['ANALYZE', 'DESIGN', 'PLAN', 'IMPLEMENT', 'VERIFY', 'ARCHIVE', 'ARCHIVED'];
let index;
let currentScreen = { type: 'module', moduleId: null };
let commandHelperOpen = false;
let currentChangeOptions = {};
let currentChangeReturnScreen;
let searchDocuments = [];
let searchReturnScreen;
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
  themeToggle.title = `主题：${labels[theme]}（点击切换）`;
  themeToggle.setAttribute('aria-label', themeToggle.title);
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
  if (screen.type === 'search') return '搜索结果';
  if (screen.type === 'module') return moduleLabel(screen.moduleId);
  if (screen.type === 'changes') return '变更管理';
  return '上一级';
}

function currentChange() {
  if (!currentScreen.changeId || !index) return null;
  const all = [
    ...(index.changes ?? []),
    ...(index.archive?.candidates ?? []),
    ...(index.archive?.historyChanges ?? []),
  ];
  return all.find((change) => change.id === currentScreen.changeId) ?? null;
}

function allDocuments() {
  return [
    ...(index?.archive?.currentSpecs ?? []),
    ...(index?.changes ?? []).flatMap((change) => change.documents ?? []),
    ...(index?.archive?.candidates ?? []).flatMap((change) => change.documents ?? []),
    ...(index?.archive?.historyChanges ?? []).flatMap((change) => change.documents ?? []),
  ];
}

function documentById(id) {
  return allDocuments().find((doc) => doc.id === id) ?? null;
}

function copyScreen(screen) {
  if (!screen) return screen;
  return screen.type === 'changes'
    ? { ...screen, ...(screen.filters ? { filters: { ...screen.filters } } : {}) }
    : { ...screen };
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

function groupChangesByModule(changes) {
  const groups = new Map();
  for (const change of changes) {
    const moduleId = change.modules?.[0] ?? 'unassigned';
    if (!groups.has(moduleId)) groups.set(moduleId, { id: moduleId, label: moduleLabel(moduleId), changes: [] });
    groups.get(moduleId).changes.push(change);
  }
  return [...groups.values()].sort((left, right) => {
    if (left.id === 'unassigned') return 1;
    if (right.id === 'unassigned') return -1;
    return (index.businessModules.findIndex((module) => module.id === left.id)
      - index.businessModules.findIndex((module) => module.id === right.id))
      || left.label.localeCompare(right.label);
  });
}

function changeModuleTags(change) {
  const modules = change.modules ?? [];
  if (!modules.length) return null;
  const tags = element('span', 'change-module-tags');
  for (const moduleId of modules) tags.append(element('span', 'module-tag', moduleLabel(moduleId)));
  return tags;
}

function changeButton(change, options = {}) {
  const card = element('button', 'change-row');
  card.type = 'button';
  card.onclick = () => navigateTo({ type: 'change', changeId: change.id }, { changeOptions: options });
  const main = element('span', 'change-row-main');
  main.append(element('strong', 'change-id', text(change.id)));
  main.append(element('span', 'change-title', text(change.title, '未命名 Change')));
  const meta = element('span', 'change-row-meta');
  meta.append(element('span', `status-pill ${statusClass(change.status)}`, statusLabel(change.status)));
  meta.append(element('span', 'sdd-level-badge', levelLabel(change.sddLevel)));
  const moduleTags = changeModuleTags(change);
  if (moduleTags) meta.append(moduleTags);
  card.append(main, meta);
  return card;
}

function archiveCandidateFor(change) {
  return (index.archive?.candidates ?? []).find((candidate) => candidate.id === change.id);
}

function activeChangeCard(change) {
  const card = element('article', `active-change-card ${change.status === 'ABANDONED' ? 'active-change-card-failed' : ''}`);
  const candidate = archiveCandidateFor(change);
  const detail = button('', 'active-change-card-main', () => navigateTo({ type: 'change', changeId: change.id }));
  const heading = element('div', 'active-change-card-heading');
  heading.append(element('strong', 'change-id', text(change.id)));
  heading.append(element('span', `status-pill ${statusClass(change.status)}`, statusLabel(change.status)));
  if (candidate?.ready) {
    const archiveButton = button('归档 →', 'archive-action', () => openArchiveConfirmation(candidate));
    archiveButton.setAttribute('aria-label', `归档 ${text(change.title, change.id)}`);
    heading.append(archiveButton);
  }
  if (candidate?.transitionable) {
    const transitionButton = button('进入归档准备 →', 'archive-transition-action', () => transitionToArchive(change.id));
    transitionButton.setAttribute('aria-label', `将 ${text(change.title, change.id)} 进入归档准备`);
    heading.append(transitionButton);
  }
  detail.append(heading, element('h2', 'active-change-card-title', text(change.title, '未命名 Change')));
  detail.append(element('p', 'muted active-change-card-meta', `${text(change.mode, '模式未知')} · ${levelLabel(change.sddLevel)}`));
  const moduleTags = changeModuleTags(change);
  if (moduleTags) detail.append(moduleTags);
  card.append(detail);

  const footer = element('div', 'active-change-card-footer');
  if (change.status === 'ABANDONED') {
    const reason = candidate?.gateReasons?.[0] ?? '该 Change 的生命周期已终止，请在详情中查看并处理。';
    footer.classList.add('failure-reason');
    footer.append(element('span', '', reason));
  } else if (candidate?.ready) {
    footer.append(element('span', 'gate-success', '可归档'));
  } else {
    footer.append(element('span', 'muted', candidate?.gateReasons?.[0] ?? '尚未满足归档门禁'));
  }
  card.append(footer);
  return card;
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

function metric(label, value) {
  const item = element('div', 'metric');
  item.append(element('span', 'metric-label', label), element('strong', '', text(value, '0')));
  return item;
}

function moduleChangeCount(moduleId) {
  return index.changes.filter((change) => change.modules?.includes(moduleId)).length;
}

function currentSpecForModule(moduleId) {
  return (index.archive.currentSpecs ?? []).find((doc) => doc.relativePath.includes(`/${moduleId}/spec.md`));
}

function renderWorkspaceSummary(description, badges, className = '', controls) {
  const summary = element('div', `change-summary ${className}`.trim());
  summary.append(element('p', 'change-workspace-description', description));
  if (controls || badges.length) {
    const actions = element('div', 'workspace-summary-actions');
    if (controls) actions.append(controls);
    if (badges.length) {
      const summaryBadges = element('div', 'change-summary-badges');
      for (const badge of badges) {
        summaryBadges.append(element('span', `change-summary-badge ${badge.tone ?? ''}`.trim(), `${badge.label} ${badge.value}`));
      }
      actions.append(summaryBadges);
    }
    summary.append(actions);
  }
  return summary;
}

function compactWorkspaceHeader({ className, contextClass, kicker, title, trailing }) {
  const header = element('header', `compact-workspace-header ${className}`.trim());
  const context = element('div', `compact-workspace-context ${contextClass}`.trim());
  context.append(element('p', 'kicker', kicker), element('h1', '', title));
  header.append(context);
  if (trailing) header.append(trailing);
  return header;
}

function renderCapabilities() {
  const view = document.createElement('div');
  view.classList.add('list-view');
  view.append(compactWorkspaceHeader({
    className: 'business-workspace-header',
    contextClass: 'business-workspace-context',
    kicker: 'BUSINESS MANAGEMENT',
    title: '业务功能',
  }));
  view.append(renderWorkspaceSummary('查看当前业务模块、关联 Spec 和活动变更。', [], 'business-summary'));
  const grid = element('div', 'capability-grid');
  if (!index.businessModules.length) {
    grid.append(emptyState('暂无业务模块。请通过 AI 工作流建立 codespec/business.yaml。'));
  } else {
    for (const module of index.businessModules) {
      const card = element('article', 'capability-card');
      const heading = element('div', 'capability-heading');
      heading.append(element('span', 'module-id', module.id), element('h2', '', module.name));
      const spec = currentSpecForModule(module.id);
      card.append(heading);
      const details = element('div', 'business-card-details');
      details.append(businessCardRow('活动 Change', moduleChangeCount(module.id)));
      details.append(businessCardRow('当前 Spec', spec ? '已建立' : '未建立', spec
        ? button('查看 Spec', 'quiet-button module-spec-action', () => openDocument(spec, currentScreen))
        : undefined));
      card.append(details);
      const actions = element('div', 'business-card-actions');
      actions.append(button('查看 Change', 'secondary-button', () => navigateTo({ type: 'changes', filters: { tab: 'active' } })));
      card.append(actions);
      grid.append(card);
    }
  }
  view.append(grid);
  return view;
}

function businessCardRow(label, value, action) {
  const row = element('div', 'business-card-row');
  row.append(element('span', 'business-card-label', label));
  row.append(action ?? element('strong', 'business-card-value', String(value)));
  return row;
}

function renderActiveChanges() {
  const view = document.createElement('div');
  view.classList.add('list-view');
  const grid = element('div', 'active-change-grid');
  grid.setAttribute('aria-label', 'ACTIVE CHANGES');
  if (!index.changes.length) grid.append(emptyState('暂无活动 Change。'));
  else grid.append(...index.changes.map(activeChangeCard));
  view.append(grid);
  return view;
}

function renderArchiveHistory() {
  const view = document.createElement('div');
  view.classList.add('list-view');
  const history = index.archive.historyChanges ?? [];
  const groupsList = element('div', 'change-groups-scroll change-list-scroll');
  groupsList.setAttribute('aria-label', 'ARCHIVE HISTORY');
  const groups = groupChangesByModule(history);
  if (!groups.length) groupsList.append(emptyState('暂无归档 Change。'));
  else {
    for (const group of groups) {
      const section = element('section', 'change-module-group');
      const heading = element('div', 'change-module-heading');
      heading.append(element('h2', '', group.label), element('span', 'module-count', `${group.changes.length} 个 Change`));
      const list = element('div', 'change-list change-module-list archive-history-list');
      list.append(...group.changes.map((change) => changeButton(change, { archived: true })));
      section.append(heading, list);
      groupsList.append(section);
    }
  }
  view.append(groupsList);
  return view;
}

const CHANGE_TABS = [
  { id: 'active', label: '活动 Change', render: renderActiveChanges },
  { id: 'history', label: '归档历史', render: renderArchiveHistory },
];

function renderChangesWorkspace() {
  const view = document.createElement('div');
  view.classList.add('changes-workspace-view');

  const selected = CHANGE_TABS.find((tab) => tab.id === currentScreen.filters?.tab) ?? CHANGE_TABS[0];
  const tabs = element('div', 'change-tablist');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Change 分类');
  tabs.onkeydown = (event) => {
    const selectedIndex = CHANGE_TABS.findIndex((tab) => tab.id === selected.id);
    const nextIndex = event.key === 'ArrowRight'
      ? (selectedIndex + 1) % CHANGE_TABS.length
      : event.key === 'ArrowLeft'
        ? (selectedIndex - 1 + CHANGE_TABS.length) % CHANGE_TABS.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? CHANGE_TABS.length - 1
            : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextTab = CHANGE_TABS[nextIndex];
    navigateTo({ type: 'changes', filters: { ...currentScreen.filters, tab: nextTab.id } });
    document.getElementById(`change-tab-${nextTab.id}`)?.focus();
  };
  for (const tab of CHANGE_TABS) {
    const tabButton = button(tab.label, 'change-tab', () => navigateTo({ type: 'changes', filters: { ...currentScreen.filters, tab: tab.id } }));
    tabButton.id = `change-tab-${tab.id}`;
    tabButton.setAttribute('role', 'tab');
    tabButton.setAttribute('aria-selected', String(tab.id === selected.id));
    tabButton.setAttribute('aria-controls', 'change-tab-panel');
    tabButton.tabIndex = tab.id === selected.id ? 0 : -1;
    if (tab.id === selected.id) tabButton.classList.add('active');
    tabs.append(tabButton);
  }

  const controls = element('div', 'change-workspace-controls');
  controls.append(tabs);
  const header = compactWorkspaceHeader({
    className: 'change-workspace-header',
    contextClass: 'change-workspace-context',
    kicker: 'CHANGE MANAGEMENT',
    title: '变更管理',
  });
  const summary = renderWorkspaceSummary('查看活动 Change 与归档历史。', [
    { label: '活动', value: index.changes.length, tone: 'active' },
    { label: '已归档', value: (index.archive.historyChanges ?? []).length, tone: 'archived' },
  ], '', controls);

  const panel = element('div', 'change-tab-panel');
  panel.id = 'change-tab-panel';
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', `change-tab-${selected.id}`);
  panel.append(selected.render());
  view.append(header, summary, panel);
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

function gatePanel(change) {
  const panel = element('aside', 'gate-panel');
  if (change.status === 'ABANDONED') {
    const reason = archiveCandidateFor(change)?.gateReasons?.[0] ?? '该 Change 的生命周期已终止，请检查 Change 文档并按工作流处理。';
    panel.classList.add('change-failure-panel');
    panel.append(element('h3', '', '生命周期失败'));
    panel.append(element('p', 'failure-reason', reason));
    panel.append(element('p', 'muted', '该状态下不可归档，但文档仍可只读查看。'));
    return panel;
  }
  panel.append(element('h3', '', '本等级要求'));
  panel.append(element('p', 'muted', levelDescription(change.sddLevel)));
  const details = element('ul', 'gate-list');
  const entries = [
    ['任务', change.taskProgress ? `${change.taskProgress.completed}/${change.taskProgress.total}` : '未读取'],
    ['Requirement', change.verification?.requirementsVerified ? '已验证' : '待验证'],
    ['测试', change.verification?.testsPassed ? '通过' : '待验证'],
    ['构建', change.verification?.buildPassed ? '通过' : '待验证'],
    ['Lint', change.verification?.lintPassed ? '通过' : '待验证'],
  ];
  for (const [label, value] of entries) {
    const item = element('li');
    item.append(element('span', '', label), element('strong', value === '待验证' ? 'gate-warn' : 'gate-success', value));
    details.append(item);
  }
  panel.append(details);
  return panel;
}

function levelDescription(level) {
  if (level === 1) return 'Level 1：小范围单模块变更，设计说明内嵌在 spec.md。';
  if (level === 3) return 'Level 3：高风险或复杂变更，需要完整设计、追踪矩阵和代码引用。';
  return 'Level 2：常规功能或跨模块变更，需要 design.md、BDD 和集成验证。';
}

function documentTabLabel(doc) {
  const name = doc.relativePath.split('/').at(-1) ?? doc.title;
  return name.replace(/\.md$/u, '');
}

function changeDocumentOrder(left, right) {
  const order = ['metadata.yaml', 'design.md', 'spec.md', 'tasks.yaml', 'verification.yaml', 'proposal.md', 'tasks.md', 'verification.md'];
  return (order.indexOf(left.relativePath.split('/').at(-1)) + order.length) % order.length
    - (order.indexOf(right.relativePath.split('/').at(-1)) + order.length) % order.length
    || left.relativePath.localeCompare(right.relativePath);
}

function renderChangeDetail(change, options = currentChangeOptions, returnScreen = currentChangeReturnScreen) {
  documentReturnScreen = undefined;
  const fallbackReturnScreen = currentScreen.type === 'module'
    || currentScreen.type === 'changes'
    || currentScreen.type === 'search'
    ? copyScreen(currentScreen)
    : { type: 'module', moduleId: index.businessModules[0]?.id ?? null };
  const detailReturnScreen = returnScreen ?? fallbackReturnScreen;
  const activeDocumentId = currentScreen.type === 'change' && currentScreen.changeId === change.id
    ? currentScreen.activeDocumentId
    : null;
  const view = document.createElement('div');
  view.classList.add('detail-view');
  const archived = options.archived === true || change.status === 'ARCHIVED';
  if (archived) view.classList.add('archived-detail-view');
  const badges = element('div', 'detail-badges');
  badges.append(element('span', `status-pill ${statusClass(change.status)}`, statusLabel(change.status)));
  badges.append(element('span', 'sdd-level-badge', levelLabel(change.sddLevel)));
  const header = element('div', 'section-header detail-section-header');
  header.append(backButton(`返回${screenLabel(detailReturnScreen)}`, goBackFromScreen));
  header.append(element('p', 'kicker', 'CHANGE DETAIL'));
  const headerRow = element('div', 'detail-header-row');
  headerRow.append(element('h1', '', text(change.title, change.id)), badges);
  const subrow = element('div', 'detail-subrow detail-meta-row');
  subrow.append(
    element('p', 'section-description', `${change.id} · ${change.mode ?? '模式未知'}`),
    lifecycleStepper(change),
  );
  header.append(headerRow, subrow);
  view.append(header);
  if (archived) {
    const archivedDocument = change.documents?.[0];
    const historyMeta = element('div', 'history-meta');
    historyMeta.append(element('span', '', `归档路径：${archivedDocument?.relativePath?.split('/').slice(0, -1).join('/') ?? '未读取'}`));
    historyMeta.append(element('span', '', `归档时间：${change.archiveState?.archivedAt ?? '未读取'}`));
    historyMeta.append(element('span', '', `Verification Receipt：${change.verification?.evidenceReceipt ?? '未读取'}`));
    view.append(historyMeta);
  }
  const columns = element('div', 'detail-columns');
  columns.append(gatePanel(change));
  const documents = [...(change.documents ?? [])].sort(changeDocumentOrder);
  const docs = element('section', 'document-panel');
  docs.append(element('h3', '', 'Change 文档（只读）'));
  const tabs = element('nav', 'document-tabs');
  const content = element('div', 'document-content');
  const activate = async (doc, activeButton) => {
    currentScreen.activeDocumentId = doc.id;
    for (const tab of tabs.children) tab.classList.remove('active');
    activeButton.classList.add('active');
    const detail = await api(`/api/documents/${doc.id}`);
    content.replaceChildren();
    renderDocument(detail, content);
  };
  if (!documents.length) docs.append(emptyState('暂无 Change 文档'));
  else {
    documents.forEach((doc, position) => {
      const tab = button(documentTabLabel(doc), 'document-tab', () => activate(doc, tab));
      if (doc.id === activeDocumentId || (!activeDocumentId && position === 0)) tab.classList.add('active');
      tabs.append(tab);
    });
    docs.append(tabs, content);
    const activeDocument = documents.find((doc) => doc.id === activeDocumentId) ?? documents[0];
    const activeTab = [...tabs.children][documents.indexOf(activeDocument)];
    activate(activeDocument, activeTab).catch(showError);
  }
  columns.append(docs);
  view.append(columns);
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

function renderDocument(detail, target) {
  target.append(element('p', 'document-path', detail.relativePath));
  const name = documentName(detail);
  if (detail.contentType === 'yaml' && detail.structuredContent !== undefined) {
    if (name === 'metadata.yaml') renderMetadataDocument(detail.structuredContent, target);
    else if (name === 'tasks.yaml') renderTasksDocument(detail.structuredContent, target);
    else if (name === 'verification.yaml') renderVerificationDocument(detail.structuredContent, target);
    else target.append(documentRecordSection('文档内容', detail.structuredContent));
    return;
  }
  if (detail.contentType === 'markdown') {
    if (name === 'design.md' || name === 'spec.md') renderChangeMarkdownDocument(detail, target);
    else target.insertAdjacentHTML('beforeend', markdownit({ html: false }).render(detail.content));
  } else target.append(element('pre', '', detail.content));
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
    ?? { type: 'module', moduleId: index?.businessModules[0]?.id ?? null };
  documentReturnScreen = undefined;
  navigateTo(target);
}

function renderArchivePreviewSummary(preview) {
  const summary = element('div', 'preview-card');
  summary.append(element('p', '', `${levelLabel(preview.sddLevel)} · ${preview.mode}`));
  summary.append(element('p', 'muted', `目标：${preview.archiveTarget}`));
  summary.append(element('p', 'muted', `Verification Receipt：${preview.verificationReceipt}`));
  summary.append(element('p', 'muted', `影响模块：${(preview.modules ?? []).join('、') || '无'}`));
  summary.append(element('p', 'muted', `归档影响：${preview.archiveImpact?.outcome === 'affected' ? `受影响（${preview.archiveImpact.references?.length ?? 0} 条映射）` : '无当前 Spec 行为影响'}`));
  return summary;
}

async function openArchiveConfirmation(candidate) {
  const preview = await api(`/api/archive/${encodeURIComponent(candidate.id)}`);
  const backdrop = element('div', 'archive-confirmation-backdrop');
  const dialog = element('section', 'archive-confirmation-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'archive-confirmation-title');
  const header = element('div', 'archive-confirmation-header');
  const title = element('h2', '', '确认归档 Change');
  title.id = 'archive-confirmation-title';
  header.append(title, button('取消', 'quiet-button', () => backdrop.remove()));
  dialog.append(header, element('p', 'muted', `${preview.changeId} · ${preview.title}`), renderArchivePreviewSummary(preview));
  const actions = element('div', 'card-actions');
  actions.append(button('确认归档 Change', 'primary-button', async () => {
    try {
      const result = await api(`/api/archive/${encodeURIComponent(preview.changeId)}`, { method: 'POST' });
      index = result.index;
      backdrop.remove();
      navigateTo({ type: 'changes', filters: { tab: 'history' } });
    } catch (error) {
      const existing = dialog.querySelector('.inline-error');
      if (existing) existing.remove();
      dialog.append(element('div', 'inline-error', `归档失败：${error.message}`));
    }
  }));
  dialog.append(actions);
  backdrop.append(dialog);
  document.body.append(backdrop);
  dialog.querySelector('.primary-button')?.focus();
}

async function transitionToArchive(changeId) {
  const result = await api(`/api/transition/${encodeURIComponent(changeId)}`, { method: 'POST' });
  index = result.index;
  renderCurrentScreen();
  if (commandHelperOpen) renderCommandHelper();
}

function renderSearchResults(documents, query) {
  if (currentScreen.type !== 'search') searchReturnScreen = copyScreen(currentScreen);
  searchDocuments = documents;
  currentScreen = { type: 'search', query };
  const view = document.createElement('div');
  view.classList.add('search-view');
  view.append(sectionHeader('SEARCH', `搜索结果：${query}`, '搜索结果仅提供只读查看。'));
  if (!documents.length) view.append(emptyState('没有匹配的文档。'));
  else {
    const list = element('div', 'search-results');
    for (const doc of documents) list.append(button(`${doc.title} · ${doc.relativePath}`, 'search-result', () => openDocument(doc)));
    view.append(list);
  }
  page.replaceChildren(view);
}

function renderSidebar() {
  projectTree.replaceChildren();
  const activeScreen = currentScreen;
  const moduleSection = element('section', 'project-tree-section');
  moduleSection.append(element('p', 'nav-caption', '业务管理'));
  for (const module of index?.businessModules ?? []) {
    const node = element('button', 'tree-node', `${module.id} · ${module.name}`);
    node.type = 'button';
    node.setAttribute('data-node', 'business-module');
    node.dataset.moduleId = module.id;
    node.classList.toggle('active', activeScreen.type === 'module' && activeScreen.moduleId === module.id);
    node.setAttribute('aria-current', activeScreen.type === 'module' && activeScreen.moduleId === module.id ? 'page' : 'false');
    moduleSection.append(node);
  }
  if (!moduleSection.querySelector('.tree-node')) moduleSection.append(element('p', 'sidebar-empty', '暂无业务模块'));
  projectTree.append(moduleSection);

  const changeSection = element('section', 'project-tree-section');
  changeSection.append(element('p', 'nav-caption', '工作区'));
  const changeNode = element('button', 'tree-node', '变更管理');
  changeNode.type = 'button';
  changeNode.setAttribute('data-node', 'change-management');
  const changesActive = activeScreen.type === 'changes' || activeScreen.type === 'change';
  changeNode.classList.toggle('active', changesActive);
  changeNode.setAttribute('aria-current', changesActive ? 'page' : 'false');
  changeSection.append(changeNode);
  projectTree.append(changeSection);
}

function renderCurrentScreen() {
  renderSidebar();
  if (currentScreen.type === 'module') {
    page.replaceChildren(renderCapabilities());
    return;
  }
  if (currentScreen.type === 'changes') {
    page.replaceChildren(renderChangesWorkspace());
    return;
  }
  if (currentScreen.type === 'change') {
    const change = currentChange();
    if (change) renderChangeDetail(change);
    else showError(new Error('当前 Change 已不存在，请返回列表。'));
    return;
  }
  if (currentScreen.type === 'search') {
    renderSearchResults(searchDocuments, currentScreen.query ?? '');
  }
}

function navigateTo(screen, { changeOptions } = {}) {
  documentReturnScreen = undefined;
  if (screen.type !== 'search') {
    searchDocuments = [];
    searchReturnScreen = undefined;
  }
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
    if (currentScreen.type === 'module' && currentScreen.moduleId === null) {
      currentScreen = { type: 'module', moduleId: index.businessModules[0]?.id ?? null };
    }
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
  if (target.dataset.node === 'change-management') {
    navigateTo({ type: 'changes', filters: { tab: 'active' } });
  }
};

sidebarToggle.onclick = () => {
  const open = sidebar.classList.toggle('is-open');
  sidebarToggle.setAttribute('aria-expanded', String(open));
  sidebarToggle.setAttribute('aria-label', open ? '关闭工程树' : '打开工程树');
};

let searchTimer;
search.oninput = () => {
  clearTimeout(searchTimer);
  const query = search.value.trim();
  if (!query) {
    const target = searchReturnScreen ?? { type: 'module', moduleId: index?.businessModules[0]?.id ?? null };
    searchDocuments = [];
    searchReturnScreen = undefined;
    navigateTo(target);
    return;
  }
  searchTimer = setTimeout(async () => {
    try {
      const result = await api(`/api/search?q=${encodeURIComponent(query)}`);
      renderSearchResults(result.documents, query);
    } catch (error) {
      showError(error);
    }
  }, 200);
};

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
