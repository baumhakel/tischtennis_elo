// Run: node --test test/   — pure parts of the Phase 5 views (series builders, matrix metrics)
import test from 'node:test';
import assert from 'node:assert/strict';
import { demoRaw } from '../js/io/demo.js';
import { load } from '../js/core/loader.js';
import { compute, ratingAfter } from '../js/core/elo.js';
import { createStats } from '../js/core/stats/index.js';
import { ratingSeries, smoothSeries, rankSeries, movementSeries, recentStart, rangeStart, toSeconds, fromSeconds } from '../js/ui/series.js';
import { METRICS, cells, order, edges } from '../js/views/matrix-metrics.js';

const d = load(demoRaw('Europe/Vienna'));
const elo = compute(d);
const model = { dataset: d, elo, stats: createStats(d, elo) };
const ks = [...elo.ids.keys()];
const N = d.games.length;
const noNaN = arr => arr.every(v => v === null || Number.isFinite(v));

test('seconds ↔ serial', () => {
  assert.equal(toSeconds(25569), 0);
  assert.equal(fromSeconds(toSeconds(46000.5)), 46000.5);
});

test('ratingSeries: aligned, null before first game, matches ratingAfter', () => {
  for (const axis of ['game', 'date']) {
    const { x, ys } = ratingSeries(model, ks, axis, 0);
    assert.equal(x.length, N);
    for (let i = 1; i < x.length; i++) assert.ok(x[i] >= x[i - 1], 'x sorted');
    ys.forEach((y, i) => {
      assert.equal(y.length, N); assert.ok(noNaN(y));
      for (const g of [0, 10, N - 1]) {
        const want = ratingAfter(elo, ks[i], g);
        assert.equal(y[g], Number.isFinite(want) ? want : null);
      }
    });
  }
  const start = recentStart(model);
  assert.ok(start >= 0 && start <= Math.max(0, N - d.config.dashboard_games));
  const w = ratingSeries(model, ks, 'game', start);
  assert.equal(w.x.length, N - start + (start > 0 ? 1 : 0));
  if (start > 0) assert.equal(w.x[0], start);
  const own = ratingSeries(model, ks, 'own');
  assert.equal(own.x.length, Math.max(...elo.played));
  assert.equal(own.ys[0][elo.played[0] - 1], elo.final[0]);
  assert.equal(own.ys[0][elo.played[0]] ?? null, null);
});

test('smoothSeries: values only at own games, band around mean', () => {
  for (const axis of ['game', 'date', 'own']) {
    const s = smoothSeries(model, ks, axis);
    for (let i = 1; i < s.x.length; i++) assert.ok(s.x[i] > s.x[i - 1]);
    s.mean.forEach((m, i) => {
      assert.ok(noNaN(m));
      assert.equal(m.filter(v => v !== null).length, elo.played[ks[i]]);
      m.forEach((v, j) => { if (v !== null) assert.ok(s.lo[i][j] <= v && v <= s.hi[i][j]); });
    });
  }
});

test('rankSeries and movementSeries: aligned, no NaN', () => {
  const r = rankSeries(model, ks, 'game', 5);
  assert.equal(r.x.length, N);
  r.ys.forEach(y => { assert.equal(y.length, N); assert.ok(noNaN(y)); });
  assert.ok(r.maxRank >= 1 && r.maxRank <= ks.length);
  const m = movementSeries(model, 'date');
  assert.equal(m.rolling.length, N); assert.ok(noNaN(m.rolling));
  assert.equal(m.calm[0], m.mv.calmAt);
});

test('matrix metrics: cells scaled into range, edges consistent, cluster order is a permutation', () => {
  const M = model.stats.get('matrices'), n = elo.ids.length;
  for (const metric of METRICS) {
    const { vals, t } = cells(M[metric.stat], n, ks, metric);
    assert.equal(vals.length, ks.length);
    for (const row of t) for (const v of row) {
      if (!Number.isFinite(v)) continue;
      if (metric.kind === 'seq') assert.ok(v >= 0 && v <= 1); else assert.ok(v >= -1 && v <= 1);
    }
    const es = edges(M[metric.stat], n, ks, metric);
    assert.ok(es.every(e => e.w > 0 && e.w <= 1));
    if (metric.graph === 'directed') {
      for (const e of es) {
        const a = M[metric.stat][e.i * n + e.j], b = M[metric.stat][e.j * n + e.i];
        if (metric.kind === 'seq') assert.ok(a > b); else assert.ok(a > (metric.mid ?? 0));
      }
    }
    assert.ok(metric.fmt(1.5).length > 0);
  }
  for (const how of ['elo', 'name', 'cluster']) {
    const o = order(ks, how, { elo, normed: M.matchupsNormed, names: k => elo.ids[k] });
    assert.deepEqual(o.slice().sort((a, b) => a - b), ks);
  }
});

test('ranges: start indices ordered, own axis keeps absolute game numbers', () => {
  const now = d.games.at(-1).t;
  const st = Object.fromEntries(['insgesamt', 'jahr', 'monat', 'aktuell', 'heute'].map(r => [r, rangeStart(model, r, now)]));
  assert.equal(st.insgesamt, 0);
  assert.ok(st.jahr <= st.monat && st.monat <= st.heute && st.heute <= N);
  assert.ok(d.games[st.monat].t >= now - 31 && (st.monat === 0 || d.games[st.monat - 1].t < now - 27));
  if (st.heute < N) assert.equal(Math.floor(d.games[st.heute].t), Math.floor(now));
  const own = ratingSeries(model, ks, 'own', st.monat);
  own.ys.forEach((y, i) => y.forEach((v, j) => {
    if (v === null) return;
    const ownIdx = own.x[j] - 1;
    assert.ok(elo.history[ks[i]].g[ownIdx] >= st.monat);
    assert.equal(v, elo.history[ks[i]].r[ownIdx]);
  }));
  const sm = smoothSeries(model, ks, 'game', st.monat);
  assert.ok(sm.x.every(x => x >= st.monat + 1));
});

import { opponents, partnersOf, bestTeams, duel } from '../js/views/duels.js';
test('duels: opponents/partners consistent with elo; duel counts and probability', () => {
  const k = 0, id = elo.ids[0];
  const opp = opponents(model, k);
  const sum = opp.reduce((s, o) => s + o.n, 0);
  assert.ok(Math.abs(sum - elo.played[k]) < 1e-9);
  const par = partnersOf(model, k);
  assert.equal(par.reduce((s, p) => s + p.n, 0), elo.doubles[k]);
  const teams = bestTeams(model, ks, 1);
  for (let i = 1; i < teams.length; i++) assert.ok(teams[i - 1].perGame >= teams[i].perGame);
  const other = elo.ids[opp[0].j];
  const dd = duel(model, [id], [other]);
  assert.equal(dd.aWins + dd.bWins, dd.games.length);
  assert.equal(dd.singles + dd.doubles, dd.games.length);
  assert.ok(dd.pA > 0 && dd.pA < 1);
  const back = duel(model, [other], [id]);
  assert.equal(back.aWins, dd.bWins);
  assert.ok(Math.abs(back.pA + dd.pA - 1) < 1e-12);
  // singles between the two = singles part of the pair matrix (full games)
  const singles = d.games.filter(g => !g.double && [...g.winners, ...g.losers].includes(id) && [...g.winners, ...g.losers].includes(other)).length;
  assert.equal(dd.singles, singles);
});
