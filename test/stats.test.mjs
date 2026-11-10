// Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { compute, winProbability, ratingsAfter } from '../js/core/elo.js';
import { createStats } from '../js/core/stats/index.js';
import { weekStart } from '../js/core/stats/activity.js';
import { serialFromParts } from '../js/core/normalize.js';
import { CONFIG_DEFAULTS } from '../js/config.js';

const CFG = Object.fromEntries(Object.entries(CONFIG_DEFAULTS).map(([k, d]) => [k, d.value]));
const close = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) < eps, msg || `${a} ≉ ${b}`);

/** Dataset from [[winners], [losers], t?] — t defaults to one game per hour from 2026-11-02. */
function ds(list, config = {}) {
  const t0 = serialFromParts(2026, 11, 2, 8);
  return {
    config: { ...CFG, ...config },
    games: list.map(([w, l, t], g) => ({ g, t: t ?? t0 + g / 24, winners: w, losers: l, double: w.length === 2, approxTime: false })),
  };
}
function model(list, config, now) {
  const d = ds(list, config);
  const elo = compute(d);
  return { d, elo, stats: createStats(d, elo, now == null ? {} : { now }) };
}

function league(nGames, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const P = Array.from({ length: 12 }, (_, i) => 'p' + String(i + 1).padStart(3, '0'));
  const t0 = serialFromParts(2025, 1, 6, 8);
  const list = [];
  for (let i = 0; i < nGames; i++) {
    const k = rnd() < 0.3 ? 4 : 2;
    const pick = new Set();
    while (pick.size < k) pick.add(P[Math.floor(rnd() * (i < 50 ? 6 : 12))]);   // late joiners
    const q = [...pick];
    list.push([q.slice(0, k / 2), q.slice(k / 2), t0 + i * 0.25]);
  }
  return list;
}

const A = 'p001', B = 'p002', C = 'p003';

test('form: delta over last N own games, last results, streak', () => {
  const { elo, stats } = model([[[A], [B]], [[A], [B]], [[B], [A]], [[A], [B]]]);
  const f = stats.get('form', { n: 2, results: 5 });
  const a = elo.index.get(A), b = elo.index.get(B);
  close(f.delta[a], elo.history[a].r[3] - elo.history[a].r[1]);
  assert.equal(f.last[a], 'WWLW'); assert.equal(f.last[b], 'LLWL');
  assert.equal(f.streak[a], 1); assert.equal(f.streak[b], -1);
  const f10 = stats.get('form', { n: 10, results: 2 });
  close(f10.delta[a], elo.final[a] - 1400);   // fewer games than N → since start
  assert.equal(f10.last[a], 'LW');
});

test('recent + risingStar: window by days, start rating for newcomers, min games', () => {
  const day = serialFromParts(2026, 11, 20, 12);
  const list = [
    [[A], [B], day - 30], [[A], [B], day - 20],
    [[B], [A], day - 3], [[B], [A], day - 2], [[B], [A], day - 1],
    [[C], [A], day - 0.5],
  ];
  const { elo, stats } = model(list, {}, day);
  const w = stats.get('recent', { days: 7 });
  const [a, b, c] = [A, B, C].map(id => elo.index.get(id));
  assert.deepEqual([w.games[a], w.games[b], w.games[c]], [4, 3, 1]);
  close(w.delta[b], elo.final[b] - elo.history[b].r[1]);
  close(w.delta[c], elo.final[c] - 1400);
  const rs = stats.get('risingStar', { days: 7, minGames: 2 });
  assert.deepEqual(rs.map(x => x.k), [b, a]);         // C has only 1 game
  assert.ok(rs[0].delta > 0 && rs[1].delta < 0);
  assert.equal(stats.get('risingStar').length, 2);    // config defaults: 7 days, min 3 → A and B
});

