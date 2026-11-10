// Best and worst runs over N consecutive own games. Pure.

/**
 * bestRuns: for N = 1 … maxN, the largest Elo gain (best) and loss (worst) over any N consecutive
 * own games, on the sequence [start rating, rating after own game 1, 2, …].
 * best[k][N-1], worst[k][N-1] (NaN if the player has fewer than N games);
 * bestEnd[k][N-1] = global index of the last game of that best run (worstEnd likewise).
 */
export const bestRuns = {
  name: 'bestRuns',
  defaults: c => ({ maxN: c.best_run_max_games }),
  compute({ elo }, { maxN }) {
    const P = elo.ids.length;
    const best = [], worst = [], bestEnd = [], worstEnd = [];
    for (let k = 0; k < P; k++) {
      const { g, r } = elo.history[k], m = g.length;
      const seq = new Float64Array(m + 1);
      seq[0] = elo.start[k]; seq.set(r, 1);
      const b = new Float64Array(maxN).fill(NaN), w = new Float64Array(maxN).fill(NaN);
      const be = new Int32Array(maxN).fill(-1), we = new Int32Array(maxN).fill(-1);
      for (let N = 1; N <= Math.min(maxN, m); N++) {
        let hi = -Infinity, lo = Infinity, hiI = -1, loI = -1;
        for (let i = N; i <= m; i++) {
          const d = seq[i] - seq[i - N];
          if (d > hi) { hi = d; hiI = i; }
          if (d < lo) { lo = d; loI = i; }
        }
        b[N - 1] = hi; w[N - 1] = lo; be[N - 1] = g[hiI - 1]; we[N - 1] = g[loI - 1];
      }
      best.push(b); worst.push(w); bestEnd.push(be); worstEnd.push(we);
    }
    return { maxN, best, worst, bestEnd, worstEnd };
  },
};
