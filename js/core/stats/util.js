// Small numeric helpers shared by the stats modules. Pure.

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf, |error| < 1.5e-7). */
export function Phi(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);
const phi = z => INV_SQRT_2PI * Math.exp(-0.5 * z * z);

/**
 * Gaussian kernel mass of the interval [a, b] around x with SD h: Φ((b−x)/h) − Φ((a−x)/h).
 * Short intervals use Simpson's rule on the density, which stays accurate where the
 * difference of two Φ approximations would lose precision.
 */
export function kernelMass(a, b, x, h) {
  const za = (a - x) / h, zb = (b - x) / h, w = zb - za;
  if (w < 0.2) return w * (phi(za) + 4 * phi((za + zb) / 2) + phi(zb)) / 6;
  return Phi(zb) - Phi(za);
}

/** Linear-interpolated quantile (type 7, as R's default) of a sorted array, p in [0, 1]. */
export function quantileSorted(sorted, p) {
  const n = sorted.length;
  if (!n) return NaN;
  const h = (n - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/** Index of the last element ≤ x in an ascending array, or -1. */
export function lastLE(arr, x) {
  let lo = 0, hi = arr.length - 1, pos = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) { pos = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return pos;
}

/** Index of the first element ≥ x in an ascending array, or arr.length. */
export function firstGE(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Did player k win global game g? */
export function won(elo, k, g) {
  return elo.slots[4 * g] === k || elo.slots[4 * g + 1] === k;
}

/** Player k's Elo change in global game g (they must have played it). */
export function ownChange(elo, k, g) {
  return won(elo, k, g) ? elo.perGame.delta[g] : -elo.perGame.delta[g];
}

/** n×n matrix filled with NaN. */
export const nanMatrix = n => new Float64Array(n * n).fill(NaN);
