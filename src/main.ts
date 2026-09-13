import './style.css';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark-dimmed.css';
import type { DocumentKind, FontStyle, MarkdownDocument, StoredState, Theme, ViewMode } from './types';
import { loadState, saveState, saveMetadata, loadDocumentData } from './store';
import { readDocument, MAX_FILE_BYTES } from './import-document';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { decorateRenderedMarkdown, plainTextFromMarkdown, renderMarkdown, type TocEntry } from './markdown';

const SAMPLE = `# 欢迎使用 MD

这是一个只在本机工作的 Markdown 阅读器。点右上角的 **打开文件**，就可以阅读手机里的 \`.md\` 文档。

## 常用格式

- **粗体**、*斜体*、~~删除线~~ 与 [链接](https://example.com)
- [x] 支持任务清单
- [ ] 也支持未完成项目

> 简单的工具，也可以有舒服的阅读体验。

### 表格

| 功能 | 状态 |
| --- | --- |
| 完全离线 | ✓ |
| 数学公式 | ✓ |
| 代码高亮 | ✓ |

### 数学公式

行内公式：$E = mc^2$

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} \, dx = \\sqrt{\\pi}
$$

### 代码

\`\`\`javascript
const localFirst = true;
console.log('内容只留在你的设备里');
\`\`\`
`;

const icons: Record<string, string> = {
  book: '<svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5Z"/><path d="M4 6.5v13M8 8h8M8 12h6"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
  toc: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3A1.7 1.7 0 0 0 14 21v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M5 3h12l2 2v16H5Z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></svg>'
};

const app = document.querySelector<HTMLDivElement>('#app')!;
const fileInput = document.querySelector<HTMLInputElement>('#file-input')!;
let state: StoredState;
let view: 'library' | 'reader' | 'settings' = 'library';
let mode: ViewMode = 'read';
let toc: TocEntry[] = [];
let searchTerm = '';
let saveTimer = 0;
let category: 'all' | DocumentKind = 'all';
let cleanupReader: (() => void) | undefined;
let renderGeneration = 0;
let importing = false;
let ready = false;
const labels: Record<DocumentKind, string> = { md: 'MD', pdf: 'PDF', word: 'Word' };
const ReaderFiles = registerPlugin<{ drainFiles(): Promise<{ files: Array<{ name: string; base64?: string; content?: string; error?: string }> }>; addListener(name: string, callback: () => void): Promise<unknown> }>('ReaderFiles');

function currentDocument(): MarkdownDocument | undefined {
  return state.documents.find(doc => doc.id === state.currentId);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]!);
}

function applyAppearance(): void {
  document.documentElement.dataset.theme = state.settings.theme;
  document.documentElement.dataset.font = state.settings.fontStyle;
  document.documentElement.style.setProperty('--reader-size', `${state.settings.fontSize}px`);
  document.documentElement.dataset.width = state.settings.lineWidth;
  const dark = state.settings.theme === 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#111417' : state.settings.theme === 'paper' ? '#F7F5F1' : '#F7F8FA');
}

async function persist(): Promise<void> {
  applyAppearance();
  try { await saveState(state); } catch { showToast('保存失败，本机空间可能不足，请先不要关闭文档。'); }
}

function recordPosition(): void {
  if (!state) return;
  const doc = currentDocument();
  if (view === 'reader' && mode === 'read' && doc && doc.kind !== 'pdf') doc.scrollY = window.scrollY;
  try { saveMetadata(state); } catch { showToast('阅读位置未能保存，请检查本机空间。'); }
}

function render(): void {
  renderGeneration++;
  cleanupReader?.(); cleanupReader = undefined;
  applyAppearance();
  if (view === 'library') renderLibrary();
  else if (view === 'settings') renderSettings();
  else void renderReader();
}

