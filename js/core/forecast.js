// Prognose (Phase 14): Chance auf Platz 1 am Monatsende. PURE, no DOM — runs in a Web Worker.
//
// Monte Carlo, one run =
//   1. true strengths θ_k ~ N(Elo-Wert_k, (s·σ_k)²), drawn once per run
//   2. the rest of the month: n ~ Poisson(λ) games, λ = games per workday in the last `rate_days`
//      days × workdays left; each game = a random past game of that window (same type, same people)
//   3. each game: the side with the higher θ wins more often (Elo formula on θ, team = mean);
//      the Elo-Werte move with the real engine update (K by game type)
//   4. Rangliste at month end with the Wertung's default filters → Platz 1, Top 3, Platz,
//      Monatsaufsteiger (most Elo gained in the month, ≥ monthly_min_games games, ranked by the badge rules)
// σ_k: spread of the player's last `smooth_sd_games` Elo-Werte (only the past, so the backtest is fair),
// never below half the theoretical noise of an Elo-Wert, √(K·200/ln 10) / 2.
//
//   forecastInput(model, mode, t)              → state at time t (plain data, can go to a worker)
//   simulate(input, n, seed, { force })        → { p1, top3, place, eligible, riser, n }
//   spotlight(input, res, n, seed)             → the Spitzenspiel or null
//   backtest(inputs, n, seed)                  → { forecasts, brier, bins }
import { serialFromParts, serialToParts } from './normalize.js';

// ───────── random numbers (seeded, so the numbers don't jitter between reloads) ─────────

export function seedFrom(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
export function rng(seed) {             // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(rand) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
export function poisson(rand, lambda) {
  if (lambda <= 0) return 0;
  if (lambda > 500) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal(rand)));
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rand(); } while (p > L);
  return k - 1;
}

// ───────── calendar ─────────

const isWeekday = d => { const w = (Math.floor(d) + 5) % 7; return w < 5; };   // serial 0 = Saturday → Monday = 0
/** Workdays (Mon–Fri) between serials a and b, counting part days. */
export function workdays(a, b) {
  let s = 0;
  for (let d = Math.floor(a); d < b; d++) {
    if (!isWeekday(d)) continue;
    s += Math.max(0, Math.min(b, d + 1) - Math.max(a, d));
  }
  return s;
}
export function monthOf(t) {
  const p = serialToParts(t);
  const from = serialFromParts(p.y, p.mo, 1);
  const to = p.mo === 12 ? serialFromParts(p.y + 1, 1, 1) : serialFromParts(p.y, p.mo + 1, 1);
  return { from, to, y: p.y, mo: p.mo };
}

// ───────── state at time t ─────────

/**
 * @param model  { dataset, elo } of one Wertung (full replay)
 * @param mode   'alle' | 'einzel' | 'doppel'
 * @param t      sheet serial: the forecast is made at this moment (games before t are known)
 * @param end    month end (default: end of t's month)
 */
export function forecastInput(model, mode, t, end = monthOf(t).to) {
  const { dataset, elo } = model, cfg = dataset.config, G = dataset.games;
  const n = elo.ids.length;
  let gEnd = 0;
  while (gEnd < G.length && G[gEnd].t < t) gEnd++;
  const monthStart = monthOf(t).from;
  const rating = new Float64Array(n), played = new Int32Array(n), lastT = new Float64Array(n).fill(-Infinity);
  const sigma = new Float64Array(n), mBase = new Float64Array(n).fill(NaN), mGames = new Int32Array(n);
  const K = mode === 'doppel' ? cfg.k_double : cfg.k_single;
  const floor = Math.sqrt(K * 200 / Math.LN10) / 2;
  const win = Math.max(2, Math.round(cfg.smooth_sd_games));
  for (let k = 0; k < n; k++) {
    const h = elo.history[k];
    let m = 0;
    while (m < h.g.length && h.g[m] < gEnd) m++;
    played[k] = m;
    rating[k] = m ? h.r[m - 1] : elo.start[k];
    if (m) lastT[k] = G[h.g[m - 1]].t;
    // spread of the last `win` Elo-Werte, floored
    const from = Math.max(0, m - win);
    let s1 = 0, s2 = 0, c = 0;
    for (let i = from; i < m; i++) { s1 += h.r[i]; s2 += h.r[i] * h.r[i]; c++; }
    const sd = c > 1 ? Math.sqrt(Math.max(0, (s2 - s1 * s1 / c) / (c - 1))) : 0;
    sigma[k] = Math.max(floor, sd);
    // this month so far: rating before the first game of the month, games in the month
    for (let i = 0; i < m; i++) {
      if (G[h.g[i]].t < monthStart) continue;
      if (!mGames[k]) mBase[k] = i ? h.r[i - 1] : elo.start[k];
      mGames[k]++;
    }
  }
  // the pool: past games of the last rate_days days (participants and type)
  const from = t - cfg.forecast_rate_days;
  const pool = [];
  for (let g = gEnd - 1; g >= 0 && G[g].t >= from; g--) pool.push([...elo.slots.subarray(4 * g, 4 * g + 4)]);
  const perDay = pool.length / Math.max(1e-9, workdays(from, t));
  const left = workdays(t, end);
  const minGames = mode === 'einzel' ? cfg.default_min_games_single : mode === 'doppel' ? cfg.default_min_games_double : cfg.default_min_games;
  return {
    ids: elo.ids.slice(), t, end, mode,
    rating, played, lastT, sigma, mBase, mGames,
    pool, lambda: perDay * left, perDay, workdaysLeft: left,
    kSingle: cfg.k_single, kDouble: cfg.k_double, scale: cfg.forecast_uncertainty_scale,
    minGames, inactivityDays: cfg.default_inactivity_days, monthlyMin: cfg.monthly_min_games, riserMinGames: cfg.achievement_rank_min_games,
  };
}

