// Line chart adapter around uPlot. The only file that knows uPlot's API (besides the rank chart's
// options passed through here), so the library stays swappable.
//
// lineChart(el, spec) → { update(spec), destroy() }
// spec = {
//   x: number[],                        shared x (seconds for xType 'time')
//   xType: 'time' | 'num',
//   series: [{ label, values, color, width?, stepped?, spanGaps?, context? }],
//            context = thin neutral line, listed after the focused ones in the tooltip
//   bands:  [{ upper, lower, color }],  indices into series; the two series are drawn invisible
//   y: { invert?, range?: [min, max], ints?, fmt?: v => string },
//   height?: number,
//   xLabel?: (x) => string,             tooltip heading for an x value
//   xFmt?: (x) => string, xRange?: [min, max]   numeric x axis labels / fixed range
//   series[].points: draw point markers (calibration)
//   series[].face: { img, text } a face at the end of the line (Phase 18b): the image, or the initials
// }
import uPlot from '../../vendor/uPlot.esm.js';
import { chrome, onThemeChange } from '../colors.js';
import { showTip, hideTip } from '../tooltip.js';
import { h } from '../dom.js';
import { fromSeconds } from '../series.js';
import { serialToParts } from '../../core/normalize.js';

const MONTHS = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const pad = n => String(n).padStart(2, '0');

/** Axis labels for a time axis: 14:30 within two days, 9.11. up to four months, "Mär 26" beyond. */
function dateTicks(u, splits) {
  const span = (u.scales.x.max - u.scales.x.min) / 86400;
  return splits.map(s => {
    const p = serialToParts(fromSeconds(s));
    if (span <= 2) return `${pad(p.h)}:${pad(p.mi)}`;
    return span > 120 ? `${MONTHS[p.mo - 1]} ${String(p.y).slice(2)}` : `${p.d}.${p.mo}.`;
  });
}

export function dateLabel(s) {
  const p = serialToParts(fromSeconds(s));
  return `${pad(p.d)}.${pad(p.mo)}.${p.y}, ${pad(p.h)}:${pad(p.mi)}`;
}

function options(spec, width) {
  const c = chrome();
  const time = spec.xType === 'time';
  const yfmt = spec.y?.fmt || (v => String(Math.round(v)));
  const bandIdx = new Set((spec.bands || []).flatMap(b => [b.upper, b.lower]));
  const axis = {
    stroke: c.muted,
    grid: { stroke: c.grid, width: 1 },
    ticks: { stroke: c.grid, width: 1, size: 4 },
    font: '12px system-ui, sans-serif',
  };
  return {
    width,
    height: spec.height || 260,
    legend: { show: false },
    cursor: { y: false, points: { show: false }, drag: { x: false, y: false, setScale: false } },
    scales: {
      x: { time, ...(spec.xRange ? { range: () => spec.xRange } : {}) },
      y: {
        dir: spec.y?.invert ? -1 : 1,
        ...(spec.y?.range ? { range: () => spec.y.range } : {}),
      },
    },
    axes: [
      { ...axis, space: 64, values: time ? dateTicks : (u, sp) => sp.map(spec.xFmt || (v => String(Math.round(v)))) },
      {
        ...axis, size: 46, values: (u, sp) => sp.map(yfmt),
        ...(spec.y?.ints ? { splits: (u, i, min, max) => intSplits(min, max) } : {}),
      },
    ],
    series: [{}, ...spec.series.map((s, i) => ({
      label: s.label,
      stroke: bandIdx.has(i) ? 'transparent' : s.color,
      width: bandIdx.has(i) ? 0 : (s.width ?? (s.context ? 1 : 2)),
      spanGaps: !!s.spanGaps,
      points: s.points ? { show: true, size: 7, fill: s.color, stroke: s.color } : { show: false },
      ...(s.stepped ? { paths: uPlot.paths.stepped({ align: 1 }) } : {}),
    }))],
    bands: (spec.bands || []).map(b => ({ series: [b.upper + 1, b.lower + 1], fill: b.color })),
    hooks: {
      setCursor: [u => tooltip(u, spec)],
      draw: spec.series.some(s => s.face) ? [u => drawFaces(u, spec)] : [],
    },
  };
}

/**
 * Faces at the last point of each line that has one (Phase 18b). Pushed apart vertically when two would overlap,
 * kept inside the plot. The ring has the line's colour, so face and line belong together.
 */