function renderLibrary(): void {
  const docs = [...state.documents].filter(doc => category === 'all' || (doc.kind ?? 'md') === category).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  app.innerHTML = `<div class="app-shell library-shell">
    <header class="library-header"><div class="brand"><span>${icons.book}</span><div><strong>MD</strong><small>本地阅读</small></div></div><button class="icon-button" data-view="settings" aria-label="设置">${icons.settings}</button></header>
    <section class="hero"><p>你的离线文档架</p><h1>安静地读<br>每一份文档</h1><div class="hero-actions"><button class="primary-button" data-action="open-file">${icons.folder}打开文件</button><button class="secondary-button" data-action="new-doc">${icons.plus}新建 MD</button></div><small class="supported-files">PDF · Word（.docx）· MD</small></section>
    <nav class="library-tabs" aria-label="文档类型">${(['all', 'word', 'pdf', 'md'] as const).map(kind => `<button data-category="${kind}" class="${category === kind ? 'active' : ''}" aria-pressed="${category === kind}">${kind === 'all' ? '全部' : labels[kind]}<small>${state.documents.filter(doc => kind === 'all' || (doc.kind ?? 'md') === kind).length}</small></button>`).join('')}</nav>
    <div class="section-title"><h2>最近阅读</h2><span>${docs.length} 篇</span></div>
    <main class="document-list">${docs.length ? docs.map(documentCard).join('') : `<div class="empty-library"><span>${icons.folder}</span><h3>还没有${category === 'all' ? '' : labels[category]}文档</h3><p>打开手机中的 PDF、Word（.docx）或 MD 文件。</p></div>`}</main>
    <p class="local-badge"><span></span>所有内容只保存在这台设备</p>
  </div>`;
  bindCommonEvents();
  document.querySelectorAll<HTMLButtonElement>('[data-category]').forEach(button => button.addEventListener('click', () => { category = button.dataset.category as typeof category; render(); }));
}

