// Kalibrierung: do the Elo win chances match what actually happens?
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { seriesColor, css } from '../ui/colors.js';
import { lineChart } from '../ui/charts/line.js';
import { viewHead, tile, segmented, plainTable, linkTo } from './common.js';
import { binRange } from './insights.js';

const KINDS = { all: 'Alle', singles: 'Einzel', doubles: 'Doppel' };

export default {
  id: 'calibration',
  title: 'Kalibrierung',
  mount(el, ctx) {
    const head = h('div'), tiles = h('div', { class: 'tiles' }), chartEl = h('div'), note = h('p', { class: 'chart-note' }), table = h('div');
    render(el, head, tiles, chartEl, note, table);
    let chart = null;
    function update(c) {
      const kind = c.mode === 'alle' && KINDS[c.params.art] ? c.params.art : 'all';   // in Einzel/Doppel the mode is the split
      const cal = c.model.stats.get('calibration')[kind];
      render(head, viewHead('Kalibrierung', 'Stimmen die Siegchancen laut Elo mit den tatsächlichen Ergebnissen überein? Jedes Spiel wird nach der vorhergesagten Siegchance einsortiert; liegen die Punkte auf der Diagonale, passen Vorhersage und Wirklichkeit zusammen.'),
        c.mode === 'alle' ? h('div', { class: 'toolbar' }, segmented(c, { label: 'Spielart', param: 'art', value: kind, options: Object.entries(KINDS) })) : null);
      render(tiles,
        tile({ label: 'Spiele', value: fmt.int(cal.games), sub: c.mode === 'alle' ? KINDS[kind] : c.mode === 'einzel' ? 'Einzel' : 'Doppel' }),
        tile({ label: 'Log-Loss', value: Number.isFinite(cal.logLoss) ? cal.logLoss.toFixed(3).replace('.', ',') : '–', sub: 'kleiner ist besser; Münzwurf: 0,693' }),
        tile({ label: 'Brier-Score', value: Number.isFinite(cal.brier) ? cal.brier.toFixed(3).replace('.', ',') : '–', sub: 'kleiner ist besser; Münzwurf: 0,250' }),
        tile({ label: 'Favorit gewinnt', value: favourite(c, kind), sub: 'Anteil der Spiele; die Ausnahmen: Überraschungen', link: linkTo(c, 'upsets') }));

      const idx = [...cal.n.keys()].filter(b => cal.n[b] > 0);
      if (idx.length < 2) {
        chart?.destroy(); chart = null; chartEl.replaceChildren(h('p', { class: 'empty' }, 'Noch zu wenige Spiele für dieses Diagramm.'));
      } else {
        const x = idx.map(b => cal.predicted[b]);
        const spec = {
          x, xType: 'num', height: 300, xRange: [0, 1], y: { range: [0, 1], fmt: v => `${Math.round(100 * v)} %` },
          xFmt: v => `${Math.round(100 * v)} %`,
          xLabel: v => `vorhergesagt ${fmt.pct(v)}`,
          series: [
            { label: 'perfekt', values: x.slice(), context: true, color: css('--axis'), width: 1 },
            { label: 'tatsächlich', values: idx.map(b => cal.observed[b]), color: seriesColor(0), width: 2, points: true },
          ],
        };
        if (!chart) { chartEl.replaceChildren(); chart = lineChart(chartEl, spec); } else chart.update(spec);
      }
      note.textContent = 'x-Achse: vorhergesagte Siegchance, y-Achse: tatsächlicher Anteil der Siege. Jedes Spiel zählt zweimal, aus Sicht beider Seiten; deshalb ist das Bild symmetrisch.';
      const bins = cal.n.length;
      const rangeOf = b => { const r = binRange(b, bins); return `${fmt.pct(r.lo)} bis ${fmt.pct(r.hi)}`; };
      render(table, h('h2', {}, 'Nach Siegchance'),
        h('p', { class: 'lead' }, 'Tippe auf einen Bereich: Wer gewinnt dort öfter oder seltener, als Elo erwartet?'),
        plainTable(['Siegchance', 'Vorhergesagt', 'Tatsächlich', 'Seiten'],
          idx.map(b => [rangeOf(b), fmt.pct(cal.predicted[b]), fmt.pct(cal.observed[b]), fmt.int(cal.n[b])]), [1, 2, 3],
          idx.map(b => linkTo(c, 'siegchance', { chance: binRange(b, bins).param, art: kind === 'all' ? null : kind }))));
    }
    update(ctx);
    return { update, unmount() { chart?.destroy(); } };
  },
};

/** Share of games won by the Elo favourite (ties at exactly 50 % count half). */
function favourite(ctx, kind) {
  const { perGame, slots } = ctx.model.elo;
  let won = 0, n = 0;
  for (let g = 0; g < perGame.eW.length; g++) {
    const dbl = slots[4 * g + 1] !== -1;
    if ((kind === 'singles' && dbl) || (kind === 'doubles' && !dbl)) continue;
    n++;
    won += perGame.eW[g] > 0.5 ? 1 : perGame.eW[g] === 0.5 ? 0.5 : 0;
  }
  return n ? fmt.pct(won / n) : '–';
}
