// Phase 19: the monthly wall newspaper (core/poster.js, views/poster-text.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../js/core/loader.js';
import { compute } from '../js/core/elo.js';
import { computeAchievements } from '../js/core/achievements.js';
import { demoRaw } from '../js/io/demo.js';
import { posterData, placesAt, lastMonth, monthBounds, issueNumber, lineCandidates, personalLine, riddleFor, weekday } from '../js/core/poster.js';
import { serialFromParts } from '../js/core/normalize.js';
import { storyText, lineText, recordTiles, numbersRow, riddleFacts } from '../js/views/poster-text.js';

const ds = load(demoRaw('Europe/Vienna'));
const model = { dataset: ds, elo: compute(ds) };
const now = ds.games.at(-1).t;
const A = computeAchievements(model, {}, now);
const month = lastMonth(now);
const P = posterData(model, A, { ...month, now, tournaments: ds.tournaments });
const names = new Map([...ds.players.values()].map(p => [p.id, p.name]));
const T = { names, monthName: 'Oktober', cfg: ds.config };

test('calendar helpers: month bounds, last month, issue number, weekday', () => {
  const d = monthBounds(2026, 12);
  assert.equal(d.to - d.from, 31);
  assert.deepEqual(lastMonth(serialFromParts(2027, 1, 5)), { year: 2026, month: 12 });
  assert.equal(issueNumber(2026, 11), 1);
  assert.equal(issueNumber(2027, 1), 3);
  assert.equal(weekday(serialFromParts(2026, 11, 27)), 5);   // a Friday
});

test('numbers and cards add up with the games of the month', () => {
  const { from, to } = monthBounds(month.year, month.month);
  const games = ds.games.filter(g => g.t >= from && g.t < to);
  assert.equal(P.numbers.games, games.length);
  assert.equal(P.numbers.days, new Set(games.map(g => Math.floor(g.t))).size);
  const played = P.players.filter(p => p.games);
  assert.equal(played.length, P.numbers.active);
  assert.equal(played.reduce((s, p) => s + p.games, 0), games.reduce((s, g) => s + g.winners.length + g.losers.length, 0));
  for (const p of played) {
    assert.equal(p.spark.length, p.games + 1);
    assert.ok(Math.abs(p.spark.at(-1) - p.spark[0] - p.delta) < 1e-9);
    assert.equal(p.wins + p.losses, p.games);
  }
  // ranked cards first, in Platz order, every one with a line
  const places = P.players.filter(p => p.place != null).map(p => p.place);
  assert.deepEqual(places, places.slice().sort((a, b) => a - b));
  assert.ok(P.players.every(p => p.line && typeof lineText(p.line, T) === 'string'));
});

test('Platz follows the badge rule and agrees with the Ruhmeshalle leader', () => {
  const { to } = monthBounds(month.year, month.month);
  const end = placesAt(model, to, ds.config);
  for (const x of end.values()) {
    assert.ok(x.total >= ds.config.achievement_rank_min_games);
    assert.ok(x.lastT >= to - ds.config.achievement_rank_active_days);
  }
  const m = A.monthly.find(x => x.to === to);
  if (m?.leader) assert.equal([...end.values()].find(x => x.place === 1).id, m.leader);
});

test('stories, records, network, bump, badges, Ruhmeshalle', () => {
  assert.ok(P.stories.length >= 1);
  for (const st of P.stories) { const x = storyText(st, T); assert.ok(x.title && x.sub, st.kind); }
  assert.ok(recordTiles(P.records, T).length >= 3);
  assert.ok(numbersRow(P.numbers, T).length >= 4);
  // network: edge weights are the month's Begegnungen
  const total = P.network.edges.reduce((s, e) => s + e.n, 0);
  const { from, to } = monthBounds(month.year, month.month);
  const expect = ds.games.filter(g => g.t >= from && g.t < to).reduce((s, g) => s + g.winners.length * g.losers.length * (g.double ? 0.5 : 1), 0);
  assert.equal(total, expect);
  assert.equal(P.network.busiest.n, Math.max(...P.network.edges.map(e => e.n)));
  // bump: one place per day, places unique per day, at most 5 highlighted
  for (let i = 0; i < P.bump.days.length; i++) {
    const day = P.bump.series.map(s => s.places[i]).filter(x => x != null);
    assert.equal(new Set(day).size, day.length);
  }
  assert.ok(P.bump.series.filter(s => s.slot != null).length <= 5);
  assert.ok(P.badges.every(b => b.t >= from && b.t < to));
  assert.ok(P.hall.every(m => m.from <= from));
  assert.equal(P.tournament?.id, 'herbst');                         // finished in that month
});

test('personal lines: most notable first, never a losing streak, the cards differ', () => {
  const s = { games: 12, wins: 3, losses: 9, bestWin: { opp: 'p2', chance: 0.18 }, cracked: null, maxStreak: 1, maxGain: 30, days: new Set([1, 2]), opp: new Map([['p2', 5]]), isNew: false };
  const p = { id: 'p1', place: 4, placeStart: 4 };
  assert.equal(lineCandidates(p, s, {})[0].kind, 'upset');
  assert.equal(lineCandidates(p, null, { endPlace: 4 })[0].kind, 'pause');
  assert.equal(lineCandidates({ id: 'p1', place: 1, placeStart: 2 }, s, { leaderEnd: 'p1', lStart: 'p9' })[0].kind, 'newLeader');
  assert.ok(!lineCandidates(p, { ...s, bestWin: null }, {}).some(c => /loss|losing/.test(c.kind)));
  const used = new Map();
  const kinds = [1, 2, 3].map(() => personalLine(p, s, {}, used).kind);
  assert.deepEqual(kinds, ['upset', 'upset', 'gain']);                 // a kind at most twice
  assert.equal(lineText({ kind: 'pause', place: 7, kept: true }, T), 'Im Oktober Pause · Platz 7 gehalten');
});

test('riddle: three facts, the same for the same month, answer is a player with ≥ 10 games', () => {
  assert.ok(P.riddle);
  assert.equal(P.riddle.facts.length, 3);
  assert.ok(P.players.find(p => p.id === P.riddle.id).games >= 10);
  const again = posterData(model, A, { ...month, now, tournaments: [] });
  assert.deepEqual(again.riddle, P.riddle);
  assert.equal(riddleFacts(P.riddle).length, 3);
  assert.equal(riddleFor(new Map(), 2026, 11), null);
});

test('a month without games: only pauses, a quiet story, nothing empty', () => {
  const Q = posterData(model, A, { year: 2030, month: 1, now: Infinity, tournaments: [] });
  assert.equal(Q.numbers.games, 0);
  assert.deepEqual(Q.stories.map(s => s.kind), ['quiet']);
  assert.equal(Q.network.edges.length, 0);
  assert.equal(Q.riddle, null);
});
