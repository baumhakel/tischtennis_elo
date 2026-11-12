// Run: node --test test/*.test.mjs — Phase 8 pages (views/insights.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { demoRaw } from '../js/io/demo.js';
import { load } from '../js/core/loader.js';
import { compute } from '../js/core/elo.js';
import { createStats } from '../js/core/stats/index.js';
import { ownRange, risers, streaks, teamFacts, binRange, chanceRange } from '../js/views/insights.js';
import { parseFilter, queryGames, sideOf } from '../js/views/game-query.js';
import { duel } from '../js/views/duels.js';

const d = load(demoRaw('Europe/Vienna'));
const elo = compute(d);
const model = { dataset: d, elo, stats: createStats(d, elo) };
const G = d.games;
const won = (k, g) => elo.slots[4 * g] === k || elo.slots[4 * g + 1] === k;

test('ownRange → Alle Spiele returns exactly the streak', () => {
  const r = model.stats.get('records');
  for (let k = 0; k < 4; k++) {
    const p = ownRange(model, k, r.longestWinG[k], r.longestWin[k]);
    const gs = queryGames(model, parseFilter({ ...p, sortierung: 'alt' }, model));
    assert.equal(gs.length, r.longestWin[k]);
    assert.ok(gs.every(g => won(k, g)));
    assert.equal(gs.at(-1), r.longestWinG[k]);
  }
});

test('risers: rows match the recent stat and win/loss counts', () => {
  const days = 30, rr = risers(model, days, 3);
  const w = model.stats.get('recent', { days });
  for (const x of rr.rows) {
    assert.equal(x.games, w.games[x.k]);
    assert.equal(x.delta, w.delta[x.k]);
    assert.equal(x.wins + x.losses, x.games);
    assert.equal(x.qualifies, x.games >= 3);
  }
  for (let i = 1; i < rr.rows.length; i++) assert.ok(rr.rows[i - 1].delta >= rr.rows[i].delta);
  // the qualifying top equals the rising star stat
  const top = rr.rows.find(x => x.qualifies), rs = model.stats.get('risingStar', { days, minGames: 3 })[0];
  assert.equal(top?.k, rs?.k);
});

test('streaks: every player once, consistent with form.streak', () => {
  const f = model.stats.get('form');
  const s = streaks(model);
  assert.equal(s.length, elo.ids.length);
  for (const x of s) assert.equal(x.win ? x.n : -x.n, f.streak[x.k]);
});

test('teamFacts matches the partner matrix and duel()', () => {
  const n = elo.ids.length;
  let checked = 0;
  for (let i = 0; i < n && checked < 3; i++) for (let j = i + 1; j < n && checked < 3; j++) {
    const games = elo.partner.games[i * n + j];
    if (!games) continue;
    const t = teamFacts(model, elo.ids[i], elo.ids[j]);
    assert.equal(t.n, games);
    assert.equal(t.wins, elo.partner.wins[i * n + j]);
    assert.ok(Math.abs(t.chem - (elo.partner.wins[i * n + j] - elo.partner.expected[i * n + j])) < 1e-9);
    assert.equal(t.opponents.reduce((a, o) => a + o.n, 0), t.n);
    const o = t.opponents[0];
    const dd = duel(model, [elo.ids[i], elo.ids[j]], o.ids);
    assert.equal(dd.games.length, o.n); assert.equal(dd.aWins, o.wins);
    checked++;
  }
  assert.ok(checked > 0);
  assert.equal(teamFacts(model, elo.ids[0], elo.ids[0]), null);
});

test('chanceRange: totals agree with the calibration bins', () => {
  const bins = 10, cal = model.stats.get('calibration', { bins }).all;
  for (const b of [1, 3, 5, 8]) {
    const { lo, hi } = binRange(b, bins);
    const r = chanceRange(model, lo, hi);
    assert.equal(r.sides, cal.n[b]);
    if (r.sides) assert.ok(Math.abs(r.actual / r.sides - cal.observed[b]) < 1e-9);
    // per player: sum of n = sides weighted by players per side
    assert.ok(r.players.reduce((a, p) => a + p.n, 0) >= r.sides);
  }
  // the player's chance filter in Alle Spiele uses the player's own side
  const id = elo.ids[1];
  const gs = queryGames(model, parseFilter({ spieler: id, chance: '0.2-0.4' }, model));
  for (const g of gs) {
    const p = sideOf(G[g], id) === 'w' ? elo.perGame.eW[g] : 1 - elo.perGame.eW[g];
    assert.ok(p >= 0.2 - 1e-12 && p <= 0.4 + 1e-12);
  }
  const k = elo.index.get(id), row = chanceRange(model, 0.2, 0.4).players.find(p => p.k === k);
  assert.equal(row?.n ?? 0, gs.length);
});
