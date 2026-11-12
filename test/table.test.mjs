// Run: node --test test/*.test.mjs — Phase 11: Tisch (views/table-logic.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { demoRaw } from '../js/io/demo.js';
import { load } from '../js/core/loader.js';
import { compute, winProbability } from '../js/core/elo.js';
import { createStats } from '../js/core/stats/index.js';
import { resolveFilters, visible } from '../js/core/filters.js';
import { previewGame, applyGames, standings, outcome, splits, whoPlays, gamesTodayWeek, weekStart, bestPair, prefillUrl, winsNeeded, shrunkResiduals, suggestions, ratingOf } from '../js/views/table-logic.js';

const d = load(demoRaw('Europe/Vienna'));
const elo = compute(d);
const model = { dataset: d, elo, stats: createStats(d, elo) };
const cfg = d.config, ids = elo.ids;
const now = d.games.at(-1).t;
const f = resolveFilters({ minGames: 0 }, cfg);
const vis = visible(d, elo, f, now);
const R = id => elo.final[elo.index.get(id)];

test('previewGame: the engine formula, singles and doubles', () => {
  const [a, b, c, e] = ids;
  const s = previewGame(model, [a], [b]);
  assert.equal(s.eW, winProbability(R(a), R(b)));
  assert.ok(Math.abs(s.delta - cfg.k_single * (1 - s.eW)) < 1e-12);
  const dd = previewGame(model, [a, b], [c, e]);
  assert.ok(Math.abs(dd.rW - (R(a) + R(b)) / 2) < 1e-12);
  assert.ok(Math.abs(dd.delta - cfg.k_double * (1 - dd.eW)) < 1e-12);
  assert.equal(ratingOf(model, 'p999'), cfg.start_rating);
});

test('applyGames: sequential, zero-sum, matches the engine on the real next game', () => {
  const g = d.games.at(-1);
  // replay the last game from the ratings before it: same delta as the engine
  const before = new Map([...g.winners, ...g.losers].map((id, s) => [id, elo.perGame.before[4 * (d.games.length - 1) + [0, 1, 2, 3][s]]]));
  const ordered = new Map(); g.winners.forEach((id, i) => ordered.set(id, elo.perGame.before[4 * (d.games.length - 1) + i]));
  g.losers.forEach((id, i) => ordered.set(id, elo.perGame.before[4 * (d.games.length - 1) + 2 + i]));
  const after = applyGames(model, [{ winners: g.winners, losers: g.losers }], { ratings: ordered });
  for (const id of [...g.winners, ...g.losers]) assert.ok(Math.abs(after.ratings.get(id) - R(id)) < 1e-9);
  const two = applyGames(model, [{ winners: [ids[0]], losers: [ids[1]] }, { winners: [ids[1]], losers: [ids[0]] }]);
  assert.ok(Math.abs(two.ratings.get(ids[0]) + two.ratings.get(ids[1]) - R(ids[0]) - R(ids[1])) < 1e-9);
  assert.equal(two.extra.get(ids[0]), 2);
  void before;
});

test('standings and outcome: Platz before/after consistent', () => {
  const st = standings(model, vis, 0);
  const order = [...vis.shown].sort((a, b) => elo.final[b] - elo.final[a]).map(k => ids[k]);
  order.forEach((id, i) => assert.equal(st.get(id), i + 1));
  const last = order.at(-1), first = order[0];
  const o = outcome(model, vis, 0, [last], [first]);
  const w = o.players.find(p => p.id === last), l = o.players.find(p => p.id === first);
  assert.ok(w.rankAfter <= w.rankBefore && l.rankAfter >= l.rankBefore);
  assert.ok(Math.abs(w.after - w.before - o.delta) < 1e-9 && Math.abs(l.before - l.after - o.delta) < 1e-9);
  // provisional: min games above everyone → no Platz
  assert.equal(standings(model, vis, 10 ** 6).size, 0);
});

test('splits: three distinct splits, most balanced first', () => {
  const four = ids.slice(0, 4);
  const s = splits(model, four);
  assert.equal(s.length, 3);
  for (const x of s) assert.deepEqual([...x.A, ...x.B].sort(), four.slice().sort());
  for (let i = 1; i < 3; i++) assert.ok(Math.abs(s[i - 1].eA - 0.5) <= Math.abs(s[i].eA - 0.5));
  const bp = bestPair(model, ids.slice(0, 5));
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
    assert.ok(Math.abs(bp.e - 0.5) <= Math.abs(winProbability(R(ids[i]), R(ids[j])) - 0.5) + 1e-12);
  }
});

