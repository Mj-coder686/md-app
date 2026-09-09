import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import sql from 'highlight.js/lib/languages/sql';
import { marked } from 'marked';
import markedKatex from 'marked-katex-extension';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('java', java);
hljs.registerLanguage('sql', sql);

marked.use(markedKatex({ throwOnError: false, nonStandard: true }));
marked.setOptions({ gfm: true, breaks: false });

export interface TocEntry {
  id: string;
  text: string;
  level: number;
}

export async function renderMarkdown(source: string): Promise<string> {
  const raw = await marked.parse(source);
  return DOMPurify.sanitize(raw, {
    ADD_TAGS: ['math', 'semantics', 'annotation', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'msubsup', 'mfrac', 'mtext', 'mspace', 'mstyle'],
    ADD_ATTR: ['xmlns', 'encoding', 'aria-hidden']
  });
}

export function decorateRenderedMarkdown(container: HTMLElement): TocEntry[] {
  const used = new Map<string, number>();
  const entries: TocEntry[] = [];
  container.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6').forEach((heading, index) => {
    const base = slugify(heading.textContent || `section-${index + 1}`);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    heading.id = count ? `${base}-${count + 1}` : base;
    entries.push({ id: heading.id, text: heading.textContent ?? '', level: Number(heading.tagName.slice(1)) });
  });
  container.querySelectorAll<HTMLElement>('pre code').forEach(block => {
    try { hljs.highlightElement(block); } catch { /* keep plain code */ }
  });
  container.querySelectorAll<HTMLAnchorElement>('a').forEach(link => {
    if (/^https?:/i.test(link.href)) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
  });
  return entries;
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^\p{Letter}\p{Number}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-') || 'section';
}

export function plainTextFromMarkdown(source: string): string {
  return source
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[#>*_~|\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
