// Activity heatmap: games per player per calendar week (Monday–Sunday). Pure.
// Legacy times are interpolated, so weeks before responses_valid_from are approximate.

const MONDAY = 2;   // serial 2 = Monday 1900-01-01

/** Serial of the Monday 00:00 starting the week that contains serial t. */
export const weekStart = t => MONDAY + 7 * Math.floor((t - MONDAY) / 7);

/**
 * activity: weeks = Monday serials from the first game's week to the week of `now`;
 * counts[k][w] = own games of player k in week w (Int32Array per player);
 * approx[w] = true if the week contains interpolated (legacy) games.
 */
export const activity = {
  name: 'activity',
  defaults: () => ({}),
  compute({ dataset, elo, times, now }) {
    const N = times.length, n = elo.ids.length;
    if (!N) return { weeks: new Float64Array(0), counts: [], approx: [] };
    const w0 = weekStart(times[0]), w1 = weekStart(Math.max(now, times[N - 1]));
    const W = (w1 - w0) / 7 + 1;
    const weeks = Float64Array.from({ length: W }, (_, w) => w0 + 7 * w);
    const counts = Array.from({ length: n }, () => new Int32Array(W));
    const approx = new Array(W).fill(false);
    for (let g = 0; g < N; g++) {
      const w = (weekStart(times[g]) - w0) / 7;
      if (dataset.games[g].approxTime) approx[w] = true;
      for (let s = 0; s < 4; s++) {
        const k = elo.slots[4 * g + s];
        if (k !== -1) counts[k][w]++;
      }
    }
    return { weeks, counts, approx };
  },
};