function documentCard(doc: MarkdownDocument): string {
  const kind = doc.kind ?? 'md';
  if (kind !== 'md') {
    const template = document.createElement('template'); template.innerHTML = doc.content;
    const preview = kind === 'pdf' ? (doc.pageCount ? `第 ${doc.page ?? 1} / ${doc.pageCount} 页 · 点击继续阅读` : '保留原排版 · 左右翻页 · 支持放大') : (template.content.textContent?.slice(0, 120) || 'Word 文档 · 点击阅读');
    return `<article class="document-card" data-open-doc="${doc.id}"><div class="doc-icon file-kind-${kind}">${labels[kind]}</div><div class="doc-content"><h3>${escapeHtml(doc.name)}</h3><p>${escapeHtml(preview)}</p><small>${formatRelative(doc.updatedAt)} · ${labels[kind]} · 已保存到本机</small></div><span class="chevron">${icons.chevron}</span></article>`;
  }
  const preview = plainTextFromMarkdown(doc.content).slice(0, 120) || '空白文档';
  const headings = (doc.content.match(/^#{1,6}\s/gm) ?? []).length;
  const words = doc.content.replace(/\s/g, '').length;
  return `<article class="document-card" data-open-doc="${doc.id}"><div class="doc-icon">${icons.book}</div><div class="doc-content"><h3>${escapeHtml(doc.name)}</h3><p>${escapeHtml(preview)}</p><small>${formatRelative(doc.updatedAt)} · ${headings} 个章节 · ${words} 字</small></div><span class="chevron">${icons.chevron}</span></article>`;
}

async function renderReader(): Promise<void> {
  const doc = currentDocument();
  if (!doc) { view = 'library'; render(); return; }
  const ticket = renderGeneration;
  if (doc.kind === 'pdf') {
    app.innerHTML = `<div class="reader-shell pdf-reader-shell"><header class="reader-bar"><button class="icon-button bare" data-view="library" aria-label="返回">${icons.back}</button><div class="reader-title"><strong>${escapeHtml(doc.name)}</strong><small>PDF · 离线阅读</small></div><span></span></header><main id="pdf-root"></main><div id="toast" class="toast"></div></div>`;
    bindCommonEvents();
    const [{ mountPdf }, data] = await Promise.all([import('./pdf-reader'), loadDocumentData(doc.id)]);
    if (ticket !== renderGeneration) return;
    if (!data) { document.querySelector('#pdf-root')!.textContent = '本机文件缺失，请重新打开这份 PDF。'; return; }
    doc.data = data;
    cleanupReader = mountPdf(document.querySelector('#pdf-root')!, doc, () => { try { saveMetadata(state); } catch { /* keep reading available */ } });
    delete doc.data;
    return;
  }
  const isWord = doc.kind === 'word';
  app.innerHTML = `<div class="reader-shell ${mode === 'edit' ? 'editing' : ''}">
    <header class="reader-bar"><button class="icon-button bare" data-view="library" aria-label="返回">${icons.back}</button><div class="reader-title"><strong>${escapeHtml(doc.name)}</strong><small>${mode === 'edit' ? '正在编辑' : `${isWord ? 'Word' : 'MD'} · 离线阅读`}</small></div><div class="reader-tools"><button class="icon-button bare" data-action="search" aria-label="搜索">${icons.search}</button><button class="icon-button bare" data-action="toc" aria-label="目录">${icons.toc}</button>${isWord ? '' : `<button class="icon-button bare" data-action="toggle-mode" aria-label="${mode === 'read' ? '编辑' : '阅读'}">${mode === 'read' ? icons.edit : icons.eye}</button>`}</div></header>
    <div id="search-bar" class="search-bar ${searchTerm ? 'visible' : ''}"><span>${icons.search}</span><input id="search-input" placeholder="在文档中查找" value="${escapeHtml(searchTerm)}"><button data-action="close-search">${icons.close}</button></div>
    ${mode === 'read' ? '<main id="markdown-body" class="markdown-body"></main>' : `<main class="editor-area"><input id="doc-name" class="doc-name-input" value="${escapeHtml(doc.name)}" aria-label="文档名"><textarea id="markdown-editor" spellcheck="false" aria-label="Markdown 编辑器">${escapeHtml(doc.content)}</textarea><div class="editor-status"><span>Markdown</span><span id="char-count">${doc.content.length} 字符</span></div></main>`}
    <div id="drawer-root"></div>
    ${mode === 'read' ? '<footer class="reading-controls text-controls"><button data-text-zoom="-1" aria-label="缩小">A−</button><span data-text-size></span><button data-text-zoom="1" aria-label="放大">A＋</button><small>自动记住阅读位置</small></footer>' : ''}
    <div id="toast" class="toast"></div>
  </div>`;
  bindReaderEvents();
  if (mode === 'read') {
    const body = document.querySelector<HTMLElement>('#markdown-body')!;
    const html = isWord ? doc.content : await renderMarkdown(doc.content);
    if (ticket !== renderGeneration) return;
    body.innerHTML = html;
    body.style.fontSize = `${Math.round(state.settings.fontSize * (doc.zoom ?? 1))}px`;
    document.querySelector('[data-text-size]')!.textContent = `${Math.round((doc.zoom ?? 1) * 100)}%`;
    toc = decorateRenderedMarkdown(body);
    applySearchHighlight(body, searchTerm);
    requestAnimationFrame(() => { if (ticket === renderGeneration && !searchTerm) window.scrollTo(0, doc.scrollY ?? 0); });
  }
}

function renderSettings(): void {
  app.innerHTML = `<div class="app-shell settings-shell">
    <header class="simple-header"><button class="icon-button bare" data-view="library">${icons.back}</button><h1>阅读设置</h1><span></span></header>
    <main>
      <h2>主题</h2><section class="setting-card"><div class="theme-grid">${themeOption('paper','纸张','温暖')}${themeOption('light','明亮','清爽')}${themeOption('dark','深色','夜读')}</div></section>
      <h2>排版</h2><section class="setting-card">
        <div class="setting-row"><div><strong>正文字号</strong><small>调整 Markdown 内容的大小</small></div><div class="font-stepper"><button data-font="-1">A−</button><span>${state.settings.fontSize}</span><button data-font="1">A＋</button></div></div>
        <div class="setting-row"><div><strong>字体风格</strong><small>选择更适合你的阅读感觉</small></div><div class="mini-segment"><button data-font-style="sans" class="${state.settings.fontStyle === 'sans' ? 'active':''}">简洁</button><button data-font-style="serif" class="${state.settings.fontStyle === 'serif' ? 'active':''}">书卷</button></div></div>
        <div class="setting-row"><div><strong>页面宽度</strong><small>窄栏更适合专注阅读</small></div><div class="mini-segment"><button data-line-width="narrow" class="${state.settings.lineWidth === 'narrow' ? 'active':''}">窄栏</button><button data-line-width="wide" class="${state.settings.lineWidth === 'wide' ? 'active':''}">宽栏</button></div></div>
      </section>
      <h2>关于 MD</h2><section class="setting-card"><div class="about-row"><span>${icons.book}</span><div><strong>MD 1.2 · 离线文档阅读器</strong><small>支持 PDF 原版翻页与放大、Word（.docx）阅读、Markdown 阅读与编辑。导入后可离线查看；旧 .doc 暂不支持。Word 按手机屏幕重排，复杂版式可能不同。</small></div></div></section>
      <p class="privacy-note">无需登录、没有网络同步、没有广告。</p>
    </main>
  </div>`;
  bindCommonEvents();
  document.querySelectorAll<HTMLButtonElement>('[data-theme-option]').forEach(button => button.addEventListener('click', () => { state.settings.theme = button.dataset.themeOption as Theme; void persist(); render(); }));
  document.querySelectorAll<HTMLButtonElement>('[data-font]').forEach(button => button.addEventListener('click', () => { state.settings.fontSize = Math.min(24, Math.max(14, state.settings.fontSize + Number(button.dataset.font))); void persist(); render(); }));
  document.querySelectorAll<HTMLButtonElement>('[data-font-style]').forEach(button => button.addEventListener('click', () => { state.settings.fontStyle = button.dataset.fontStyle as FontStyle; void persist(); render(); }));
  document.querySelectorAll<HTMLButtonElement>('[data-line-width]').forEach(button => button.addEventListener('click', () => { state.settings.lineWidth = button.dataset.lineWidth as 'narrow'|'wide'; void persist(); render(); }));
}

function themeOption(value: Theme, label: string, caption: string): string {
  return `<button data-theme-option="${value}" class="theme-option ${state.settings.theme === value ? 'active':''}"><span class="theme-preview ${value}"><i></i><i></i><i></i></span><strong>${label}</strong><small>${caption}</small></button>`;
}

function bindCommonEvents(): void {
  document.querySelectorAll<HTMLElement>('[data-view]').forEach(el => el.addEventListener('click', async () => { if (mode === 'edit') await flushEditor(); recordPosition(); view = el.dataset.view as typeof view; searchTerm = ''; window.scrollTo(0, 0); render(); }));
  document.querySelector('[data-action="open-file"]')?.addEventListener('click', () => fileInput.click());
  document.querySelector('[data-action="new-doc"]')?.addEventListener('click', () => createDocument('未命名.md', '# 未命名\n\n从这里开始写。\n'));
  document.querySelectorAll<HTMLElement>('[data-open-doc]').forEach(el => el.addEventListener('click', () => openDocument(el.dataset.openDoc!)));
}

function bindReaderEvents(): void {
  bindCommonEvents();
  document.querySelectorAll<HTMLButtonElement>('[data-text-zoom]').forEach(button => button.addEventListener('click', () => {
    const doc = currentDocument(); if (!doc) return;
    doc.zoom = Math.min(2.5, Math.max(.75, (doc.zoom ?? 1) + Number(button.dataset.textZoom) * .25));
    document.querySelector<HTMLElement>('#markdown-body')!.style.fontSize = `${Math.round(state.settings.fontSize * doc.zoom)}px`;
    document.querySelector('[data-text-size]')!.textContent = `${Math.round(doc.zoom * 100)}%`; recordPosition();
  }));
  document.querySelector('[data-action="toggle-mode"]')?.addEventListener('click', async () => { if (mode === 'edit') await flushEditor(); else recordPosition(); mode = mode === 'read' ? 'edit' : 'read'; render(); });
  document.querySelector('[data-action="search"]')?.addEventListener('click', () => { document.querySelector('#search-bar')?.classList.add('visible'); document.querySelector<HTMLInputElement>('#search-input')?.focus(); });
  document.querySelector('[data-action="close-search"]')?.addEventListener('click', () => { searchTerm = ''; render(); });
  document.querySelector<HTMLInputElement>('#search-input')?.addEventListener('input', event => { searchTerm = (event.target as HTMLInputElement).value; const body = document.querySelector<HTMLElement>('#markdown-body'); if (body) void rerenderSearch(body); });
  document.querySelector('[data-action="toc"]')?.addEventListener('click', openToc);
  const editor = document.querySelector<HTMLTextAreaElement>('#markdown-editor');
  editor?.addEventListener('input', () => { document.querySelector('#char-count')!.textContent = `${editor.value.length} 字符`; window.clearTimeout(saveTimer); saveTimer = window.setTimeout(flushEditor, 450); });
  editor?.addEventListener('keydown', handleEditorKeys);
  document.querySelector<HTMLInputElement>('#doc-name')?.addEventListener('input', () => { window.clearTimeout(saveTimer); saveTimer = window.setTimeout(flushEditor, 450); });
}

async function rerenderSearch(body: HTMLElement): Promise<void> {
  const doc = currentDocument();
  if (!doc) return;
  const ticket = renderGeneration;
  const html = doc.kind === 'word' ? doc.content : await renderMarkdown(doc.content);
  if (ticket !== renderGeneration || !body.isConnected) return;
  body.innerHTML = html;
  toc = decorateRenderedMarkdown(body);
  applySearchHighlight(body, searchTerm);
}

function applySearchHighlight(container: HTMLElement, term: string): void {
  if (!term.trim()) return;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.parentElement && !node.parentElement.closest('pre,code,style,script') && node.data.toLocaleLowerCase().includes(term.toLocaleLowerCase())) nodes.push(node);
  }
  nodes.forEach(node => {
    const fragment = document.createDocumentFragment();
    const expression = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
    let last = 0;
    node.data.replace(expression, (match, offset: number) => {
      fragment.append(node.data.slice(last, offset));
      const mark = document.createElement('mark'); mark.textContent = match; fragment.append(mark); last = offset + match.length; return match;
    });
    fragment.append(node.data.slice(last));
    node.replaceWith(fragment);
  });
  container.querySelector('mark')?.scrollIntoView({ block:'center', behavior:'smooth' });
}

