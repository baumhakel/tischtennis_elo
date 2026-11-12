// Elo-Bewegung: how much rating moves through the league, rolling over the last N games,
// with the "normal" range (between the calm and turbulent percentiles) as a band.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { seriesColor, css, withAlpha } from '../ui/colors.js';
import { movementSeries } from '../ui/series.js';
import { lineChart } from '../ui/charts/line.js';
import { viewHead, tile, tableView, linkTo } from './common.js';

const LEVEL = { calm: 'ruhig', normal: 'normal', turbulent: 'turbulent' };

export default {
  id: 'movement',
  title: 'Elo-Bewegung',
  mount(el, ctx) {
    const head = h('div'), tiles = h('div', { class: 'tiles' }), chartEl = h('div'), note = h('p', { class: 'chart-note' }), table = h('div');
    render(el, head, tiles, chartEl, note, table);
    let chart = null;
    function update(c) {
      const cfg = c.model.dataset.config;
      const axis = c.filters.xAxis === 'own' ? 'game' : c.filters.xAxis;
      const s = movementSeries(c.model, axis);
      const { mv } = s;
      render(head, viewHead('Elo-Bewegung',
        `Wie viele Elo-Punkte pro Spiel den Besitzer wechseln, gemittelt über die jeweils letzten ${cfg.movement_window} Spiele. Das graue Band zeigt den üblichen Bereich (${cfg.movement_calm_percentile}. bis ${cfg.movement_turbulent_percentile}. Perzentil): Darüber ist es turbulent, darunter ruhig.`));
      render(tiles,
        tile({ label: 'Gerade', value: LEVEL[mv.level] || '–', sub: Number.isFinite(mv.percentile) ? `bewegter als ${Math.round(mv.percentile)} % der bisherigen Zeit` : 'Noch zu wenige Spiele.' }),
        tile({ label: 'Aktueller Mittelwert', value: fmt.dec1(mv.current), sub: `Elo-Punkte pro Spiel; die letzten ${cfg.movement_window} Spiele ansehen`,
          link: linkTo(c, 'spiele', { letzte: String(cfg.movement_window), sortierung: 'elo' }) }),
        tile({ label: 'Ruhig bis', value: fmt.dec1(mv.calmAt), sub: `${cfg.movement_calm_percentile}. Perzentil` }),
        tile({ label: 'Turbulent ab', value: fmt.dec1(mv.turbulentAt), sub: `${cfg.movement_turbulent_percentile}. Perzentil` }));
      const c1 = seriesColor(0);
      const spec = {
        x: s.x, xType: axis === 'date' ? 'time' : 'num', height: 260,
        y: { fmt: v => fmt.dec1(v) },
        series: [
          { label: `${cfg.movement_turbulent_percentile}. Perzentil`, values: s.turbulent, context: true },
          { label: `${cfg.movement_calm_percentile}. Perzentil`, values: s.calm, context: true },
          { label: `Mittel über ${cfg.movement_window} Spiele`, values: s.rolling, color: c1, width: 2 },
        ],
        bands: [{ upper: 0, lower: 1, color: withAlpha(css('--axis'), 0.18) }],
      };
      if (!chart) chart = lineChart(chartEl, spec); else chart.update(spec);
      note.textContent = 'Vor dem Start der Formulareinträge sind die Zeitpunkte geschätzt.';
      render(table, tableView('Als Tabelle anzeigen', ['Kennzahl', 'Elo-Punkte pro Spiel'], [
        ['Aktueller Mittelwert', fmt.dec1(mv.current)],
        [`${cfg.movement_calm_percentile}. Perzentil`, fmt.dec1(mv.calmAt)],
        [`${cfg.movement_turbulent_percentile}. Perzentil`, fmt.dec1(mv.turbulentAt)],
      ], [1]));
    }
    update(ctx);
    return { update, unmount() { chart?.destroy(); } };
  },
};
