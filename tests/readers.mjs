import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright-core';
import JSZip from 'jszip';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(process.env.READER_DIST || resolve(project, 'dist'));
const screenshots = resolve(process.env.READER_SCREENSHOTS || resolve(project, 'work/screenshots'));
await mkdir(screenshots, { recursive: true });
const executablePath = process.env.CHROME_PATH || [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].find(existsSync);
if (!executablePath) throw new Error('Set CHROME_PATH to a Chrome/Chromium executable.');

function pdfFixture() {
  const objects = [null, '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>'];
  for (let n = 0; n < 3; n++) {
    const stream = `BT /F1 24 Tf 40 700 Td (Offline PDF - page ${n + 1}) Tj ET\n0.${n + 2} 0.6 0.5 rg 40 350 300 250 re f\n`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 800] /Resources << /Font << /F1 9 0 R >> >> /Contents ${4 + n * 2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let output = '%PDF-1.4\n'; const offsets = [0];
  for (let n = 1; n < objects.length; n++) { offsets.push(Buffer.byteLength(output)); output += `${n} 0 obj\n${objects[n]}\nendobj\n`; }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}
async function wordFixture() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/styles.xml', '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>');
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/picture.png"/></Relationships>');
  zip.file('word/media/picture.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8e8AAAAASUVORK5CYII=', 'base64'));
  const paragraphs = Array.from({ length: 45 }, (_, n) => `<w:p><w:r><w:t>第 ${n + 1} 段：离线阅读测试。手机上可以调整字号，关闭后接着阅读。</w:t></w:r></w:p>`).join('');
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>手机上的 Word 阅读</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>功能</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>离线</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>${paragraphs}<w:sectPr/></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-CN' });
  context.setDefaultTimeout(15000);
  if (process.env.READER_OLDER_WEBVIEW === '1') {
    await context.addInitScript(() => {
      delete Map.prototype.getOrInsertComputed;
      delete WeakMap.prototype.getOrInsertComputed;
      delete Promise.try;
      delete Uint8Array.prototype.toHex;
    });
  }
  const errors = [], external = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  // Serve packaged assets from disk. Offline mode rejects any real network access.
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') { external.push(url.href); await route.abort(); return; }
    const path = decodeURIComponent(url.pathname);
    if (path === '/setup') { await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Setup</title>' }); return; }
    const file = resolve(dist, `.${path === '/' ? '/index.html' : path}`);
    if (!file.startsWith(dist + sep)) throw new Error('Invalid asset path');
    if (path === '/favicon.ico') { await route.fulfill({ status: 204 }); return; }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
    try {
      let body = await readFile(file);
      if (process.env.READER_OLDER_WEBVIEW === '1' && path.includes('pdf.worker')) {
        body = Buffer.concat([Buffer.from('delete Map.prototype.getOrInsertComputed; delete WeakMap.prototype.getOrInsertComputed; delete Promise.try; delete Uint8Array.prototype.toHex;\n'), body]);
      }
      await route.fulfill({ body, contentType: types[extname(file)] || 'application/octet-stream' });
    }
    catch { errors.push(`Missing packaged asset ${path}`); await route.fulfill({ status: 404 }); }
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:49321/setup');
  const legacyContent = '# 原来的 MD\n\n| 功能 | 状态 |\n| --- | --- |\n| 保留文档 | 正常 |\n\n数学公式：$E=mc^2$\n\n```javascript\nconsole.log("offline");\n```\n\n' + '旧文档继续阅读。\n\n'.repeat(100);
  await page.evaluate(async content => {
    const doc = { id: 'legacy-md', name: '原来的文档.md', content, createdAt: '2026-09-05T00:00:00Z', updatedAt: '2026-09-05T00:00:00Z' };
    localStorage.setItem('md-reader-state-v1', JSON.stringify({ documents: [{ ...doc, content: undefined }], currentId: doc.id, settings: { theme: 'paper', fontSize: null, fontStyle: 'sans', lineWidth: 'narrow' } }));
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('md-reader-documents', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('documents', { keyPath: 'id' });
      request.onsuccess = () => { const db = request.result; const tx = db.transaction('documents', 'readwrite'); tx.objectStore('documents').put(doc); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
    });
  }, legacyContent);
  await context.setOffline(true);
  await page.goto('http://127.0.0.1:49321/');
  console.log('Checking legacy MD…');
  await page.click('[data-open-doc="legacy-md"]');
  await page.waitForSelector('#markdown-body .katex');
  assert.equal(await page.locator('#markdown-body table').count(), 1);
  assert.equal(await page.locator('#markdown-body pre code.hljs').count(), 1);
  await page.click('[data-text-zoom="1"]');
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('md-reader-state-v1')).documents.find(doc => doc.id === 'legacy-md').scrollY > 1000);
  await page.click('[data-view="library"]');
  await page.reload(); await page.click('[data-open-doc="legacy-md"]');
  console.log('Checking saved MD position…');
  await page.waitForFunction(() => window.scrollY > 1000);
  assert.equal(await page.locator('[data-text-size]').textContent(), '125%');
  await page.click('[data-action="toggle-mode"]');
  await page.fill('#markdown-editor', legacyContent + '\n保留 MD 编辑功能。');
  await page.click('[data-view="library"]');
  await page.waitForSelector('.document-list');
  await page.reload(); await page.click('[data-open-doc="legacy-md"]');
  await page.waitForFunction(() => document.querySelector('#markdown-body')?.textContent.includes('保留 MD 编辑功能。'));
  await page.click('[data-view="library"]');

  const pdf = { name: '离线电子书.pdf', mimeType: 'application/pdf', buffer: pdfFixture() };
  console.log('Checking PDF…');
  await page.setInputFiles('#file-input', pdf);
  await page.waitForFunction(() => document.querySelector('.pdf-message')?.hidden && document.querySelector('[data-pdf-count]')?.textContent === '/ 3').catch(async error => {
    console.error('PDF compatibility failure:', await page.locator('.pdf-message').textContent(), 'pages:', await page.locator('[data-pdf-count]').textContent());
    throw error;
  });
  assert.ok(await page.locator('.pdf-sheet canvas').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 220 && pixels[i + 3] > 0) return true;
    return false;
  }), 'PDF must contain rendered pixels, not just a page count');
  await page.evaluate(() => { window.firstPdfCanvas = document.querySelector('.pdf-sheet canvas'); });
  await page.click('[data-pdf-next]');
  await page.waitForFunction(() => document.querySelector('[data-pdf-page]')?.value === '2' && document.querySelector('.pdf-message')?.hidden);
  await page.click('[data-pdf-prev]');
  await page.waitForFunction(() => document.querySelector('[data-pdf-page]')?.value === '1' && document.querySelector('.pdf-sheet canvas') === window.firstPdfCanvas);
  await page.evaluate(() => {
    document.querySelector('[data-pdf-next]').click();
    document.querySelector('[data-pdf-next]').click();
    document.querySelector('[data-pdf-prev]').click();
  });
  await page.waitForFunction(() => document.querySelector('[data-pdf-page]')?.value === '2' && document.querySelector('.pdf-message')?.hidden);
  await page.click('[data-pdf-zoom="1"]');
  await page.waitForFunction(() => document.querySelector('[data-pdf-fit]')?.textContent === '125%' && document.querySelector('.pdf-message')?.hidden);
  await page.evaluate(() => { document.querySelector('.pdf-stage').scrollTop = 100; });
  await page.waitForTimeout(100);
  const savedPdfScroll = await page.locator('.pdf-stage').evaluate(el => el.scrollTop);
  await page.waitForTimeout(2300);
  await page.screenshot({ path: resolve(screenshots, 'PDF-阅读.png') });
  await page.click('[data-view="library"]');
  await page.reload(); await page.click('[data-category="pdf"]'); await page.click('[data-open-doc]');
  await page.waitForFunction(() => document.querySelector('[data-pdf-page]')?.value === '2' && document.querySelector('.pdf-message')?.hidden);
  assert.equal(await page.locator('[data-pdf-fit]').textContent(), '125%');
  assert.ok(Math.abs(await page.locator('.pdf-stage').evaluate(el => el.scrollTop) - savedPdfScroll) <= 1,
    JSON.stringify(await page.evaluate(() => ({ top: document.querySelector('.pdf-stage').scrollTop, height: document.querySelector('.pdf-stage').scrollHeight, saved: JSON.parse(localStorage.getItem('md-reader-state-v1')).documents.find(doc => doc.kind === 'pdf') }))));
  await page.click('[data-pdf-fit]');
  await page.waitForFunction(() => document.querySelector('.pdf-message')?.hidden && document.querySelector('[data-pdf-fit]')?.textContent === '100%');
  await page.evaluate(() => {
    const stage = document.querySelector('.pdf-stage');
    const touch = (x, y) => new Touch({ identifier: 1, target: stage, clientX: x, clientY: y });
    stage.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(300, 300)] }));
    stage.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch(90, 305)] }));
  });
  await page.waitForFunction(() => document.querySelector('[data-pdf-page]')?.value === '3' && document.querySelector('.pdf-message')?.hidden);
  await page.evaluate(() => {
    const stage = document.querySelector('.pdf-stage');
    const touch = (id, x) => new Touch({ identifier: id, target: stage, clientX: x, clientY: 300 });
    stage.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(1, 100), touch(2, 200)] }));
    stage.dispatchEvent(new TouchEvent('touchmove', { cancelable: true, touches: [touch(1, 50), touch(2, 250)] }));
    if (document.querySelector('[data-pdf-fit]').textContent !== '200%' || !document.querySelector('.pdf-sheet').style.transform.includes('scale(2)')) throw new Error('PDF must zoom during the gesture');
    stage.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch(1, 50), touch(2, 250)] }));
  });
  await page.waitForFunction(() => document.querySelector('[data-pdf-fit]')?.textContent === '200%' && document.querySelector('.pdf-message')?.hidden);
  await page.click('[data-view="library"]');
  await page.setInputFiles('#file-input', pdf);
  await page.waitForSelector('.pdf-stage'); await page.click('[data-view="library"]');
  assert.equal(await page.locator('[data-category="pdf"] small').textContent(), '1');

  const word = { name: '手机阅读.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await wordFixture() };
  console.log('Checking Word…');
  await page.setInputFiles('#file-input', word);
  await page.waitForSelector('#markdown-body h1');
  assert.equal(await page.locator('#markdown-body h1').textContent(), '手机上的 Word 阅读');
  assert.equal(await page.locator('#markdown-body table').count(), 1);
  assert.equal(await page.locator('[data-action="toggle-mode"]').count(), 0);
  assert.equal(await page.locator('#markdown-body img[src^="data:image/"]').count(), 1);
  await page.click('[data-text-zoom="1"]');
  const pinchWord = async factor => page.evaluate(factor => {
    const body = document.querySelector('#markdown-body');
    const touch = (id, x) => new Touch({ identifier: id, target: body, clientX: x, clientY: 300 });
    body.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(1, 145), touch(2, 245)] }));
    body.dispatchEvent(new TouchEvent('touchmove', { cancelable: true, touches: [touch(1, 195 - 50 * factor), touch(2, 195 + 50 * factor)] }));
    const scale = Number(body.style.zoom);
    body.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch(1, 145), touch(2, 245)] }));
    return scale;
  }, factor);
  const beforeImage = await page.locator('#markdown-body img').evaluate(image => image.getBoundingClientRect().width);
  assert.equal(await pinchWord(2), 2.5);
  assert.equal(await page.locator('[data-text-size]').textContent(), '250%');
  assert.ok(await page.locator('#markdown-body img').evaluate(image => image.getBoundingClientRect().width) > beforeImage * 1.9, 'Pinch must enlarge images as well as text');
  assert.equal(await pinchWord(.5), 1.25);
  assert.equal(await page.evaluate(() => visualViewport.scale), 1, 'Pinching content must not enlarge the toolbar');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390), 'Zooming Word must keep the phone viewport width');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(2300);
  await page.screenshot({ path: resolve(screenshots, 'Word-阅读.png') });
  await page.evaluate(() => window.scrollTo(0, 1000));
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('md-reader-state-v1')).documents.find(doc => doc.kind === 'word').scrollY > 900);
  await page.click('[data-view="library"]');
  await page.reload(); await page.click('[data-category="word"]'); await page.click('[data-open-doc]');
  await page.waitForFunction(() => window.scrollY > 900);
  assert.equal(await page.locator('[data-text-size]').textContent(), '125%');
  await page.click('[data-action="search"]'); await page.fill('#search-input', '离线阅读测试');
  await page.waitForSelector('#markdown-body mark');
  await page.click('[data-view="library"]');
  await page.click('[data-category="all"]');
  assert.equal(await page.locator('.document-card').count(), 3);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390), 'Library must fit a phone screen');
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('md-reader-documents', 2);
      open.onsuccess = () => {
        const db = open.result; const tx = db.transaction(['documents', 'files'], 'readonly');
        const docs = tx.objectStore('documents').getAll(); const files = tx.objectStore('files').getAllKeys();
        tx.oncomplete = () => { db.close(); if (docs.result.some(doc => doc.data) || files.result.length !== 2) reject(new Error('PDF binaries must be stored separately for lazy loading')); else resolve(); };
      };
    });
  });
  await page.screenshot({ path: resolve(screenshots, '文档架.png'), fullPage: true });

  await page.setInputFiles('#file-input', { name: '损坏.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') });
  await page.waitForFunction(() => document.querySelector('.toast.show')?.textContent.includes('不是有效的 PDF'));
  assert.equal(await page.locator('.document-card').count(), 3);
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    window.restoreTransactions = () => IDBDatabase.prototype.transaction = original;
    IDBDatabase.prototype.transaction = function(...args) { if (args[1] === 'readwrite') throw new DOMException('Storage full', 'QuotaExceededError'); return original.apply(this, args); };
  });
  await page.setInputFiles('#file-input', { ...word, name: '无法保存.docx' });
  await page.waitForFunction(() => document.querySelector('.toast.show')?.textContent.includes('导入失败'));
  await page.evaluate(() => window.restoreTransactions());
  await page.reload(); await page.waitForSelector('.document-card');
  assert.equal(await page.locator('.document-card').count(), 3);
  console.log('Checking redesigned desk…');
  await page.locator('[data-resume-doc]').press('Enter');
  await page.waitForSelector('#markdown-body');
  assert.equal(await page.locator('.reader-title strong').textContent(), word.name);
  await page.waitForFunction(() => window.scrollY > 900);
  await page.click('[data-view="library"]');
  // Long file names are clamped visually and kept complete in the accessible name.
  const longName = '移动端文档阅读与排版规范（2026 年修订版，含兼容说明与附录）.md';
  await page.click('[data-open-doc="legacy-md"]');
  await page.click('[data-action="toggle-mode"]');
  await page.fill('#doc-name', longName);
  await page.click('[data-view="library"]');
  await page.reload(); await page.waitForSelector('.document-card');
  assert.equal(await page.locator('.document-card').first().getAttribute('aria-label'), `打开 ${longName}`);
  for (const width of [320, 390, 430, 1100]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Desk must fit ${width}px`);
    const tops = await page.locator('.document-cover').evaluateAll(items => items.map(item => item.getBoundingClientRect().top));
    assert.ok(Math.abs(tops[0] - tops[1]) < 1, 'Covers in the same row must align');
    await page.screenshot({ path: resolve(screenshots, `书桌-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-view="settings"]');
  assert.equal(await page.locator('.font-stepper span').textContent(), '17');
  await page.click('button[data-font="1"]');
  assert.equal(await page.locator('.font-stepper span').textContent(), '18');
  await page.click('button[data-font="-1"]');
  assert.equal(await page.locator('.font-stepper span').textContent(), '17');
  await page.screenshot({ path: resolve(screenshots, '设置.png'), fullPage: true });
  await page.click('[data-theme-option="dark"]');
  await page.click('[data-view="library"]');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('md-reader-state-v1')).settings.fontSize), 17);
  await page.screenshot({ path: resolve(screenshots, '书桌-深色.png'), fullPage: true });
  await page.reload(); await page.waitForSelector('.document-card');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.click('[data-view="settings"]'); await page.click('[data-theme-option="paper"]'); await page.click('[data-view="library"]');
  await page.screenshot({ path: resolve(screenshots, '文档架.png'), fullPage: true });
  await page.click('[data-open-doc="legacy-md"]'); await page.waitForSelector('#markdown-body h1');
  assert.ok(await page.locator('#markdown-body').evaluate(body => parseFloat(getComputedStyle(body).fontSize)) >= 17);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: MD migration/editing, invalid font recovery, PDF pixels/cache/swipe/pinch, Word images/pinch/search, offline positions, duplicates and quota rollback; desk layouts 320–1100px, aligned covers, long names, keyboard resume, theme persistence and font controls; no external requests or browser errors.');
} finally { await browser.close(); }
