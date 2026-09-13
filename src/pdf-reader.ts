import { getDocument, GlobalWorkerOptions, PDFWorker, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { MarkdownDocument } from './types';

GlobalWorkerOptions.workerSrc = workerUrl;
// Reuse the idle parser thread across files; each reader still destroys its own document.
const sharedWorker = new PDFWorker();
export function mountPdf(root: HTMLElement, doc: MarkdownDocument, changed: () => void): () => void {
  root.innerHTML = `<div class="pdf-stage" tabindex="0" aria-label="PDF 页面，左右滑动翻页"><div class="pdf-sheet"><canvas aria-label="PDF 内容"></canvas></div><p class="pdf-message" role="status">正在打开本地 PDF…</p></div>
    <footer class="reading-controls"><button data-pdf-prev aria-label="上一页">‹</button><label><input data-pdf-page type="number" min="1" inputmode="numeric" aria-label="页码"><span data-pdf-count>/ —</span></label><button data-pdf-next aria-label="下一页">›</button><span class="control-divider"></span><button data-pdf-zoom="-1" aria-label="缩小">−</button><button data-pdf-fit aria-label="适应宽度">100%</button><button data-pdf-zoom="1" aria-label="放大">＋</button></footer>`;
  const stage = root.querySelector<HTMLElement>('.pdf-stage')!;
  const sheet = root.querySelector<HTMLElement>('.pdf-sheet')!;
  let canvas = root.querySelector<HTMLCanvasElement>('canvas')!;
  const cache = new Map<string, HTMLCanvasElement>();
  let saveTimer = 0, restoring = true;
  const message = root.querySelector<HTMLElement>('.pdf-message')!;
  const pageInput = root.querySelector<HTMLInputElement>('[data-pdf-page]')!;
  let pdf: PDFDocumentProxy | undefined;
  let task: RenderTask | undefined, warmTask: RenderTask | undefined;
  let warmTimer = 0;
  let alive = true;
  let generation = 0;
  let zoom = Math.min(3, Math.max(1, doc.zoom ?? 1));
  let page = Math.max(1, doc.page ?? 1);
  const loading = getDocument({ worker: sharedWorker, data: new Uint8Array(doc.data!.slice(0)), cMapUrl: new URL('pdf/cmaps/', document.baseURI).href,
    cMapPacked: true, standardFontDataUrl: new URL('pdf/standard_fonts/', document.baseURI).href,
    wasmUrl: new URL('pdf/wasm/', document.baseURI).href, isEvalSupported: false });

  function controls(): void {
    pageInput.value = String(page); pageInput.max = String(pdf?.numPages ?? 1);
    root.querySelector('[data-pdf-count]')!.textContent = `/ ${pdf?.numPages ?? '—'}`;
    root.querySelector('[data-pdf-fit]')!.textContent = `${Math.round(zoom * 100)}%`;
    root.querySelector<HTMLButtonElement>('[data-pdf-prev]')!.disabled = !pdf || page <= 1;
    root.querySelector<HTMLButtonElement>('[data-pdf-next]')!.disabled = !pdf || page >= pdf.numPages;
  }
  function cacheKey(number: number): string { return `${number}:${stage.clientWidth}:${zoom}:${window.devicePixelRatio}`; }
  function remember(id: string, item: HTMLCanvasElement): void {
    cache.delete(id); cache.set(id, item);
    let pixels = [...cache.values()].reduce((sum, entry) => sum + entry.width * entry.height, 0);
    while (cache.size > 3 || (pixels > 12_000_000 && cache.size > 1)) {
      const oldest = cache.keys().next().value!; pixels -= cache.get(oldest)!.width * cache.get(oldest)!.height; cache.delete(oldest);
    }
  }
  async function raster(pdfPage: PDFPageProxy, width: number, background = false): Promise<HTMLCanvasElement> {
    const item = document.createElement('canvas'); item.setAttribute('aria-label', 'PDF 内容');
    const base = pdfPage.getViewport({ scale: 1 });
    const viewport = pdfPage.getViewport({ scale: width / base.width });
    const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (viewport.width * viewport.height)));
    item.width = Math.max(1, Math.floor(viewport.width * ratio)); item.height = Math.max(1, Math.floor(viewport.height * ratio));
    item.style.width = `${viewport.width}px`; item.style.height = `${viewport.height}px`;
    const render = pdfPage.render({ canvas: item, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
    if (background) warmTask = render; else task = render;
    await render.promise; return item;
  }
  function warmNext(ticket: number): void {
    if (!pdf || zoom !== 1 || page >= pdf.numPages) return;
    const number = page + 1, id = cacheKey(number), width = Math.max(200, stage.clientWidth - 24);
    if (cache.has(id)) return;
    warmTimer = window.setTimeout(() => {
      void (async () => {
        const next = await pdf!.getPage(number);
        if (!alive || ticket !== generation) return;
        const item = await raster(next, width, true);
        if (alive && ticket === generation) remember(id, item);
      })().catch(() => { /* Prefetch is optional; opening the page still reports actual failures. */ });
    }, 180);
  }
  async function paint(resetScroll = false): Promise<void> {
    if (!pdf || !alive) return;
    const ticket = ++generation;
    const targetScroll = doc.scrollY ?? 0;
    restoring = true;
    task?.cancel(); warmTask?.cancel(); window.clearTimeout(warmTimer);
    if (task) await task.promise.catch(() => {});
    const pdfPage = await pdf.getPage(page);
    if (!alive || ticket !== generation) return;
    const id = cacheKey(page);
    const cached = cache.get(id);
    if (cached) {
      canvas = cached; sheet.style.width = canvas.style.width; sheet.style.transform = ''; sheet.replaceChildren(canvas);
      message.hidden = true; if (resetScroll) { stage.scrollTop = 0; stage.scrollLeft = 0; doc.scrollY = 0; }
      else stage.scrollTop = targetScroll;
      restoring = false;
      remember(id, cached);
      doc.page = page; doc.pageCount = pdf.numPages; doc.zoom = zoom; changed(); controls(); warmNext(ticket); return;
    }
    const width = Math.max(200, stage.clientWidth - 24) * zoom;
    const rendered = await raster(pdfPage, width);
    if (!alive || ticket !== generation) return;
    canvas = rendered;
    sheet.style.transform = ''; sheet.style.width = canvas.style.width; sheet.replaceChildren(canvas);
    remember(id, canvas);
    message.hidden = true;
    if (resetScroll) { stage.scrollTop = 0; stage.scrollLeft = 0; doc.scrollY = 0; }
    else stage.scrollTop = targetScroll;
    restoring = false;
    doc.page = page; doc.pageCount = pdf.numPages; doc.zoom = zoom; changed(); controls(); warmNext(ticket);
  }
  function failed(error: unknown): void {
    if (!alive || (error as Error).name === 'RenderingCancelledException') return;
    message.hidden = false;
    restoring = false;
    message.textContent = (error as Error).name === 'PasswordException' ? '这份 PDF 有密码，暂时无法打开。' : (error as Error).name === 'InvalidPDFException' ? '这份文件不是有效的 PDF，或内容不完整。' : 'PDF 页面绘制失败，请尝试重新打开。这不一定是文件损坏。';
    console.error('PDF reading failed:', error);
  }
  function turn(delta: number): void {
    if (!pdf) return;
    const next = Math.min(pdf.numPages, Math.max(1, page + delta));
    if (next === page) return;
    page = next; doc.page = page; doc.scrollY = 0; changed(); controls(); void paint(true).catch(failed);
  }
  function setZoom(value: number, x = stage.clientWidth / 2, y = stage.clientHeight / 2): void {
    const ratio = Math.min(3, Math.max(1, value)) / zoom;
    const left = (stage.scrollLeft + x) * ratio - x;
    doc.scrollY = Math.max(0, (stage.scrollTop + y) * ratio - y);
    zoom = Math.min(3, Math.max(1, value)); doc.zoom = zoom; changed(); controls(); void paint().then(() => { if (alive) stage.scrollLeft = left; }).catch(failed);
  }
  root.querySelector('[data-pdf-prev]')!.addEventListener('click', () => turn(-1));
  root.querySelector('[data-pdf-next]')!.addEventListener('click', () => turn(1));
  pageInput.addEventListener('change', () => { if (pdf) turn(Math.round(Number(pageInput.value) || page) - page); });
  root.querySelectorAll<HTMLButtonElement>('[data-pdf-zoom]').forEach(button => button.addEventListener('click', () => setZoom(zoom + Number(button.dataset.pdfZoom) * .25)));
  root.querySelector('[data-pdf-fit]')!.addEventListener('click', () => setZoom(1));
  stage.addEventListener('keydown', event => { if (event.key === 'ArrowRight') turn(1); if (event.key === 'ArrowLeft') turn(-1); });
  stage.addEventListener('scroll', () => { if (restoring) return; doc.scrollY = stage.scrollTop; window.clearTimeout(saveTimer); saveTimer = window.setTimeout(changed, 180); }, { passive: true });
  let startX = 0, startY = 0, pinching = false, distance = 0, pinchZoom = 1, nextZoom = 1, pinchX = 0, pinchY = 0;
  stage.addEventListener('touchstart', event => {
    if (event.touches.length === 2) {
      pinching = true; distance = Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY); pinchZoom = zoom; nextZoom = zoom;
      const rect = stage.getBoundingClientRect();
      pinchX = (event.touches[0].clientX + event.touches[1].clientX) / 2 - rect.left;
      pinchY = (event.touches[0].clientY + event.touches[1].clientY) / 2 - rect.top;
    } else if (event.touches.length === 1) { startX = event.touches[0].clientX; startY = event.touches[0].clientY; }
  }, { passive: true });
  stage.addEventListener('touchmove', event => {
    if (pinching && event.touches.length === 2) {
      event.preventDefault();
      nextZoom = Math.min(3, Math.max(1, pinchZoom * Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY) / Math.max(1, distance)));
      sheet.style.transformOrigin = `${stage.scrollLeft + pinchX}px ${stage.scrollTop + pinchY}px`; sheet.style.transform = `scale(${nextZoom / zoom})`;
      root.querySelector('[data-pdf-fit]')!.textContent = `${Math.round(nextZoom * 100)}%`;
    }
  }, { passive: false });
  stage.addEventListener('touchend', event => {
    if (pinching) { if (event.touches.length === 0) { pinching = false; setZoom(nextZoom, pinchX, pinchY); } return; }
    const touch = event.changedTouches[0];
    if (touch && zoom === 1) {
      const dx = touch.clientX - startX, dy = touch.clientY - startY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) turn(dx < 0 ? 1 : -1);
    }
  }, { passive: true });
  stage.addEventListener('touchcancel', () => { if (pinching) { pinching = false; setZoom(nextZoom, pinchX, pinchY); } }, { passive: true });
  let lastWidth = stage.clientWidth;
  const resize = new ResizeObserver(() => { if (stage.clientWidth === lastWidth) return; lastWidth = stage.clientWidth; if (pdf) void paint().catch(failed); }); resize.observe(stage);
  controls();
  void loading.promise.then(result => { if (!alive) { void result.destroy(); return; } pdf = result; page = Math.min(page, pdf.numPages); controls(); return paint(); }).catch(failed);
  return () => { alive = false; generation++; resize.disconnect(); window.clearTimeout(saveTimer); window.clearTimeout(warmTimer); changed(); cache.clear(); task?.cancel(); warmTask?.cancel(); void loading.destroy(); };
}
