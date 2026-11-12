// Teamchemie, geschrumpft (Phase 16). Pure.
//
// Per team t (two players who played doubles together): residual r̄_t = (wins − Σ e) / n_t,
// sampling variance v_t = Σ e(1−e) / n_t² (e = the team's pre-game win chance). Random effects
// s_t ~ N(0, τ²) with τ² by the method of moments over the teams with ≥ team_min_games doubles.
// Shown: the posterior mean r̄_t · τ² / (τ² + v_t) with a 95 % interval, for every team; plus the
// heterogeneity test (Q, p). τ² = 0 means: no real team chemistry is detectable in the data.
import { shrinkToZero } from './util.js';

export const chemistry = {
  name: 'chemistry',
  defaults: c => ({ minGames: c.team_min_games }),
  compute({ dataset, elo }, { minGames }) {
    const n = elo.ids.length, N = dataset.games.length;
    const games = new Float64Array(n * n), wins = new Float64Array(n * n), sumE = new Float64Array(n * n), sumV = new Float64Array(n * n);
    const add = (i, j, won, e) => {
      for (const c of [i * n + j, j * n + i]) { games[c]++; wins[c] += won; sumE[c] += e; sumV[c] += e * (1 - e); }
    };
    for (let g = 0; g < N; g++) {
      const w2 = elo.slots[4 * g + 1];
      if (w2 < 0) continue;
      const eW = elo.perGame.eW[g];
      add(elo.slots[4 * g], w2, 1, eW);
      add(elo.slots[4 * g + 2], elo.slots[4 * g + 3], 0, 1 - eW);
    }
    // τ² from the teams with enough doubles
    const fitR = [], fitV = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const c = i * n + j;
      if (games[c] < minGames || !(sumV[c] > 0)) continue;
      fitR.push((wins[c] - sumE[c]) / games[c]); fitV.push(sumV[c] / (games[c] * games[c]));
    }
    const fit = shrinkToZero(fitR, fitV);
    const tau2 = fit.tau2;
    const est = new Float64Array(n * n).fill(NaN), lo = new Float64Array(n * n).fill(NaN), hi = new Float64Array(n * n).fill(NaN), raw = new Float64Array(n * n).fill(NaN);
    const teams = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const c = i * n + j;
      if (!games[c]) continue;
      const r = (wins[c] - sumE[c]) / games[c], v = sumV[c] / (games[c] * games[c]);
      const m = tau2 > 0 && v > 0 ? r * tau2 / (tau2 + v) : 0;
      const s = tau2 > 0 && v > 0 ? Math.sqrt(tau2 * v / (tau2 + v)) : 0;
      for (const cc of [c, j * n + i]) { est[cc] = m; lo[cc] = m - 1.96 * s; hi[cc] = m + 1.96 * s; raw[cc] = r; }
      teams.push({ i, j, n: games[c], wins: wins[c], ratio: wins[c] / games[c], raw: r, est: m, lo: m - 1.96 * s, hi: m + 1.96 * s, enough: games[c] >= minGames });
    }
    teams.sort((x, y) => y.est - x.est || y.n - x.n);
    return { tau2, tau: Math.sqrt(tau2), Q: fit.Q, df: fit.df, p: fit.p, fitted: fitR.length, est, lo, hi, raw, games, teams };
  },
};
