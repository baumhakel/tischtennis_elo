// Small SVG scatter with labelled points and a diagonal (Doppelspezialist). No library.
// points: [{ x, y, label, href, onclick, highlight }]; axes are in the same units (z-scores),
// the square plot keeps the diagonal at 45°. Colours come from CSS variables, so light and dark work.
const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, text) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  return el;
}

export function scatter({ points, xLabel, yLabel, ariaLabel, diagonalLabel }) {
  const S = 340, P = 36;                                  // size and padding (layout only)
  const all = points.flatMap(p => [p.x, p.y]);
  const lim = Math.max(1, Math.ceil(Math.max(...all.map(Math.abs)) * 2) / 2 + 0.25);
  const sx = v => P + (v + lim) / (2 * lim) * (S - 2 * P), sy = v => S - P - (v + lim) / (2 * lim) * (S - 2 * P);
  const root = svg('svg', { viewBox: `0 0 ${S} ${S}`, role: 'img', 'aria-label': ariaLabel, class: 'scatter' });
  // grid at whole units, axes through 0
  for (let v = -Math.floor(lim); v <= Math.floor(lim); v++) {
    root.appendChild(svg('line', { x1: sx(v), x2: sx(v), y1: sy(-lim), y2: sy(lim), class: v ? 'grid' : 'axis' }));
    root.appendChild(svg('line', { y1: sy(v), y2: sy(v), x1: sx(-lim), x2: sx(lim), class: v ? 'grid' : 'axis' }));
  }
  root.appendChild(svg('line', { x1: sx(-lim), y1: sy(-lim), x2: sx(lim), y2: sy(lim), class: 'diag' }));
  root.appendChild(svg('text', { x: sx(lim) - 4, y: sy(lim) + 12, 'text-anchor': 'end', class: 'note' }, diagonalLabel));
  root.appendChild(svg('text', { x: S / 2, y: S - 6, 'text-anchor': 'middle', class: 'label' }, xLabel));
  root.appendChild(svg('text', { x: 12, y: S / 2, 'text-anchor': 'middle', transform: `rotate(-90 12 ${S / 2})`, class: 'label' }, yLabel));
  for (const p of points) {
    const a = svg('a', { href: p.href, class: 'pt' + (p.highlight ? ' me' : '') });
    if (p.onclick) a.addEventListener('click', p.onclick);
    a.appendChild(svg('title', {}, p.title || p.label));
    a.appendChild(svg('circle', { cx: sx(p.x), cy: sy(p.y), r: 5 }));
    a.appendChild(svg('text', { x: sx(p.x) + 7, y: sy(p.y) + 4, class: 'name' }, p.label));
    root.appendChild(a);
  }
  return root;
}