test('leaderboard: sorted by rating, fields consistent', () => {
  const { elo, stats } = model(league(300));
  const lb = stats.get('leaderboard');
  assert.equal(lb.length, elo.ids.length);
  for (let i = 1; i < lb.length; i++) assert.ok(lb[i - 1].rating >= lb[i].rating);
  for (const row of lb) {
    assert.equal(row.wins + row.losses, row.games);
    assert.ok(row.last.length <= CFG.leaderboard_form_results);
  }
});

test('bestRuns: matches brute force; N = 1 is the biggest single gain', () => {
  const { elo, stats } = model(league(500));
  const br = stats.get('bestRuns', { maxN: 20 });
  const rec = stats.get('records');
  for (let k = 0; k < elo.ids.length; k++) {
    const seq = [elo.start[k], ...elo.history[k].r];
    for (const N of [1, 5, 20]) {
      let hi = -Infinity, lo = Infinity;
      for (let i = N; i < seq.length; i++) { hi = Math.max(hi, seq[i] - seq[i - N]); lo = Math.min(lo, seq[i] - seq[i - N]); }
      if (seq.length - 1 < N) { assert.ok(Number.isNaN(br.best[k][N - 1])); continue; }
      close(br.best[k][N - 1], hi); close(br.worst[k][N - 1], lo);
    }
    close(br.best[k][0], rec.maxGain[k]);
    close(br.worst[k][0], rec.maxLoss[k]);
  }
});

test('smoothing: constant → flat with zero band; tiny h → raw; huge h → time-weighted mean', () => {
  const { elo, stats } = model(league(400));
  // 'own' evaluates at segment centres → raw values. 'game'/'date' evaluate at the jump itself, so a
  // vanishing kernel gives the midpoint of the two levels (the first point only sees its own level).
  const tinyOwn = stats.get('smoothing', { axis: 'own', sdGames: 1e-3 });
  for (let k = 0; k < elo.ids.length; k++) {
    tinyOwn[k].mean.forEach((m, i) => close(m, elo.history[k].r[i], 1e-6, 'own tiny'));
    tinyOwn[k].sd.forEach(s => assert.ok(s < 1e-6));
  }
  for (const axis of ['game', 'date']) {
    const tiny = stats.get('smoothing', { axis, sdGames: 1e-3, sdDays: 1e-5 });
    for (let k = 0; k < elo.ids.length; k++) {
      const r = elo.history[k].r;
      tiny[k].mean.forEach((m, i) => close(m, i ? (r[i - 1] + r[i]) / 2 : r[0], 1e-6, `${axis} tiny`));
    }
  }
  const huge = stats.get('smoothing', { axis: 'own', sdGames: 1e6 });
  for (let k = 0; k < elo.ids.length; k++) {
    const r = elo.history[k].r, mean = r.reduce((x, y) => x + y, 0) / r.length;
    close(huge[k].mean[0], mean, 1e-3);
    close(huge[k].mean.at(-1), mean, 1e-3);
  }
  // one rating held forever: mean = that rating, band 0
  const one = model([[[A], [B]]]).stats.get('smoothing', { axis: 'date' });
  close(one[0].mean[0], 1420); close(one[0].sd[0], 0);
  // band is non-negative and finite everywhere
  for (const s of stats.get('smoothing')) s.sd.forEach(v => assert.ok(v >= 0 && Number.isFinite(v)));
});