/** Rangliste (indices) at month end by the default filters. */
function standings(I, r, played, last) {
  const out = [];
  for (let k = 0; k < r.length; k++) {
    if (played[k] < I.minGames || played[k] === 0) continue;
    if (I.inactivityDays > 0 && last[k] < I.end - I.inactivityDays) continue;
    out.push(k);
  }
  return out.sort((a, b) => r[b] - r[a]);
}
export const currentStandings = I => standings(I, I.rating, I.played, I.lastT);

// ───────── simulation ─────────

/**
 * @param force  optional [winner, loser] (indices): a singles game played first, with a fixed result (Spitzenspiel)
 */
export function simulate(I, nSims, seed, { force = null } = {}) {
  const n = I.ids.length, rand = rng(seed);
  const p1 = new Float64Array(n), top3 = new Float64Array(n), placeSum = new Float64Array(n), eligible = new Float64Array(n), riser = new Float64Array(n);
  const r = new Float64Array(n), played = new Int32Array(n), last = new Float64Array(n), base = new Float64Array(n), mg = new Int32Array(n), th = new Float64Array(n);
  const P = Int32Array.from(I.pool.flat()), m = I.pool.length;
  const touch = k => { if (!mg[k]) base[k] = r[k]; mg[k]++; played[k]++; last[k] = I.t; };
  // one game, w1/w2 beat l1/l2 (w2 = l2 = -1 in singles)
  const play = (w1, w2, l1, l2) => {
    const dbl = w2 >= 0;
    const rW = dbl ? (r[w1] + r[w2]) / 2 : r[w1], rL = dbl ? (r[l1] + r[l2]) / 2 : r[l1];
    const d = (dbl ? I.kDouble : I.kSingle) * (1 - 1 / (1 + Math.pow(10, (rL - rW) / 400)));
    touch(w1); touch(l1); r[w1] += d; r[l1] -= d;
    if (dbl) { touch(w2); touch(l2); r[w2] += d; r[l2] -= d; }
  };
  for (let s = 0; s < nSims; s++) {
    r.set(I.rating); played.set(I.played); last.set(I.lastT); base.set(I.mBase); mg.set(I.mGames);
    for (let k = 0; k < n; k++) th[k] = I.rating[k] + I.scale * I.sigma[k] * normal(rand);
    if (force) play(force[0], -1, force[1], -1);
    const games = m ? poisson(rand, I.lambda) : 0;
    for (let j = 0; j < games; j++) {
      const o = 4 * Math.floor(rand() * m);
      const a1 = P[o], a2 = P[o + 1], b1 = P[o + 2], b2 = P[o + 3];
      const tA = a2 >= 0 ? (th[a1] + th[a2]) / 2 : th[a1], tB = b2 >= 0 ? (th[b1] + th[b2]) / 2 : th[b1];
      if (rand() < 1 / (1 + Math.pow(10, (tB - tA) / 400))) play(a1, a2, b1, b2); else play(b1, b2, a1, a2);
    }
    const order = standings(I, r, played, last);
    for (let i = 0; i < order.length; i++) {
      const k = order[i];
      eligible[k]++; placeSum[k] += i + 1;
      if (i === 0) p1[k]++;
      if (i < 3) top3[k]++;
    }
    // Monatsaufsteiger: most Elo gained this month (same rules as the badge)
    let best = -1, gain = 0;
    for (let k = 0; k < n; k++) {
      if (mg[k] < I.monthlyMin || played[k] < I.riserMinGames) continue;
      const g = r[k] - base[k];
      if (g > gain) { gain = g; best = k; }
    }
    if (best >= 0) riser[best]++;
  }
  const div = a => Float64Array.from(a, x => x / nSims);
  return { n: nSims, p1: div(p1), top3: div(top3), riser: div(riser), eligible: div(eligible),
    place: Float64Array.from(placeSum, (x, k) => (eligible[k] ? x / eligible[k] : NaN)) };
}

