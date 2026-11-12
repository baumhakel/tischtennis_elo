// Matrix-Explorer: one metric at a time, as a matrix (row against column) or as a network graph.
// Table: a cell opens the Direktvergleich, a heading the profile. Network: tapping a player highlights
// their connections and offers the profile below the graph; tapping elsewhere resets.
import { h, render } from '../ui/dom.js';
import { seriesColor, css } from '../ui/colors.js';
import { hideTip } from '../ui/tooltip.js';
import { matrixTable } from './matrix-table.js';
import { drawGraph } from '../ui/charts/graph.js';
import { METRICS, metricById, order, edges } from './matrix-metrics.js';
import { viewHead, paramSelect, nameOf, linkTo, profileLink } from './common.js';

export default {
  id: 'matrix',
  title: 'Matrix',
  mount(el, ctx) {
    const head = h('div'), body = h('div');
    render(el, head, body);
    let token = 0;
    async function update(c) {
      const metric = metricById(c.params.metrik);
      const mode = c.params.darstellung === 'graph' ? 'graph' : 'matrix';
      const how = ['elo', 'name', 'cluster'].includes(c.params.ordnung) ? c.params.ordnung : 'elo';
      render(head, viewHead('Matrix', metric.lead),
        h('div', { class: 'toolbar' },
          paramSelect(c, { label: 'Kennzahl', param: 'metrik', value: metric.id, options: METRICS.map(m => [m.id, m.label]) }),
          paramSelect(c, { label: 'Darstellung', param: 'darstellung', value: mode, options: [['matrix', 'Tabelle'], ['graph', 'Netzwerk']] }),
          mode === 'matrix' ? paramSelect(c, { label: 'Reihenfolge', param: 'ordnung', value: how,
            options: [['elo', 'nach Elo-Wert'], ['cluster', 'nach Spielgruppen'], ['name', 'nach Name']] }) : null));

      const M = c.model.stats.get('matrices');
      const n = c.model.elo.ids.length;
      const ks = order(c.visible.shown, how, { elo: c.model.elo, normed: M.matchupsNormed, names: k => nameOf(c, k) });
      if (ks.length < 2) return render(body, h('p', { class: 'empty' }, 'Zu wenige Spieler sichtbar. Unter „Filter“ die Mindestanzahl Spiele senken.'));
      const ids = c.model.elo.ids;
      if (mode === 'matrix') return render(body, matrixTable(c, M[metric.stat], n, ks, metric, {
        cell: (i, j) => linkTo(c, 'h2h', { a: ids[i], b: ids[j] }),
        head: k => profileLink(c, k),
      }));

      const my = ++token;
      const shown = edges(M[metric.stat], n, ks, metric);
      const box = h('div', { class: 'graph chart' });
      const picked = h('div', { class: 'graph-pick' });
      const onSelect = k => render(picked, k == null
        ? h('p', { class: 'chart-note' }, 'Tippe auf einen Spieler, um seine Verbindungen hervorzuheben.')
        : h('nav', { class: 'links' }, h('a', { class: 'tap', ...profileLink(c, k) }, `Profil von ${nameOf(c, k)}`)));
      onSelect(null);
      render(body, box, picked, h('p', { class: 'chart-note' }, graphNote(metric)));
      try {
        await drawGraph(box, {
          key: `${c.model.dataset.hash}|${metric.id}|${ks.slice().sort((a, b) => a - b).join(',')}`,
          nodes: ks.map(k => ({ k, label: nameOf(c, k), color: c.focus.slotOf.has(k) ? seriesColor(c.focus.slotOf.get(k)) : css('--axis') })),
          // attraction from the selected metric; for signed metrics only positive links pull
          layoutLinks: shown.filter(e => metric.graph !== 'signed' || e.sign > 0),
          edges: shown,
          mode: metric.graph,
          edgeLabel: e => `${nameOf(c, e.i)} – ${nameOf(c, e.j)}: ${metric.fmt(M[metric.stat][e.i * n + e.j])}`,
          onSelect,
        });
      } catch (err) {
        if (my === token) render(box, h('p', { class: 'error' }, err.message));
      }
    }
    update(ctx);
    return { update, unmount() { hideTip(); } };
  },
};

function graphNote(metric) {
  if (metric.graph === 'directed') return 'Pfeile zeigen vom überlegenen zum unterlegenen Spieler. Je deutlicher der Vorsprung, desto dicker und dunkler der Pfeil und desto näher liegen die beiden.';
  if (metric.graph === 'signed') return 'Blau: spielen öfter gegeneinander als zufällig, rot: seltener. Je stärker die Abweichung, desto dicker die Linie; nur blaue Verbindungen ziehen die Punkte zusammen.';
  return 'Je größer der Wert, desto dicker und dunkler die Linie und desto näher liegen die beiden Spieler.';
}
