const tree = document.querySelector('#tree');
const reader = document.querySelector('#reader');
const search = document.querySelector('#search');
let index;

const api = async (path, init) => {
  const response = await fetch(path, init);
  if (!response.ok) throw new Error('请求失败');
  return response.json();
};

function fileButton(doc, depth = 0) {
  const button = document.createElement('button');
  button.className = 'item tree-file';
  button.style.paddingLeft = `${depth * 16 + 12}px`;
  button.textContent = doc.relativePath.split('/').pop();
  button.onclick = () => openDocument(doc);
  return button;
}

function changeButton(change) {
  const button = document.createElement('button');
  button.className = 'item tree-file change-item';
  button.textContent = change.id;
  button.onclick = () => openChange(change);
  return button;
}

function buildTree(docs, pathForDocument = (doc) => doc.relativePath) {
  const root = { children: new Map(), document: undefined };
  for (const doc of docs) {
    let node = root;
    for (const segment of pathForDocument(doc).split('/').filter(Boolean)) {
      if (!node.children.has(segment)) {
        node.children.set(segment, { children: new Map(), document: undefined });
      }
      node = node.children.get(segment);
    }
    node.document = doc;
  }
  return root;
}

function renderTree(node, depth = 0) {
  return [...node.children.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, child]) => {
      if (child.document && child.children.size === 0) return fileButton(child.document, depth);
      const folder = document.createElement('details');
      folder.open = depth < 2;
      const label = document.createElement('summary');
      label.textContent = name;
      folder.append(label, ...renderTree(child, depth + 1));
      return folder;
    });
}

async function openDocument(doc) {
  const detail = await api(`/api/documents/${doc.id}`);
  reader.replaceChildren();
  renderDocument(detail, reader);
}

function renderDocument(detail, target) {
  target.append(Object.assign(document.createElement('p'), { textContent: detail.relativePath }));
  if (detail.contentType === 'markdown') {
    target.insertAdjacentHTML('beforeend', markdownit({ html: false }).render(detail.content));
  } else {
    target.append(Object.assign(document.createElement('pre'), { textContent: detail.content }));
  }
}

function documentTabLabel(doc) {
  const parts = doc.relativePath.split('/');
  const specsIndex = parts.lastIndexOf('specs');
  if (parts.at(-1) === 'spec.md' && specsIndex >= 0) return `specs / ${parts.slice(specsIndex + 1, -1).join(' / ')}`;
  return parts.at(-1).replace(/\.md$/u, '');
}

function changeDocumentOrder(left, right) {
  const order = ['proposal.md', 'design.md', 'tasks.md', '.openspec.yaml'];
  const leftIndex = order.indexOf(left.relativePath.split('/').at(-1));
  const rightIndex = order.indexOf(right.relativePath.split('/').at(-1));
  return (leftIndex < 0 ? order.length : leftIndex) - (rightIndex < 0 ? order.length : rightIndex)
    || left.relativePath.localeCompare(right.relativePath);
}

async function openChange(change) {
  const documents = [...change.documents].sort(changeDocumentOrder);
  if (documents.length === 0) return;

  reader.replaceChildren();
  const tabs = document.createElement('nav');
  tabs.className = 'reader-tabs';
  const content = document.createElement('section');
  content.className = 'reader-content';
  const buttons = new Map();

  const activate = async (doc) => {
    for (const [id, button] of buttons) button.classList.toggle('active', id === doc.id);
    const detail = await api(`/api/documents/${doc.id}`);
    content.replaceChildren();
    renderDocument(detail, content);
  };

  for (const doc of documents) {
    const button = document.createElement('button');
    button.className = 'reader-tab';
    button.textContent = documentTabLabel(doc);
    button.onclick = () => activate(doc).catch(showError);
    buttons.set(doc.id, button);
    tabs.append(button);
  }
  reader.append(tabs, content);
  await activate(documents[0]);
}

function changeCard(title, changes) {
  const panel = document.createElement('details');
  panel.open = true;
  panel.className = 'card';
  panel.innerHTML = `<summary>${title} <b>${changes.length}</b></summary>`;
  if (changes.length === 0) {
    panel.append(Object.assign(document.createElement('p'), { textContent: '暂无 Change' }));
  } else {
    panel.append(...changes.map(changeButton));
  }
  return panel;
}

function cardSection(title, count) {
  const section = document.createElement('p');
  section.className = 'card-section';
  section.textContent = `${title} · ${count}`;
  return section;
}

function businessModules(doc) {
  return (doc?.content.match(/^\|\s*MOD-\d+\s*\|.*$/gmu) ?? []).map((line) => {
    const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
    return { id: cells[0], name: cells[1] };
  });
}

function businessCard(doc) {
  const modules = businessModules(doc);
  const panel = document.createElement('details');
  panel.open = true;
  panel.className = 'card';
  panel.innerHTML = `<summary>业务模块 <b>${modules.length}</b></summary>`;
  if (!doc || modules.length === 0) {
    panel.append(Object.assign(document.createElement('p'), { textContent: '暂无业务模块' }));
    return panel;
  }
  for (const module of modules) {
    const button = document.createElement('button');
    button.className = 'item tree-file';
    button.textContent = `${module.id} · ${module.name}`;
    button.onclick = () => openDocument(doc);
    panel.append(button);
  }
  return panel;
}

function archiveCard(archive) {
  const panel = document.createElement('details');
  panel.open = true;
  panel.className = 'card';
  panel.innerHTML = `<summary>归档记录 <b>${archive.specSnapshots.length} Spec · ${archive.historyCount} Change</b></summary>`;
  panel.append(cardSection('能力 Spec 快照', archive.specSnapshots.length));
  if (archive.specSnapshots.length === 0) {
    panel.append(Object.assign(document.createElement('p'), { textContent: '暂无归档 Spec' }));
  } else {
    for (const snapshot of archive.specSnapshots) {
      const button = fileButton(snapshot);
      button.textContent = snapshot.relativePath.split('/')[3];
      panel.append(button);
    }
  }

  panel.append(cardSection('Change 历史', archive.historyCount));
  if (archive.history.length === 0) {
    panel.append(Object.assign(document.createElement('p'), { textContent: '暂无归档 Change' }));
  } else {
    panel.append(...archive.historyChanges.map(changeButton));
  }
  return panel;
}

function render() {
  const business = index.documents.filter((doc) => doc.relativePath === 'openspec/business.md');
  tree.replaceChildren(
    businessCard(business[0]),
    archiveCard(index.archive),
    changeCard('活动 Change', index.changes),
  );

  const initialDocument = business[0] ?? index.documents[0];
  if (initialDocument) openDocument(initialDocument).catch(showError);
  else reader.textContent = '当前工程中没有可展示的 OpenSpec 文件。';
}

function showError(error) {
  reader.textContent = `无法加载内容：${error.message}`;
}

async function load() {
  try {
    index = await api('/api/index');
    render();
  } catch (error) {
    tree.textContent = '无法读取当前工程的 OpenSpec 内容。';
    showError(error);
  }
}

let timer;
search.oninput = () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      const result = await api(`/api/search?q=${encodeURIComponent(search.value)}`);
      tree.replaceChildren(...renderTree(buildTree(result.documents)));
    } catch (error) {
      showError(error);
    }
  }, 200);
};

rebuild.onclick = async () => {
  await api('/api/rebuild', { method: 'POST' });
  load();
};

load();
