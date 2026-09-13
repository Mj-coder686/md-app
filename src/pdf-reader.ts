import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { MarkdownDocument } from './types';

GlobalWorkerOptions.workerSrc = workerUrl;
export function mountPdf(root: HTMLElement, doc: MarkdownDocument, changed: () => void): () => void {
  root.innerHTML = `<div class="pdf-stage" tabindex="0" aria-label="PDF 页面，左右滑动翻页"><div class="pdf-sheet"><canvas aria-label="PDF 内容"></canvas></div><p class="pdf-message" role="status">正在打开本地 PDF…</p></div>
    <footer class="reading-controls"><button data-pdf-prev aria-label="上一页">‹</button><label><input data-pdf-page type="number" min="1" inputmode="numeric" aria-label="页码"><span data-pdf-count>/ —</span></label><button data-pdf-next aria-label="下一页">›</button><span class="control-divider"></span><button data-pdf-zoom="-1" aria-label="缩小">−</button><button data-pdf-fit aria-label="适应宽度">100%</button><button data-pdf-zoom="1" aria-label="放大">＋</button></footer>`;
  const stage = root.querySelector<HTMLElement>('.pdf-stage')!;
  const sheet = root.querySelector<HTMLElement>('.pdf-sheet')!;
  const canvas = root.querySelector<HTMLCanvasElement>('canvas')!;
  const message = root.querySelector<HTMLElement>('.pdf-message')!;
  const pageInput = root.querySelector<HTMLInputElement>('[data-pdf-page]')!;
  let pdf: PDFDocumentProxy | undefined;
  let task: RenderTask | undefined;
  let alive = true;
  let generation = 0;
  let zoom = Math.min(3, Math.max(1, doc.zoom ?? 1));
  let page = Math.max(1, doc.page ?? 1);
  const loading = getDocument({ data: new Uint8Array(doc.data!.slice(0)), cMapUrl: new URL('pdf/cmaps/', document.baseURI).href,
    cMapPacked: true, standardFontDataUrl: new URL('pdf/standard_fonts/', document.baseURI).href,
    wasmUrl: new URL('pdf/wasm/', document.baseURI).href, isEvalSupported: false });

  function controls(): void {
    pageInput.value = String(page); pageInput.max = String(pdf?.numPages ?? 1);
    root.querySelector('[data-pdf-count]')!.textContent = `/ ${pdf?.numPages ?? '—'}`;
    root.querySelector('[data-pdf-fit]')!.textContent = `${Math.round(zoom * 100)}%`;
    root.querySelector<HTMLButtonElement>('[data-pdf-prev]')!.disabled = !pdf || page <= 1;
    root.querySelector<HTMLButtonElement>('[data-pdf-next]')!.disabled = !pdf || page >= pdf.numPages;
  }
  async function paint(resetScroll = false): Promise<void> {
    if (!pdf || !alive) return;
    const ticket = ++generation;
    task?.cancel();
    if (task) await task.promise.catch(() => {});
    const pdfPage = await pdf.getPage(page);
    if (!alive || ticket !== generation) return;
    const base = pdfPage.getViewport({ scale: 1 });
    const width = Math.max(200, stage.clientWidth - 24) * zoom;
    const viewport = pdfPage.getViewport({ scale: width / base.width });
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(10_000_000 / (viewport.width * viewport.height)));
    canvas.width = Math.floor(viewport.width * pixelRatio); canvas.height = Math.floor(viewport.height * pixelRatio);
    canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`; sheet.style.width = `${viewport.width}px`;
    message.textContent = '正在显示页面…'; message.hidden = false;
    task = pdfPage.render({ canvas, viewport, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] });
    try { await task.promise; } catch (error) { if ((error as Error).name !== 'RenderingCancelledException') throw error; }
    if (!alive || ticket !== generation) return;
    message.hidden = true;
    if (resetScroll) { stage.scrollTop = 0; stage.scrollLeft = 0; doc.scrollY = 0; }
    else stage.scrollTop = doc.scrollY ?? 0;
    doc.page = page; doc.pageCount = pdf.numPages; doc.zoom = zoom; changed(); controls();
  }
  function failed(error: unknown): void {
    if (!alive) return;
    message.hidden = false;
    message.textContent = (error as Error).name === 'PasswordException' ? '这份 PDF 有密码，暂时无法打开。' : 'PDF 无法显示，请检查文件是否完整。';
  }
  function turn(delta: number): void {
    if (!pdf) return;
    const next = Math.min(pdf.numPages, Math.max(1, page + delta));
    if (next === page) return;
    page = next; doc.page = page; doc.scrollY = 0; changed(); controls(); void paint(true).catch(failed);
  }
  function setZoom(value: number): void {
    zoom = Math.min(3, Math.max(1, value)); doc.zoom = zoom; changed(); controls(); void paint().catch(failed);
  }
  root.querySelector('[data-pdf-prev]')!.addEventListener('click', () => turn(-1));
  root.querySelector('[data-pdf-next]')!.addEventListener('click', () => turn(1));
  pageInput.addEventListener('change', () => { if (pdf) turn(Math.round(Number(pageInput.value) || page) - page); });
  root.querySelectorAll<HTMLButtonElement>('[data-pdf-zoom]').forEach(button => button.addEventListener('click', () => setZoom(zoom + Number(button.dataset.pdfZoom) * .25)));
  root.querySelector('[data-pdf-fit]')!.addEventListener('click', () => setZoom(1));
  stage.addEventListener('keydown', event => { if (event.key === 'ArrowRight') turn(1); if (event.key === 'ArrowLeft') turn(-1); });
  stage.addEventListener('scroll', () => { doc.scrollY = stage.scrollTop; changed(); }, { passive: true });
  let startX = 0, startY = 0, pinching = false, distance = 0, pinchZoom = 1, nextZoom = 1;
  stage.addEventListener('touchstart', event => {
    if (event.touches.length === 2) {
      pinching = true; distance = Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY); pinchZoom = zoom; nextZoom = zoom;
    } else if (event.touches.length === 1) { startX = event.touches[0].clientX; startY = event.touches[0].clientY; }
  }, { passive: true });
  stage.addEventListener('touchmove', event => {
    if (pinching && event.touches.length === 2) {
      event.preventDefault();
      nextZoom = Math.min(3, Math.max(1, pinchZoom * Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY) / Math.max(1, distance)));
      sheet.style.transformOrigin = 'top left'; sheet.style.transform = `scale(${nextZoom / zoom})`;
    }
  }, { passive: false });
  stage.addEventListener('touchend', event => {
    if (pinching) { if (event.touches.length === 0) { pinching = false; sheet.style.transform = ''; setZoom(nextZoom); } return; }
    const touch = event.changedTouches[0];
    if (touch && zoom === 1) {
      const dx = touch.clientX - startX, dy = touch.clientY - startY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) turn(dx < 0 ? 1 : -1);
    }
  }, { passive: true });
  const resize = new ResizeObserver(() => { if (pdf) void paint().catch(failed); }); resize.observe(stage);
  controls();
  void loading.promise.then(result => { if (!alive) { void result.destroy(); return; } pdf = result; page = Math.min(page, pdf.numPages); controls(); return paint(); }).catch(failed);
  return () => { alive = false; generation++; resize.disconnect(); task?.cancel(); void loading.destroy(); };
}
