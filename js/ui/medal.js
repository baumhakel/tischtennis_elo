// Medals for the Abzeichen: drawn in code (SVG), no image files. A medal = a ring in the tier's
// colour + a table-tennis motif in the middle. Not yet earned: grey outline.
//
//   medal(motif, level, { size, locked, title }) → <svg>
//   level 0 / locked → grey; badges without levels use level = -1 (table-green ring)

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  for (const c of kids) if (c) e.appendChild(c);
  return e;
};

// Tier rings: Gebietsliga (bronze), Landesliga (silver), Bundesliga (gold), Champions League (night blue
// with stars), Universumsliga (violet), Götterliga (light gold, radiant). Beyond: the last one.
const TIERS = [
  { ring: '#B87A3D', dark: '#7A4E22' },
  { ring: '#A8B2BA', dark: '#66717A' },
  { ring: '#D9A520', dark: '#8E6A0C' },
  { ring: '#1F3C88', dark: '#0F1F4D', stars: true },
  { ring: '#6B3FA0', dark: '#3D2160', stars: true },
  { ring: '#F2D27A', dark: '#B08A24', rays: true },
];
const SINGLE = { ring: '#1D5E46', dark: '#0F3527' };   // badges without levels: the table's green

// Motifs on a 24 × 24 grid; stroke = currentColor
const S = { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
const F = { fill: 'currentColor', stroke: 'none' };
const MOTIFS = {
  ball: () => [el('circle', { cx: 12, cy: 12, r: 7.5, ...S }), el('path', { d: 'M5.5 9.5c3.5 1.8 9.5 1.8 13 0', ...S })],
  bats2: () => [el('circle', { cx: 8, cy: 9, r: 4.6, ...F }), el('circle', { cx: 16, cy: 9, r: 4.6, ...F, opacity: 0.75 }),
    el('path', { d: 'M9.5 13l2.2 7M14.5 13l-2.2 7', ...S, 'stroke-width': '2.6' })],
  crown: () => [el('path', { d: 'M4 17.5h16l1.2-9.5-5.2 4-4-6.5-4 6.5-5.2-4z', ...F }), el('path', { d: 'M4 20.5h16', ...S })],
  crownx: () => [el('path', { d: 'M3 13.5h12l1-7-3.9 3-3.1-5-3.1 5L2 6.5z', ...F }), el('circle', { cx: 17.5, cy: 17.5, r: 4.2, ...S }),
    el('path', { d: 'M14.5 17.5h6', ...S })],
  flame: () => [el('path', { d: 'M12 2.5c1.2 4.2 6.3 5.6 6.3 11.3a6.3 6.3 0 0 1-12.6 0c0-3.2 2-4.4 2.2-6.6 2 1.2 2.2 3.3 2.2 3.3.2-4.3 1-6.2 1.9-8z', ...F })],
  arrowup: () => [el('path', { d: 'M12 20.5V4.5M5.5 11l6.5-6.5 6.5 6.5', ...S, 'stroke-width': '2.4' })],
  repeat: () => [el('path', { d: 'M17 2.5l3 3-3 3M4 11.5V10a4.5 4.5 0 0 1 4.5-4.5H20M7 21.5l-3-3 3-3M20 12.5V14a4.5 4.5 0 0 1-4.5 4.5H4', ...S })],
  star: () => [el('path', { d: 'M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z', ...F })],
  target: () => [el('circle', { cx: 12, cy: 12, r: 8.5, ...S }), el('circle', { cx: 12, cy: 12, r: 4.8, ...S }), el('circle', { cx: 12, cy: 12, r: 1.8, ...F })],
  globe: () => [el('circle', { cx: 12, cy: 12, r: 8.5, ...S }), el('ellipse', { cx: 12, cy: 12, rx: 3.8, ry: 8.5, ...S }), el('path', { d: 'M3.5 12h17', ...S })],
  stack: () => [el('path', { d: 'M5.5 5.5v13M9.5 5.5v13M13.5 5.5v13M17.5 5.5v13M3.5 15.5l17-6', ...S })],
  chain: () => [el('rect', { x: 2.5, y: 8, width: 11, height: 8, rx: 4, ...S }), el('rect', { x: 10.5, y: 8, width: 11, height: 8, rx: 4, ...S })],
  calendar: () => [el('rect', { x: 4, y: 5.5, width: 16, height: 15, rx: 2.2, ...S }), el('path', { d: 'M4 10h16M8.5 3.5v4M15.5 3.5v4', ...S }),
    el('circle', { cx: 12, cy: 15, r: 2, ...F })],
  clock: () => [el('circle', { cx: 12, cy: 12, r: 8.5, ...S }), el('path', { d: 'M12 7v5.2l3.4 2.2', ...S })],
  sun: () => [el('circle', { cx: 12, cy: 12, r: 4.2, ...F }),
    el('path', { d: 'M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8', ...S })],
  moon: () => [el('path', { d: 'M15.5 3.5a8.5 8.5 0 1 0 5 14.2A7.4 7.4 0 0 1 15.5 3.5z', ...F })],
  rain: () => [el('path', { d: 'M7 14.5h10a3.8 3.8 0 0 0 .6-7.6A5.2 5.2 0 0 0 7.5 8a3.3 3.3 0 0 0-.5 6.5z', ...F }),
    el('path', { d: 'M8 17.5l-1 3M12 17.5l-1 3M16 17.5l-1 3', ...S })],
  podium: () => [el('path', { d: 'M2.5 20.5h19M4.5 20.5v-6h5v6M9.5 20.5V10h5v10.5M14.5 20.5v-4h5v4', ...S }),
    el('path', { d: 'M12 3.2l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3z', ...F })],
  throne: () => [el('path', { d: 'M7 21v-8.5h10V21M7 12.5V4.5h10v8M5 14.5h14', ...S }),
    el('path', { d: 'M9 9.5h6l.5-3-2 1.4L12 5.6l-1.5 2.3-2-1.4z', ...F })],
  mountain: () => [el('path', { d: 'M2.5 20l6.5-11 4 6 3-4.2 5.5 9.2z', ...F }), el('path', { d: 'M9 9V3.5l4 1.5-4 1.5', ...S })],
  rocket: () => [el('path', { d: 'M12 2.5c4 3 5 8 4 12.5H8C7 10.5 8 5.5 12 2.5z', ...F }),
    el('path', { d: 'M8 13.5l-3 4h3.5M16 13.5l3 4h-3.5M10.5 18.5l1.5 3 1.5-3', ...S }), el('circle', { cx: 12, cy: 9, r: 1.7, fill: 'var(--medal-inner)' })],
  shield: () => [el('path', { d: 'M12 2.8l7.5 3v6.2c0 4.3-3 7.5-7.5 9.4-4.5-1.9-7.5-5.1-7.5-9.4V5.8z', ...S }), el('path', { d: 'M8.5 12l2.5 2.5 4.5-5', ...S })],
  swords: () => [el('path', { d: 'M4 20L15.5 8.5M20 20L8.5 8.5M15.5 8.5l1-4 3 3-4 1M8.5 8.5l-1-4-3 3 4 1M6 15.5l2.5 2.5M18 15.5L15.5 18', ...S })],
  scale: () => [el('path', { d: 'M12 3.5v16.5M8 20.5h8M4.5 7.5h15', ...S }),
    el('path', { d: 'M4.5 7.5l-3 6.5h6zM19.5 7.5l-3 6.5h6z', ...F })],
  infinity: () => [el('path', { d: 'M8 8.8a3.2 3.2 0 1 0 0 6.4c2.2 0 3.2-1.6 4-3.2s1.8-3.2 4-3.2a3.2 3.2 0 1 1 0 6.4c-2.2 0-3.2-1.6-4-3.2S10.2 8.8 8 8.8z', ...S, 'stroke-width': '2.2' })],
  heart: () => [el('path', { d: 'M12 20.5s-8-4.9-8-10.7A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 8 2.6c0 5.8-8 10.7-8 10.7z', ...F })],
  dice: () => [el('rect', { x: 4, y: 4, width: 16, height: 16, rx: 3.5, ...S }),
    ...[[8.5, 8.5], [15.5, 8.5], [12, 12], [8.5, 15.5], [15.5, 15.5]].map(([cx, cy]) => el('circle', { cx, cy, r: 1.5, ...F }))],
  trophy: () => [el('path', { d: 'M8 3.5h8v6a4 4 0 0 1-8 0z', ...F }),
    el('path', { d: 'M8 5.5H5a3 3 0 0 0 3 4.5M16 5.5h3a3 3 0 0 1-3 4.5M12 13.5v4M8 20.5h8M9.5 17.5h5', ...S })],
  bolt: () => [el('path', { d: 'M13.5 2.5L5 14h6l-1.5 7.5L19 10h-6z', ...F })],
};

let uid = 0;

/** @param {string} motif  key of MOTIFS  @param {number} level 1-based tier; 0 = not earned; -1 = earned, no levels */
export function medal(motif, level, { size = 48, locked = false, title = null } = {}) {
  const off = locked || level === 0;
  const tier = off ? null : level < 0 ? SINGLE : TIERS[Math.min(level, TIERS.length) - 1];
  const id = `m${++uid}`;
  const kids = [];
  if (title) kids.push(el('title', {}, document.createTextNode(title)));
  if (tier?.rays) {   // Götterliga: a faint radiant halo
    kids.push(el('g', { opacity: 0.55 }, ...Array.from({ length: 12 }, (_, i) =>
      el('path', { d: 'M32 1v6', stroke: tier.ring, 'stroke-width': 2.4, 'stroke-linecap': 'round', transform: `rotate(${i * 30} 32 32)` }))));
  }
  kids.push(el('defs', {}, el('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 },
    el('stop', { offset: '0', 'stop-color': off ? 'var(--medal-off)' : tier.ring }),
    el('stop', { offset: '1', 'stop-color': off ? 'var(--medal-off)' : tier.dark }))));
  kids.push(el('circle', { cx: 32, cy: 32, r: 27, fill: off ? 'none' : `url(#${id})`, stroke: off ? 'var(--medal-off)' : 'none', 'stroke-width': off ? 2 : null, 'stroke-dasharray': off ? '3 3' : null }));
  if (tier?.stars) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 2 * Math.PI, x = 32 + 24 * Math.sin(a), y = 32 - 24 * Math.cos(a);
      kids.push(el('circle', { cx: x.toFixed(2), cy: y.toFixed(2), r: 1.2, fill: '#fff', opacity: 0.85 }));
    }
  }
  kids.push(el('circle', { cx: 32, cy: 32, r: 20.5, fill: off ? 'transparent' : 'var(--medal-inner)' }));
  kids.push(el('g', { transform: 'translate(17 17) scale(1.25)', color: off ? 'var(--medal-off)' : 'var(--medal-ink)' }, ...(MOTIFS[motif] || MOTIFS.ball)()));
  return el('svg', { viewBox: '0 0 64 64', width: size, height: size, class: 'medal' + (off ? ' off' : ''), role: title ? 'img' : 'presentation', 'aria-hidden': title ? null : 'true' }, ...kids);
}

export const MOTIF_NAMES = Object.keys(MOTIFS);
