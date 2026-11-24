// Full-screen photo viewer (Phase 18b): swipe left / right through a list of photos (scroll-snap, also arrow
// keys), the preview first and the full image as soon as it is there (only the current photo and its
// neighbours are loaded). A caption line and actions per photo. Back (Android, browser) closes it.
//
//   openViewer({ photos, index, load(photo, size) → Promise<url|null>, preview(photo) → url|null,
//                caption(photo) → nodes, actions(photo, close) → [{ label, onclick?, href?, danger? }] })
import { h, render } from './dom.js';

export function openViewer({ photos, index = 0, load, preview, caption, actions }) {
  if (!photos.length) return;
  const prevFocus = document.activeElement;
  const slides = photos.map(p => {
    const img = h('img', { alt: p.caption || 'Foto', decoding: 'async', draggable: 'false' });
    const pre = preview(p);
    if (pre) img.src = pre;
    const fig = h('figure', { class: 'viewer-slide' }, img);
    return { p, fig, img, full: false };
  });
  const track = h('div', { class: 'viewer-track' }, slides.map(s => s.fig));
  const counter = h('span', { class: 'viewer-count', 'aria-live': 'polite' });
  const info = h('div', { class: 'viewer-info' });
  const prevBtn = h('button', { type: 'button', class: 'viewer-nav prev', 'aria-label': 'Voriges Foto', onclick: () => go(cur - 1) }, '‹');
  const nextBtn = h('button', { type: 'button', class: 'viewer-nav next', 'aria-label': 'Nächstes Foto', onclick: () => go(cur + 1) }, '›');
  const closeBtn = h('button', { type: 'button', class: 'viewer-close', 'aria-label': 'Schließen', onclick: () => close() }, '×');
  const root = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Fotos' },
    h('div', { class: 'viewer-top' }, counter, closeBtn), track, prevBtn, nextBtn, info);
  document.body.append(root);
  document.body.classList.add('viewer-open');

  let cur = -1, closed = false;
  // Back closes the viewer: one history entry for it
  history.pushState({ ...(history.state || {}), viewer: true }, '', location.href);
  const onPop = () => { if (!closed) close(true); };
  window.addEventListener('popstate', onPop);
  const onKey = e => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') go(cur + 1);
    else if (e.key === 'ArrowLeft') go(cur - 1);
  };
  document.addEventListener('keydown', onKey);

  function full(i) {
    const s = slides[i];
    if (!s || s.full) return;
    s.full = true;
    load(s.p, 'full').then(url => { if (url && !closed) s.img.src = url; });
  }

  function show(i) {
    if (i === cur) return;
    cur = i;
    counter.textContent = `${i + 1} / ${slides.length}`;
    prevBtn.hidden = i === 0;
    nextBtn.hidden = i === slides.length - 1;
    [i, i + 1, i - 1].forEach(full);
    const p = slides[i].p;
    render(info, h('div', { class: 'viewer-caption' }, caption(p)),
      h('div', { class: 'viewer-actions' }, actions(p, close).map(a => (a.href
        ? h('a', { class: 'btn', href: a.href, onclick: e => { a.onclick?.(e); } }, a.label)
        : h('button', { type: 'button', class: 'btn' + (a.danger ? ' danger' : ''), onclick: e => a.onclick(e) }, a.label)))));
  }

  function go(i) {
    const j = Math.max(0, Math.min(slides.length - 1, i));
    track.scrollTo({ left: j * track.clientWidth, behavior: 'smooth' });
    show(j);
  }

  track.addEventListener('scroll', () => {
    const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    if (i !== cur && i >= 0 && i < slides.length) show(i);
  }, { passive: true });

  function close(fromPop = false) {
    if (closed) return;
    closed = true;
    root.remove();
    document.body.classList.remove('viewer-open');
    window.removeEventListener('popstate', onPop);
    document.removeEventListener('keydown', onKey);
    if (!fromPop && history.state?.viewer) history.back();
    prevFocus?.focus?.({ preventScroll: true });
  }

  requestAnimationFrame(() => { track.scrollLeft = index * track.clientWidth; show(index); closeBtn.focus({ preventScroll: true }); });
  return { close };
}