/** Monte-Carlo standard error of a probability. */
export const mcError = (p, n) => Math.sqrt(Math.max(p * (1 - p), 0) / n);

// ───────── Spitzenspiel: the singles pairing whose result moves the favourite's chance most ─────────

export function spotlight(I, res, nSims, seed) {
  let fav = -1;
  res.p1.forEach((p, k) => { if (fav < 0 || p > res.p1[fav]) fav = k; });
  if (fav < 0 || res.p1[fav] <= 0) return null;
  const cand = [...res.p1.keys()].filter(k => res.p1[k] >= 0.01 || res.top3[k] >= 0.25)
    .sort((a, b) => res.p1[b] - res.p1[a]).slice(0, 4);
  if (cand.length < 2) return null;
  let best = null;
  for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
    const a = cand[i], b = cand[j];
    const sA = simulate(I, nSims, seed, { force: [a, b] }), sB = simulate(I, nSims, seed, { force: [b, a] });   // same seed: common random numbers
    const swing = Math.abs(sA.p1[fav] - sB.p1[fav]);
    if (!best || swing > best.swing) best = { a: I.ids[a], b: I.ids[b], fav: I.ids[fav], ifA: sA.p1[fav], ifB: sB.p1[fav], swing };
  }
  return best;
}

// ───────── backtest: forecasts as of the 1st, 10th and 20th of past months ─────────

/** All forecast moments of completed months, with the actual Platz 1 at month end. */
export function backtestInputs(model, mode, now) {
  const G = model.dataset.games;
  if (!G.length) return [];
  const out = [];
  let m = monthOf(G[0].t);
  const rateDays = model.dataset.config.forecast_rate_days;
  while (m.to <= now) {
    const atEnd = forecastInput(model, mode, m.to, m.to);
    const winner = currentStandings(atEnd)[0];
    if (winner !== undefined) {
      for (const day of [1, 10, 20]) {
        const t = serialFromParts(m.y, m.mo, day);
        if (t - rateDays < G[0].t) continue;          // not enough history to estimate the pace
        const I = forecastInput(model, mode, t, m.to);
        if (I.lambda <= 0 || currentStandings(I).length < 2) continue;
        out.push({ I, winner, label: `${day}.${m.mo}.${m.y}` });
      }
    }
    m = monthOf(m.to);
  }
  return out;
}

export function backtest(items, nSims, seed, bins = 10) {
  const brier = { model: 0, leader: 0, softmax: 0 };
  const B = Array.from({ length: bins }, () => ({ n: 0, p: 0, y: 0 }));
  let n = 0;
  for (const [i, { I, winner }] of items.entries()) {
    const res = simulate(I, nSims, seed + i);
    const now = currentStandings(I);
    const leader = now[0];
    const w = new Float64Array(I.ids.length);
    let z = 0;
    for (const k of now) { w[k] = Math.exp(I.rating[k] / 100); z += w[k]; }
    for (let k = 0; k < I.ids.length; k++) {
      const y = k === winner ? 1 : 0, p = res.p1[k];
      brier.model += (p - y) ** 2;
      brier.leader += ((k === leader ? 1 : 0) - y) ** 2;
      brier.softmax += ((z ? w[k] / z : 0) - y) ** 2;
      if (p > 0 || y) { const b = B[Math.min(bins - 1, Math.floor(p * bins))]; b.n++; b.p += p; b.y += y; }
    }
    n++;
  }
  if (!n) return null;
  for (const key of Object.keys(brier)) brier[key] /= n;
  return { forecasts: n, brier, bins: B.map((b, i) => ({ lo: i / bins, hi: (i + 1) / bins, n: b.n, meanP: b.n ? b.p / b.n : NaN, freq: b.n ? b.y / b.n : NaN })) };
}

// ───────── one job (the worker and the fallback run the same code) ─────────

/**
 * phase 'main':     { I, n, quick, seed }          → { res, spot }
 * phase 'backtest': { items, quick, seed, bins }   → { bt }
 */
export function runJob(phase, job) {
  if (phase === 'main') {
    const res = simulate(job.I, job.n, job.seed);
    const spot = job.I.lambda > 0 && job.I.mode !== 'doppel' ? spotlight(job.I, res, job.quick, job.seed + 1) : null;
    return { res, spot };
  }
  return { bt: backtest(job.items, job.quick, job.seed, job.bins) };
}
