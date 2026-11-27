// Phase 19b: tournament, set and photo badges (core/achievements.js extraBadges).
import test from 'node:test';
import assert from 'node:assert/strict';
import { extraBadges } from '../js/core/achievements.js';

const side = (id, extra = {}) => ({ key: `m:${id}`, id, ids: [id], members: null, ...extra });
const team = (a, b) => ({ key: `m:${a}+m:${b}`, id: null, members: [{ id: a }, { id: b }] });
const res = (t, sets, winner, wo = null) => ({ t, sets, winner, wo, setsA: 0, setsB: 0 });

function run(tours, photos = null, players = []) {
  const ids = ['a', 'b', 'c', 'd'];
  const elo = { index: new Map(ids.map((id, k) => [id, k])), ids };
  const got = [];
  const award = (k, badge, level, t) => got.push(`${ids[k]}:${badge}:${level}@${t}`);
  const awardValue = (k, badge, v, t) => got.push(`${ids[k]}:${badge}=${v}@${t}`);
  const dataset = { config: { achievement_deuce_points: 15 }, tournaments: tours, games: [{ ref: 'g1', winners: ['a'], losers: ['c'] }],
    photos, players: new Map(players.map(p => [p.id, p])) };
  extraBadges(dataset, elo, { award, awardValue, lvl: () => 1, best: () => {} });
  return got;
}

test('tournament: played, knockout, podium, win; w. o. and test tournaments never count', () => {
  const T = { id: 't', ok: true, status: 'beendet', date: 1, winner: 'm:a', second: 'm:b', third: ['m:c'],
    participants: [side('a'), side('b'), side('c'), side('d')],
    matches: [
      { nr: 1, stage: 'gruppe', bestOf: 3, a: side('a'), b: side('d'), result: res(2, [], 'a', 'b') },              // d didn't show up
      { nr: 2, stage: 'gruppe', bestOf: 3, a: side('a'), b: side('b'), result: res(3, [[11, 0], [11, 9]], 'a') },
      { nr: 3, stage: 'ko', label: 'Finale', bestOf: 5, a: side('a'), b: side('b'), result: res(5, [[9, 11], [8, 11], [11, 5], [16, 14], [11, 3]], 'a') },
      { nr: 4, stage: 'ko', label: 'Spiel um Platz 3', third: true, bestOf: 5, a: side('c'), b: side('d'), result: res(4, [[11, 1], [11, 2], [11, 3]], 'a') },
    ] };
  const got = run([T, { ...T, id: 'x', status: 'test' }]);
  assert.ok(got.includes('a:tour_played=1@3'));                       // the w. o. at t=2 doesn't count as played
  assert.ok(got.includes('d:tour_played=1@4'));
  assert.ok(got.includes('a:tour_win=1@5') && got.includes('b:tour_podium:1@5') && got.includes('c:tour_podium:1@5'));
  assert.ok(!got.some(x => x.startsWith('d:tour_podium')));
  assert.ok(got.includes('a:tour_ko:1@5') && got.includes('d:tour_ko:1@4'));
  assert.ok(got.includes('a:set_zero:1@3'));
  assert.ok(got.includes('a:set_deuce:1@5'));                         // 16:14
  assert.ok(got.includes('a:set_comeback:1@5'));                      // from 0:2
  assert.ok(got.includes('c:set_clean:1@4'));
  assert.ok(!got.some(x => x.includes('set_clean') && x.startsWith('a:')));
  assert.equal(got.filter(x => x.includes('tour_win')).length, 1);    // the test tournament adds nothing
});

test('doubles: both members of a team; sets seen from side b', () => {
  const T = { id: 'd', ok: true, status: 'aktiv', date: 1, winner: null, third: [], participants: [],
    matches: [{ nr: 1, stage: 'gruppe', bestOf: 3, a: team('a', 'b'), b: team('c', 'd'), result: res(7, [[0, 11], [5, 11]], 'b') }] };
  const got = run([T]);
  assert.ok(got.includes('c:set_zero:1@7') && got.includes('d:set_zero:1@7'));
  assert.ok(!got.some(x => x.startsWith('a:set_zero')));
  assert.equal(got.filter(x => x.includes('tour_played')).length, 4);
});

test('photos: uploads by the own accounts, the own profile picture, games in the picture', () => {
  const photos = { list: [
    { id: '1', kind: 'spieler', ref: 'b', by: 'a@x.at', at: 10 },
    { id: '2', kind: 'spiel', ref: 'g1', by: 'a@x.at', at: 11 },
    { id: '3', kind: 'spiel', ref: 'g1', by: 'q@x.at', at: 12 },
  ] };
  const got = run([], photos, [{ id: 'a', accounts: ['a@x.at'] }]);
  assert.ok(got.includes('a:photo_upload=1@10') && got.includes('a:photo_upload=2@11'));
  assert.ok(got.includes('b:photo_avatar:1@10'));
  assert.ok(got.includes('a:photo_in=1@11') && got.includes('c:photo_in=1@11'));
  assert.equal(got.filter(x => x.startsWith('a:photo_in')).length, 1); // the same game counts once
});