function drawFaces(u, spec) {
  const px = uPlot.pxRatio || 1, r = 11 * px;
  const { left, top, width, height } = u.bbox;
  const ends = [];
  spec.series.forEach((s, j) => {
    if (!s.face) return;
    let i = s.values.length - 1;
    while (i >= 0 && s.values[i] == null) i--;
    if (i < 0) return;
    const x = Math.min(left + width - r - px, Math.max(left + r, u.valToPos(spec.x[i], 'x', true)));
    const y = u.valToPos(s.values[i], 'y', true);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    ends.push({ s, x, y });
  });
  ends.sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) {
    const a = ends[k - 1], b = ends[k];
    if (Math.abs(a.x - b.x) < 2 * r && b.y - a.y < 2 * r + px) b.y = a.y + 2 * r + px;
  }
  const over = ends.length ? ends.at(-1).y + r - (top + height) : 0;
  if (over > 0) ends.forEach(e => { e.y -= over; });
  const g = u.ctx, c = chrome();
  g.save();
  for (const { s, x, y } of ends) {
    g.save();
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.closePath();
    g.fillStyle = c.surface || '#fff'; g.fill();
    g.clip();
    if (s.face.img?.complete && s.face.img.naturalWidth) g.drawImage(s.face.img, x - r, y - r, 2 * r, 2 * r);
    else {
      g.fillStyle = c.muted; g.font = `600 ${Math.round(10 * px)}px system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(s.face.text, x, y + px);
    }
    g.restore();
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
    g.lineWidth = 2 * px; g.strokeStyle = s.color; g.stroke();
  }
  g.restore();
}

/** Value of a gappy series at index i, linearly between its nearest values (null outside its range). */
function interpolate(x, ys, i) {
  let a = i - 1, b = i + 1;
  while (a >= 0 && ys[a] == null) a--;
  while (b < ys.length && ys[b] == null) b++;
  if (a < 0 || b >= ys.length) return null;
  return ys[a] + (ys[b] - ys[a]) * (x[i] - x[a]) / (x[b] - x[a]);
}

function intSplits(min, max) {
  const lo = Math.ceil(min), hi = Math.floor(max);
  const step = Math.max(1, Math.ceil((hi - lo + 1) / 8));
  const out = [];
  for (let v = lo; v <= hi; v += step) out.push(v);
  return out;
}

/** One tooltip, every series: focused (coloured) first, then the context lines, by value. */
function tooltip(u, spec) {
  const i = u.cursor.idx;
  if (i == null || u.cursor.left == null || u.cursor.left < 0) return hideTip();
  const x = spec.x[i];
  const yfmt = spec.y?.fmt || (v => String(Math.round(v)));
  const bandIdx = new Set((spec.bands || []).flatMap(b => [b.upper, b.lower]));
  const rows = spec.series
    .map((s, j) => ({ s, j, v: s.values[i] ?? (s.spanGaps ? interpolate(spec.x, s.values, i) : null) }))
    .filter(({ v, j }) => v != null && !bandIdx.has(j));
  const sorter = (a, b) => (spec.y?.invert ? a.v - b.v : b.v - a.v);
  const focus = rows.filter(r => !r.s.context).sort(sorter);
  const context = rows.filter(r => r.s.context).sort(sorter);
  const MAX_CONTEXT_ROWS = 6;   // tooltip size on phones; the rest is summarised
  const row = ({ s, v }) => h('div', { class: 'tip-row' },
    h('span', { class: 'key', style: s.context ? '' : `background:${s.color}` }),
    h('span', { class: 'val' }, yfmt(v)),
    h('span', { class: 'lbl' }, s.label));
  const rect = u.over.getBoundingClientRect();
  showTip([
    h('div', { class: 'tip-head' }, spec.xLabel ? spec.xLabel(x) : spec.xType === 'time' ? dateLabel(x) : `Spiel ${x}`),
    ...focus.map(row),
    ...context.slice(0, MAX_CONTEXT_ROWS).map(row),
    context.length > MAX_CONTEXT_ROWS ? h('div', { class: 'tip-more' }, `und ${context.length - MAX_CONTEXT_ROWS} weitere`) : null,
  ], rect.left + u.cursor.left, rect.top + (u.cursor.top ?? 0));
}

export function lineChart(el, spec) {
  el.classList.add('chart');
  let current = spec, u = null;

  function build() {
    if (u) u.destroy();
    const width = Math.max(240, el.clientWidth - 8);
    u = new uPlot(options(current, width), [current.x, ...current.series.map(s => s.values)], el);
    u.over.addEventListener('mouseleave', hideTip);
  }
  build();

  const ro = new ResizeObserver(() => {
    const w = Math.max(240, el.clientWidth - 8);
    if (u && Math.abs(u.width - w) > 2) u.setSize({ width: w, height: current.height || 260 });
  });
  ro.observe(el);
  const offTheme = onThemeChange(build);

  return {
    update(next) { current = next; build(); },
    destroy() { ro.disconnect(); offTheme(); hideTip(); if (u) u.destroy(); u = null; },
  };
}
