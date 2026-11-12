// Run: node --test test/*.test.mjs — Phase 15: Jahresrückblick (views/review-logic.js) and the monthday config type
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_DEFAULTS } from '../js/config.js';
import { load } from '../js/core/loader.js';
import { compute } from '../js/core/elo.js';
import { serialFromParts } from '../js/core/normalize.js';
import { createStats } from '../js/core/stats/index.js';
import { reviewSeason, reviewYears, playerYear, leagueYear } from '../js/views/review-logic.js';

const NAMES = ['A', 'B', 'C'];
function model(games, cfg = {}) {
  const config = [['key', 'value'], ...Object.entries({ ...Object.fromEntries(Object.entries(CONFIG_DEFAULTS).map(([k, d]) => [k, d.value])),
    responses_valid_from: serialFromParts(2024, 1, 1), default_min_games: 1, h2h_min_games: 2, ...cfg })];
  const raw = {
    config, legacy: [['timestamp', 'winner1', 'winner2', 'loser1', 'loser2', 'source_row']],
    spiele: [['Zeitstempel', 'Sieger 1', 'Sieger 2', 'Verlierer 1', 'Verlierer 2'], ...games.map(([t, w, l]) => [t, w[0], w[1] || '', l[0], l[1] || ''])],
    players: [['id', 'display_name', 'active'], ...NAMES.map((n, i) => [`p${i + 1}`, n, true])],
    aliases: [['name', 'player_id'], ...NAMES.map((n, i) => [n, `p${i + 1}`])],
    corrections: [['game_ref', 'action', 'note']],
  };
  const dataset = load(raw), elo = compute(dataset);
  return { dataset, elo, stats: createStats(dataset, elo, {}) };
}
const T = (y, m, d, h = 12) => serialFromParts(y, m, d, h);

test('monthday config: text, German date text, date cell; the season wraps the new year', () => {
  const m = model([[T(2025, 3, 2), ['A'], ['B']]], { year_review_from: '01.12.', year_review_until: serialFromParts(2027, 1, 31) });
  assert.deepEqual(m.dataset.config.year_review_from, [12, 1]);
  assert.deepEqual(m.dataset.config.year_review_until, [1, 31]);
  assert.deepEqual(model([], { year_review_from: '12-05' }).dataset.config.year_review_from, [12, 5]);
  const cfg = m.dataset.config;
  assert.deepEqual(reviewSeason(cfg, T(2026, 12, 3)), { inSeason: true, year: 2026 });
  assert.deepEqual(reviewSeason(cfg, T(2027, 1, 20)), { inSeason: true, year: 2026 });
  assert.deepEqual(reviewSeason(cfg, T(2026, 11, 12)), { inSeason: false, year: 2026 });
});

test('player year: counts, Elo from 1 Jan, streak, opponents only inside the year', () => {
  const games = [
    [T(2025, 12, 30), ['A'], ['B']],                       // last year: changes the start Elo, not the counts
    [T(2026, 1, 5), ['A'], ['B']], [T(2026, 1, 6), ['A'], ['C']], [T(2026, 1, 7), ['B'], ['A']],
    [T(2026, 2, 2), ['A', 'C'], ['B', 'C'].slice(0, 1).concat([])],
  ].slice(0, 4);
  games.push([T(2026, 2, 2), ['A', 'C'], ['B']]);   // invalid doubles (3 players) are skipped by the loader
  const m = model(games);
  assert.deepEqual(reviewYears(m.dataset), [2026, 2025]);
  const y = playerYear(m, null, 2026, 'p1', T(2026, 12, 31));
  assert.equal(y.games, 3); assert.equal(y.wins, 2); assert.equal(y.days, 3);
  assert.equal(y.eloStart, m.elo.history[0].r[0]);          // after the game of 30 Dec
  assert.equal(y.spark.length, 4);
  assert.equal(y.streak.len, 2);
  assert.equal(y.opponent.id, 'p2'); assert.equal(y.opponent.meetings, 2);
  assert.equal(y.nemesis, null);                             // 1 : 1 against B is not below half
  assert.equal(playerYear(m, null, 2024, 'p1', T(2026, 12, 31)), null);
});

test('league year: totals, Elo gained, most games, biggest upset', () => {
  const m = model([[T(2026, 1, 5), ['A'], ['B']], [T(2026, 1, 6), ['A'], ['B']], [T(2026, 1, 7), ['B'], ['A']], [T(2026, 1, 8), ['C'], ['A']]]);
  const L = leagueYear(m, null, 2026, T(2026, 6, 1));
  assert.equal(L.games, 4); assert.equal(L.players, 3); assert.equal(L.running, true);
  assert.equal(L.mostGames[0].id, 'p1');
  assert.equal(L.upset.g, 2);                                // B beat A after A had won twice
  assert.ok(L.gainers.length > 0);
});