function openToc(): void {
  const root = document.querySelector<HTMLDivElement>('#drawer-root')!;
  root.innerHTML = `<div class="drawer-backdrop" data-close-drawer></div><aside class="toc-drawer"><header><div><small>文档导航</small><h2>目录</h2></div><button class="icon-button bare" data-close-drawer>${icons.close}</button></header><nav>${toc.length ? toc.map(entry => `<button data-heading="${entry.id}" style="--level:${entry.level}">${escapeHtml(entry.text)}</button>`).join('') : '<p>这篇文档还没有标题。</p>'}</nav></aside>`;
  document.querySelectorAll('[data-close-drawer]').forEach(el => el.addEventListener('click', () => root.innerHTML = ''));
  document.querySelectorAll<HTMLButtonElement>('[data-heading]').forEach(button => button.addEventListener('click', () => { document.getElementById(button.dataset.heading!)?.scrollIntoView({ behavior:'smooth', block:'start' }); root.innerHTML=''; }));
}

function handleEditorKeys(event: KeyboardEvent): void {
  const editor = event.currentTarget as HTMLTextAreaElement;
  if (event.key === 'Tab') {
    event.preventDefault();
    const start = editor.selectionStart;
    editor.setRangeText('  ', start, editor.selectionEnd, 'end');
    editor.dispatchEvent(new Event('input'));
  }
}

