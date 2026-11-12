// Rangliste (#/rangliste): the whole table, and the one page where the Zeitraum turns the Rangliste
// into „the league as of the end of the window“: Elo-Wert at the end, change within the window,
// games and Bilanz within it. A window onto the continuous rating, not a fresh start.
// Without a Zeitraum it is the Übersicht's table with all columns.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { viewHead, linkTo } from './common.js';
import { ratingAfter } from '../core/elo.js';
import { shareButton } from '../ui/share.js';

export default {
  id: 'rangliste',
  title: 'Rangliste',
  mount(el, ctx) {
    const update = c => render(el, page(c));
    update(ctx);
    return { update, unmount() {} };
  },
};

/** Rows of the table (pure apart from the model): every player with a game before the end. */
export function standingRows(ctx) {
  const full = ctx.fullModel, elo = full.elo, G = full.dataset.games, cfg = full.dataset.config;
  const win = ctx.model.window;                         // { a, b } in the mode's game indices, or undefined
  const a = win ? win.a : lowerBound(G, ctx.now - cfg.dashboard_days);
  const b = win ? win.b : G.length;
  const end = ctx.now;                                  // in a window: its end (or now, if it is still running)
  const rows = [];
  elo.ids.forEach((id, k) => {
    const hg = elo.history[k].g;
    let last = -1, before = -1, total = 0, gIn = 0, wIn = 0;
    for (let i = 0; i < hg.length && hg[i] < b; i++) {
      total++; last = hg[i];
      if (hg[i] < a) before = hg[i];
      else { gIn++; if (elo.slots[4 * hg[i]] === k || elo.slots[4 * hg[i] + 1] === k) wIn++; }
    }
    if (last < 0) return;
    const rating = ratingAfter(elo, k, last);
    const startRating = before >= 0 ? ratingAfter(elo, k, before) : elo.start[k];
    rows.push({
      id, k, rating, delta: rating - startRating, total, lastT: G[last].t,
      games: win ? gIn : total, wins: win ? wIn : elo.wins[k], losses: win ? gIn - wIn : elo.losses[k],
    });
  });
  const { minGames, inactivityDays } = ctx.filters;
  for (const r of rows) {
    r.inactive = inactivityDays > 0 && r.lastT < end - inactivityDays;
    r.provisional = r.total < minGames;
  }
  return rows.filter(r => !r.inactive).sort((x, y) => (x.provisional - y.provisional) || y.rating - x.rating);
}

function lowerBound(G, t) {
  let lo = 0, hi = G.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (G[m].t < t) lo = m + 1; else hi = m; }
  return lo;
}

function page(ctx) {
  const w = ctx.window, cfg = ctx.fullModel.dataset.config;
  const rows = standingRows(ctx);
  const dLabel = w ? 'im Zeitraum' : cfg.dashboard_days === 7 ? 'Woche' : `${cfg.dashboard_days} Tage`;
  let rank = 0;
  const body = rows.map(r => {
    if (!r.provisional) rank++;
    return h('tr', { class: 'tap-row' + (r.provisional ? ' provisional' : '') + (r.id === ctx.me?.id ? ' me' : ''), onclick: () => ctx.navigate('player', { id: r.id }) },
      h('td', { class: 'rank' }, r.provisional ? '' : String(rank)),
      h('td', { class: 'name' }, h('span', { class: 'player' }, ctx.names.get(r.id) ?? r.id),
        r.provisional ? h('span', { class: 'sub' }, `vorläufig: ${r.total} von ${ctx.filters.minGames} Spielen`) : null),
      h('td', { class: 'num score' }, fmt.elo(r.rating)),
      h('td', { class: 'num delta ' + (r.delta > 0.5 ? 'up' : r.delta < -0.5 ? 'down' : '') }, r.games || !w ? fmt.signed(r.delta) : '–'),
      h('td', { class: 'num' }, fmt.int(r.games)),
      h('td', { class: 'num wide' }, `${r.wins}:${r.losses}`),
      h('td', { class: 'num wide' }, r.games ? fmt.pct(r.wins / r.games) : '–'));
  });
  const spec = () => ({
    kicker: `Rangliste · ${w ? w.label : fmt.date(ctx.now)}${{ alle: '', einzel: ' · Wertung Einzel', doppel: ' · Wertung Doppel' }[ctx.mode]}`,
    title: 'Tischtennis Elo',
    lines: rows.filter(r => !r.provisional).slice(0, 10).map((r, i) => ({ label: `${i + 1}. ${ctx.names.get(r.id) ?? r.id}`,
      value: w ? `${fmt.elo(r.rating)}  ${fmt.signed(r.delta)}` : fmt.elo(r.rating) })),
  });
  return [
    viewHead('Rangliste', w ? `Stand am Ende von ${w.label}.` : null, { key: 'rangliste', share: shareButton(spec, { name: 'rangliste' }), info: [
      w ? `Elo-Wert: nach dem letzten Spiel bis zum Ende des Zeitraums. „im Zeitraum“: Änderung des Elo-Werts in diesem Zeitraum. Spiele und Siege zählen nur im Zeitraum. Die Elo-Werte laufen durch, der Zeitraum ist kein Neustart.`
        : `Wie auf der Übersicht, mit allen Spalten. Über „Zeitraum“ im Menü wird daraus die Rangliste eines Monats oder Jahres.`,
      `Vorläufig: weniger als ${ctx.filters.minGames} Spiele insgesamt (bis zum Ende des Zeitraums). Ausgeblendet: mehr als ${ctx.filters.inactivityDays} Tage ohne Spiel.`,
      'Tippe auf eine Zeile für das Spielerprofil.'] }),
    rows.length ? h('section', { class: 'board' }, h('table', {},
      h('thead', {}, h('tr', {},
        h('th', { class: 'rank' }, h('span', { class: 'sr' }, 'Rang')),
        h('th', {}, 'Spieler'), h('th', { class: 'num' }, 'Elo'), h('th', { class: 'num' }, dLabel),
        h('th', { class: 'num wide' }, 'Spiele'), h('th', { class: 'num wide' }, 'S:N'), h('th', { class: 'num wide' }, 'Siegquote'))),
      h('tbody', {}, body)))
      : h('p', { class: 'empty' }, 'Niemand sichtbar: Alle waren länger inaktiv, als der Filter erlaubt.'),
    w ? h('nav', { class: 'links' }, h('a', { class: 'tap', ...linkTo(ctx, 'ruhmeshalle') }, 'Monatssieger und Aufsteiger jeder Woche in der Ruhmeshalle')) : null,
  ];
}
