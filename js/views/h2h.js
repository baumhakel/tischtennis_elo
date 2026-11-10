// Direktvergleich: two players (or two doubles teams) against each other.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { seriesColor } from '../ui/colors.js';
import { ratingSeries } from '../ui/series.js';
import { lineChart } from '../ui/charts/line.js';
import { tile, viewHead, nameOf, byName } from './common.js';
import { duel } from './duels.js';

export default {
  id: 'h2h',
  title: 'Direktvergleich',
  mount(el, ctx) {
    const head = h('div'), tiles = h('div'), chartEl = h('div'), list = h('div');
    render(el, head, tiles, chartEl, list);
    let chart = null;

    function update(c) {
      const { elo } = c.model;
      const pool = byName(c, [...c.visible.listed]);
      const valid = id => id && elo.index.has(id);
      const ranked = c.visible.shown.slice().sort((x, y) => elo.final[y] - elo.final[x]);
      const a = valid(c.params.a) ? c.params.a : elo.ids[ranked[0] ?? pool[0]];
      const b = valid(c.params.b) && c.params.b !== a ? c.params.b : elo.ids[(ranked.find(k => elo.ids[k] !== a)) ?? pool.find(k => elo.ids[k] !== a)];
      const a2 = valid(c.params.a2) && ![a, b].includes(c.params.a2) ? c.params.a2 : null;
      const b2 = valid(c.params.b2) && ![a, b, a2].includes(c.params.b2) ? c.params.b2 : null;
      const teams = !!(a2 && b2);
      const A = teams ? [a, a2] : [a], B = teams ? [b, b2] : [b];
      const label = ids => ids.map(id => c.names.get(id) ?? id).join(' & ');

      const pick = (param, value, { optional = false, exclude = [] } = {}) =>
        h('select', { 'aria-label': optional ? 'Doppelpartner' : 'Spieler', onchange: e => c.setParams({ [param]: e.target.value || null }) },
          optional ? h('option', { value: '' }, 'ohne Partner') : null,
          pool.filter(k => !exclude.includes(elo.ids[k]) || elo.ids[k] === value)
            .map(k => h('option', { value: elo.ids[k], selected: elo.ids[k] === value ? true : null }, nameOf(c, k))));

      render(head, viewHead('Direktvergleich', 'Zwei Spieler oder zwei Doppelteams im Vergleich. Mit je einem Partner pro Seite zählen nur Spiele genau dieser beiden Teams; ohne Partner alle Spiele, in denen die beiden Gegner waren.'),
        h('div', { class: 'toolbar duel-pick' },
          h('span', { class: 'side' }, h('span', { class: 'key', style: `background:${seriesColor(0)}` }), pick('a', a, { exclude: [b, a2, b2] }), pick('a2', a2, { optional: true, exclude: [a, b, b2] })),
          h('span', { class: 'vs' }, 'gegen'),
          h('span', { class: 'side' }, h('span', { class: 'key', style: `background:${seriesColor(1)}` }), pick('b', b, { exclude: [a, a2, b2] }), pick('b2', b2, { optional: true, exclude: [a, b, a2] }))),
        (a2 && !b2) || (b2 && !a2) ? h('p', { class: 'chart-note' }, 'Für einen Teamvergleich auf beiden Seiten einen Partner wählen. Bis dahin werden die Einzelspieler verglichen.') : null);

      const d = duel(c.model, A, B);
      const games = c.model.dataset.games;
      const last = d.games.at(-1);
      render(tiles, h('div', { class: 'tiles' },
        tile({ label: 'Bilanz', value: `${d.aWins} : ${d.bWins}`, sub: d.games.length ? `${d.games.length} Begegnungen (${d.singles} Einzel, ${d.doubles} Doppel)` : 'Noch nie gegeneinander gespielt.' }),
        tile({ label: `Siegchance ${label(A)}`, value: fmt.pct(d.pA), sub: `laut Elo heute: ${fmt.elo(d.rA)} gegen ${fmt.elo(d.rB)}` }),
        tile({ label: 'Siegquote bisher', value: d.games.length ? fmt.pct(d.aWins / d.games.length) : '–', sub: `für ${label(A)}` }),
        tile({ label: 'Letzte Begegnung', value: last ? fmt.date(games[last.g].t) : '–', sub: last ? `${last.aWon ? label(A) : label(B)} hat gewonnen` : '' })));

      // Elo curves of everyone involved
      const ids = [...A, ...B];
      const ks = ids.map(id => elo.index.get(id));
      const axis = c.filters.xAxis;
      const { x, ys } = ratingSeries(c.model, ks, axis, 0);
      const spec = {
        x, xType: axis === 'date' ? 'time' : 'num', height: 240, y: {},
        xLabel: axis === 'own' ? v => `${v}. eigenes Spiel` : undefined,
        series: ks.map((k, i) => ({
          label: nameOf(c, k), values: ys[i], stepped: axis !== 'own',
          color: seriesColor(i < A.length ? 0 : 1), width: i === 0 || i === A.length ? 2 : 1.25,
        })),
      };
      if (!chart) chart = lineChart(chartEl, spec); else chart.update(spec);

      render(list, d.games.length ? [
        h('h2', {}, 'Alle Begegnungen'),
        h('ol', { class: 'upsets duels' }, d.games.slice().reverse().map(({ g, aWon }) => {
          const x = games[g];
          const pA = aWon ? c.model.elo.perGame.eW[g] : 1 - c.model.elo.perGame.eW[g];
          const delta = c.model.elo.perGame.delta[g];
          return h('li', {},
            h('span', { class: 'pct' }, aWon ? 'S' : 'N'),
            h('span', { class: 'who' }, `${aWon ? label(A) : label(B)} gewinnt`),
            h('span', { class: 'd ' + (aWon ? '' : 'down') }, fmt.signed(aWon ? delta : -delta, 1)),
            h('span', { class: 'meta' }, `${x.approxTime ? 'ca. ' : ''}${fmt.date(x.t)}, ${x.double ? 'Doppel' : 'Einzel'}` +
              (teams ? '' : x.double ? ` (${x.winners.concat(x.losers).filter(id => !ids.includes(id)).map(id => c.names.get(id)).join(' und ')} dabei)` : '') +
              `, Siegchance ${label(A)} vorher ${fmt.pct(pA)}`));
        })),
        h('p', { class: 'chart-note' }, `S/N: Sieg oder Niederlage aus Sicht von ${label(A)}; daneben die Elo-Veränderung von ${label(A)}.`),
      ] : null);
    }
    update(ctx);
    return { update, unmount() { chart?.destroy(); } };
  },
};
