// League-wide per-game statistics: Elo movement, upsets, calibration. Pure.
import { quantileSorted } from './util.js';

/**
 * movement: per game m_g = Σ|Δ|/2 over the players in it (= Δ in singles, 2Δ in doubles),
 * trailing rolling mean over the last `window` games (NaN until `window` games exist),
 * the calm/turbulent thresholds as percentiles of all rolling values, and the current level.
 */
export const movement = {
  name: 'movement',
  defaults: c => ({ window: c.movement_window, calm: c.movement_calm_percentile, turbulent: c.movement_turbulent_percentile }),
  compute({ elo }, { window, calm, turbulent }) {
    const N = elo.perGame.delta.length;
    const perGame = new Float64Array(N), rolling = new Float64Array(N).fill(NaN);
    let sum = 0;
    for (let g = 0; g < N; g++) {
      perGame[g] = elo.perGame.delta[g] * (elo.slots[4 * g + 1] === -1 ? 1 : 2);
      sum += perGame[g];
      if (g >= window) sum -= perGame[g - window];
      if (g >= window - 1) rolling[g] = sum / window;
    }
    const sorted = Float64Array.from(rolling.filter(v => !Number.isNaN(v))).sort();
    const calmAt = quantileSorted(sorted, calm / 100);
    const turbulentAt = quantileSorted(sorted, turbulent / 100);
    const current = N ? rolling[N - 1] : NaN;
    let percentile = NaN, level = null;
    if (!Number.isNaN(current)) {
      let below = 0;
      for (const v of sorted) if (v <= current) below++;
      percentile = 100 * below / sorted.length;
      level = current <= calmAt ? 'calm' : current >= turbulentAt ? 'turbulent' : 'normal';
    }
    return { perGame, rolling, calmAt, turbulentAt, current, percentile, level };
  },
};

/**
 * upsets: surprise of each game = 1 − e_W (the loser was the favourite when > 0.5).
 * order = global game indices, biggest upset first (ties: later game first).
 */
export const upsets = {
  name: 'upsets',
  defaults: () => ({}),
  compute({ elo }) {
    const N = elo.perGame.eW.length;
    const surprise = Float64Array.from(elo.perGame.eW, e => 1 - e);
    const order = Int32Array.from({ length: N }, (_, g) => g)
      .sort((a, b) => surprise[b] - surprise[a] || b - a);
    return { surprise, order };
  },
};

/**
 * calibration: predicted vs observed win frequency. Every game gives two observations,
 * (e_W, won) and (1 − e_W, lost), so the curve is symmetric around 0.5. Bins are equal-width on [0, 1].
 * logLoss = mean −ln e_W, brier = mean (1 − e_W)², per game. Separately for all / singles / doubles.
 */
export const calibration = {
  name: 'calibration',
  defaults: c => ({ bins: c.calibration_bins }),
  compute({ elo }, { bins }) {
    const make = () => ({
      n: new Int32Array(bins), predicted: new Float64Array(bins), observed: new Float64Array(bins),
      games: 0, logLoss: 0, brier: 0,
    });
    const out = { all: make(), singles: make(), doubles: make() };
    const N = elo.perGame.eW.length;
    const bin = p => Math.min(bins - 1, Math.floor(p * bins));
    for (let g = 0; g < N; g++) {
      const e = elo.perGame.eW[g];
      for (const c of [out.all, elo.slots[4 * g + 1] === -1 ? out.singles : out.doubles]) {
        c.games++;
        c.logLoss -= Math.log(e);
        c.brier += (1 - e) ** 2;
        const b = bin(e), b2 = bins - 1 - b;           // mirrored, so the curve stays symmetric at 0.5
        c.n[b]++; c.predicted[b] += e; c.observed[b] += 1;
        c.n[b2]++; c.predicted[b2] += 1 - e;
      }
    }
    for (const c of Object.values(out)) {
      for (let b = 0; b < bins; b++) {
        c.predicted[b] = c.n[b] ? c.predicted[b] / c.n[b] : NaN;
        c.observed[b] = c.n[b] ? c.observed[b] / c.n[b] : NaN;
      }
      c.logLoss = c.games ? c.logLoss / c.games : NaN;
      c.brier = c.games ? c.brier / c.games : NaN;
    }
    return out;
  },
};
