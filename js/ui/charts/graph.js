// Network graph: d3-force for the layout, plain SVG for drawing.
// The layout comes from the selected metric: the stronger a connection, the more the two
// players attract each other. Arrowheads are drawn per edge, in the edge's colour and opacity.
import { loadD3 } from './d3.js';
import { css } from '../colors.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

// Layout physics (visual tuning of the drawing, not a statistic).
const LAYOUT = { ticks: 300, charge: -260, collide: 30, minDist: 50, extraDist: 150, minStrength: 0.03, extraStrength: 0.7 };
const layoutCache = new Map();

/** Static force layout; cached per key. nodes: [{ k }], links: [{ i, j, w ∈ [0,1] }]. */
async function layout(key, nodes, links) {
  if (layoutCache.has(key)) return layoutCache.get(key);
  const d3 = await loadD3();
  const N = nodes.length;
  const ns = nodes.map((n, idx) => ({ id: n.k, x: 200 * Math.cos(2 * Math.PI * idx / N), y: 200 * Math.sin(2 * Math.PI * idx / N) }));
  const ls = links.map(l => ({ source: l.i, target: l.j, w: l.w }));
  const sim = d3.forceSimulation(ns)
    .force('link', d3.forceLink(ls).id(d => d.id)
      .strength(d => LAYOUT.minStrength + LAYOUT.extraStrength * d.w)
      .distance(d => LAYOUT.minDist + LAYOUT.extraDist * (1 - d.w)))
    .force('charge', d3.forceManyBody().strength(LAYOUT.charge))
    .force('collide', d3.forceCollide(LAYOUT.collide))
    .force('center', d3.forceCenter(0, 0))
    .stop();
  for (let t = 0; t < LAYOUT.ticks; t++) sim.tick();
  const pos = new Map(ns.map(n => [n.id, { x: n.x, y: n.y }]));
  layoutCache.set(key, pos);
  return pos;
}

/**
 * @param {HTMLElement} el
 * @param {{ key: string, nodes: {k, label, color}[], layoutLinks: {i,j,w}[], edges: {i,j,w,sign}[],
 *           mode: 'undirected'|'directed'|'signed', edgeLabel: (e) => string }} spec
 */
export async function drawGraph(el, spec) {
  const pos = await layout(spec.key, spec.nodes, spec.layoutLinks);
  const xs = [...pos.values()].map(p => p.x), ys = [...pos.values()].map(p => p.y);
  const pad = 46;
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  const root = svg('svg', { viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}`, role: 'img',
    'aria-label': `Netzwerk: ${spec.nodes.length} Spieler, ${spec.edges.length} Verbindungen` });

  const ink = css('--ink'), pos1 = css('--div-pos'), neg = css('--div-neg');
  const R = 9, HEAD = 9;                              // node radius, arrowhead length (px in layout units)
  const edgesG = svg('g');
  for (const e of spec.edges.slice().sort((a, b) => a.w - b.w)) {
    const a = pos.get(e.i), b = pos.get(e.j);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const color = spec.mode === 'signed' ? (e.sign > 0 ? pos1 : neg) : ink;
    const opacity = (0.06 + 0.8 * e.w * e.w).toFixed(2);   // weak edges fade out, strong ones carry the picture
    const width = 0.5 + 3.5 * e.w;
    const tipX = b.x - ux * (R + 2), tipY = b.y - uy * (R + 2);
    const directed = spec.mode === 'directed';
    const g = svg('g', { opacity });
    g.appendChild(svg('line', {
      x1: a.x + ux * R, y1: a.y + uy * R,
      x2: directed ? tipX - ux * HEAD * 0.8 : b.x - ux * R, y2: directed ? tipY - uy * HEAD * 0.8 : b.y - uy * R,
      stroke: color, 'stroke-width': width.toFixed(2), 'stroke-linecap': 'round',
    }));
    if (directed) {
      const hw = Math.max(3.5, width * 1.1);              // head half-width grows a little with the line
      const bx = tipX - ux * HEAD, by = tipY - uy * HEAD;
      g.appendChild(svg('path', {
        d: `M${tipX.toFixed(1)},${tipY.toFixed(1)} L${(bx - uy * hw).toFixed(1)},${(by + ux * hw).toFixed(1)} L${(bx + uy * hw).toFixed(1)},${(by - ux * hw).toFixed(1)} Z`,
        fill: color,
      }));
    }
    const title = svg('title'); title.textContent = spec.edgeLabel(e); g.appendChild(title);
    edgesG.appendChild(g);
  }
  root.appendChild(edgesG);

  const nodesG = svg('g');
  for (const n of spec.nodes) {
    const p = pos.get(n.k);
    const g = svg('g', { class: 'node', transform: `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})` });
    g.appendChild(svg('circle', { r: R, fill: n.color }));
    const t = svg('text', { y: R + 14, 'text-anchor': 'middle' });
    t.textContent = n.label;
    g.appendChild(t);
    nodesG.appendChild(g);
  }
  root.appendChild(nodesG);
  el.replaceChildren(root);
}
