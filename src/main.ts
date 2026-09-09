import './style.css';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark-dimmed.css';
import type { FontStyle, MarkdownDocument, StoredState, Theme, ViewMode } from './types';
import { loadState, saveState } from './store';
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
  await saveState(state);
}

function render(): void {
  applyAppearance();
  if (view === 'library') renderLibrary();
  else if (view === 'settings') renderSettings();
  else void renderReader();
}

function renderLibrary(): void {
  const docs = [...state.documents].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  app.innerHTML = `<div class="app-shell library-shell">
    <header class="library-header"><div class="brand"><span>${icons.book}</span><div><strong>MD</strong><small>本地阅读</small></div></div><button class="icon-button" data-view="settings" aria-label="设置">${icons.settings}</button></header>
    <section class="hero"><p>你的离线文档架</p><h1>安静地读<br>每一份 Markdown</h1><div class="hero-actions"><button class="primary-button" data-action="open-file">${icons.folder}打开文件</button><button class="secondary-button" data-action="new-doc">${icons.plus}新建</button></div></section>
    <div class="section-title"><h2>最近阅读</h2><span>${docs.length} 篇</span></div>
    <main class="document-list">${docs.length ? docs.map(documentCard).join('') : `<div class="empty-library"><span>${icons.folder}</span><h3>还没有本地文档</h3><p>打开手机中的 .md 文件，或从这里新建一篇。</p></div>`}</main>
    <p class="local-badge"><span></span>所有内容只保存在这台设备</p>
  </div>`;
  bindCommonEvents();
}

function documentCard(doc: MarkdownDocument): string {
  const preview = plainTextFromMarkdown(doc.content).slice(0, 120) || '空白文档';
  const headings = (doc.content.match(/^#{1,6}\s/gm) ?? []).length;
  const words = doc.content.replace(/\s/g, '').length;
  return `<article class="document-card" data-open-doc="${doc.id}"><div class="doc-icon">${icons.book}</div><div class="doc-content"><h3>${escapeHtml(doc.name)}</h3><p>${escapeHtml(preview)}</p><small>${formatRelative(doc.updatedAt)} · ${headings} 个章节 · ${words} 字</small></div><span class="chevron">${icons.chevron}</span></article>`;
}

async function renderReader(): Promise<void> {
  const doc = currentDocument();
  if (!doc) { view = 'library'; render(); return; }
  app.innerHTML = `<div class="reader-shell ${mode === 'edit' ? 'editing' : ''}">
    <header class="reader-bar"><button class="icon-button bare" data-view="library" aria-label="返回">${icons.back}</button><div class="reader-title"><strong>${escapeHtml(doc.name)}</strong><small>${mode === 'edit' ? '正在编辑' : '本地文档'}</small></div><div class="reader-tools"><button class="icon-button bare" data-action="search" aria-label="搜索">${icons.search}</button><button class="icon-button bare" data-action="toc" aria-label="目录">${icons.toc}</button><button class="icon-button bare" data-action="toggle-mode" aria-label="${mode === 'read' ? '编辑' : '阅读'}">${mode === 'read' ? icons.edit : icons.eye}</button></div></header>
    <div id="search-bar" class="search-bar ${searchTerm ? 'visible' : ''}"><span>${icons.search}</span><input id="search-input" placeholder="在文档中查找" value="${escapeHtml(searchTerm)}"><button data-action="close-search">${icons.close}</button></div>
    ${mode === 'read' ? '<main id="markdown-body" class="markdown-body"></main>' : `<main class="editor-area"><input id="doc-name" class="doc-name-input" value="${escapeHtml(doc.name)}" aria-label="文档名"><textarea id="markdown-editor" spellcheck="false" aria-label="Markdown 编辑器">${escapeHtml(doc.content)}</textarea><div class="editor-status"><span>Markdown</span><span id="char-count">${doc.content.length} 字符</span></div></main>`}
    <div id="drawer-root"></div>
    <div id="toast" class="toast"></div>
  </div>`;
  bindReaderEvents();
  if (mode === 'read') {
    const body = document.querySelector<HTMLElement>('#markdown-body')!;
    body.innerHTML = await renderMarkdown(doc.content);
    toc = decorateRenderedMarkdown(body);
    applySearchHighlight(body, searchTerm);
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
      <h2>关于 MD</h2><section class="setting-card"><div class="about-row"><span>${icons.book}</span><div><strong>离线 Markdown 阅读器</strong><small>支持 GFM、表格、任务清单、代码高亮和 KaTeX 数学公式。HTML 会经过安全过滤。</small></div></div></section>
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
  document.querySelectorAll<HTMLElement>('[data-view]').forEach(el => el.addEventListener('click', () => { view = el.dataset.view as typeof view; searchTerm = ''; render(); }));
  document.querySelector('[data-action="open-file"]')?.addEventListener('click', () => fileInput.click());
  document.querySelector('[data-action="new-doc"]')?.addEventListener('click', () => createDocument('未命名.md', '# 未命名\n\n从这里开始写。\n'));
  document.querySelectorAll<HTMLElement>('[data-open-doc]').forEach(el => el.addEventListener('click', () => openDocument(el.dataset.openDoc!)));
}

function bindReaderEvents(): void {
  bindCommonEvents();
  document.querySelector('[data-action="toggle-mode"]')?.addEventListener('click', () => { if (mode === 'edit') flushEditor(); mode = mode === 'read' ? 'edit' : 'read'; render(); });
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
  body.innerHTML = await renderMarkdown(doc.content);
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

function flushEditor(): void {
  const doc = currentDocument();
  const editor = document.querySelector<HTMLTextAreaElement>('#markdown-editor');
  const name = document.querySelector<HTMLInputElement>('#doc-name');
  if (!doc || !editor || !name) return;
  doc.content = editor.value;
  doc.name = name.value.trim() || '未命名.md';
  doc.updatedAt = new Date().toISOString();
  void persist();
}

function createDocument(name: string, content: string): void {
  const now = new Date().toISOString();
  const doc: MarkdownDocument = { id: crypto.randomUUID(), name: normalizeName(name), content, createdAt: now, updatedAt: now };
  state.documents = [doc, ...state.documents.filter(existing => !(existing.name === doc.name && existing.content === doc.content))].slice(0, 40);
  state.currentId = doc.id;
  view = 'reader'; mode = 'read';
  void persist(); render();
}

function openDocument(id: string): void {
  const doc = state.documents.find(item => item.id === id);
  if (!doc) return;
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
  try { createDocument(file.name, await file.text()); }
  catch { showToast('这个文件暂时无法读取'); }
  fileInput.value = '';
});

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
}

void initialize();
