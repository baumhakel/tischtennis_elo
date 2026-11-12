// Run: node --test test/*.test.mjs — Phase 9: one Elo replay per mode (app/modes.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { demoRaw } from '../js/io/demo.js';
import { load } from '../js/core/loader.js';
import { compute, winProbability } from '../js/core/elo.js';
import { createStats } from '../js/core/stats/index.js';
import { modelFor, modeDataset } from '../js/app/modes.js';
import { findGame } from '../js/views/game-query.js';

const d = load(demoRaw('Europe/Vienna'));
const elo = compute(d);
const pooled = { dataset: d, elo, stats: createStats(d, elo) };

test('modeDataset: only that mode\'s games, re-indexed, same order', () => {
  const s = modeDataset(d, 'einzel'), dd = modeDataset(d, 'doppel');
  assert.equal(s.games.length + dd.games.length, d.games.length);
  assert.ok(s.games.every((g, i) => !g.double && g.g === i));
  assert.ok(dd.games.every((g, i) => g.double && g.g === i));
  for (let i = 1; i < s.games.length; i++) assert.ok(s.games[i].t >= s.games[i - 1].t);
  assert.notEqual(s.hash, d.hash);
  assert.equal(modeDataset(d, 'alle'), d);
  assert.ok(d.games.some(g => g.double), 'the pooled data is untouched');
});

test('modelFor: alle is the pooled model; others memoised and independent', () => {
  assert.equal(modelFor(pooled, 'alle'), pooled);
  assert.equal(modelFor(pooled, undefined), pooled);
  const e = modelFor(pooled, 'einzel');
  assert.equal(modelFor(pooled, 'einzel'), e, 'memoised');
  assert.equal(e.mode, 'einzel');
  assert.equal(e.stats.now, pooled.stats.now);
  // singles: winner gains exactly k_single·(1 − e_W) on the mode's own ratings, replayed from the start
  const cfg = d.config, s = e.elo;
  assert.equal(s.perGame.delta.length, e.dataset.games.length);
  for (const g of [0, 5, e.dataset.games.length - 1]) {
    assert.ok(Math.abs(s.perGame.delta[g] - cfg.k_single * (1 - winProbability(s.perGame.rW[g], s.perGame.rL[g]))) < 1e-9);
  }
  // first singles game: both players start at the start rating, whatever they did in doubles before
  assert.equal(s.perGame.rW[0], cfg.start_rating);
  // independent ratings: someone's singles rating differs from their pooled one
  assert.ok(s.ids.some(id => Math.abs(s.final[s.index.get(id)] - elo.final[elo.index.get(id)]) > 1e-6));
  // played counts per mode add up to the pooled ones
  const dbl = modelFor(pooled, 'doppel').elo;
  for (const id of elo.ids) {
    const n = (s.index.has(id) ? s.played[s.index.get(id)] : 0) + (dbl.index.has(id) ? dbl.played[dbl.index.get(id)] : 0);
    assert.equal(n, elo.played[elo.index.get(id)]);
  }
  // doubles mode uses k_double and team means
  const g = 3, sl = dbl.slots;
  const mean = (a, b) => (dbl.perGame.before[4 * g + a] + dbl.perGame.before[4 * g + b]) / 2;
  assert.ok(Math.abs(dbl.perGame.rW[g] - mean(0, 1)) < 1e-9 && sl[4 * g + 1] >= 0);
  assert.ok(Math.abs(dbl.perGame.delta[g] - cfg.k_double * (1 - dbl.perGame.eW[g])) < 1e-9);
});

test('a game is found by game_ref in its own mode only', () => {
  const x = d.games.find(g => g.double);
  assert.ok(findGame(modelFor(pooled, 'doppel').dataset, x.ref) >= 0);
  assert.equal(findGame(modelFor(pooled, 'einzel').dataset, x.ref), -1);
});

test('stats run on every mode', () => {
  for (const mode of ['einzel', 'doppel']) {
    const m = modelFor(pooled, mode);
    for (const name of m.stats.names) m.stats.get(name);
  }
});