test('matrices: invariants of every metric', () => {
  const { elo, stats } = model(league(2000));
  const M = stats.get('matrices'), n = elo.ids.length;
  let sumE = 0, T = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const c = i * n + j, t = j * n + i;
    if (i === j) { assert.ok(Number.isNaN(M.winProb[c]) && Number.isNaN(M.deviation[c])); continue; }
    sumE += M.expectedMatchups[c]; T += M.matchups[c] / 2;
    close(M.winProb[c] + M.winProb[t], 1);
    close(M.winProb[c], winProbability(elo.final[i], elo.final[j]));
    if (M.matchups[c] > 0) {
      close(M.winRatio[c] + M.winRatio[t], 1);
      close(M.actualVsExpected[c], -M.actualVsExpected[t]);
      close(M.avgTransfer[c], -M.avgTransfer[t]);
    }
    close(M.matchupsNormed[c], M.matchupsNormed[t]);
    close(M.deviation[c], M.deviation[t]);
  }
  close(sumE, 2 * T, 1e-6, 'expected matchups sum to all matchups');
  const P = stats.get('partners');
  for (let c = 0; c < n * n; c++) if (P.games[c]) close(P.chemistry[c], P.chemistryPerGame[c] * P.games[c]);
});

test('movement: per game Σ|Δ|/2, trailing mean, level', () => {
  const { d, elo, stats } = model(league(600));
  const mv = stats.get('movement', { window: 10, calm: 25, turbulent: 75 });
  for (let g = 0; g < 600; g++) {
    const before = ratingsAfter(elo, g - 1), after = ratingsAfter(elo, g);
    let s = 0;
    for (let k = 0; k < elo.ids.length; k++) {
      const x = Number.isNaN(before[k]) ? (Number.isNaN(after[k]) ? 0 : after[k] - elo.start[k]) : after[k] - before[k];
      s += Math.abs(x);
    }
    close(mv.perGame[g], s / 2, 1e-9, `game ${g}`);
  }
  assert.ok(Number.isNaN(mv.rolling[8]));
  close(mv.rolling[9], mv.perGame.slice(0, 10).reduce((a, b) => a + b) / 10);
  close(mv.rolling[599], mv.perGame.slice(590).reduce((a, b) => a + b) / 10);
  assert.ok(mv.calmAt <= mv.turbulentAt);
  assert.ok(['calm', 'normal', 'turbulent'].includes(mv.level));
  assert.ok(mv.percentile > 0 && mv.percentile <= 100);
  assert.equal(d.games.length, 600);
});

test('upsets: biggest surprise first', () => {
  const { elo, stats } = model(league(300));
  const u = stats.get('upsets');
  for (let i = 1; i < u.order.length; i++) assert.ok(u.surprise[u.order[i - 1]] >= u.surprise[u.order[i]]);
  close(u.surprise[u.order[0]], 1 - Math.min(...elo.perGame.eW));
});

test('calibration: two symmetric observations per game; scores', () => {
  const { elo, stats } = model(league(800));
  const cal = stats.get('calibration', { bins: 10 });
  assert.equal(cal.all.games, 800);
  assert.equal(cal.singles.games + cal.doubles.games, 800);
  assert.equal(cal.all.n.reduce((a, b) => a + b), 1600);
  for (let b = 0; b < 10; b++) {
    assert.equal(cal.all.n[b], cal.all.n[9 - b]);
    if (cal.all.n[b]) close(cal.all.observed[b] + cal.all.observed[9 - b], 1, 1e-9);
  }
  close(cal.all.logLoss, -elo.perGame.eW.reduce((a, e) => a + Math.log(e), 0) / 800);
});

test('ranks: brute force; newcomers only ranked after minGames (bug #2)', () => {
  const { elo, stats } = model(league(500));
  const n = elo.ids.length;
  for (const minGames of [1, 10]) {
    const rk = stats.get('ranks', { minGames });
    const played = new Int32Array(n);
    for (let g = 0; g < 500; g++) {
      for (let s = 0; s < 4; s++) { const k = elo.slots[4 * g + s]; if (k !== -1) played[k]++; }
      const r = ratingsAfter(elo, g);
      const pool = [...Array(n).keys()].filter(k => played[k] >= minGames);
      assert.equal(rk.pool[g], pool.length);
      for (let k = 0; k < n; k++) {
        const expect = pool.includes(k) ? 1 + pool.filter(j => r[j] > r[k]).length : 0;
        assert.equal(rk.rank[g * n + k], expect, `g ${g} k ${k}`);
      }
      if (pool.length) assert.equal(rk.rank[g * n + rk.leader[g]], 1);
    }
  }
  // a newcomer with one win is not #1 with minGames = 3
  const m = model([[[A], [B]], [[A], [B]], [[A], [B]], [[C], [B]]]);
  const rk = m.stats.get('ranks', { minGames: 3 });
  assert.equal(rk.leader[3], m.elo.index.get(A));
  assert.equal(rk.rank[3 * 3 + m.elo.index.get(C)], 0);
});

