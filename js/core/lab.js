// Labor (Phase 16). PURE, no DOM — the bootstrap runs in a Web Worker.
//
// Residual method: for every player in every game y − e (won 1/0 minus the pre-game win chance
// of the player's side). An effect is the mean residual in a group of games, shown as
// „Siege über Erwartung pro 100 Spiele“.
//
// Hot hand, cold hand, Revanche and the Schere-Stein-Papier cycles are compared with a parametric
// bootstrap null: the whole history is played again with each game won with the Elo win chance it
// really had, the Elo engine runs on these made-up results, and the same statistics are measured.
// That corrects the two biases of streak statistics: after a streak the rating has already moved
// (catch-up), and choosing games by what came before them (selection, Miller & Sanjurjo 2018).
//
//   labSchedule(model, opts)        → plain data for the worker (slots, win chances, K, start)
//   measure(S, y, eA, { lists })    → the statistics for one history (observed: y = 1, eA = eW)
//   nullRuns(S, nSims, seed)        → the same statistics for nSims made-up histories
//   summarize(obs, nul)             → effects with 95 % intervals and p-values
//   timedGroups(model, opts)        → form-entry analyses (sessions, hour, weekday) by groups
//   diversity(model, ks)            → effective number of opponents per player
import { rng, seedFrom } from './forecast.js';
import { shrinkToZero } from './stats/util.js';

// ───────── schedule ─────────

/** @param opts { streak, minH } streak = lab_hot_hand_streak, minH = h2h_min_games */
export function labSchedule(model, { streak, minH }) {
  const { elo, dataset } = model, cfg = dataset.config, N = dataset.games.length;
  const K = new Float64Array(N);
  for (let g = 0; g < N; g++) K[g] = elo.slots[4 * g + 1] >= 0 ? cfg.k_double : cfg.k_single;
  return { n: elo.ids.length, N, slots: elo.slots.slice(), eW: elo.perGame.eW.slice(), K, start: elo.start.slice(), streak, minH };
}

// ───────── one history ─────────

/**
 * y[g] = 1 if the side in slots 0/1 won, eA[g] = that side's pre-game win chance.
 * Returns sums, counts and variance sums (Σ e(1−e)) per statistic; with lists: the cycles.
 */
export function measure(S, y, eA, { lists = false } = {}) {
  const { n, N, slots, streak: L, minH } = S;
  const run = new Int32Array(n);                 // > 0 wins in a row, < 0 losses in a row
  const last = new Int8Array(n * n);              // last singles result of row against column
  const meet = new Float64Array(n * n), wins = new Float64Array(n * n), expd = new Float64Array(n * n);
  const hot = acc(), cold = acc(), revenge = acc();
  const hotP = new Float64Array(n), hotN = new Float64Array(n), hotV = new Float64Array(n);
  const coldP = new Float64Array(n), coldN = new Float64Array(n);
  for (let g = 0; g < N; g++) {
    const a1 = slots[4 * g], a2 = slots[4 * g + 1], b1 = slots[4 * g + 2], b2 = slots[4 * g + 3];
    const won = y[g], e = eA[g], rA = won - e, v = e * (1 - e);
    const one = (p, res, w) => {
      if (run[p] >= L) { add(hot, res, v); hotP[p] += res; hotN[p]++; hotV[p] += v; }
      else if (run[p] <= -L) { add(cold, res, v); coldP[p] += res; coldN[p]++; }
      run[p] = w ? (run[p] > 0 ? run[p] + 1 : 1) : (run[p] < 0 ? run[p] - 1 : -1);
    };
    one(a1, rA, won); one(b1, -rA, !won);
    if (a2 >= 0) { one(a2, rA, won); one(b2, -rA, !won); }
    if (a2 < 0) {                                  // Revanche: singles after a singles loss to the same opponent
      if (last[a1 * n + b1] === -1) add(revenge, rA, v);
      if (last[b1 * n + a1] === -1) add(revenge, -rA, v);
      last[a1 * n + b1] = won ? 1 : -1; last[b1 * n + a1] = won ? -1 : 1;
    }
    // Begegnungen for the cycles (doubles: ½ per opponent pair, as in the pair matrix)
    const A = a2 >= 0 ? [a1, a2] : [a1], B = b2 >= 0 ? [b1, b2] : [b1], w8 = a2 >= 0 ? 0.5 : 1;
    for (const p of A) for (const q of B) {
      meet[p * n + q] += w8; meet[q * n + p] += w8;
      expd[p * n + q] += w8 * e; expd[q * n + p] += w8 * (1 - e);
      if (won) wins[p * n + q] += w8; else wins[q * n + p] += w8;
    }
  }
  const beats = (i, j) => meet[i * n + j] >= minH && wins[i * n + j] > meet[i * n + j] / 2;
  const over = (i, j) => meet[i * n + j] >= minH && wins[i * n + j] - expd[i * n + j] > 1e-9;
  const cyc = edge => {
    let c = 0;
    const list = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
      if (edge(i, j) && edge(j, k) && edge(k, i)) { c++; if (lists) list.push([i, j, k]); }
      if (edge(i, k) && edge(k, j) && edge(j, i)) { c++; if (lists) list.push([i, k, j]); }
    }
    return { count: c, list };
  };
  let pairs = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (meet[i * n + j] >= minH) pairs++;
  const cw = cyc(beats), cr = cyc(over);
  return { hot, cold, revenge, hotP, hotN, hotV, coldP, coldN, pairs, cycles: cw.count, cyclesResid: cr.count, cycleList: cw.list, residList: cr.list };
}
const acc = () => ({ sum: 0, n: 0, v: 0 });
const add = (a, r, v) => { a.sum += r; a.n++; a.v += v; };
const mean = a => (a.n ? a.sum / a.n : NaN);

