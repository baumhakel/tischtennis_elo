// Übersicht: highlight tiles, recent Elo curves, last games, leaderboard.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { seriesColor, seriesVar, css } from '../ui/colors.js';
import { ratingSeries, recentStart } from '../ui/series.js';
import { lineChart } from '../ui/charts/line.js';
import { focusLegend, tile, nameOf, linkTo } from './common.js';
import { recentGames } from './games.js';

export default {
  id: 'dashboard',
  title: 'Übersicht',
  mount(el, ctx) {
    const tiles = h('div', { class: 'tiles' });
    const legend = h('div');
    const chartEl = h('div');
    const note = h('p', { class: 'chart-note' });
    const board = h('div');
    const recent = recentGames();
    render(el, tiles, h('h2', {}, 'Aktueller Verlauf'), legend, chartEl, note, recent.el, board);
    let chart = null;

    function update(c) {
      render(tiles, highlights(c));
      render(legend, focusLegend(c));
      const spec = curves(c);
      render(note, spec.note);
      if (!chart) chart = lineChart(chartEl, spec); else chart.update(spec);
      recent.update(c);
      render(board, leaderboard(c));
    }
    update(ctx);
    return { update, unmount() { chart?.destroy(); } };
  },
};

// ───────── highlight tiles ─────────

function highlights(ctx) {
  const { model, visible } = ctx;
  const { config, games } = model.dataset;
  const ok = k => visible.isShown(k);   // provisional and inactive players are not eligible

  const week = d => (d === 7 ? 'der Woche' : `(${d} Tage)`);
  const rs = model.stats.get('risingStar').filter(r => ok(r.k))[0];
  const rising = rs
    ? tile({ label: `Aufsteiger ${week(config.rising_star_days)}`, value: fmt.signed(rs.delta), tone: rs.delta > 0 ? 'up' : 'down',
        who: nameOf(ctx, rs.k), sub: `Elo-Punkte aus ${rs.games} Spielen`, link: linkTo(ctx, 'aufsteiger') })
    : tile({ label: `Aufsteiger ${week(config.rising_star_days)}`, value: '–',
        sub: `Niemand hat in dieser Zeit ${config.rising_star_min_games} Spiele bestritten.`, link: linkTo(ctx, 'aufsteiger') });

  const form = model.stats.get('form');
  let best = -1;
  for (const k of visible.shown) if (form.streak[k] > 0 && (best < 0 || form.streak[k] > form.streak[best])) best = k;
  const streak = best >= 0
    ? tile({ label: 'Aktuelle Siegesserie', value: `${form.streak[best]} Siege`, who: nameOf(ctx, best), sub: 'in Folge, seither ungeschlagen',
        link: linkTo(ctx, 'serien', { id: model.elo.ids[best] }) })
    : tile({ label: 'Aktuelle Siegesserie', value: '–', sub: 'Gerade hat niemand eine Siegesserie.', link: linkTo(ctx, 'serien') });

  const recent = model.stats.get('recent');
  const up = model.stats.get('upsets');
  let g = -1;
  for (const i of up.order) if (i >= recent.firstGame) { g = i; break; }
  const upset = g >= 0
    ? tile({ label: `Überraschung ${week(config.dashboard_days)}`, value: fmt.pct(model.elo.perGame.eW[g]),
        who: teamNames(ctx, games[g].winners), sub: `Siegchance gegen ${teamNames(ctx, games[g].losers)} am ${fmt.date(games[g].t)}`,
        link: linkTo(ctx, 'spiel', { ref: games[g].ref }) })
    : tile({ label: `Überraschung ${week(config.dashboard_days)}`, value: '–', sub: 'In dieser Zeit wurde nicht gespielt.' });

  const mv = model.stats.get('movement');
  const LEVELS = { calm: ['ruhig', 1], normal: ['normal', 2], turbulent: ['turbulent', 3] };
  const [word, bars] = LEVELS[mv.level] || ['–', 0];
  const movement = tile({
    label: 'Elo-Bewegung',
    value: h('span', { class: 'level' }, word,
      h('i', { 'aria-hidden': 'true' }, [1, 2, 3].map(b => h('b', { class: b <= bars ? 'on' : null })))),
    sub: Number.isFinite(mv.percentile) ? `bewegter als ${Math.round(mv.percentile)} % der bisherigen Zeit` : 'Noch zu wenige Spiele.',
    link: linkTo(ctx, 'movement'),
  });
  return [rising, streak, upset, movement];
}

