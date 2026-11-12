// Pure helpers of the Abzeichen pages (views/badge-defs.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { isoWeek, tierName, progressOf, DEFS, ORDER } from '../js/views/badge-defs.js';
import { BADGES } from '../js/core/achievements.js';
import { CONFIG_DEFAULTS } from '../js/config.js';
import { serialFromParts } from '../js/core/normalize.js';

const cfg = Object.fromEntries(Object.entries(CONFIG_DEFAULTS).map(([k, v]) => [k, v.value]));

test('ISO weeks', () => {
  assert.deepEqual(isoWeek(serialFromParts(2026, 11, 16)), { week: 47, year: 2026 });
  assert.deepEqual(isoWeek(serialFromParts(2026, 11, 22, 23)), { week: 47, year: 2026 });
  assert.deepEqual(isoWeek(serialFromParts(2027, 1, 1)), { week: 53, year: 2026 });
  assert.deepEqual(isoWeek(serialFromParts(2025, 12, 29)), { week: 1, year: 2026 });
});

test('tier names from config, „Stufe n“ beyond the list', () => {
  assert.equal(tierName(cfg, 1), 'Gebietsliga');
  assert.equal(tierName(cfg, 4), 'Champions League');
  assert.equal(tierName({ ...cfg, achievement_tier_names: ['A'] }, 2), 'Stufe 2');
});

test('every badge has texts and a motif, and the catalogue matches the engine', () => {
  assert.deepEqual(ORDER.slice().sort(), Object.keys(BADGES).sort());
  for (const b of ORDER) {
    assert.ok(DEFS[b].name && DEFS[b].motif && DEFS[b].cond, b);
    assert.equal(typeof DEFS[b].cond(cfg, 1), 'string');
  }
});

test('progress towards the next level', () => {
  const levels = { games: [50, 250, 500, 1000], giant: [0.3, 0.2, 0.1] };
  const p = { level: { games: 1 }, value: { games: 125, giant: 0.4 } };
  const g = progressOf(cfg, levels, 'games', p);
  assert.equal(g.next, 250); assert.equal(g.ratio, 0.5); assert.match(g.text, /125 Spiele/);
  const r = progressOf(cfg, levels, 'giant', p);
  assert.equal(r.next, 0.3); assert.ok(r.ratio > 0.8 && r.ratio < 0.9);
  assert.equal(progressOf(cfg, levels, 'games', { level: { games: 4 }, value: { games: 1200 } }).ratio, 1);
});
