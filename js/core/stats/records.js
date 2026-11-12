// Ranks over time and all-time records. Pure.
// Fixes R bug #2 (no 1400 placeholder before the first game) and #7 (lopsided = win share).
import { won, ownChange } from './util.js';

/**
 * ranks: everyone's rank after each global game, among the players who have played at least
 * max(1, minGames) games at that point (others: rank 0 = not ranked yet). Ties share the better
 * rank (R's ties.method = "min"). rank[g*n + k]; leader[g] / last[g] = k or −1; pool[g] = size.
 */
export const ranks = {
  name: 'ranks',
  defaults: c => ({ minGames: c.default_min_games }),
  compute({ elo }, { minGames }) {
    const n = elo.ids.length, N = elo.perGame.delta.length;
    const need = Math.max(1, minGames);
    const r = new Float64Array(n).fill(NaN), played = new Int32Array(n);
    const rank = new Int16Array(N * n), leader = new Int32Array(N).fill(-1), last = new Int32Array(N).fill(-1);
    const pool = new Int32Array(N);
    const inPool = [];
    if (elo.prior) {   // a window (Zeitraum): everyone enters with their rating and games from before
      for (let k = 0; k < n; k++) { r[k] = elo.start[k]; played[k] = elo.prior[k]; if (played[k] >= need) inPool.push(k); }
    }
    for (let g = 0; g < N; g++) {
      const d = elo.perGame.delta[g];
      for (let s = 0; s < 4; s++) {
        const k = elo.slots[4 * g + s];
        if (k === -1) continue;
        r[k] = elo.perGame.before[4 * g + s] + (s < 2 ? d : -d);
        if (++played[k] === need) inPool.push(k);
      }
      pool[g] = inPool.length;
      let hi = -Infinity, lo = Infinity;
      for (const i of inPool) {
        let above = 0;
        for (const j of inPool) if (r[j] > r[i]) above++;
        rank[g * n + i] = above + 1;
        if (r[i] > hi || (r[i] === hi && i < leader[g])) { hi = r[i]; leader[g] = i; }
        if (r[i] < lo || (r[i] === lo && i < last[g])) { lo = r[i]; last[g] = i; }
      }
    }
    return { minGames: need, rank, leader, last, pool };
  },
};

/**
 * records: per player (arrays indexed by k) and head-to-head extremes.
 *   highest / lowest           rating after an own game (start rating not counted), + game index
 *   maxGain / maxLoss          biggest single-game change, + game index
 *   longestWin / longestLoss   streaks in own games, + index of the streak's last game
 *   leaderGames / leaderRun / leaderOwnGames / leaderDays   time as #1 (ranks with minGames):
 *     global games after which k was #1, longest such run, own games played while #1 afterwards,
 *     days as #1 (until the next game; the current leader until now)
 *   lastGames / lastRun / lastOwnGames / lastDays    the same for last place
 *   h2h: pairs with ≥ h2hMin matchups { i, j, n, winsI, winsJ, share } (share = max win share),
 *        mostMatches and mostLopsided (highest share, ties → more games)
 * Eligibility (provisional players) is applied by the view.
 */
export const records = {
  name: 'records',
  defaults: c => ({ minGames: c.default_min_games, h2hMin: c.h2h_min_games }),
  compute({ elo, get, times, now }, { minGames, h2hMin }) {
    const n = elo.ids.length, N = times.length;
    const arr = (T = Float64Array, v = NaN) => new T(n).fill(v);
    const out = {
      highest: arr(), highestG: arr(Int32Array, -1), lowest: arr(), lowestG: arr(Int32Array, -1),
      maxGain: arr(), maxGainG: arr(Int32Array, -1), maxLoss: arr(), maxLossG: arr(Int32Array, -1),
      longestWin: arr(Int32Array, 0), longestWinG: arr(Int32Array, -1),
      longestLoss: arr(Int32Array, 0), longestLossG: arr(Int32Array, -1),
    };
    for (let k = 0; k < n; k++) {
      const { g, r } = elo.history[k];
      let runW = 0, runL = 0;
      for (let j = 0; j < g.length; j++) {
        if (!(r[j] <= out.highest[k])) { out.highest[k] = r[j]; out.highestG[k] = g[j]; }
        if (!(r[j] >= out.lowest[k])) { out.lowest[k] = r[j]; out.lowestG[k] = g[j]; }
        const d = ownChange(elo, k, g[j]);
        if (!(d <= out.maxGain[k])) { out.maxGain[k] = d; out.maxGainG[k] = g[j]; }
        if (!(d >= out.maxLoss[k])) { out.maxLoss[k] = d; out.maxLossG[k] = g[j]; }
        if (won(elo, k, g[j])) { runW++; runL = 0; } else { runL++; runW = 0; }
        if (runW > out.longestWin[k]) { out.longestWin[k] = runW; out.longestWinG[k] = g[j]; }
        if (runL > out.longestLoss[k]) { out.longestLoss[k] = runL; out.longestLossG[k] = g[j]; }
      }
    }

    const rk = get('ranks', { minGames });
    const place = (holder, prefix) => {
      const games = arr(Int32Array, 0), run = arr(Int32Array, 0), own = arr(Int32Array, 0), days = arr(Float64Array, 0);
      let cur = -1, len = 0;
      for (let g = 0; g < N; g++) {
        const k = holder[g];
        len = k === cur ? len + 1 : 1;
        cur = k;
        if (k === -1) continue;
        games[k]++;
        if (len > run[k]) run[k] = len;
        if (elo.slots.subarray(4 * g, 4 * g + 4).includes(k)) own[k]++;
        days[k] += (g + 1 < N ? times[g + 1] : Math.max(now, times[g])) - times[g];
      }
      out[prefix + 'Games'] = games; out[prefix + 'Run'] = run; out[prefix + 'OwnGames'] = own; out[prefix + 'Days'] = days;
    };
    place(rk.leader, 'leader');
    place(rk.last, 'last');

    const M = elo.pair.matchups, W = elo.pair.wins, h2h = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const m = M[i * n + j];
      if (m >= h2hMin) {
        const wi = W[i * n + j], wj = W[j * n + i];
        h2h.push({ i, j, n: m, winsI: wi, winsJ: wj, share: Math.max(wi, wj) / m });
      }
    }
    out.h2h = h2h;
    out.mostMatches = h2h.reduce((a, b) => (!a || b.n > a.n ? b : a), null);
    out.mostLopsided = h2h.reduce((a, b) => (!a || b.share > a.share || (b.share === a.share && b.n > a.n) ? b : a), null);
    out.minGames = rk.minGames;
    return out;
  },
};
