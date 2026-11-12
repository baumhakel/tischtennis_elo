// Shaded matrix table (row against column), shared by Matrix and Doppelpartner.
import { h } from '../ui/dom.js';
import { sequential, diverging, textOn } from '../ui/colors.js';
import { showTip, hideTip } from '../ui/tooltip.js';
import { cells } from './matrix-metrics.js';
import { nameOf } from './common.js';

/**
 * metric = { label, kind 'seq'|'div', mid?, fmt, note? }. Returns [table wrapper, scale, note].
 * links (optional): { cell(i, j) → link props | null, head(k) → link props } make cells and headings tappable.
 */
export function matrixTable(ctx, M, n, ks, metric, links = null) {
  const { vals, t, max, maxAbs } = cells(M, n, ks, metric);
  const color = metric.kind === 'seq' ? sequential : diverging;
  const short = k => { const s = nameOf(ctx, k); return s.length > 10 ? s.slice(0, 9) + '…' : s; };
  const head = k => (links?.head ? h('a', { class: 'head-link', ...links.head(k) }, short(k)) : short(k));
  const table = h('table', { class: 'matrix' },
    h('caption', { class: 'sr' }, `${metric.label}: Zeile gegen Spalte`),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, h('span', { class: 'sr' }, 'Zeile gegen Spalte')),
      ks.map(k => h('th', { scope: 'col', title: nameOf(ctx, k) }, head(k))))),
    h('tbody', {}, ks.map((i, a) => h('tr', {},
      h('th', { scope: 'row' }, head(i)),
      ks.map((j, b) => {
        if (i === j) return h('td', { class: 'diag' });
        const v = vals[a][b];
        if (!Number.isFinite(v)) return h('td', {});
        const fill = color(t[a][b]);
        const label = `${nameOf(ctx, i)} gegen ${nameOf(ctx, j)}: ${metric.fmt(v)}`;
        const L = links?.cell?.(i, j);
        return h('td', {
          style: `background:${fill};color:${textOn(fill)}`, 'aria-label': label, class: L ? 'cell-link' : null,
          onpointerenter: e => showTip(label, e.clientX, e.clientY), onpointerleave: hideTip,
        }, L ? h('a', { ...L, onclick: e => { hideTip(); L.onclick(e); } }, metric.fmt(v)) : metric.fmt(v));
      })))));
  const scale = metric.kind === 'seq'
    ? h('div', { class: 'scale' }, '0', h('span', { class: 'bar', style: `background:linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map(sequential).join(',')})` }), metric.fmt(max))
    : h('div', { class: 'scale' }, metric.fmt((metric.mid ?? 0) - maxAbs),
        h('span', { class: 'bar', style: `background:linear-gradient(90deg, ${[-1, -0.5, 0, 0.5, 1].map(diverging).join(',')})` }),
        metric.fmt((metric.mid ?? 0) + maxAbs));
  return [h('div', { class: 'matrix-wrap' }, table), scale,
    h('p', { class: 'chart-note' }, metric.note || 'Lesart: Zeile gegen Spalte. Leere Felder: Die beiden haben nie gegeneinander gespielt.')];
}
