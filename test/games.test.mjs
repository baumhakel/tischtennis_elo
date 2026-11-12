// Run: node --test test/*.test.mjs — game lists and the game page (views/game-query.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { demoRaw } from '../js/io/demo.js';
import { load } from '../js/core/loader.js';
import { compute } from '../js/core/elo.js';
import { createStats } from '../js/core/stats/index.js';
import { findGame, parseFilter, filterParams, queryGames, lastGames, gameFacts, sideOf, hasFilter } from '../js/views/game-query.js';

const d = load(demoRaw('Europe/Vienna'));
const elo = compute(d);
const model = { dataset: d, elo, stats: createStats(d, elo) };
const G = d.games;
const N = G.length;
const all = [...G.keys()];
const q = params => queryGames(model, parseFilter(params, model));

test('findGame: every ref finds a game with that ref; unknown ref → -1', () => {
  for (const i of [0, 7, N - 1]) assert.equal(G[findGame(d, G[i].ref)].ref, G[i].ref);
  assert.equal(findGame(d, '1999-01-01 00:00:00'), -1);
  assert.equal(findGame(d, undefined), -1);
});

test('queryGames without filters: all games, newest first; alt = oldest first', () => {
  assert.deepEqual(q({}), all.slice().reverse());
  assert.deepEqual(q({ sortierung: 'alt' }), all);
});

test('player, opponent, partner filters match brute force', () => {
  const [a, b, c] = elo.ids;
  const mine = x => (x.winners.includes(a) ? x.winners : x.losers);
  const theirs = x => (x.winners.includes(a) ? x.losers : x.winners);
  assert.deepEqual(q({ spieler: a, sortierung: 'alt' }), all.filter(i => sideOf(G[i], a)));
  assert.deepEqual(q({ spieler: a, gegner: b, sortierung: 'alt' }), all.filter(i => sideOf(G[i], a) && theirs(G[i]).includes(b)));
  assert.deepEqual(q({ spieler: a, partner: c, sortierung: 'alt' }), all.filter(i => sideOf(G[i], a) && G[i].double && mine(G[i]).includes(c) && c !== a));
  // gegner/partner without spieler are ignored; unknown IDs are dropped
  assert.equal(q({ gegner: b }).length, N);
  assert.equal(parseFilter({ spieler: 'p999' }, model).spieler, null);
});

test('type, source, date and chance filters', () => {
  assert.deepEqual(q({ art: 'doppel', sortierung: 'alt' }), all.filter(i => G[i].double));
  assert.deepEqual(q({ art: 'einzel', sortierung: 'alt' }), all.filter(i => !G[i].double));
  assert.deepEqual(q({ quelle: 'altdaten', sortierung: 'alt' }), all.filter(i => G[i].source === 'legacy'));
  const day = G[Math.floor(N / 2)].ref.slice(0, 10);
  assert.deepEqual(q({ von: day, bis: day, sortierung: 'alt' }), all.filter(i => G[i].ref.slice(0, 10) === day));
  const ref = G[100].ref;
  assert.deepEqual(q({ von: ref, sortierung: 'alt' }), all.filter(i => G[i].ref >= ref));
  const eW = elo.perGame.eW;
  // winner in [0.2, 0.3) or loser mirrored: eW in [0.7, 0.8)
  assert.deepEqual(q({ chance: '0.2-0.3', sortierung: 'alt' }), all.filter(i => (eW[i] >= 0.2 && eW[i] < 0.3) || (eW[i] >= 0.7 && eW[i] < 0.8)));
  assert.equal(parseFilter({ chance: '0.5-0.2' }, model).chance, null);
});

test('letzte and elo sort', () => {
  const a = elo.ids[0];
  const mine = all.filter(i => sideOf(G[i], a));
  assert.deepEqual(q({ spieler: a, letzte: '10' }), mine.slice(-10).reverse());
  const byElo = q({ sortierung: 'elo' });
  for (let i = 1; i < byElo.length; i++) assert.ok(elo.perGame.delta[byElo[i - 1]] >= elo.perGame.delta[byElo[i]]);
});

test('filterParams round-trips; hasFilter', () => {
  const p = { spieler: elo.ids[0], gegner: elo.ids[1], art: 'einzel', von: '2026-01-01', chance: '0.1-0.2', letzte: '5', sortierung: 'elo' };
  const f = parseFilter(p, model);
  assert.deepEqual(parseFilter(filterParams(f), model), f);
  assert.equal(hasFilter(parseFilter({ sortierung: 'alt' }, model)), false);
  assert.equal(hasFilter(f), true);
});

test('lastGames: newest first, per player', () => {
  assert.deepEqual(lastGames(model, 3), [N - 1, N - 2, N - 3]);
  const a = elo.ids[2];
  assert.deepEqual(lastGames(model, 4, a), all.filter(i => sideOf(G[i], a)).slice(-4).reverse());
});

test('gameFacts: before/after consistent with the next game of each player', () => {
  for (const g of [0, 50, N - 1]) {
    const f = gameFacts(model, g);
    assert.equal(f.players.length, G[g].double ? 4 : 2);
    for (const p of f.players) {
      assert.ok(Math.abs(p.after - p.before - p.delta) < 1e-9);
      assert.equal(p.side === 'w', G[g].winners.includes(p.id));
    }
    const w = gameFacts(model, g, G[g].winners[0]), l = gameFacts(model, g, G[g].losers[0]);
    assert.equal(w.won, true); assert.equal(l.won, false);
    assert.ok(Math.abs(w.ownChance + l.ownChance - 1) < 1e-12);
    assert.equal(w.ownDelta, -l.ownDelta);
  }
  // rating after a game = rating before the player's next game
  const a = elo.ids[0];
  const mine = all.filter(i => sideOf(G[i], a));
  const f1 = gameFacts(model, mine[0]).players.find(p => p.id === a);
  const f2 = gameFacts(model, mine[1]).players.find(p => p.id === a);
  assert.ok(Math.abs(f1.after - f2.before) < 1e-9);
});

test('loader marks swapped games as corrected', () => {
  const raw = demoRaw('Europe/Vienna');
  const ref = load(raw).games[5].ref;
  raw.corrections.push([ref, 'swap', 'test']);
  const d2 = load(raw);
  const g = d2.games.find(x => x.ref === ref);
  assert.equal(g.corrected, true);
  assert.equal(d2.games.filter(x => x.corrected).length, 1);
});
