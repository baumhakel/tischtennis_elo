// Teilen: one button in the page head of a few pages. A tap draws the page's card as an image and
// shows it in a sheet first (deliberate: you see what leaves the app), then „Teilen“ (Web Share with
// the image, where the phone supports it) or „Bild speichern“.
import { h, render } from './dom.js';
import { cardCanvas } from './cards.js';

let sheet = null;

/** The share button for viewHead; makeSpec() is called on tap, so it sees the current state. */
export function shareButton(makeSpec, { name = 'tischtennis' } = {}) {
  return h('button', { class: 'share-btn', type: 'button', 'aria-label': 'Als Bild teilen', title: 'Als Bild teilen',
    onclick: () => openShare(makeSpec(), name) }, shareIcon());
}

function shareIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '18'); svg.setAttribute('height', '18'); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', 'M12 3v12M7.5 7.5L12 3l4.5 4.5M5 12v7.5h14V12');
  p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '2');
  p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(p);
  return svg;
}

const fileName = name => `${name.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-|-$/g, '')}.png`;

export async function openShare(spec, name) {
  close();
  const body = h('div', { class: 'share-body' }, h('p', { class: 'muted' }, 'Bild wird gezeichnet …'));
  sheet = h('div', { class: 'share-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Als Bild teilen' },
    h('div', { class: 'share-backdrop', onclick: close }),
    h('div', { class: 'share-panel' },
      h('div', { class: 'share-top' }, h('strong', {}, 'Als Bild teilen'), h('button', { type: 'button', class: 'share-close', onclick: close, 'aria-label': 'Schließen' }, '×')),
      body));
  document.body.appendChild(sheet);
  document.addEventListener('keydown', onKey);

  const canvas = await cardCanvas(spec, { stamp: new Date().toLocaleDateString('de-AT') });
  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
  if (!sheet) return;
  const url = URL.createObjectURL(blob);
  const file = new File([blob], fileName(name), { type: 'image/png' });
  const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  render(body,
    h('img', { class: 'share-preview', src: url, alt: spec.title }),
    h('div', { class: 'share-actions' },
      canShare ? h('button', { type: 'button', class: 'btn primary', onclick: async () => {
        try { await navigator.share({ files: [file], title: spec.title }); close(); } catch { /* cancelled */ }
      } }, 'Teilen') : null,
      h('a', { class: 'btn' + (canShare ? '' : ' primary'), href: url, download: file.name }, 'Bild speichern')),
    h('p', { class: 'share-note' }, 'Wer das Bild bekommt, sieht es ohne Anmeldung. Es zeigt nur, was auf dem Bild steht.'));
  sheet.dataset.url = url;
}

function onKey(e) { if (e.key === 'Escape') close(); }

function close() {
  if (!sheet) return;
  if (sheet.dataset.url) URL.revokeObjectURL(sheet.dataset.url);
  sheet.remove(); sheet = null;
  document.removeEventListener('keydown', onKey);
}
