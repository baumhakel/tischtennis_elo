// Doppelspezialist: who is relatively stronger in doubles than in singles? Compares the Wertungen
// Einzel and Doppel, so it ignores the Wertung switch (documented exception).
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { viewHead, tableView, linkTo } from './common.js';
import { modelFor } from '../app/modes.js';
import { specialists } from './duels.js';
import { scatter } from '../ui/charts/scatter.js';

export default {
  id: 'doppelspezialist',
  title: 'Doppelspezialist',
  mount(el, ctx) {
    const update = c => render(el, page(c));
    update(ctx);
    return { update, unmount() {} };
  },
};

function page(ctx) {
  const base = ctx.baseModel, cfg = base.dataset.config;
  const E = modelFor(base, 'einzel'), D = modelFor(base, 'doppel');
  const inactive = new Set([...ctx.visible.inactive].map(k => ctx.model.elo.ids[k]));
  const rows = specialists(E, D, cfg.default_min_games_single, cfg.default_min_games_double, id => !inactive.has(id));
  const name = id => ctx.names.get(id) ?? id;
  const z = v => fmt.signed(v, 1);
  const info = [
    'Jeder Spieler hat in der Wertung „Einzel“ und in der Wertung „Doppel“ einen eigenen Elo-Wert. Weil die beiden Ligen verschieden streuen, werden die Werte innerhalb jeder Wertung standardisiert: Abstand zum Mittelwert in Standardabweichungen (z-Wert).',
    'Punkte über der Diagonale: im Doppel relativ stärker als im Einzel. Spezialistenwert = z(Doppel) − z(Einzel).',
    `Dabei sind alle, die mindestens ${cfg.default_min_games_single} Einzel und ${cfg.default_min_games_double} Doppel gespielt haben und nicht länger als ${ctx.filters.inactivityDays} Tage pausieren. Diese Seite vergleicht die beiden Wertungen und hängt deshalb nicht vom Schalter ab.`,
  ];
  const head = viewHead('Doppelspezialist', 'Wer ist im Doppel stärker als im Einzel?', { info });
  if (rows.length < 3) return [head, h('p', { class: 'empty' }, 'Noch zu wenige Spieler mit genug Einzeln und Doppeln.')];
  const link = id => linkTo(ctx, 'player', { id });
  const top = rows[0], bottom = rows[rows.length - 1];
  return [
    head,
    scatter({
      ariaLabel: 'Streudiagramm: Elo im Einzel gegen Elo im Doppel, standardisiert',
      xLabel: 'Einzel (z-Wert)', yLabel: 'Doppel (z-Wert)', diagonalLabel: 'gleich stark',
      points: rows.map(r => ({ x: r.zsingle, y: r.zdouble, label: name(r.id), title: `${name(r.id)}: Einzel ${fmt.elo(r.single)}, Doppel ${fmt.elo(r.double)}`, highlight: r.id === ctx.me?.id, ...link(r.id) })),
    }),
    h('p', { class: 'chart-note' }, `Am meisten Doppelspezialist: ${name(top.id)} (${z(top.score)}). Am meisten Einzelspezialist: ${name(bottom.id)} (${z(bottom.score)}).`),
    tableView('Tabelle anzeigen', ['Spieler', 'Einzel', 'Doppel', 'Spezialist'],
      rows.map(r => [name(r.id), `${fmt.elo(r.single)} (${z(r.zsingle)})`, `${fmt.elo(r.double)} (${z(r.zdouble)})`, z(r.score)]),
      [1, 2, 3], rows.map(r => link(r.id))),
  ];
}
