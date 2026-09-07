const page = document.querySelector('#page');
const nav = document.querySelector('#nav');
const search = document.querySelector('#search');
const theme = document.querySelector('#theme');
const rebuild = document.querySelector('#rebuild');
const projectName = document.querySelector('#project-name');
const lifecycleStatuses = ['ANALYZE', 'DESIGN', 'PLAN', 'IMPLEMENT', 'VERIFY', 'ARCHIVE', 'ARCHIVED'];
let index;
let currentView = 'capabilities';

const api = async (path, init) => {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? '请求失败');
  return body;
};

function setTheme(value) {
  document.documentElement.dataset.theme = value;
  theme.value = value;
  localStorage.setItem('codespec-theme', value);
}

function initTheme() {
  const saved = localStorage.getItem('codespec-theme');
  setTheme(saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system');
  theme.onchange = () => setTheme(theme.value);
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

function statusLabel(status) {
  return status === 'ARCHIVED' ? '已归档' : text(status, '状态未知');
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
  card.onclick = () => renderChangeDetail(change, options);
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

function renderCapabilities() {
  const view = document.createElement('div');
  view.append(sectionHeader('CAPABILITY MAP', '能力地图', '查看当前业务模块、关联 Spec 和活动变更。模块内容由 AI 工作流维护。'));
  const grid = element('div', 'capability-grid');
  if (!index.businessModules.length) {
    grid.append(emptyState('暂无业务模块。请通过 AI 工作流建立 codespec/business.md。'));
  } else {
    for (const module of index.businessModules) {
      const card = element('article', 'capability-card');
      const heading = element('div', 'capability-heading');
      heading.append(element('span', 'module-id', module.id), element('h2', '', module.name));
      card.append(heading);
      card.append(element('p', 'muted', module.description || module.responsibility || '未填写模块说明'));
      const metrics = element('div', 'metrics');
      metrics.append(metric('活动 Change', moduleChangeCount(module.id)));
      metrics.append(metric('当前 Spec', currentSpecForModule(module.id) ? '已建立' : '未建立'));
      card.append(metrics);
      const actions = element('div', 'card-actions');
      const spec = currentSpecForModule(module.id);
      if (spec) actions.append(button('查看 Spec', 'secondary-button', () => openDocument(spec)));
      const related = index.changes.filter((change) => change.modules?.includes(module.id));
      if (related.length) actions.append(button('查看 Change', 'secondary-button', () => renderChangeList(related, '活动 Change')));
      card.append(actions);
      grid.append(card);
    }
  }
  view.append(grid);
  return view;
}

function renderChangeList(changes, title) {
  const view = document.createElement('div');
  view.classList.add('list-view');
  view.append(sectionHeader('CHANGE WORKSPACE', title, 'Change 和文档仅供查看，新增、修改和推进由 AI 工作流完成。'));
  const groupsList = element('div', 'change-groups-scroll change-list-scroll');
  const groups = groupChangesByModule(changes);
  if (!groups.length) groupsList.append(emptyState('暂无 Change'));
  else {
    for (const group of groups) {
      const section = element('section', 'change-module-group');
      const heading = element('div', 'change-module-heading');
      heading.append(element('h2', '', group.label), element('span', 'module-count', `${group.changes.length} 个 Change`));
      const list = element('div', 'change-list change-module-list');
      list.append(...group.changes.map(changeButton));
      section.append(heading, list);
      groupsList.append(section);
    }
  }
  view.append(groupsList);
  return view;
}

function renderActiveChanges() {
  return renderChangeList(index.changes, '活动 Change');
}

function archiveCandidateCard(candidate) {
  const card = element('article', `archive-card ${candidate.ready ? 'archive-ready' : 'archive-blocked'}`);
  const heading = element('div', 'archive-card-heading');
  heading.append(element('strong', '', text(candidate.id)));
  heading.append(element('span', 'sdd-level-badge', levelLabel(candidate.sddLevel)));
  card.append(heading);
  card.append(element('h2', '', text(candidate.title, '未命名 Change')));
  card.append(element('p', 'muted', `${statusLabel(candidate.status)} · ${candidate.mode ?? '模式未知'}`));
  if (candidate.ready) {
    card.append(element('p', 'gate-success', '已满足归档门禁，可查看归档预览。'));
    card.append(button('查看归档预览', 'primary-button', () => renderArchivePreview(candidate)));
  } else {
    const reasons = element('ul', 'gate-reasons');
    for (const reason of candidate.gateReasons ?? ['归档门禁状态未知']) reasons.append(element('li', '', reason));
    card.append(reasons);
    card.append(button('查看 Change', 'secondary-button', () => renderChangeDetail(candidate)));
  }
  return card;
}

function renderArchiveableChanges() {
  const view = document.createElement('div');
  view.classList.add('archive-workbench-view');
  const header = sectionHeader('ARCHIVE WORKBENCH', '可归档 Change', '仅对已通过校验和 ARCHIVE 门禁的 Change 提供归档操作。');
  const candidates = index.archive.candidates ?? [];
  const ready = candidates.filter((candidate) => candidate.ready);
  const blocked = candidates.filter((candidate) => !candidate.ready);
  header.classList.add('archive-header');
  const summary = element('div', 'summary-strip archive-summary');
  summary.setAttribute('aria-label', '归档状态计数');
  summary.append(metric('可归档', ready.length), metric('暂不可归档', blocked.length));
  header.append(summary);
  view.append(header);
  if (!candidates.length) view.append(emptyState('暂无活动 Change。'));
  const groupsList = element('div', 'archive-module-groups-scroll');
  for (const group of groupChangesByModule(candidates)) {
    const groupReady = group.changes.filter((candidate) => candidate.ready);
    const groupBlocked = group.changes.filter((candidate) => !candidate.ready);
    const section = element('section', 'archive-module-group');
    const heading = element('div', 'change-module-heading');
    heading.append(element('h2', '', group.label), element('span', 'module-count', `${group.changes.length} 个 Change`));
    section.append(heading);
    for (const [items, label, className] of [[groupReady, '可归档', 'archive-ready-list'], [groupBlocked, '暂不可归档', 'archive-blocked-list']]) {
      if (!items.length) continue;
      section.append(element('h3', 'subsection-title', label));
      const list = element('div', `archive-list-scroll ${className}`);
      const grid = element('div', 'archive-grid');
      grid.append(...items.map(archiveCandidateCard));
      list.append(grid);
      section.append(list);
    }
    groupsList.append(section);
  }
  if (candidates.length) view.append(groupsList);
  return view;
}

function renderArchiveHistory() {
  const view = document.createElement('div');
  view.classList.add('list-view');
  view.append(sectionHeader('ARCHIVE HISTORY', '归档历史', '查看已归档 Change 与当前 Spec 的追溯关系。'));
  const history = index.archive.historyChanges ?? [];
  const groupsList = element('div', 'change-groups-scroll change-list-scroll');
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
  const order = ['metadata.yaml', 'proposal.md', 'design.md', 'spec.md', 'tasks.md', 'verification.md'];
  return (order.indexOf(left.relativePath.split('/').at(-1)) + order.length) % order.length
    - (order.indexOf(right.relativePath.split('/').at(-1)) + order.length) % order.length
    || left.relativePath.localeCompare(right.relativePath);
}

function renderChangeDetail(change, options = {}) {
  const view = document.createElement('div');
  view.classList.add('detail-view');
  const archived = options.archived === true || change.status === 'ARCHIVED';
  if (archived) view.classList.add('archived-detail-view');
  const header = sectionHeader('CHANGE DETAIL', text(change.title, change.id), `${change.id} · ${change.mode ?? '模式未知'}`);
  const badges = element('div', 'detail-badges');
  badges.append(element('span', `status-pill ${statusClass(change.status)}`, statusLabel(change.status)));
  badges.append(element('span', 'sdd-level-badge', levelLabel(change.sddLevel)));
  if (archived) {
    const metaRow = element('div', 'detail-meta-row');
    metaRow.append(badges, lifecycleStepper(change));
    view.append(header, metaRow);
    const archivedDocument = change.documents?.[0];
    const historyMeta = element('div', 'history-meta');
    historyMeta.append(element('span', '', `归档路径：${archivedDocument?.relativePath?.split('/').slice(0, -1).join('/') ?? '未读取'}`));
    historyMeta.append(element('span', '', `归档时间：${change.archiveState?.archivedAt ?? '未读取'}`));
    historyMeta.append(element('span', '', `Verification Receipt：${change.verification?.evidenceReceipt ?? '未读取'}`));
    view.append(historyMeta);
  } else {
    header.append(badges);
    view.append(header, lifecycleStepper(change));
  }
  const columns = element('div', 'detail-columns');
  columns.append(gatePanel(change));
  const documents = [...(change.documents ?? [])].sort(changeDocumentOrder);
  const docs = element('section', 'document-panel');
  docs.append(element('h3', '', 'Change 文档（只读）'));
  const tabs = element('nav', 'document-tabs');
  const content = element('div', 'document-content');
  const activate = async (doc, activeButton) => {
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
      if (position === 0) tab.classList.add('active');
      tabs.append(tab);
    });
    docs.append(tabs, content);
    activate(documents[0], tabs.firstChild).catch(showError);
  }
  columns.append(docs);
  view.append(columns);
  page.replaceChildren(view);
}

function renderDocument(detail, target) {
  target.append(element('p', 'document-path', detail.relativePath));
  if (detail.contentType === 'markdown') target.insertAdjacentHTML('beforeend', markdownit({ html: false }).render(detail.content));
  else target.append(element('pre', '', detail.content));
}

async function openDocument(doc) {
  const detail = await api(`/api/documents/${doc.id}`);
  const view = document.createElement('div');
  view.classList.add('document-view');
  view.append(sectionHeader('DOCUMENT', doc.title, '只读文档内容'));
  const content = element('div', 'document-content standalone-document');
  renderDocument(detail, content);
  view.append(content);
  page.replaceChildren(view);
}

async function renderArchivePreview(candidate) {
  const preview = await api(`/api/archive/${encodeURIComponent(candidate.id)}`);
  const view = document.createElement('div');
  view.classList.add('preview-view');
  view.append(sectionHeader('ARCHIVE PREVIEW', '确认归档影响', `${preview.changeId} · ${preview.title}`));
  const summary = element('div', 'preview-card');
  summary.append(element('p', '', `${levelLabel(preview.sddLevel)} · ${preview.mode}`));
  summary.append(element('p', 'muted', `目标：${preview.archiveTarget}`));
  summary.append(element('p', 'muted', `Verification Receipt：${preview.verificationReceipt}`));
  summary.append(element('p', 'muted', `影响模块：${(preview.modules ?? []).join('、') || '无'}`));
  summary.append(element('p', 'muted', `归档影响：${preview.archiveImpact?.outcome === 'affected' ? `受影响（${preview.archiveImpact.references?.length ?? 0} 条映射）` : '无当前 Spec 行为影响'}`));
  const actions = element('div', 'card-actions');
  actions.append(button('返回可归档列表', 'secondary-button', () => navigate('archiveable-changes')));
  actions.append(button('确认归档 Change', 'primary-button', async () => {
    if (!window.confirm(`确认归档 Change "${preview.changeId}"？`)) return;
    const result = await api(`/api/archive/${encodeURIComponent(preview.changeId)}`, { method: 'POST' });
    index = result.index;
    navigate('archive-history');
  }));
  summary.append(actions);
  view.append(summary);
  page.replaceChildren(view);
}

function renderSearchResults(documents, query) {
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

function renderView() {
  for (const item of nav.querySelectorAll('[data-view]')) item.classList.toggle('active', item.dataset.view === currentView);
  if (currentView === 'capabilities') page.replaceChildren(renderCapabilities());
  if (currentView === 'active-changes') page.replaceChildren(renderActiveChanges());
  if (currentView === 'archiveable-changes') page.replaceChildren(renderArchiveableChanges());
  if (currentView === 'archive-history') page.replaceChildren(renderArchiveHistory());
}

function navigate(view) {
  currentView = view;
  renderView();
}

function showError(error) {
  page.replaceChildren(element('div', 'error-state', `无法加载内容：${error.message}`));
}

async function load() {
  try {
    index = await api('/api/index');
    projectName.textContent = index.projectName ?? '当前工程';
    renderView();
  } catch (error) {
    showError(error);
  }
}

nav.onclick = (event) => {
  const target = event.target.closest('[data-view]');
  if (target) navigate(target.dataset.view);
};

let searchTimer;
search.oninput = () => {
  clearTimeout(searchTimer);
  const query = search.value.trim();
  if (!query) {
    renderView();
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

rebuild.onclick = async () => {
  try {
    index = await api('/api/rebuild', { method: 'POST' });
    renderView();
  } catch (error) {
    showError(error);
  }
};

initTheme();
load();
