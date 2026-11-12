// Verlauf: Elo curves of all shown players over a chosen time range, raw or smoothed with form band.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { seriesColor, css, withAlpha } from '../ui/colors.js';
import { ratingSeries, smoothSeries, rangeStart, RANGES } from '../ui/series.js';
import { lineChart } from '../ui/charts/line.js';
import { focusLegend, tableView, viewHead, segmented, nameOf, X_AXIS_NAMES, profileLink } from './common.js';

const RANGE_LABELS = { heute: 'Heute', aktuell: 'Aktuell', monat: 'Monat', jahr: 'Jahr', insgesamt: 'Gesamt' };

export default {
  id: 'history',
  title: 'Verlauf',
  mount(el, ctx) {
    const head = h('div'), legend = h('div'), chartEl = h('div'), empty = h('div'), note = h('p', { class: 'chart-note' }), table = h('div');
    render(el, head, legend, chartEl, empty, note, table);
    let chart = null;

    function update(c) {
      const smooth = c.params.ansicht === 'geglaettet';
      const range = RANGES.includes(c.params.zeitraum) ? c.params.zeitraum : 'insgesamt';
      const startG = rangeStart(c.model, range, c.now);
      const N = c.model.dataset.games.length;
      const cfg = c.model.dataset.config;

      render(head, viewHead('Elo-Verlauf'),
        h('div', { class: 'toolbar' },
          segmented(c, { label: 'Zeitraum', param: 'zeitraum', value: range, options: RANGES.map(r => [r, RANGE_LABELS[r]]) }),
          segmented(c, { label: 'Darstellung', param: 'ansicht', value: smooth ? 'geglaettet' : 'roh',
            options: [['roh', 'Nach jedem Spiel'], ['geglaettet', 'Geglättet']] })),
        h('p', { class: 'lead' }, rangeText(c, range, startG)));
      render(legend, focusLegend(c));

      if (startG >= N) {
        chart?.destroy(); chart = null; chartEl.replaceChildren();
        render(empty, h('p', { class: 'empty' }, range === 'heute' ? 'Heute wurde noch nicht gespielt.' : 'In diesem Zeitraum wurde nicht gespielt.'));
        note.textContent = '';
      } else {
        empty.replaceChildren();
        const spec = smooth ? smoothed(c, startG) : raw(c, startG);
        if (!chart) chart = lineChart(chartEl, spec); else chart.update(spec);
        note.textContent = `x-Achse: ${X_AXIS_NAMES[c.filters.xAxis]} (umstellbar unter „Filter“).` + (smooth
          ? ` Geglättet über ±${c.filters.xAxis === 'date' ? `${fmt.dec1(cfg.smooth_sd_days).replace(',0', '')} Tage` : `${fmt.dec1(cfg.smooth_sd_games).replace(',0', '')} Spiele`} (Standardabweichung des Gauß-Kerns); das Band zeigt, wie stark die Wertung in diesem Fenster schwankt.`
          : '');
      }
      render(table, summaryTable(c));
    }
    update(ctx);
    return { update, unmount() { chart?.destroy(); } };
  },
};

function rangeText(ctx, range, startG) {
  const games = ctx.model.dataset.games, N = games.length;
  const n = N - startG;
  const count = `${fmt.int(n)} ${n === 1 ? 'Spiel' : 'Spiele'}`;
  if (range === 'insgesamt') return N ? `Alle ${count} seit ${fmt.date(games[0].t)}.` : '';
  if (range === 'heute') return n ? `${count} heute.` : '';
  if (range === 'aktuell') {
    const cfg = ctx.model.dataset.config;
    return `Die letzten ${cfg.dashboard_days} Tage, mindestens aber die letzten ${cfg.dashboard_games} Spiele – wie auf der Übersicht. ${count} seit ${fmt.date(games[startG].t)}.`;
  }
  return n ? `${count} seit ${fmt.date(games[startG].t)}.` : '';
}

function players(ctx) {
  const context = ctx.visible.shown.filter(k => !ctx.focus.slotOf.has(k));
  return [...context, ...ctx.focus.slotOf.keys()];   // highlighted players drawn last = on top
}

function raw(ctx, startG) {
  const axis = ctx.filters.xAxis;
  const ks = players(ctx);
  const { x, ys } = ratingSeries(ctx.model, ks, axis, startG);
  const ctxColor = css('--context-line');
  return {
    x, xType: axis === 'date' ? 'time' : 'num', height: 320, y: {},
    xLabel: axis === 'own' ? v => `${v}. eigenes Spiel` : undefined,
    series: ks.map((k, i) => {
      const slot = ctx.focus.slotOf.get(k);
      return { label: nameOf(ctx, k), values: ys[i], stepped: axis !== 'own', context: slot == null,
        color: slot == null ? ctxColor : seriesColor(slot) };
    }),
  };
}

function smoothed(ctx, startG) {
  const axis = ctx.filters.xAxis;
  const ks = players(ctx);
  const { x, mean, lo, hi } = smoothSeries(ctx.model, ks, axis, startG);
  const ctxColor = css('--context-line');
  const alpha = Number(css('--band')) || 0.16;
  const series = [], bands = [];
  ks.forEach((k, i) => {
    const slot = ctx.focus.slotOf.get(k);
    if (slot != null) {
      bands.push({ upper: series.length, lower: series.length + 1, color: withAlpha(seriesColor(slot), alpha) });
      series.push({ label: `${nameOf(ctx, k)} oben`, values: hi[i], spanGaps: true, context: true },
                  { label: `${nameOf(ctx, k)} unten`, values: lo[i], spanGaps: true, context: true });
    }
  });
  ks.forEach((k, i) => {
    const slot = ctx.focus.slotOf.get(k);
    series.push({ label: nameOf(ctx, k), values: mean[i], spanGaps: true, context: slot == null,
      color: slot == null ? ctxColor : seriesColor(slot) });
  });
  return {
    x, xType: axis === 'date' ? 'time' : 'num', height: 320, y: {}, series, bands,
    xLabel: axis === 'own' ? v => `${v}. eigenes Spiel` : undefined,
  };
}

function summaryTable(ctx) {
  const { elo } = ctx.model;
  const rec = ctx.model.stats.get('records');
  const ks = ctx.visible.shown.slice().sort((a, b) => elo.final[b] - elo.final[a]);
  return tableView('Als Tabelle anzeigen', ['Spieler', 'Elo', 'Höchste', 'Tiefste', 'Spiele'],
    ks.map(k => [nameOf(ctx, k), fmt.elo(elo.final[k]), fmt.elo(rec.highest[k]), fmt.elo(rec.lowest[k]), fmt.int(elo.played[k])]),
    [1, 2, 3, 4], ks.map(k => profileLink(ctx, k)));
}
