// Cards: one spec, two renderers. The page shows the card as HTML (with links); sharing draws the
// same card on a canvas (1080 × 1350, light theme) — a designed image, nicer than a screenshot.
//
//   spec = { kicker, title, big, bigLabel, sub, spark: [numbers], sparkLabels: [left, right],
//            lines: [{ label, value, link, tone: 'up'|'down' }], medals: [{ motif, level, title }],
//            link, note, foot }
//   cardHtml(spec)              → element
//   cardCanvas(spec) → Promise<HTMLCanvasElement>
import { h } from './dom.js';
import { medal } from './medal.js';

// ───────── HTML ─────────

export function cardHtml(s) {
  const wrap = s.link ? ['a', { class: 'xcard tap', ...s.link }] : ['div', { class: 'xcard' }];
  return h(wrap[0], wrap[1],
    h('div', { class: 'xc-head' }, s.kicker ? h('div', { class: 'xc-kicker' }, s.kicker) : null, h('div', { class: 'xc-title' }, s.title)),
    h('div', { class: 'xc-body' },
      s.big != null ? h('div', { class: 'xc-big' + (s.tone ? ' ' + s.tone : '') }, s.big) : null,
      s.bigLabel ? h('div', { class: 'xc-biglabel' }, s.bigLabel) : null,
      s.sub ? h('div', { class: 'xc-sub' }, s.sub) : null,
      s.spark?.length > 1 ? sparkSvg(s.spark, s.sparkLabels) : null,
      s.medals?.length ? h('div', { class: 'xc-medals' }, s.medals.map(m => medal(m.motif, m.level, { size: 44, title: m.title }))) : null,
      s.lines?.length ? h('ul', { class: 'xc-lines' }, s.lines.map(l => h('li', {},
        l.link && !s.link ? h('a', { class: 'tap', ...l.link }, h('span', {}, l.label), h('b', { class: l.tone || null }, l.value))
          : [h('span', {}, l.label), h('b', { class: l.tone || null }, l.value)]))) : null,
      s.note ? h('div', { class: 'xc-note' }, s.note) : null));
}

const NS = 'http://www.w3.org/2000/svg';
function sparkSvg(v, labels) {
  const W = 300, H = 70, lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((y, i) => `${(i / (v.length - 1) * W).toFixed(1)},${(H - 4 - (y - lo) / span * (H - 8)).toFixed(1)}`).join(' ');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'xc-spark'); svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const pl = document.createElementNS(NS, 'polyline');
  pl.setAttribute('points', pts); pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', 'currentColor');
  pl.setAttribute('stroke-width', '2.5'); pl.setAttribute('vector-effect', 'non-scaling-stroke'); pl.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(pl);
  return labels ? h('div', { class: 'xc-sparkwrap' }, svg, h('div', { class: 'xc-sparklabels' }, h('span', {}, labels[0]), h('span', {}, labels[1]))) : svg;
}

// ───────── Canvas ─────────

const C = { paper: '#F5F7F5', surface: '#FFFFFF', ink: '#16201B', muted: '#5C6A62', line: '#DCE3DE', table: '#1D5E46', up: '#1D7A52', down: '#C2332B' };
const SCORE = '"Bahnschrift", "DIN Alternate", "DIN 2014", "Roboto Condensed", "Arial Narrow", system-ui, sans-serif';
const TEXT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const CARD_W = 1080, CARD_H = 1350;

/** Medal as an image: the SVG with the light theme's colours written in (CSS variables don't reach a canvas). */
function medalImage(m) {
  const svg = medal(m.motif, m.level, { size: 160 });
  svg.setAttribute('xmlns', NS);
  const src = new XMLSerializer().serializeToString(svg)
    .replaceAll('var(--medal-inner)', '#FFFFFF').replaceAll('var(--medal-ink)', '#16201B').replaceAll('var(--medal-off)', '#B4BEB8');
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
  });
}

