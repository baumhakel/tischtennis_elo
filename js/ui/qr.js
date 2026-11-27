// QR codes as SVG (Phase 18c): the matrix from core/qr-encode.js, drawn with rounded modules (or dots, or squares),
// own colours, and the pupils of the three finder patterns („eyes“) as table tennis rackets (rework 27 Nov, after
// Julius's QR Batch Studio sketch): the 7 × 7 ring stays a normal finder ring; inside it the 3 × 3 pupil becomes a
// racket: a round blade 3 modules wide (so the middle row and column keep the 1 : 1 : 3 : 1 : 1 ratio scanners
// look for) and a short tapered handle with a round end towards the lower left, inside the ring's hole (away from
// the main diagonal that ZXing-style scanners cross-check).
// Check new variants with real phones on #/qr-test before printing.
//
//   qrSvg(text, { style: 'rund'|'punkte'|'eckig', eyes: 'schlaeger'|'schlaeger-rund'|'quadrat', fg, bg, eye, ball,
//                 quiet, ecl, label })  → <svg> (viewBox in modules; size it with CSS)
//   eyes: 'schlaeger' = square ring + racket, 'schlaeger-rund' = ring with rounded corners + racket, 'quadrat' =
//   plain finder patterns. eye = colour of the ring, ball = colour of the racket (both default to fg).
//   racketPaths(cx, cy, m) → [blade, handle, end cap] path data (also for icons)
import { encodeQr } from '../core/qr-encode.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v); return e; };
const f = x => (Math.round(x * 1000) / 1000).toString();

/** Path data for one module at (x, y) with rounded corners where both neighbours of that corner are light. */
function roundedModule(x, y, n, r) {
  const [t, rt, b, l] = n;                    // neighbours: top, right, bottom, left
  const tl = !t && !l ? r : 0, tr = !t && !rt ? r : 0, br = !b && !rt ? r : 0, bl = !b && !l ? r : 0;
  const arc = (rad, ex, ey) => (rad ? `A${f(rad)} ${f(rad)} 0 0 1 ${f(ex)} ${f(ey)}` : `L${f(ex)} ${f(ey)}`);
  return `M${f(x + tl)} ${f(y)}H${f(x + 1 - tr)}${arc(tr, x + 1, y + tr)}V${f(y + 1 - br)}${arc(br, x + 1 - br, y + 1)}H${f(x + bl)}${arc(bl, x, y + 1 - bl)}V${f(y + tl)}${arc(tl, x + tl, y)}Z`;
}

/** A rounded rectangle as path data (for the rounded ring and its hole). */
function roundRect(x, y, w, hgt, r) {
  return `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + hgt - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + hgt)}`
    + `H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + hgt - r)}V${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)}Z`;
}

/** A racket centred at (cx, cy), module size m: [blade, handle, end cap] as path data. */
export function racketPaths(cx, cy, m = 1) {
  const circle = (x, y, r) => `M${f(x - r)} ${f(y)}A${f(r)} ${f(r)} 0 1 0 ${f(x + r)} ${f(y)}A${f(r)} ${f(r)} 0 1 0 ${f(x - r)} ${f(y)}Z`;
  const k = Math.SQRT1_2, dx = -k, dy = k, nx = k, ny = k;   // handle towards the lower left, and its normal
  const t0 = 1.0 * m, t1 = 2.0 * m, w0 = 0.36 * m, w1 = 0.42 * m;
  const p0x = cx + dx * t0, p0y = cy + dy * t0, p1x = cx + dx * t1, p1y = cy + dy * t1;
  const handle = `M${f(p0x + nx * w0)} ${f(p0y + ny * w0)}L${f(p1x + nx * w1)} ${f(p1y + ny * w1)}L${f(p1x - nx * w1)} ${f(p1y - ny * w1)}L${f(p0x - nx * w0)} ${f(p0y - ny * w0)}Z`;
  return [circle(cx, cy, 1.5 * m), handle, circle(p1x, p1y, w1)];
}

export function qrSvg(text, { style = 'rund', eyes = 'schlaeger', fg = '#111', bg = '#fff', eye = null, ball = null, quiet = 4, ecl = 'H', label = null } = {}) {
  const q = encodeQr(text, { ecl });
  const n = q.size, Q = quiet, W = n + 2 * Q;
  const svg = el('svg', { xmlns: NS, viewBox: `0 0 ${W} ${W}`, role: 'img', 'aria-label': label || 'QR-Code', 'shape-rendering': style === 'eckig' ? 'crispEdges' : null, class: 'qr' });
  if (label) { const t = el('title'); t.textContent = label; svg.append(t); }
  if (bg && bg !== 'none') svg.append(el('rect', { x: 0, y: 0, width: W, height: W, fill: bg, rx: style === 'eckig' ? 0 : 1.2 }));
  const dark = (r, c) => r >= 0 && c >= 0 && r < n && c < n && q.modules[r][c] && !q.isFinder(r, c);
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!dark(r, c)) continue;
    const x = c + Q, y = r + Q;
    if (style === 'punkte') d += `M${f(x + 0.5)} ${f(y + 0.07)}a0.43 0.43 0 1 1 0 0.86a0.43 0.43 0 1 1 0 -0.86Z`;
    else if (style === 'eckig') d += `M${x} ${y}h1v1h-1Z`;
    else d += roundedModule(x, y, [dark(r - 1, c), dark(r, c + 1), dark(r + 1, c), dark(r, c - 1)], 0.42);
  }
  svg.append(el('path', { d, fill: fg }));

  // the three eyes: the ring, and the pupil (a racket, or the plain 3 × 3 square)
  for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    const x = c0 + Q, y = r0 + Q;
    const g = el('g', { class: 'qr-eye' });
    const ring = eyes === 'schlaeger-rund' ? roundRect(x, y, 7, 7, 1.6) + roundRect(x + 1, y + 1, 5, 5, 0.8) : `M${x} ${y}h7v7h-7ZM${x + 1} ${y + 1}v5h5v-5Z`;
    g.append(el('path', { d: ring, fill: eye || fg, 'fill-rule': 'evenodd' }));
    if (eyes === 'quadrat') g.append(el('rect', { x: x + 2, y: y + 2, width: 3, height: 3, fill: ball || fg }));
    else for (const part of racketPaths(x + 3.5, y + 3.5)) g.append(el('path', { d: part, fill: ball || fg }));   // separate paths: overlapping parts never cancel
    svg.append(g);
  }
  return svg;
}

const HEX = /^#[0-9a-f]{6}$/i;
/**
 * A QR code in the style set in config: qr_style, qr_eyes, qr_color (the whole code, dark enough to scan),
 * qr_racket_color (the rackets in the eyes; empty = same as qr_color). Invalid colours fall back to black.
 */
export function configQr(cfg, text, label, extra = {}) {
  const fg = HEX.test(cfg.qr_color || '') ? cfg.qr_color : '#111';
  const ball = HEX.test(cfg.qr_racket_color || '') ? cfg.qr_racket_color : fg;
  return qrSvg(text, { style: cfg.qr_style, eyes: cfg.qr_eyes, fg, ball, label, ...extra });
}

/** The app's address for a page (for printed codes): this site without ?demo, keeping ?turniertest. */
export function appUrl(hash) {
  if (typeof location === 'undefined') return hash;
  const keep = new URLSearchParams(location.search).has('turniertest') ? '?turniertest' : '';
  return `${location.origin}${location.pathname}${keep}${hash}`;
}