// ───────── the null ─────────

/** nSims made-up histories: game g is won with its real Elo chance eW[g]; the engine runs on them. */
export function nullRuns(S, nSims, seed) {
  const { n, N, slots, eW, K, start } = S, rand = rng(seed);
  const r = new Float64Array(n), y = new Uint8Array(N), eA = new Float64Array(N);
  const out = { hot: [], cold: [], revenge: [], cycles: [], cyclesResid: [], hotP: new Float64Array(n), hotN: new Float64Array(n), coldP: new Float64Array(n), coldN: new Float64Array(n) };
  for (let s = 0; s < nSims; s++) {
    r.set(start);
    for (let g = 0; g < N; g++) {
      const a1 = slots[4 * g], a2 = slots[4 * g + 1], b1 = slots[4 * g + 2], b2 = slots[4 * g + 3];
      const rA = a2 >= 0 ? (r[a1] + r[a2]) / 2 : r[a1], rB = b2 >= 0 ? (r[b1] + r[b2]) / 2 : r[b1];
      const e = 1 / (1 + Math.pow(10, (rB - rA) / 400));
      const won = rand() < eW[g] ? 1 : 0;
      y[g] = won; eA[g] = e;
      const d = K[g] * (won - e);
      r[a1] += d; r[b1] -= d;
      if (a2 >= 0) { r[a2] += d; r[b2] -= d; }
    }
    const m = measure(S, y, eA);
    out.hot.push(mean(m.hot)); out.cold.push(mean(m.cold)); out.revenge.push(mean(m.revenge));
    out.cycles.push(m.cycles); out.cyclesResid.push(m.cyclesResid);
    for (let p = 0; p < n; p++) { out.hotP[p] += m.hotP[p]; out.hotN[p] += m.hotN[p]; out.coldP[p] += m.coldP[p]; out.coldN[p] += m.coldN[p]; }
  }
  return out;
}

/** What the worker runs: { S, nSims, key } → nullRuns, seeded with the key (data hash + Wertung). */
export function runLabJob({ S, nSims, key }) {
  return nullRuns(S, nSims, seedFrom(key));
}

// ───────── observed vs null ─────────

function effect(obsMean, nullValues, n) {
  const xs = nullValues.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length || !Number.isFinite(obsMean)) return null;
  const q = p => xs[Math.min(xs.length - 1, Math.max(0, Math.round(p * (xs.length - 1))))];
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  const ge = xs.filter(x => x >= obsMean).length / xs.length, le = xs.filter(x => x <= obsMean).length / xs.length;
  // basic bootstrap: observed minus the spread of the null around its mean
  return { n, observed: obsMean, nullMean: m, effect: obsMean - m, lo: obsMean - q(0.975), hi: obsMean - q(0.025),
    p: Math.min(1, 2 * Math.min(ge, le)), sims: xs.length };
}

