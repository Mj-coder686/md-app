import type { MarkdownDocument } from './types';

export function bindTextZoom(body: HTMLElement, doc: MarkdownDocument, fontSize: number, changed: () => void): void {
  let startDistance = 0, startZoom = 1, pinching = false;
  const clamp = (value: number) => Math.round(Math.min(3, Math.max(.75, value)) * 100) / 100;
  function apply(value: number, x = innerWidth / 2, y = innerHeight / 2): void {
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('p,h1,h2,h3,h4,li,td,img,pre');
    const anchor = target && body.contains(target) ? target : undefined;
    const top = anchor?.getBoundingClientRect().top;
    doc.zoom = clamp(value);
    body.style.fontSize = `${fontSize}px`;
    body.style.zoom = String(doc.zoom);
    body.style.width = `${100 / doc.zoom}%`;
    document.querySelector('[data-text-size]')!.textContent = `${Math.round(doc.zoom * 100)}%`;
    if (anchor && top !== undefined) window.scrollBy(0, anchor.getBoundingClientRect().top - top);
  }
  apply(doc.zoom ?? 1, -1, -1);
  document.querySelectorAll<HTMLButtonElement>('[data-text-zoom]').forEach(button => button.addEventListener('click', () => {
    apply((doc.zoom ?? 1) + Number(button.dataset.textZoom) * .25); changed();
  }));
  const distance = (touches: TouchList) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
  body.addEventListener('touchstart', event => {
    if (event.touches.length !== 2) return;
    pinching = true; startDistance = Math.max(1, distance(event.touches)); startZoom = doc.zoom ?? 1;
  }, { passive: true });
  body.addEventListener('touchmove', event => {
    if (!pinching || event.touches.length !== 2) return;
    event.preventDefault();
    apply(startZoom * distance(event.touches) / startDistance,
      (event.touches[0].clientX + event.touches[1].clientX) / 2,
      (event.touches[0].clientY + event.touches[1].clientY) / 2);
  }, { passive: false });
  const end = (event: TouchEvent) => { if (pinching && event.touches.length === 0) { pinching = false; changed(); } };
  body.addEventListener('touchend', end, { passive: true });
  body.addEventListener('touchcancel', () => { pinching = false; changed(); }, { passive: true });
}
