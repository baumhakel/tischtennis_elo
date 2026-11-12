// Pure helpers for the Phase 8 pages: Aufsteiger, Serien, Team, Siegchance, and game ranges
// for links into Alle Spiele (no DOM).
import { formatRef } from '../core/normalize.js';
import { sideInRange } from './game-query.js';

const wonBy = (elo, k, g) => { const s = elo.slots; return s[4 * g] === k || s[4 * g + 1] === k; };

/**
 * Alle Spiele params for player k's own games from own-game position `endG` back `len` games
 * (a streak or a run ending at global game endG). null if endG is not one of k's games.
 */
export function ownRange(model, k, endG, len) {
  const { g } = model.elo.history[k];
  const j = g.indexOf(endG);
  if (j < 0 || len < 1) return null;
  const games = model.dataset.games;
  return { spieler: model.elo.ids[k], von: games[g[Math.max(0, j - len + 1)]].ref, bis: games[endG].ref };
}

/**
 * Aufsteiger: every player with games in the last `days` days.
 * rows sorted by Elo change (desc), each { k, delta, games, wins, losses, qualifies } where
 * qualifies = at least `minGames` own games in the window (eligibility by the global filters is the view's).
 */
export function risers(model, days, minGames) {
  const w = model.stats.get('recent', { days });
  const { elo } = model;
  const rows = [];
  for (let k = 0; k < elo.ids.length; k++) {
    if (!w.games[k]) continue;
    const { g } = elo.history[k];
    let wins = 0;
    for (let j = g.length - w.games[k]; j < g.length; j++) if (wonBy(elo, k, g[j])) wins++;
    rows.push({ k, delta: w.delta[k], games: w.games[k], wins, losses: w.games[k] - wins, qualifies: w.games[k] >= minGames });
  }
  rows.sort((a, b) => b.delta - a.delta || b.games - a.games);
  return { from: w.from, fromRef: formatRef(w.from), rows };
}

/**
 * Current streaks: { k, n, win } for every player, n = length of the current streak (≥ 1).
 * Sorted: wins longest first, then losses longest first.
 */
export function streaks(model) {
  const f = model.stats.get('form');
  const out = [];
  for (let k = 0; k < f.streak.length; k++) {
    if (!f.streak[k]) continue;
    out.push({ k, n: Math.abs(f.streak[k]), win: f.streak[k] > 0 });
  }
  return out.sort((a, b) => (b.win - a.win) || b.n - a.n);
}

/**
 * Team = two players who played doubles together (no team rating; strength = mean of the two).
 * { n, wins, losses, ratio, chem (wins − expected), perGame, games [g, newest first],
 *   opponents [{ ids: [x, y], n, wins, losses }] most frequent first }
 */
export function teamFacts(model, a, b) {
  const { elo, dataset } = model;
  const ka = elo.index.get(a), kb = elo.index.get(b);
  const games = [], opp = new Map();
  let wins = 0, expected = 0;
  if (ka === undefined || kb === undefined || ka === kb) return null;
  dataset.games.forEach((x, g) => {
    if (!x.double) return;
    const w = x.winners.includes(a) && x.winners.includes(b);
    const l = x.losers.includes(a) && x.losers.includes(b);
    if (!w && !l) return;
    games.push(g);
    if (w) wins++;
    expected += w ? elo.perGame.eW[g] : 1 - elo.perGame.eW[g];
    const other = (w ? x.losers : x.winners).slice().sort();
    const key = other.join('+');
    const o = opp.get(key) || opp.set(key, { ids: other, n: 0, wins: 0, losses: 0 }).get(key);
    o.n++; if (w) o.wins++; else o.losses++;
  });
  const n = games.length;
  return {
    n, wins, losses: n - wins, ratio: n ? wins / n : NaN, chem: wins - expected, perGame: n ? (wins - expected) / n : NaN,
    games: games.reverse(),
    opponents: [...opp.values()].sort((x, y) => y.n - x.n || y.wins - x.wins),
  };
}

/** Calibration bin b of `bins` as [lo, hi] and the URL value "lo-hi". */
export function binRange(b, bins) {
  const lo = +(b / bins).toFixed(4), hi = +((b + 1) / bins).toFixed(4);
  return { lo, hi, param: `${lo}-${hi}` };
}

/**
 * Siegchance page: every side of every game whose pre-game win chance lies in the range
 * (convention of sideInRange, identical to the calibration bins). kind: 'all' | 'singles' | 'doubles'.
 * { sides, games, expected, actual, players [{ k, n, expected, actual, diff }] by diff desc }.
 * In doubles each player on a side counts that side's chance and result once.
 */
export function chanceRange(model, lo, hi, kind = 'all') {
  const { elo } = model;
  const eW = elo.perGame.eW, slots = elo.slots;
  const P = elo.ids.length;
  const n = new Int32Array(P), ex = new Float64Array(P), ac = new Float64Array(P);
  let sides = 0, expected = 0, actual = 0;
  const gamesSeen = new Set();
  for (let g = 0; g < eW.length; g++) {
    const dbl = slots[4 * g + 1] !== -1;
    if ((kind === 'singles' && dbl) || (kind === 'doubles' && !dbl)) continue;
    for (const [p, won, s0] of [[eW[g], 1, 0], [1 - eW[g], 0, 2]]) {
      if (!sideInRange(eW[g], won === 1, lo, hi)) continue;
      sides++; expected += p; actual += won; gamesSeen.add(g);
      for (const s of [s0, s0 + 1]) {
        const k = slots[4 * g + s];
        if (k < 0) continue;
        n[k]++; ex[k] += p; ac[k] += won;
      }
    }
  }
  const players = [];
  for (let k = 0; k < P; k++) if (n[k]) players.push({ k, n: n[k], expected: ex[k], actual: ac[k], diff: ac[k] - ex[k] });
  players.sort((a, b) => b.diff - a.diff || b.n - a.n);
  return { sides, games: gamesSeen.size, expected, actual, players };
}