/**
 * obs = measure(…) of the real history, nul = nullRuns(…) (or null while it runs).
 * Effects are per game (×100 for display); lo/hi = 95 % interval; p two-sided.
 */
export function summarize(obs, nul, minSamples) {
  const out = {
    hot: { n: obs.hot.n, enough: obs.hot.n >= minSamples, raw: mean(obs.hot) },
    cold: { n: obs.cold.n, enough: obs.cold.n >= minSamples, raw: mean(obs.cold) },
    revenge: { n: obs.revenge.n, enough: obs.revenge.n >= minSamples, raw: mean(obs.revenge) },
    cycles: { observed: obs.cycles, resid: obs.cyclesResid, pairs: obs.pairs, list: obs.cycleList, residList: obs.residList, enough: obs.pairs >= 3 },
    ready: !!nul,
  };
  if (!nul) return out;
  Object.assign(out.hot, effect(mean(obs.hot), nul.hot, obs.hot.n));
  Object.assign(out.cold, effect(mean(obs.cold), nul.cold, obs.cold.n));
  Object.assign(out.revenge, effect(mean(obs.revenge), nul.revenge, obs.revenge.n));
  const tail = (xs, x) => xs.filter(v => v >= x).length / xs.length;
  out.cycles.nullMean = nul.cycles.reduce((s, x) => s + x, 0) / nul.cycles.length;
  out.cycles.p = tail(nul.cycles, obs.cycles);
  out.cycles.residNullMean = nul.cyclesResid.reduce((s, x) => s + x, 0) / nul.cyclesResid.length;
  out.cycles.residP = tail(nul.cyclesResid, obs.cyclesResid);
  // per player: hot-hand residual minus the player's own null mean, shrunk (empirical Bayes)
  const ks = [], r = [], v = [];
  for (let p = 0; p < obs.hotN.length; p++) {
    if (!obs.hotN[p] || !nul.hotN[p] || !(obs.hotV[p] > 0)) continue;
    ks.push(p);
    r.push(obs.hotP[p] / obs.hotN[p] - nul.hotP[p] / nul.hotN[p]);
    v.push(obs.hotV[p] / (obs.hotN[p] * obs.hotN[p]));
  }
  const fit = shrinkToZero(r, v);
  out.hotPlayers = { tau2: fit.tau2, p: fit.p, rows: ks.map((k, i) => ({ k, n: obs.hotN[k], raw: r[i], est: fit.est[i], lo: fit.est[i] - 1.96 * fit.sd[i], hi: fit.est[i] + 1.96 * fit.sd[i] })) };
  return out;
}

// ───────── form entries: sessions, time of day, weekday ─────────

const BANDS = [[0, 10, 'vor 10 Uhr'], [10, 12, '10 bis 12 Uhr'], [12, 14, '12 bis 14 Uhr'], [14, 16, '14 bis 16 Uhr'], [16, 24, 'ab 16 Uhr']];
const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

/**
 * Form entries only (exact times). Two kinds of analyses:
 *  - by situation (position in the session with gap ≤ gapMinutes, first game of the day, Revanche
 *    in the same session): the residual mean per group, over everyone.
 *  - by player (hour band, weekday): a whole game falls into one band, so over everyone the
 *    residuals cancel exactly. What can differ is a player's own pattern: the mean per player and
 *    group, shrunk (empirical Bayes) over the cells with ≥ minSamples games.
 * @returns {{ key, title, perPlayer, groups?: [{label, n, mean, se}], cells?: {tau2, p, rows: [{k, label, n, raw, est, lo, hi}]} }[]}
 */