function wrapText(c, text, maxW) {
  const words = String(text).split(' '), out = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (c.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

function fit(c, text, font, size, maxW, weight = '') {
  let s = size;
  do { c.font = `${weight} ${s}px ${font}`; s -= 4; } while (c.measureText(text).width > maxW && s > 24);
}

export async function cardCanvas(s, { stamp = '' } = {}) {
  const cv = document.createElement('canvas');
  cv.width = CARD_W; cv.height = CARD_H;
  const c = cv.getContext('2d');
  const X = 90, R = CARD_W - 90, Wd = R - X;
  c.fillStyle = C.paper; c.fillRect(0, 0, CARD_W, CARD_H);

  // head band: the table, with its white edge line
  c.fillStyle = C.table; c.fillRect(0, 0, CARD_W, 300);
  c.fillStyle = '#FFFFFF'; c.fillRect(0, 300, CARD_W, 8);
  c.fillStyle = 'rgba(255,255,255,0.78)'; c.font = `500 40px ${TEXT}`; c.textBaseline = 'alphabetic';
  if (s.kicker) c.fillText(s.kicker, X, 120);
  c.fillStyle = '#FFFFFF'; fit(c, s.title, TEXT, 84, Wd, '700'); c.fillText(s.title, X, 222);

  let y = 400;
  if (s.big != null) {
    c.fillStyle = s.tone === 'up' ? C.up : s.tone === 'down' ? C.down : C.ink;
    fit(c, String(s.big), SCORE, 210, Wd, '700');
    y += 150; c.fillText(String(s.big), X - 6, y);
    y += 20;
  }
  if (s.bigLabel) { c.fillStyle = C.muted; c.font = `500 44px ${TEXT}`; y += 50; c.fillText(s.bigLabel, X, y); }
  if (s.sub) {
    c.fillStyle = C.ink; c.font = `400 40px ${TEXT}`;
    for (const l of wrapText(c, s.sub, Wd)) { y += 56; c.fillText(l, X, y); }
  }
  if (s.spark?.length > 1) {
    y += 50;
    const top = y, H = 190, v = s.spark, lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
    c.strokeStyle = C.line; c.lineWidth = 2;
    c.beginPath(); c.moveTo(X, top + H); c.lineTo(R, top + H); c.stroke();
    c.strokeStyle = C.table; c.lineWidth = 7; c.lineJoin = 'round'; c.lineCap = 'round';
    c.beginPath();
    v.forEach((val, i) => { const px = X + i / (v.length - 1) * Wd, py = top + H - 10 - (val - lo) / span * (H - 20); i ? c.lineTo(px, py) : c.moveTo(px, py); });
    c.stroke();
    y = top + H;
    if (s.sparkLabels) {
      c.fillStyle = C.muted; c.font = `500 34px ${TEXT}`; y += 46;
      c.fillText(s.sparkLabels[0], X, y);
      c.textAlign = 'right'; c.fillText(s.sparkLabels[1], R, y); c.textAlign = 'left';
    }
  }
  if (s.medals?.length) {
    y += 40;
    const imgs = await Promise.all(s.medals.slice(0, 10).map(medalImage));
    const size = 160, gap = (Wd - 5 * size) / 4;
    imgs.forEach((img, i) => { if (img) c.drawImage(img, X + (i % 5) * (size + gap), y + Math.floor(i / 5) * (size + 20), size, size); });
    y += Math.ceil(imgs.length / 5) * (size + 20);
  }
  if (s.lines?.length) {
    y += 30;
    const room = CARD_H - 150 - y, step = Math.max(64, Math.min(96, room / s.lines.length));
    for (const l of s.lines) {
      if (y + step > CARD_H - 140) break;
      c.strokeStyle = C.line; c.lineWidth = 2; c.beginPath(); c.moveTo(X, y); c.lineTo(R, y); c.stroke();
      const base = y + step / 2 + 14;
      c.fillStyle = l.tone === 'up' ? C.up : l.tone === 'down' ? C.down : C.ink;
      c.font = `700 44px ${SCORE}`; c.textAlign = 'right';
      const vw = c.measureText(l.value).width;
      c.fillText(l.value, R, base); c.textAlign = 'left';
      c.fillStyle = C.muted; fit(c, l.label, TEXT, 40, Wd - vw - 30, '400'); c.fillText(l.label, X, base);
      y += step;
    }
  }
  // foot: a ball and the app's name
  c.fillStyle = C.line; c.fillRect(0, CARD_H - 110, CARD_W, 2);
  c.fillStyle = '#FFFFFF'; c.strokeStyle = C.muted; c.lineWidth = 3;
  c.beginPath(); c.arc(X + 16, CARD_H - 56, 16, 0, 2 * Math.PI); c.fill(); c.stroke();
  c.fillStyle = C.muted; c.font = `500 34px ${TEXT}`;
  c.fillText(['Tischtennis Elo', s.foot || stamp].filter(Boolean).join(' · '), X + 50, CARD_H - 44);
  if (s.note) { c.textAlign = 'right'; c.font = `400 28px ${TEXT}`; c.fillText(s.note, R, CARD_H - 44); c.textAlign = 'left'; }
  return cv;
}
