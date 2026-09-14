import type { DocumentKind, MarkdownDocument } from './types';

const labels: Record<DocumentKind, string> = { md: 'MD', pdf: 'PDF', word: 'Word' };
function escape(value: string): string {
  return value.replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]!);
}
function title(doc: MarkdownDocument): string {
  return doc.name.replace(/\.(pdf|docx|md|markdown|mdown|mkd|txt)$/i, '') || doc.name;
}
function position(doc: MarkdownDocument): string {
  return doc.kind === 'pdf' && doc.pageCount ? `第 ${doc.page ?? 1} / ${doc.pageCount} 页`
    : (doc.scrollY ?? 0) > 0 ? '已记住阅读位置' : '从开头阅读';
}
function cover(kind: DocumentKind): string {
  const symbol = kind === 'word' ? 'W' : kind === 'md' ? '#' : 'PDF';
  return `<div class="document-cover cover-${kind}" aria-hidden="true"><span class="cover-tag">${kind === 'md' ? 'MARKDOWN' : labels[kind].toUpperCase()}</span><span class="cover-symbol">${symbol}</span><span class="cover-lines"><i></i><i></i><i></i></span><span class="cover-caption">${kind === 'pdf' ? '原版阅读' : kind === 'word' ? '随屏阅读' : '阅读 · 编辑'}</span><span class="cover-bookmark"></span></div>`;
}

export function libraryView(
  docs: MarkdownDocument[], allDocs: MarkdownDocument[], category: 'all' | DocumentKind,
  recent: MarkdownDocument | undefined, icons: Record<string, string>, relative: (date: string) => string
): string {
  const mark = '<svg viewBox="0 0 28 28"><path d="M6 4h11l5 5v15H6Z"/><path d="M17 4v6h5M10 14h8M10 18h5"/><path class="mark-accent" d="M17 4v6h5"/></svg>';
  return `<div class="app-shell library-shell">
    <header class="library-header"><div class="brand"><span>${mark}</span><strong>轻阅</strong><small>离线文档</small></div><button class="icon-button" data-view="settings" aria-label="设置">${icons.settings}</button></header>
    <section class="desk-intro"><div><p class="eyebrow">阅读，从这里继续</p><h1>我的书桌<span>。</span></h1></div><div class="desk-count"><strong>${String(allDocs.length).padStart(2, '0')}</strong><small>份本地文档</small></div></section>
    <div class="desk-actions"><button class="import-button" data-action="open-file">${icons.plus}<span>打开文件</span><span class="action-arrow" aria-hidden="true">↗</span></button><button class="new-note-button" data-action="new-doc">新建 MD<span aria-hidden="true">＋</span></button></div>
    ${recent ? `<button class="resume-reading" data-resume-doc="${recent.id}" aria-label="继续阅读 ${escape(recent.name)}"><div class="resume-content"><small><i></i>继续阅读</small><strong>${escape(title(recent))}</strong><span>${labels[recent.kind ?? 'md']}<i>·</i>${position(recent)}</span></div><span class="resume-arrow" aria-hidden="true">${icons.chevron}</span></button>` : ''}
    <nav class="library-tabs" aria-label="文档类型">${(['all','word','pdf','md'] as const).map(kind => `<button data-category="${kind}" class="${category === kind ? 'active' : ''}" aria-pressed="${category === kind}">${kind === 'all' ? '全部' : labels[kind]}<small>${allDocs.filter(doc => kind === 'all' || (doc.kind ?? 'md') === kind).length}</small></button>`).join('')}</nav>
    <div class="section-title"><h2>${category === 'all' ? '最近打开' : `${labels[category]} 文档`}</h2><span>保存在本机</span></div>
    <main class="document-list">${docs.length ? docs.map(doc => {
      const kind = doc.kind ?? 'md';
      return `<button class="document-card" data-open-doc="${doc.id}" aria-label="打开 ${escape(doc.name)}">${cover(kind)}<h3>${escape(title(doc))}</h3><p>${labels[kind]}<i>·</i>${relative(doc.updatedAt)}</p>${kind === 'pdf' && doc.pageCount ? `<small class="document-position">${position(doc)}</small>` : ''}</button>`;
    }).join('') : `<div class="empty-library"><span>${icons.folder}</span><h3>给书桌放一份${category === 'all' ? '' : labels[category]}文档</h3><p>打开手机里的 PDF、Word 或 MD，<br>下次就从这里接着读。</p><button class="empty-open" data-action="open-file">打开文件 ${icons.plus}</button></div>`}</main>
    <footer class="library-footer"><span class="footer-line"></span><span>只在你的设备里，安静阅读。</span><span class="footer-line"></span></footer>
    <div id="toast" class="toast"></div>
  </div>`;
}
