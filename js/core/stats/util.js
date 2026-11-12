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

/** Upper tail P(X ≥ x) of a χ² distribution with k degrees of freedom (regularised gamma Q(k/2, x/2)). */
export function chiSquareUpper(x, k) {
  if (!(x > 0)) return 1;
  const a = k / 2, z = x / 2;
  const lg = logGamma(a);
  if (z < a + 1) {                                 // series for P, then Q = 1 − P
    let sum = 1 / a, term = sum;
    for (let n = 1; n < 500; n++) { term *= z / (a + n); sum += term; if (term < sum * 1e-14) break; }
    return Math.max(0, 1 - sum * Math.exp(-z + a * Math.log(z) - lg));
  }
  let b = z + 1 - a, c = 1e300, d = 1 / b, f = d;  // continued fraction for Q (Lentz)
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    f *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.min(1, f * Math.exp(-z + a * Math.log(z) - lg));
}

function logGamma(x) {                             // Lanczos, g = 7
  const C = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let s = C[0];
  for (let i = 1; i < 9; i++) s += C[i] / (x + i);
  const t = x + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(s);
}

/**
 * Empirical Bayes shrinkage towards 0 (random effects θ_i ~ N(0, τ²), r_i | θ_i ~ N(θ_i, v_i)).
 * τ² by the method of moments (DerSimonian–Laird with the mean fixed at 0: E[Q] = m + τ² Σw).
 * Returns { tau2, Q, df, p, est[i], sd[i] } with est = posterior mean, sd = posterior SD.
 */
export function shrinkToZero(r, v) {
  const m = r.length;
  let Q = 0, W = 0;
  for (let i = 0; i < m; i++) { const w = 1 / v[i]; Q += w * r[i] * r[i]; W += w; }
  const tau2 = m && W ? Math.max(0, (Q - m) / W) : 0;
  const est = r.map((x, i) => (tau2 > 0 ? x * tau2 / (tau2 + v[i]) : 0));
  const sd = v.map(vi => (tau2 > 0 ? Math.sqrt(tau2 * vi / (tau2 + vi)) : 0));
  return { tau2, Q, df: m, p: m ? chiSquareUpper(Q, m) : 1, est, sd };
}