async function flushEditor(): Promise<void> {
  const doc = currentDocument();
  const editor = document.querySelector<HTMLTextAreaElement>('#markdown-editor');
  const name = document.querySelector<HTMLInputElement>('#doc-name');
  if (!doc || !editor || !name) return;
  doc.content = editor.value;
  doc.name = name.value.trim() || '未命名.md';
  doc.updatedAt = new Date().toISOString();
  await persist();
}

function createDocument(name: string, content: string): void {
  const now = new Date().toISOString();
  const existing = state.documents.find(doc => (doc.kind ?? 'md') === 'md' && doc.name === normalizeName(name) && doc.content === content);
  if (existing) { openDocument(existing.id); return; }
  if (mode === 'edit') flushEditor(); recordPosition();
  const doc: MarkdownDocument = { id: crypto.randomUUID(), kind: 'md', name: normalizeName(name), content, createdAt: now, updatedAt: now };
  state.documents = [doc, ...state.documents];
  state.currentId = doc.id;
  view = 'reader'; mode = 'read';
  void persist(); render();
}

function openDocument(id: string): void {
  const doc = state.documents.find(item => item.id === id);
  if (!doc) return;
  if (mode === 'edit') flushEditor(); recordPosition();
  state.currentId = id; doc.updatedAt = new Date().toISOString();
  view = 'reader'; mode = 'read';
  void persist(); render();
}

