// Form, recent window, rising star, leaderboard. Pure.
import { won, firstGE } from './util.js';

/**
 * form: Elo change over each player's last N own games, the last M results and the current streak.
 * delta[k] = rating now − rating before the N-th last own game (start rating if fewer games).
 * last[k]  = string of 'W'/'L', oldest first, length ≤ M.
 * streak[k] = +n for n wins in a row at the end, −n for n losses.
 */
export const form = {
  name: 'form',
  defaults: c => ({ n: c.form_games, results: c.leaderboard_form_results }),
  compute({ elo }, { n, results }) {
    const P = elo.ids.length;
    const delta = new Float64Array(P), games = new Int32Array(P), streak = new Int32Array(P);
    const last = new Array(P);
    for (let k = 0; k < P; k++) {
      const { g, r } = elo.history[k], m = g.length;
      delta[k] = r[m - 1] - (m > n ? r[m - 1 - n] : elo.start[k]);
      games[k] = Math.min(n, m);
      let s = '';
      for (let j = Math.max(0, m - results); j < m; j++) s += won(elo, k, g[j]) ? 'W' : 'L';
      last[k] = s;
      const w0 = won(elo, k, g[m - 1]);
      let j = m - 1;
      while (j >= 0 && won(elo, k, g[j]) === w0) j--;
      streak[k] = (w0 ? 1 : -1) * (m - 1 - j);
    }
    return { delta, games, last, streak };
  },
};

/**
 * recent: what happened in the last `days` days before `now`.
 * delta[k] = rating now − rating at the start of the window (start rating if the player's
 * first game is inside the window); 0 if no game in the window. games[k] = own games in the window.
 */
export const recent = {
  name: 'recent',
  defaults: c => ({ days: c.dashboard_days }),
  compute({ elo, now, times }, { days }) {
    const from = now - days;
    const gFrom = firstGE(times, from);   // first global game in the window
    const P = elo.ids.length;
    const delta = new Float64Array(P), games = new Int32Array(P);
    for (let k = 0; k < P; k++) {
      const { g, r } = elo.history[k], m = g.length;
      const j = firstGE(g, gFrom);                                // first own game in the window
      games[k] = m - j;
      if (games[k] === 0) continue;
      delta[k] = r[m - 1] - (j > 0 ? r[j - 1] : elo.start[k]);
    }
    return { from, firstGame: gFrom, delta, games };
  },
};

/**
 * risingStar: players ranked by Elo gained in the last `days` days, among those with at least
 * `minGames` own games in that window. Highest gain first; ties → more games first.
 * Eligibility by the global min-games filter (provisional players) is left to the view.
 */
export const risingStar = {
  name: 'risingStar',
  defaults: c => ({ days: c.rising_star_days, minGames: c.rising_star_min_games }),
  compute({ get }, { days, minGames }) {
    const w = get('recent', { days });
    const out = [];
    for (let k = 0; k < w.delta.length; k++) {
      if (w.games[k] >= minGames) out.push({ k, delta: w.delta[k], games: w.games[k] });
    }
    return out.sort((a, b) => b.delta - a.delta || b.games - a.games);
  },
};

/** leaderboard: one row per player, sorted by current rating. */
export const leaderboard = {
  name: 'leaderboard',
  defaults: c => ({ days: c.dashboard_days, results: c.leaderboard_form_results, n: c.form_games }),
  compute({ dataset, elo, get }, { days, results, n }) {
    const w = get('recent', { days });
    const f = get('form', { n, results });
    return elo.ids.map((id, k) => ({
      k, id,
      rating: elo.final[k],
      delta: w.delta[k],
      games: elo.played[k], wins: elo.wins[k], losses: elo.losses[k],
      winRate: elo.wins[k] / elo.played[k],
      last: f.last[k],
      streak: f.streak[k],
      lastT: dataset.games[elo.lastG[k]].t,
    })).sort((a, b) => b.rating - a.rating);
  },
};
