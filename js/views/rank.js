// Rangverlauf: rank after every game (bump chart). Only players with at least the min-games
// number of games at that time are ranked, so newcomers enter the chart once they qualify.
import { h, render } from '../ui/dom.js';
import { seriesColor, css } from '../ui/colors.js';
import { rankSeries } from '../ui/series.js';
import { lineChart } from '../ui/charts/line.js';
import { focusLegend, tableView, viewHead, nameOf, profileLink } from './common.js';

export default {
  id: 'rank',
  title: 'Rangverlauf',
  mount(el, ctx) {
    const head = h('div'), legend = h('div'), chartEl = h('div'), note = h('p', { class: 'chart-note' }), table = h('div');
    render(el, head, legend, chartEl, note, table);
    let chart = null;
    function update(c) {
      render(head, viewHead('Rangverlauf', null, { info: `Platz nach jedem Spiel. In der Rangliste steht, wer zu diesem Zeitpunkt mindestens ${c.filters.minGames} Spiele hatte. Bei Gleichstand teilen sich die Spieler den besseren Platz.` }));
      render(legend, focusLegend(c));
      const axis = c.filters.xAxis === 'own' ? 'game' : c.filters.xAxis;
      const context = c.visible.shown.filter(k => !c.focus.slotOf.has(k));
      const ks = [...context, ...c.focus.slotOf.keys()];
      const { x, ys, maxRank } = rankSeries(c.model, ks, axis, c.filters.minGames);
      const ctxColor = css('--context-line');
      const spec = {
        x, xType: axis === 'date' ? 'time' : 'num', height: 340,
        y: { invert: true, ints: true, range: [0.5, maxRank + 0.5], fmt: v => `${Math.round(v)}.` },
        series: ks.map((k, i) => {
          const slot = c.focus.slotOf.get(k);
          return { label: nameOf(c, k), values: ys[i], stepped: true, context: slot == null,
            color: slot == null ? ctxColor : seriesColor(slot), width: slot == null ? 1 : 2.5 };
        }),
      };
      if (!chart) chart = lineChart(chartEl, spec); else chart.update(spec);
      note.textContent = c.filters.xAxis === 'own' ? 'Die x-Achse zeigt hier die Spielnummer: Eine gemeinsame Rangliste lässt sich nicht nach eigenen Spielen ordnen.' : '';
      const rk = c.model.stats.get('ranks', { minGames: c.filters.minGames });
      const n = c.model.elo.ids.length, last = c.model.dataset.games.length - 1;
      const now = c.visible.shown.filter(k => last >= 0 && rk.rank[last * n + k] > 0)
        .sort((a, b) => rk.rank[last * n + a] - rk.rank[last * n + b]);
      const rec = c.model.stats.get('records', { minGames: c.filters.minGames });
      render(table, tableView('Als Tabelle anzeigen', ['Platz', 'Spieler', 'Spiele auf Platz 1', 'Tage auf Platz 1'],
        now.map(k => [`${rk.rank[last * n + k]}.`, nameOf(c, k), String(rec.leaderGames[k]), String(Math.round(rec.leaderDays[k]))]),
        [0, 2, 3], now.map(k => profileLink(c, k))));
    }
    update(ctx);
    return { update, unmount() { chart?.destroy(); } };
  },
};