function normalizeName(name: string): string {
  const trimmed = name.trim() || '未命名.md';
  return /\.(md|markdown|mdown|mkd)$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
}

function formatRelative(iso: string): string {
  const difference = Date.now() - new Date(iso).getTime();
  if (difference < 60_000) return '刚刚';
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)} 分钟前`;
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)} 小时前`;
  if (difference < 604_800_000) return `${Math.floor(difference / 86_400_000)} 天前`;
  return new Intl.DateTimeFormat('zh-CN', { month:'short', day:'numeric' }).format(new Date(iso));
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try { if (file.size > MAX_FILE_BYTES) throw new Error('文件超过 80 MB，请选择较小的文件。'); await importFile(file.name, await file.arrayBuffer()); }
  catch (error) { showToast((error as Error).message || '这个文件暂时无法读取'); }
  fileInput.value = '';
});

async function importFile(name: string, data: ArrayBuffer): Promise<void> {
  if (importing) { showToast('上一份文档正在导入，请稍候。'); return; }
  importing = true;
  try {
    showToast('正在保存到本机…');
    const result = await readDocument(name, data);
    if (result.kind === 'md') { createDocument(name, result.content); return; }
    const hash = await crypto.subtle.digest('SHA-256', data);
    const fingerprint = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    const existing = state.documents.find(doc => doc.name === name && doc.fingerprint === fingerprint);
    if (existing) { openDocument(existing.id); return; }
    if (mode === 'edit') flushEditor(); recordPosition();
    const now = new Date().toISOString();
    const doc: MarkdownDocument = { id: crypto.randomUUID(), name, ...result, data, fingerprint, createdAt: now, updatedAt: now, page: 1, zoom: 1, scrollY: 0 };
    state.documents.unshift(doc);
    try { await saveState(state); } catch { state.documents = state.documents.filter(item => item.id !== doc.id); throw new Error('导入失败，本机存储空间可能不足。'); }
    delete doc.data;
    openDocument(doc.id);
    void navigator.storage?.persist?.();
  } finally { importing = false; }
}

async function drainNativeFiles(): Promise<void> {
  if (!ready || !Capacitor.isNativePlatform()) return;
  const { files } = await ReaderFiles.drainFiles();
  for (const file of files) {
    try {
      if (file.error) throw new Error(file.error);
      if (file.content != null) createDocument(file.name, file.content);
      else if (file.base64) {
        const binary = atob(file.base64); const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        await importFile(file.name, bytes.buffer);
      }
    } catch (error) { showToast((error as Error).message); }
  }
}
window.addEventListener('scroll', () => { if (ready) recordPosition(); }, { passive: true });
window.addEventListener('pagehide', () => { if (ready) { flushEditor(); recordPosition(); } });
document.addEventListener('visibilitychange', () => { if (ready && document.visibilityState === 'hidden') { flushEditor(); recordPosition(); } });

window.addEventListener('markdown-file-opened', event => {
  const detail = (event as CustomEvent<{ name?: string; content?: string }>).detail;
  if (detail?.content != null) createDocument(detail.name || '打开的文档.md', detail.content);
});

function showToast(message: string): void {
  let toast = document.querySelector<HTMLDivElement>('#toast');
  if (!toast) { toast = document.createElement('div'); toast.id='toast'; toast.className='toast'; document.body.append(toast); }
  toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast?.classList.remove('show'), 2200);
}

async function initialize(): Promise<void> {
  state = await loadState();
  if (!state.documents.length) {
    const now = new Date().toISOString();
    const welcome: MarkdownDocument = { id: crypto.randomUUID(), name:'欢迎使用 MD.md', content:SAMPLE, createdAt:now, updatedAt:now };
    state.documents = [welcome]; state.currentId = welcome.id; await persist();
  }
  render();
  ready = true;
  if (Capacitor.isNativePlatform()) {
    await ReaderFiles.addListener('fileReady', () => { void drainNativeFiles(); });
    await drainNativeFiles();
  }
}

void initialize().catch(() => { app.innerHTML = '<div class="app-shell"><h1>本机存储暂时不可用</h1><p>请检查设备空间后重新打开。已有文件不会被自动清除。</p></div>'; });