export function timedGroups(model, { gapMinutes, minSamples }) {
  const { elo, dataset } = model, G = dataset.games, n = elo.ids.length;
  const gap = gapMinutes / 1440;
  const lastT = new Float64Array(n).fill(-Infinity), pos = new Int32Array(n), sess = new Int32Array(n);
  const lastSingle = new Map();                     // "p,q" → { sess, lost }
  const groups = { position: new Map(), firstOfDay: new Map(), sessionRevenge: new Map(), hour: new Map(), weekday: new Map() };
  const put = (m, key, label, order, res, v, k = -1) => {
    const a = m.get(key) || m.set(key, { label, order, k, n: 0, sum: 0, v: 0 }).get(key);
    a.n++; a.sum += res; a.v += v;
  };
  for (let g = 0; g < G.length; g++) {
    const x = G[g];
    if (x.source !== 'spiele') continue;
    const s = elo.slots, a1 = s[4 * g], a2 = s[4 * g + 1], b1 = s[4 * g + 2], b2 = s[4 * g + 3];
    const e = elo.perGame.eW[g], res = 1 - e, v = e * (1 - e);   // the winners' side; losers get −res
    const hour = (x.t - Math.floor(x.t)) * 24, wd = (Math.floor(x.t) + 5) % 7;
    const band = BANDS.findIndex(([lo, hi]) => hour >= lo && hour < hi);
    const each = (p, r) => {
      const newDay = Math.floor(lastT[p]) !== Math.floor(x.t);
      if (x.t - lastT[p] > gap) { pos[p] = 1; sess[p]++; } else pos[p]++;
      lastT[p] = x.t;
      const P = Math.min(pos[p], 4);
      put(groups.position, P, P < 4 ? `${P}. Spiel der Session` : '4. Spiel und später', P, r, v);
      put(groups.firstOfDay, newDay ? 1 : 0, newDay ? 'erstes Spiel des Tages' : 'weitere Spiele des Tages', newDay ? 0 : 1, r, v);
      put(groups.hour, `${p}|${band}`, BANDS[band][2], band, r, v, p);
      put(groups.weekday, `${p}|${wd}`, WEEKDAYS[wd], wd, r, v, p);
    };
    each(a1, res); each(b1, -res);
    if (a2 >= 0) { each(a2, res); each(b2, -res); }
    if (a2 < 0) {
      for (const [p, q, r] of [[a1, b1, res], [b1, a1, -res]]) {
        const prev = lastSingle.get(`${p},${q}`);
        if (prev && prev.lost && prev.sess === sess[p]) put(groups.sessionRevenge, 1, 'nächstes Einzel gegen denselben Gegner nach einer Niederlage', 0, r, v);
        lastSingle.set(`${p},${q}`, { sess: sess[p], lost: r < 0 });
      }
    }
  }
  const fin = m => [...m.values()].sort((a, b) => a.order - b.order)
    .map(a => ({ label: a.label, n: a.n, mean: a.sum / a.n, se: Math.sqrt(a.v) / a.n }));
  const cells = m => {
    const use = [...m.values()].filter(a => a.n >= minSamples && a.v > 0);
    const fit = shrinkToZero(use.map(a => a.sum / a.n), use.map(a => a.v / (a.n * a.n)));
    return { tau2: fit.tau2, p: fit.p, rows: use.map((a, i) => ({ k: a.k, label: a.label, order: a.order, n: a.n, raw: a.sum / a.n,
      est: fit.est[i], lo: fit.est[i] - 1.96 * fit.sd[i], hi: fit.est[i] + 1.96 * fit.sd[i] })) };
  };
  return [
    { key: 'position', title: 'Position in der Session', perPlayer: false, groups: fin(groups.position) },
    { key: 'firstOfDay', title: 'Erstes Spiel des Tages', perPlayer: false, groups: fin(groups.firstOfDay) },
    { key: 'sessionRevenge', title: 'Revanche in derselben Session', perPlayer: false, groups: fin(groups.sessionRevenge) },
    { key: 'hour', title: 'Uhrzeit', perPlayer: true, cells: cells(groups.hour) },
    { key: 'weekday', title: 'Wochentag', perPlayer: true, cells: cells(groups.weekday) },
  ];
}

// ───────── Gegnervielfalt ─────────

/** Per player k in ks: Begegnungen, effective number of opponents e^H, share of the most frequent one. */
export function diversity(model, ks) {
  const { elo } = model, n = elo.ids.length, M = elo.pair.matchups;
  return ks.map(k => {
    let tot = 0, top = 0, topJ = -1, H = 0, opp = 0;
    for (let j = 0; j < n; j++) { const m = M[k * n + j]; if (j !== k && m > 0) { tot += m; opp++; if (m > top) { top = m; topJ = j; } } }
    for (let j = 0; j < n; j++) { const m = M[k * n + j]; if (j !== k && m > 0) { const p = m / tot; H -= p * Math.log(p); } }
    return { k, meetings: tot, opponents: opp, effective: Math.exp(H), topJ, topShare: tot ? top / tot : NaN };
  }).filter(r => r.meetings > 0).sort((a, b) => b.effective - a.effective);
}
