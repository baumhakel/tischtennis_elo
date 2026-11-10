// Smoothed Elo + form band (Gaussian kernel). Pure. Fixes R bug #8 (padded boxcar).
import { kernelMass, firstGE } from './util.js';

/**
 * smoothing: each player's rating as a step function on the chosen x-axis, convolved with a
 * Gaussian kernel of SD h. The kernel is normalised over the part of the axis where the player
 * exists (first game … end), so the curve ends are not pulled towards padding values.
 * band = local SD of the step function under the same kernel.
 *
 * Axes (x of each point = where the player's rating after an own game starts):
 *   'own'  own game number 1…m, each game holds its rating for one unit       h = smooth_sd_games
 *   'game' global game index g, rating holds until the player's next game     h = smooth_sd_games
 *   'date' sheet serial t, rating holds until the next game (last: until now,  h = smooth_sd_days
 *          but at least one average gap between games)
 *
 * Returns per player { x, mean, sd } (Float64Arrays, one entry per own game).
 */
export const smoothing = {
  name: 'smoothing',
  defaults: c => ({ axis: 'game', sdGames: c.smooth_sd_games, sdDays: c.smooth_sd_days }),
  compute({ elo, times, now }, { axis, sdGames, sdDays }) {
    const h = axis === 'date' ? sdDays : sdGames;
    const N = times.length;
    const end = axis === 'date' ? Math.max(now, N ? times[N - 1] : now) : N;
    // On the date axis the newest rating holds at least one average gap between games, as every
    // rating does on the game axes (otherwise a game played "now" would get no weight).
    const minLast = axis === 'date' ? (N > 1 ? (times[N - 1] - times[0]) / (N - 1) : 1) : 1;
    return elo.history.map(({ g, r }) => {
      const m = g.length;
      const a = new Float64Array(m), b = new Float64Array(m);
      for (let j = 0; j < m; j++) {
        if (axis === 'own') { a[j] = j + 0.5; b[j] = j + 1.5; }
        else if (axis === 'game') { a[j] = g[j]; b[j] = j + 1 < m ? g[j + 1] : end; }
        else { a[j] = times[g[j]]; b[j] = j + 1 < m ? times[g[j + 1]] : end; }
        if (j === m - 1 && b[j] - a[j] < minLast) b[j] = a[j] + minLast;
      }
      const x = axis === 'own' ? Float64Array.from(a, v => v + 0.5) : Float64Array.from(a);
      const mean = new Float64Array(m), sd = new Float64Array(m), w = new Float64Array(m);
      for (let i = 0; i < m; i++) {
        const xi = x[i], hi = xi + 6 * h;
        const s0 = firstGE(b, xi - 6 * h);
        let s1 = s0, W = 0, S = 0;
        for (; s1 < m && a[s1] <= hi; s1++) {
          w[s1] = kernelMass(a[s1], b[s1], xi, h);
          W += w[s1]; S += w[s1] * r[s1];
        }
        const mu = S / W;
        let V = 0;
        for (let s = s0; s < s1; s++) V += w[s] * (r[s] - mu) ** 2;
        mean[i] = mu; sd[i] = Math.sqrt(V / W);
      }
      return { x, mean, sd };
    });
  },
};
