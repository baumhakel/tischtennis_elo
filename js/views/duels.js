// Pure helpers for player profile, head-to-head and partners (no DOM).
import { winProbability } from '../core/elo.js';

/** Opponents of player k: matchups (doubles ½ per pair), wins, win ratio, wins over expectation. */
export function opponents(model, k) {
  const { elo } = model, n = elo.ids.length;
  const P = elo.pair, out = [];
  for (let j = 0; j < n; j++) {
    const m = P.matchups[k * n + j];
    if (j === k || m <= 0) continue;
    const w = P.wins[k * n + j], e = P.expected[k * n + j];
    out.push({ j, n: m, wins: w, losses: m - w, ratio: w / m, overExp: w - e, perGame: (w - e) / m });
  }
  return out.sort((a, b) => b.n - a.n);
}

/** Doubles partners of player k: games together, wins, chemistry (wins − expected). */
export function partnersOf(model, k) {
  const { elo } = model, n = elo.ids.length, P = elo.partner, out = [];
  for (let j = 0; j < n; j++) {
    const g = P.games[k * n + j];
    if (j === k || !g) continue;
    const w = P.wins[k * n + j], e = P.expected[k * n + j];
    out.push({ j, n: g, wins: w, ratio: w / g, chem: w - e, perGame: (w - e) / g });
  }
  return out.sort((a, b) => b.n - a.n);
}

/** All teams (pairs) among ks with at least minGames together, best chemistry per game first. */
export function bestTeams(model, ks, minGames) {
  const { elo } = model, n = elo.ids.length, P = elo.partner, out = [];
  for (let a = 0; a < ks.length; a++) for (let b = a + 1; b < ks.length; b++) {
    const i = ks[a], j = ks[b], g = P.games[i * n + j];
    if (g < minGames) continue;
    const w = P.wins[i * n + j], e = P.expected[i * n + j];
    out.push({ i, j, n: g, wins: w, ratio: w / g, chem: w - e, perGame: (w - e) / g });
  }
  return out.sort((x, y) => y.perGame - x.perGame || y.n - x.n);
}

/**
 * Games between side A and side B (player IDs). One ID per side: every game in which the two
 * stood on opposite sides (singles and doubles). Two IDs per side: exactly these two teams.
 * pA = Elo win probability of A now (team = mean rating).
 */
export function duel(model, A, B) {
  const { dataset, elo } = model;
  const has = (ids, xs) => xs.every(x => ids.includes(x));
  const list = [];
  dataset.games.forEach((g, i) => {
    if (has(g.winners, A) && has(g.losers, B)) list.push({ g: i, aWon: true });
    else if (has(g.winners, B) && has(g.losers, A)) list.push({ g: i, aWon: false });
  });
  const rating = ids => ids.reduce((s, id) => s + elo.final[elo.index.get(id)], 0) / ids.length;
  const ok = [...A, ...B].every(id => elo.index.has(id));
  const aWins = list.filter(x => x.aWon).length;
  return {
    games: list,
    aWins, bWins: list.length - aWins,
    singles: list.filter(x => !dataset.games[x.g].double).length,
    doubles: list.filter(x => dataset.games[x.g].double).length,
    pA: ok ? winProbability(rating(A), rating(B)) : NaN,
    rA: ok ? rating(A) : NaN, rB: ok ? rating(B) : NaN,
  };
}
