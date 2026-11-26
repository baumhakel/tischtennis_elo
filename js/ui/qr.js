// QR codes as SVG (Phase 18c): the matrix from core/qr-encode.js, drawn with rounded modules (or dots, or squares),
// own colours, and the three finder patterns („eyes“) as table tennis rackets: the 7 × 7 ring is the blade with
// rounded corners, the 3 × 3 centre the ball, the handle points outwards into the quiet zone. The ring, gap and
// centre keep the 1 : 1 : 3 : 1 : 1 ratio across the middle, so phone cameras still find the eyes.
// Check new variants with real phones on #/qr-test before printing.
//
//   qrSvg(text, { style: 'rund'|'punkte'|'eckig', eyes: 'rund'|'eckig'|'quadrat', fg, bg, eye, ball, quiet, ecl, label,
//                 blade, attached })  → <svg> (viewBox in modules; size it with CSS)
//   eyes: 'rund' = round racket (blade corner radius 2.4, round ball), 'eckig' = square racket (square ring and ball,
//   only the handle; the safest racket), 'quadrat' = plain finder patterns. The handle is detached by default (a
//   small gap), so the blade stays a clean ring for scanners that trace outlines (OpenCV reads 'eckig', but not
//   strongly rounded rings: phone scanners usually do; that is what #/qr-test is for).
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

/** A rounded rectangle as path data (for the blade and its hole). */
function roundRect(x, y, w, hgt, r) {
  return `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + hgt - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + hgt)}`
    + `H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + hgt - r)}V${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)}Z`;
}

export function qrSvg(text, { style = 'rund', eyes = 'rund', fg = '#111', bg = '#fff', eye = null, ball = null, quiet = 4, ecl = 'H', label = null, blade = null, handle = true, attached = false } = {}) {
  const square = eyes === 'eckig';
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

  // the three eyes
  const corners = [[0, 0, -1, -1], [0, n - 7, 1, -1], [n - 7, 0, -1, 1]];
  for (const [r0, c0, dx, dy] of corners) {
    const x = c0 + Q, y = r0 + Q;
    if (eyes === 'quadrat') {
      svg.append(el('path', { d: `M${x} ${y}h7v7h-7ZM${x + 1} ${y + 1}v5h5v-5Z`, fill: eye || fg, 'fill-rule': 'evenodd' }));
      svg.append(el('rect', { x: x + 2, y: y + 2, width: 3, height: 3, fill: ball || fg }));
      continue;
    }
    const R = blade ?? (square ? 0.01 : 2.4);
    const g = el('g', { class: 'qr-racket' });
    // handle: from inside the blade's outer corner, along the diagonal, out into the quiet zone
    const cx = x + (dx < 0 ? 0 : 7), cy = y + (dy < 0 ? 0 : 7);
    // attached: starts inside the blade; detached: starts a small gap outside its rounded corner (the blade then
    // stays a clean ring for scanners that trace outlines)
    const inset = R * (1 - Math.SQRT1_2);
    const start = attached ? -1.25 : -inset + 0.5;
    const sx = cx + dx * start, sy = cy + dy * start, len = attached ? 4.3 : 3.1, w = 1.6;
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    if (handle) g.append(el('rect', { x: f(sx), y: f(sy - w / 2), width: len, height: w, rx: 0.7, fill: eye || fg, transform: `rotate(${f(ang)} ${f(sx)} ${f(sy)})` }));
    g.append(el('path', { d: roundRect(x, y, 7, 7, R) + roundRect(x + 1, y + 1, 5, 5, R - 1), fill: eye || fg, 'fill-rule': 'evenodd' }));
    if (square) g.append(el('rect', { x: x + 2, y: y + 2, width: 3, height: 3, fill: ball || fg }));
    else g.append(el('circle', { cx: f(x + 3.5), cy: f(y + 3.5), r: 1.5, fill: ball || fg }));
    svg.append(g);
  }
  return svg;
}

/** The app's address for a page (for printed codes): this site without ?demo, keeping ?turniertest. */
export function appUrl(hash) {
  if (typeof location === 'undefined') return hash;
  const keep = new URLSearchParams(location.search).has('turniertest') ? '?turniertest' : '';
  return `${location.origin}${location.pathname}${keep}${hash}`;
}
