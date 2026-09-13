import DOMPurify from 'dompurify';
import type { DocumentKind } from './types';

export const MAX_FILE_BYTES = 80 * 1024 * 1024;
export function documentKind(name: string): DocumentKind {
  if (/\.pdf$/i.test(name)) return 'pdf';
  if (/\.docx$/i.test(name)) return 'word';
  if (/\.(md|markdown|mdown|mkd|txt)$/i.test(name)) return 'md';
  if (/\.doc$/i.test(name)) throw new Error('旧版 .doc 暂不支持，请先另存为 .docx 或 PDF 后打开。');
  throw new Error('请选择 MD、PDF 或 Word（.docx）文件。');
}

export async function readDocument(name: string, data: ArrayBuffer): Promise<{ kind: DocumentKind; content: string }> {
  if (data.byteLength > MAX_FILE_BYTES) throw new Error('文件超过 80 MB，请选择较小的文件。');
  const kind = documentKind(name);
  if (kind === 'md') return { kind, content: new TextDecoder().decode(data).replace(/^\uFEFF/, '') };
  if (kind === 'pdf') {
    if (!new TextDecoder().decode(data.slice(0, 1024)).includes('%PDF-')) throw new Error('这个文件不是有效的 PDF。');
    return { kind, content: '' };
  }
  const mammoth = await import('mammoth/mammoth.browser');
  const result = await mammoth.convertToHtml({ arrayBuffer: data }, { externalFileAccess: false });
  const content = DOMPurify.sanitize(result.value, { FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'] });
  const template = document.createElement('template');
  template.innerHTML = content;
  template.content.querySelectorAll('img').forEach(img => {
    if (!/^data:image\//i.test(img.getAttribute('src') ?? '')) { img.removeAttribute('src'); img.alt = '外部图片（离线不加载）'; }
  });
  return { kind, content: template.innerHTML };
}
