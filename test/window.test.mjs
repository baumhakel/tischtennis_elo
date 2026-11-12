// Run: node --test test/*.test.mjs — Phase 13: Zeitraum (core/window.js, elo.sliceElo)
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../js/core/loader.js';
import { compute, sliceElo, ratingAfter } from '../js/core/elo.js';
import { createStats } from '../js/core/stats/index.js';
import { serialFromParts } from '../js/core/normalize.js';
import { windowRange, validRange, sliceModel } from '../js/core/window.js';
import { visible } from '../js/core/filters.js';
import { demoRaw } from '../js/io/demo.js';

const d = load(demoRaw('Europe/Vienna', 'klein'));
const elo = compute(d);
const model = { dataset: d, elo, stats: createStats(d, elo, {}) };

test('Zeitraum specs: presets, own ranges, junk', () => {
  const now = serialFromParts(2026, 1, 15, 10);
  assert.equal(windowRange('gesamt', now), null);
  const m = windowRange('monat', now), v = windowRange('vormonat', now), j = windowRange('jahr', now);
  assert.deepEqual([m.from, m.to, m.label], [serialFromParts(2026, 1, 1), serialFromParts(2026, 2, 1), 'Jänner 2026']);
  assert.deepEqual([v.from, v.to, v.label], [serialFromParts(2025, 12, 1), serialFromParts(2026, 1, 1), 'Dezember 2025']);
  assert.equal(j.label, '2026');
  const own = windowRange('2026-10-01..2026-10-31', now);
  assert.deepEqual([own.from, own.to], [serialFromParts(2026, 10, 1), serialFromParts(2026, 11, 1)]);
  assert.equal(validRange('2026-02-30..2026-03-01'), false);
  assert.equal(validRange('2026-03-02..2026-03-01'), false);
  assert.equal(windowRange('quatsch', now), null);
});

test('the whole range as a slice equals the replay', () => {
  const s = sliceElo(elo, 0, d.games.length);
  assert.deepEqual(s.ids, elo.ids);
  assert.deepEqual([...s.final], [...elo.final]);
  assert.deepEqual([...s.played], [...elo.played]);
  assert.deepEqual([...s.pair.matchups], [...elo.pair.matchups]);
  assert.deepEqual([...s.partner.wins], [...elo.partner.wins]);
  assert.deepEqual([...s.prior], new Array(s.ids.length).fill(0));
});

test('a window keeps the continuous rating and counts only its games', () => {
  const a = 100, b = 180;
  const s = sliceElo(elo, a, b);
  for (const [k, id] of s.ids.entries()) {
    const K = elo.index.get(id);
    assert.ok(Math.abs(s.final[k] - ratingAfter(elo, K, b - 1)) < 1e-9, 'rating at the end of the window');
    const hg = elo.history[K].g;
    const before = hg.filter(g => g < a).length, inside = hg.filter(g => g >= a && g < b).length;
    assert.equal(s.prior[k], before);
    assert.equal(s.played[k], inside);
    const firstInside = hg.findIndex(g => g >= a);
    assert.ok(Math.abs(s.start[k] - (firstInside > 0 ? elo.history[K].r[firstInside - 1] : elo.start[K])) < 1e-9, 'rating entering the window');
  }
  const total = s.pair.matchups.reduce((x, y) => x + y, 0);
  let expect = 0;
  for (let g = a; g < b; g++) expect += d.games[g].double ? 4 : 2;   // each matchup counted from both sides
  assert.ok(Math.abs(total - expect) < 1e-9);
});

test('sliceModel: provisional counts earlier games, stats run on the window', () => {
  const t0 = d.games[200].t, t1 = d.games[260].t;
  const w = sliceModel(model, t0, t1);
  assert.ok(w.dataset.games.length > 0 && w.dataset.games.length <= 61);
  const vis = visible(w.dataset, w.elo, { minGames: 20, inactivityDays: 0 }, w.stats.now);
  for (const k of vis.listed) assert.equal(vis.provisional.has(k), w.elo.played[k] + w.elo.prior[k] < 20);
  const rec = w.stats.get('records');
  assert.ok(rec);
  assert.ok(w.stats.get('upsets'));
  assert.ok(w.stats.get('calibration'));
  const empty = sliceModel(model, serialFromParts(1990, 1, 1), serialFromParts(1990, 2, 1));
  assert.equal(empty.dataset.games.length, 0);
  assert.equal(empty.elo.ids.length, 0);
});
