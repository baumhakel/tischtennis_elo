// Run: node --test test/*.test.mjs — Phase 14: Prognose (core/forecast.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../js/core/loader.js';
import { compute } from '../js/core/elo.js';
import { serialFromParts } from '../js/core/normalize.js';
import { rng, seedFrom, poisson, workdays, monthOf, forecastInput, simulate, spotlight,
  backtestInputs, backtest, currentStandings, mcError } from '../js/core/forecast.js';
import { demoRaw } from '../js/io/demo.js';

const d = load(demoRaw('Europe/Vienna', 'klein'));
const elo = compute(d);
const model = { dataset: d, elo };
const tLast = d.games.at(-1).t;

test('random numbers: seeded, uniform, Poisson mean', () => {
  const a = rng(seedFrom('x')), b = rng(seedFrom('x'));
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
  const r = rng(7);
  let s = 0, n = 20000;
  for (let i = 0; i < n; i++) s += poisson(r, 6.5);
  assert.ok(Math.abs(s / n - 6.5) < 0.1);
  let big = 0;
  for (let i = 0; i < 2000; i++) big += poisson(r, 900);
  assert.ok(Math.abs(big / 2000 - 900) < 3);
  assert.equal(poisson(r, 0), 0);
});

test('calendar: workdays and month bounds', () => {
  const mon = serialFromParts(2026, 11, 9);          // Monday
  assert.equal(workdays(mon, mon + 7), 5);
  assert.equal(workdays(mon + 5, mon + 7), 0);       // weekend
  assert.ok(Math.abs(workdays(mon + 0.5, mon + 1) - 0.5) < 1e-9);
  const m = monthOf(serialFromParts(2026, 12, 15, 10));
  assert.deepEqual([m.from, m.to], [serialFromParts(2026, 12, 1), serialFromParts(2027, 1, 1)]);
});

test('input: the state at t uses only earlier games', () => {
  const t = d.games[300].t;
  const I = forecastInput(model, 'alle', t);
  for (let k = 0; k < I.ids.length; k++) {
    const h = elo.history[k];
    const m = [...h.g].filter(g => d.games[g].t < t).length;
    assert.equal(I.played[k], m);
    if (m) assert.equal(I.rating[k], h.r[m - 1]);
    assert.ok(I.sigma[k] >= Math.sqrt(d.config.k_single * 200 / Math.LN10) / 2 - 1e-9);
  }
  assert.ok(I.pool.length > 0 && I.lambda > 0);
});

test('simulate: deterministic, probabilities add up', () => {
  const t = serialFromParts(...(() => { const x = monthOf(tLast); return [x.y, x.mo, 10]; })());
  const I = forecastInput(model, 'alle', Math.min(t, tLast));
  const a = simulate(I, 2000, 42), b = simulate(I, 2000, 42);
  assert.deepEqual([...a.p1], [...b.p1]);
  const sum = a.p1.reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9 || sum === 0);
  assert.ok(Math.abs(a.top3.reduce((x, y) => x + y, 0) - Math.min(3, currentStandings(I).length)) < 0.05);
  for (let k = 0; k < I.ids.length; k++) assert.ok(a.p1[k] <= a.top3[k] + 1e-12);
  assert.ok(a.riser.reduce((x, y) => x + y, 0) <= 1 + 1e-9);
  assert.ok(mcError(0.5, 10000) < 0.006);
});

test('simulate: no games left → the current order stays', () => {
  const I = forecastInput(model, 'alle', tLast + 1e-6);
  I.lambda = 0;
  const res = simulate(I, 200, 1);
  const lead = currentStandings(I)[0];
  assert.equal(res.p1[lead], 1);
});

test('simulate: a clear favourite in a two-player toy league', () => {
  const I = {
    ids: ['A', 'B'], t: 0, end: 10, mode: 'einzel',
    rating: Float64Array.of(1500, 1400), played: Int32Array.of(50, 50), lastT: Float64Array.of(0, 0),
    sigma: Float64Array.of(1, 1), mBase: Float64Array.of(NaN, NaN), mGames: Int32Array.of(0, 0),
    pool: [[0, -1, 1, -1]], lambda: 1, kSingle: 40, kDouble: 20, scale: 1,
    minGames: 0, inactivityDays: 0, monthlyMin: 1, riserMinGames: 0,
  };
  const res = simulate(I, 20000, 3);
  // A stays ahead unless B wins the (at most few) games: P(B ahead) needs B to win ≥ 2 of them
  assert.ok(res.p1[0] > 0.9 && res.p1[0] < 1);
  const f = simulate(I, 5000, 3, { force: [1, 0] });
  assert.ok(f.p1[1] > res.p1[1]);
});

test('Spitzenspiel and backtest have the expected shape', () => {
  const I = forecastInput(model, 'alle', tLast);
  I.lambda = Math.max(I.lambda, 5);
  const res = simulate(I, 1000, 5);
  const s = spotlight(I, res, 400, 5);
  if (s) {
    assert.ok(I.ids.includes(s.a) && I.ids.includes(s.b) && s.a !== s.b);
    assert.ok(s.swing >= 0 && s.swing <= 1);
  }
  const items = backtestInputs(model, 'alle', tLast);
  assert.ok(items.length > 0);
  const bt = backtest(items.slice(0, 6), 300, 9, 10);
  assert.equal(bt.forecasts, Math.min(6, items.length));
  for (const v of Object.values(bt.brier)) assert.ok(v >= 0 && v <= 2);
  assert.equal(bt.bins.length, 10);
});

test('view logic: rows, teaser, wording of chances', async () => {
  const { chance, forecastRows, forecastTeaser, monthEndLabel } = await import('../js/views/forecast-logic.js');
  assert.equal(chance(0), '–');
  assert.equal(chance(0.002), '< 1 %');
  assert.equal(chance(0.999), '> 99 %');
  assert.equal(chance(1), '100 %');
  assert.equal(monthEndLabel(serialFromParts(2026, 12, 1)), 'Ende November');
  const I = forecastInput(model, 'alle', tLast);
  I.lambda = Math.max(I.lambda, 5);
  const F = { input: I, res: simulate(I, 500, 2), end: I.end };
  const rows = forecastRows(F);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].p1 >= rows[i].p1);
  const t = forecastTeaser(F);
  assert.equal(t.id, rows[0].id);
  assert.equal(forecastTeaser({ ...F, input: { ...I, lambda: 0 } }), null);
  assert.equal(forecastTeaser(null), null);
});