export const teamNames = (ctx, ids) => ids.map(id => ctx.names.get(id) ?? id).join(' & ');

// ───────── recent curves ─────────

function curves(ctx) {
  const { model, visible, focus, filters } = ctx;
  const axis = filters.xAxis === 'own' ? 'game' : filters.xAxis;   // own-game axis makes no sense for a time window
  const start = recentStart(model);
  const context = visible.shown.filter(k => !focus.slotOf.has(k));
  const focused = [...focus.slotOf.keys()];
  const ks = [...context, ...focused];
  const { x, ys } = ratingSeries(model, ks, axis, start);
  const ctxColor = css('--context-line');
  const series = ks.map((k, i) => {
    const slot = focus.slotOf.get(k);
    return { label: nameOf(ctx, k), values: ys[i], stepped: true, context: slot == null,
      color: slot == null ? ctxColor : seriesColor(slot), width: slot == null ? 1 : 2 };
  });
  const N = model.dataset.games.length;
  return {
    x, xType: axis === 'date' ? 'time' : 'num', series, height: 240, y: {},
    note: N ? [h('a', { class: 'inline-link', ...linkTo(ctx, 'spiele', { von: model.dataset.games[start].ref }) },
      `${N - start} Spiele seit dem ${fmt.date(model.dataset.games[start].t)}`), '.',
      filters.xAxis === 'own' ? ' Die x-Achse zeigt hier die Spielnummer.' : ''] : '',
  };
}

// ───────── leaderboard ─────────

function leaderboard(ctx) {
  const { model, visible, filters, names, navigate, focus } = ctx;
  const { config } = model.dataset;
  const rows = model.stats.get('leaderboard').filter(r => !visible.inactive.has(r.k));
  if (!rows.length) {
    return h('p', { class: 'empty' }, 'Niemand sichtbar: Alle Spieler waren länger inaktiv, als der Filter erlaubt. Unter „Filter“ mehr Tage zulassen.');
  }
  let rank = 0;
  const body = rows.map(r => {
    const prov = visible.provisional.has(r.k);
    if (!prov) rank++;
    const slot = focus.slotOf.get(r.k);
    return h('tr', { class: 'tap-row' + (prov ? ' provisional' : ''), onclick: () => navigate('player', { id: r.id }) },
      h('td', { class: 'rank' }, prov ? '' : String(rank)),
      h('td', { class: 'name' },
        h('span', { class: 'player' },
          slot != null ? h('span', { class: 'fkey', style: `background:${seriesVar(slot)}` }) : null,
          names.get(r.id)),
        h('span', { class: 'sub' },
          prov ? `vorläufig: ${r.games} von ${filters.minGames} Spielen` : formStrip(r.last))),
      h('td', { class: 'num score' }, fmt.elo(r.rating)),
      h('td', { class: 'num delta ' + (r.delta > 0.5 ? 'up' : r.delta < -0.5 ? 'down' : '') }, fmt.signed(r.delta)),
      h('td', { class: 'num wide' }, fmt.int(r.games)),
      h('td', { class: 'num wide' }, `${r.wins}:${r.losses}`),
      h('td', { class: 'num wide' }, fmt.pct(r.winRate)),
      h('td', { class: 'num wide muted' }, fmt.ago(r.lastT, ctx.now)));
  });
  return h('section', { class: 'board' },
    h('h2', {}, 'Rangliste'),
    h('table', {},
      h('thead', {}, h('tr', {},
        h('th', { class: 'rank' }, h('span', { class: 'sr' }, 'Rang')),
        h('th', {}, 'Spieler'),
        h('th', { class: 'num' }, 'Elo'),
        h('th', { class: 'num' }, h('a', { class: 'th-link', ...linkTo(ctx, 'aufsteiger') }, config.dashboard_days === 7 ? 'Woche' : `${config.dashboard_days} Tage`)),
        h('th', { class: 'num wide' }, 'Spiele'),
        h('th', { class: 'num wide' }, 'S:N'),
        h('th', { class: 'num wide' }, 'Siegquote'),
        h('th', { class: 'num wide' }, 'Zuletzt'))),
      h('tbody', {}, body)));
}

/** Last results as a row of small marks, oldest first. */
function formStrip(last) {
  return h('span', { class: 'form', 'aria-label': `Letzte Spiele: ${[...last].map(c => (c === 'W' ? 'Sieg' : 'Niederlage')).join(', ')}` },
    [...last].map(c => h('i', { class: c === 'W' ? 'w' : 'l' })));
}