test('records: highs/lows exclude the start value; streaks; time at #1; h2h share', () => {
  const list = [[[A], [B]], [[A], [B]], [[A], [B]], [[B], [A]], [[A], [C]], [[A], [C]], [[C], [B]]];
  const { elo, stats } = model(list);
  const r = stats.get('records', { minGames: 1, h2hMin: 2 });
  const [a, b, c] = [A, B, C].map(id => elo.index.get(id));
  close(r.highest[b], 1380);                          // after B's first game, not the 1400 start
  assert.equal(r.highestG[b], 0);
  close(r.lowest[b], Math.min(...elo.history[b].r));
  assert.ok(r.lowest[a] > 1400);                      // start value not counted
  assert.equal(r.longestWin[a], 3); assert.equal(r.longestLoss[b], 3);
  assert.equal(r.longestWinG[a], 2);
  const total = [...r.leaderGames].reduce((x, y) => x + y, 0);
  assert.equal(total, list.length);
  assert.equal(r.leaderGames[a], list.length);
  assert.equal(r.leaderRun[a], list.length);
  close(r.leaderDays[a], (list.length - 1) / 24);     // until the last game (= now by default)
  assert.equal(r.mostMatches.n, 4);
  assert.ok(r.h2h.every(p => p.share >= 0.5 && p.share <= 1));
  assert.equal(r.mostLopsided.share, 1);              // A–C 2:0 beats A–B 3:1
});

test('activity: Monday-to-Sunday weeks, counts per player', () => {
  const mon = serialFromParts(2026, 11, 9), sun = serialFromParts(2026, 11, 15, 23, 59);
  assert.equal(weekStart(mon), mon);
  assert.equal(weekStart(sun), mon);
  assert.equal(weekStart(sun + 1 / 1440 + 1e-9), mon + 7);
  const { elo, stats } = model([[[A], [B], mon + 0.5], [[A], [C], sun], [[B], [C], mon + 8]], {}, mon + 20);
  const act = stats.get('activity');
  assert.deepEqual([...act.weeks], [mon, mon + 7, mon + 14]);
  assert.deepEqual([...act.counts[elo.index.get(A)]], [2, 0, 0]);
  assert.deepEqual([...act.counts[elo.index.get(C)]], [1, 1, 0]);
});

test('registry: defaults from config, memoised, overridable', () => {
  const { stats } = model(league(100), { form_games: 3 });
  assert.equal(stats.get('form'), stats.get('form'));
  assert.equal(stats.get('form'), stats.get('form', { n: 3 }));
  assert.notEqual(stats.get('form'), stats.get('form', { n: 4 }));
  assert.throws(() => stats.get('nope'));
  assert.ok(stats.names.includes('records'));
});

test('empty dataset: every stat runs', () => {
  const { stats } = model([]);
  for (const name of stats.names) stats.get(name);
});

test('all stats on 2000 games are fast', () => {
  const { stats } = model(league(2000));
  const t0 = performance.now();
  for (const name of stats.names) stats.get(name);
  for (const axis of ['own', 'date']) stats.get('smoothing', { axis });
  const ms = performance.now() - t0;
  console.log(`# all stats: ${ms.toFixed(0)} ms`);
  assert.ok(ms < 500, `took ${ms} ms`);
});
