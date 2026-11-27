// Souvenir print (Phase 18c, section 7): highlights of a tournament day (core/souvenir.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { souvenirFacts, deficit } from '../js/core/souvenir.js';

const side = id => ({ key: `m:${id}`, id, ids: [id] });
const res = (t, sets, winner, wo = null) => {
  const sA = sets.filter(([a, b]) => a > b).length;
  return { t, sets, winner, wo, setsA: sA, setsB: sets.length - sA };
};
const T = { id: 't', points: 11, matches: [
  { nr: 1, label: 'Gruppe A', a: side('a'), b: side('b'), result: res(1, [[11, 5], [11, 7]], 'a') },
  { nr: 2, label: 'Gruppe A', a: side('a'), b: side('c'), result: res(2, [[5, 11], [9, 11], [11, 3], [15, 13], [11, 9]], 'a') },
  { nr: 3, label: 'Gruppe A', a: side('b'), b: side('c'), result: res(3, [], 'b', 'a') },
  { nr: 4, label: 'Finale', a: side('b'), b: side('c'), result: null },
] };

test('deficit: the largest number of sets the winner was behind', () => {
  assert.equal(deficit(res(0, [[5, 11], [9, 11], [11, 3], [11, 4], [11, 9]], 'a')), 2);
  assert.equal(deficit(res(0, [[11, 5], [11, 7]], 'a')), 0);
  assert.equal(deficit(res(0, [[11, 5], [7, 11], [5, 11]], 'b')), 1);
});

test('highlights from the played matches; a w. o. never counts', () => {
  const games = [{ tournament: { id: 't', nr: 1 }, winners: ['a'], losers: ['b'] }, { tournament: { id: 'x', nr: 1 }, winners: ['c'], losers: ['a'] },
    { tournament: { id: 't', nr: 2 }, winners: ['a'], losers: ['c'] }];
  const elo = { perGame: { delta: [10, 50, 30], eW: [0.7, 0.1, 0.25] } };
  const f = souvenirFacts(T, { games, elo });
  assert.equal(f.closestSet.m.nr, 2); assert.deepEqual([f.closestSet.a, f.closestSet.b, f.closestSet.set], [15, 13, 4]);
  assert.equal(f.comeback.m.nr, 2); assert.equal(f.comeback.deficit, 2);
  assert.equal(f.longest.m.nr, 2); assert.equal(f.longest.points, 98);
  assert.equal(f.mostPoints.key, 'm:a'); assert.equal(f.mostPoints.points, 22 + 51);
  assert.equal(f.upset.m.nr, 2); assert.equal(f.upset.chance, 0.25);          // the other tournament's game is ignored
  assert.deepEqual(f.eloDay.map(x => [x.id, x.delta]), [['a', 40], ['b', -10], ['c', -30]]);
});
