// Rekorde: all-time record tiles. Only players shown under the current filters are eligible
// (not provisional, not inactive). Rank records use the current min-games filter.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { tile, viewHead, nameOf, tableView, linkTo, profileLink } from './common.js';
import { ownRange } from './insights.js';

export default {
  id: 'records',
  title: 'Rekorde',
  mount(el, ctx) {
    const update = c => render(el, page(c));
    update(ctx);
    return { update, unmount() {} };
  },
};

function page(ctx) {
  const { model, visible, filters } = ctx;
  const { elo, dataset } = model;
  const games = dataset.games, cfg = dataset.config;
  const ks = visible.shown;
  if (!ks.length) return h('p', { class: 'empty' }, 'Niemand erfüllt die Filter. Unter „Filter“ die Mindestanzahl Spiele senken.');
  const r = model.stats.get('records', { minGames: filters.minGames });
  const N = Math.min(cfg.form_games, cfg.best_run_max_games);
  const runs = model.stats.get('bestRuns');
  const when = g => (g >= 0 ? `${games[g].approxTime ? 'ca. ' : ''}${fmt.date(games[g].t)}` : '');
  const best = (arr, dir = 1) => ks.reduce((b, k) => (Number.isFinite(arr[k]) && (b < 0 || dir * arr[k] > dir * arr[b]) ? k : b), -1);
  const who = k => nameOf(ctx, k);
  const game = g => (g >= 0 ? linkTo(ctx, 'spiel', { ref: games[g].ref }) : null);
  const span = (k, endG, len) => { const p = endG >= 0 ? ownRange(model, k, endG, len) : null; return p ? linkTo(ctx, 'spiele', p) : null; };
  const ranks = k => linkTo(ctx, 'rank', {}, { focus: [elo.ids[k]] });
  const T = [];
  const add = (cond, spec) => { if (cond) T.push(tile(spec)); };

  let k = best(r.highest);
  add(k >= 0, { label: 'Höchster Elo-Wert', value: fmt.elo(r.highest[k]), who: who(k), sub: when(r.highestG[k]), link: game(r.highestG[k]) });
  k = best(r.lowest, -1);
  add(k >= 0, { label: 'Tiefster Elo-Wert', value: fmt.elo(r.lowest[k]), who: who(k), sub: when(r.lowestG[k]), link: game(r.lowestG[k]) });
  k = best(r.maxGain);
  add(k >= 0, { label: 'Größter Gewinn in einem Spiel', value: fmt.signed(r.maxGain[k], 1), tone: 'up', who: who(k), sub: when(r.maxGainG[k]), link: game(r.maxGainG[k]) });
  k = best(r.maxLoss, -1);
  add(k >= 0, { label: 'Größter Verlust in einem Spiel', value: fmt.signed(r.maxLoss[k], 1), tone: 'down', who: who(k), sub: when(r.maxLossG[k]), link: game(r.maxLossG[k]) });
  const bestRun = ks.map(k => runs.best[k][N - 1]), worstRun = ks.map(k => runs.worst[k][N - 1]);
  let i = bestRun.reduce((b, v, j) => (Number.isFinite(v) && (b < 0 || v > bestRun[b]) ? j : b), -1);
  add(i >= 0, { label: `Größter Zuwachs in ${N} Spielen`, value: fmt.signed(bestRun[i]), tone: 'up', who: who(ks[i]), sub: `bis ${when(runs.bestEnd[ks[i]][N - 1])}`, link: span(ks[i], runs.bestEnd[ks[i]][N - 1], N) });
  i = worstRun.reduce((b, v, j) => (Number.isFinite(v) && (b < 0 || v < worstRun[b]) ? j : b), -1);
  add(i >= 0, { label: `Größter Einbruch in ${N} Spielen`, value: fmt.signed(worstRun[i]), tone: 'down', who: who(ks[i]), sub: `bis ${when(runs.worstEnd[ks[i]][N - 1])}`, link: span(ks[i], runs.worstEnd[ks[i]][N - 1], N) });
  k = best(r.longestWin);
  add(k >= 0, { label: 'Längste Siegesserie', value: String(r.longestWin[k]), who: who(k), sub: `Siege in Folge, bis ${when(r.longestWinG[k])}`, link: span(k, r.longestWinG[k], r.longestWin[k]) });
  k = best(r.longestLoss);
  add(k >= 0, { label: 'Längste Niederlagenserie', value: String(r.longestLoss[k]), who: who(k), sub: `Niederlagen in Folge, bis ${when(r.longestLossG[k])}`, link: span(k, r.longestLossG[k], r.longestLoss[k]) });
  k = best(r.leaderDays);
  add(k >= 0 && r.leaderDays[k] > 0, { label: 'Am längsten auf Platz 1', value: `${Math.round(r.leaderDays[k])} Tage`, who: who(k), sub: `insgesamt, dabei ${r.leaderOwnGames[k]} eigene Spiele`, link: ranks(k) });
  k = best(r.leaderRun);
  add(k >= 0 && r.leaderRun[k] > 0, { label: 'Längste Serie auf Platz 1', value: `${r.leaderRun[k]} Spiele`, who: who(k), sub: 'Ligaspiele ohne Unterbrechung', link: ranks(k) });
  k = best(r.lastDays);
  add(k >= 0 && r.lastDays[k] > 0, { label: 'Am längsten auf dem letzten Platz', value: `${Math.round(r.lastDays[k])} Tage`, who: who(k), sub: `insgesamt, ${r.lastGames[k]} Ligaspiele lang`, link: ranks(k) });
  k = best(Float64Array.from(elo.played));
  add(k >= 0, { label: 'Meiste Spiele', value: fmt.int(elo.played[k]), who: who(k), sub: `${elo.wins[k]} Siege, ${elo.losses[k]} Niederlagen`, link: linkTo(ctx, 'activity') });
  const rate = Float64Array.from(elo.ids, (_, k) => elo.wins[k] / elo.played[k]);
  k = best(rate);
  add(k >= 0, { label: 'Beste Siegquote', value: fmt.pct(rate[k]), who: who(k), sub: `aus ${elo.played[k]} Spielen`, link: profileLink(ctx, k) });

  const shown = new Set(ks);
  const pairs = r.h2h.filter(p => shown.has(p.i) && shown.has(p.j));
  const most = pairs.reduce((a, p) => (!a || p.n > a.n ? p : a), null);
  const lop = pairs.reduce((a, p) => (!a || p.share > a.share || (p.share === a.share && p.n > a.n) ? p : a), null);
  const pairName = p => `${who(p.i)} – ${who(p.j)}`;
  const num = v => fmt.dec1(v).replace(',0', '');
  add(most, { label: 'Häufigstes Duell', value: most && num(most.n), who: most && pairName(most),
    sub: most && `Begegnungen, Bilanz ${num(most.winsI)} zu ${num(most.winsJ)}`, link: most && linkTo(ctx, 'h2h', { a: elo.ids[most.i], b: elo.ids[most.j] }) });
  add(lop, { label: 'Einseitigstes Duell', value: fmt.pct(lop?.share), who: lop && (lop.winsI >= lop.winsJ ? pairName(lop) : `${who(lop.j)} – ${who(lop.i)}`),
    sub: lop && `Siegquote, ab ${cfg.h2h_min_games} Begegnungen gewertet`,
    link: lop && (lop.winsI >= lop.winsJ ? linkTo(ctx, 'h2h', { a: elo.ids[lop.i], b: elo.ids[lop.j] }) : linkTo(ctx, 'h2h', { a: elo.ids[lop.j], b: elo.ids[lop.i] })) });

  const sorted = ks.slice().sort((a, b) => elo.final[b] - elo.final[a]);
  return h('div', { class: 'records' },
    viewHead('Rekorde', null, { info: [`Berücksichtigt werden Spieler mit mindestens ${filters.minGames} Spielen. Auch bei den Platz-Rekorden zählt der Rang erst ab dieser Zahl.`, 'Bei den Altdaten sind die Daten geschätzt („ca.“). Tippe auf einen Rekord für das Spiel oder die Spiele dahinter.'] }),
    h('div', { class: 'tiles' }, T),
    tableView('Alle Spieler als Tabelle anzeigen', ['Spieler', 'Höchster', 'Tiefster', 'Siegesserie', 'Niederlagenserie', 'Tage auf Platz 1'],
      sorted.map(k => [who(k), fmt.elo(r.highest[k]), fmt.elo(r.lowest[k]), String(r.longestWin[k]), String(r.longestLoss[k]), String(Math.round(r.leaderDays[k]))]),
      [1, 2, 3, 4, 5], sorted.map(k => profileLink(ctx, k))));
}