test('whoPlays: fewest games today play, rounds rotate, deterministic', () => {
  const present = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
  const today = new Map([['p1', 3], ['p2', 0], ['p3', 1], ['p4', 0], ['p5', 2], ['p6', 0]]);
  const week = new Map([['p2', 5], ['p4', 1], ['p6', 2]]);
  const r = whoPlays(present, 4, { today, thisWeek: week });
  assert.deepEqual(r.play, ['p4', 'p6', 'p2', 'p3']);
  assert.deepEqual(r.out, ['p5', 'p1']);
  const rounds = new Map(r.play.map(id => [id, 1])), satOut = new Map(r.out.map(id => [id, 1]));
  const r2 = whoPlays(present, 4, { today, thisWeek: week, rounds, satOut });
  assert.ok(r2.play.includes('p5'), 'someone who sat out plays next');
  // weekStart: Monday
  const mon = weekStart(46336.5);   // serial of Wed 11 Nov 2026 noon
  assert.equal((mon + 5) % 7, 0);
  assert.ok(46336.5 - mon < 7 && 46336.5 - mon >= 0);
  const tw = gamesTodayWeek(d, now);
  assert.ok([...tw.today.values()].every(v => v >= 1));
});

test('prefillUrl: only with URL and question IDs from config', () => {
  const name = id => ({ a: 'Anna Maria', b: 'Bernd', c: 'Clara', e: 'Elif' })[id];
  assert.equal(prefillUrl({ form_result_url: '' }, ['a'], ['b'], name), null);
  const base = { form_result_url: 'https://docs.google.com/forms/d/e/XYZ/viewform' };
  assert.equal(prefillUrl(base, ['a'], ['b'], name), base.form_result_url);
  const full = { ...base, form_result_entry_winner1: '111', form_result_entry_winner2: 'entry.222', form_result_entry_loser1: '333', form_result_entry_loser2: '444' };
  const u = new URL(prefillUrl(full, ['a'], ['b'], name));
  assert.equal(u.searchParams.get('usp'), 'pp_url');
  assert.equal(u.searchParams.get('entry.111'), 'Anna Maria');
  assert.equal(u.searchParams.get('entry.333'), 'Bernd');
  assert.equal(u.searchParams.get('entry.222'), null);
  const dbl = new URL(prefillUrl(full, ['a', 'c'], ['b', 'e'], name));
  assert.equal(dbl.searchParams.get('entry.222'), 'Clara');
  assert.equal(dbl.searchParams.get('entry.444'), 'Elif');
});

test('winsNeeded and shrunk residuals', () => {
  const order = [...vis.shown].sort((a, b) => elo.final[b] - elo.final[a]).map(k => ids[k]);
  const me = order[3], up = order[2];
  const n = winsNeeded(model, me, order.at(-1), up);
  assert.ok(n >= 1);
  const after = applyGames(model, Array.from({ length: n }, () => ({ winners: [me], losers: [order.at(-1)] })));
  assert.ok(ratingOf(model, me, after.ratings) > R(up));
  if (n > 1) {
    const less = applyGames(model, Array.from({ length: n - 1 }, () => ({ winners: [me], losers: [order.at(-1)] })));
    assert.ok(ratingOf(model, me, less.ratings) <= R(up));
  }
  const s = shrunkResiduals(model);
  assert.ok(s.tau2 >= 0);
  const M = model.stats.get('matrices'), N = ids.length;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    if (i === j || !(M.matchups[i * N + j] > 0)) continue;
    const raw = M.actualVsExpected[i * N + j] / M.matchups[i * N + j];
    const sh = s.at(i, j);
    assert.ok(Math.abs(sh) <= Math.abs(raw) + 1e-12, 'shrinks towards 0');
    assert.ok(Math.sign(sh) === Math.sign(raw) || sh === 0);
    assert.ok(Math.abs(s.at(i, j) + s.at(j, i)) < 1e-9, 'antisymmetric');
  }
});

test('suggestions: count, balanced pairs first when nobody played recently', () => {
  const sug = suggestions(model, vis, now, 28, 5);
  assert.equal(sug.length, 5);
  for (let i = 1; i < sug.length; i++) assert.ok(sug[i - 1].p * (1 - sug[i - 1].p) * (1 + 1 / (1 + sug[i - 1].recent)) >= sug[i].p * (1 - sug[i].p) * (1 + 1 / (1 + sug[i].recent)) - 1e-12);
  const far = suggestions(model, vis, now + 10000, 28, 3);
  for (let i = 1; i < far.length; i++) assert.ok(Math.abs(far[i - 1].p - 0.5) <= Math.abs(far[i].p - 0.5) + 1e-12);
});
