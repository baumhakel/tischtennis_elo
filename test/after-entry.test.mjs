// Phase 17, item 3: refresh after entering a result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, initialState } from '../js/app/store.js';
import { createAfterEntry, arrivedGames, WAIT_MS } from '../js/app/after-entry.js';

const game = (ref, source = 'spiele') => ({ ref, source, winners: ['p1'], losers: ['p2'] });
function setup(nextGames) {
  const store = createStore(initialState());
  store.set({ data: { model: { dataset: { games: [game('a'), game('b')] } } } });
  let t = 1000, refreshes = 0, timers = [];
  const ae = createAfterEntry({
    store, hasToken: () => true, clock: () => t, later: (fn) => timers.push(fn),
    refresh: async () => { refreshes++; const g = nextGames.shift(); if (g) store.set({ data: { model: { dataset: { games: g } } } }); return true; },
  });
  return { store, ae, tick: ms => { t += ms; }, refreshes: () => refreshes, timers };
}
const settle = () => new Promise(r => setTimeout(r, 0));

test('arrivedGames: new form entries only', () => {
  assert.deepEqual(arrivedGames(new Set(['a']), [game('a'), game('b'), game('c', 'legacy')]).map(g => g.ref), ['b']);
});

test('without an opened form the return does nothing special', () => {
  const { ae, refreshes } = setup([]);
  assert.equal(ae.onVisible(), false);
  assert.equal(refreshes(), 0);
});

test('form opened → return refreshes at once; the new game is announced and marked, then unmarked', async () => {
  const { store, ae, refreshes, timers } = setup([[game('a'), game('b'), game('c')]]);
  ae.opened();
  assert.equal(ae.onVisible(), true);
  assert.deepEqual(store.get().notice, { kind: 'checking' });
  await settle();
  assert.equal(refreshes(), 1);
  assert.deepEqual(store.get().notice, { kind: 'arrived', refs: ['c'] });
  assert.deepEqual(store.get().fresh, ['c']);
  assert.equal(ae.pending, null);
  timers.forEach(fn => fn());
  assert.equal(store.get().fresh, null);
  assert.equal(store.get().notice, null);
});

test('nothing arrived → „missing“, „Aktualisieren“ checks again, dismiss forgets it', async () => {
  const { store, ae, refreshes } = setup([null, [game('a'), game('b'), game('c')]]);
  ae.opened();
  ae.onVisible(); await settle();
  assert.deepEqual(store.get().notice, { kind: 'missing' });
  ae.retry(); await settle();
  assert.equal(refreshes(), 2);
  assert.equal(store.get().notice.kind, 'arrived');

  const s2 = setup([null]);
  s2.ae.opened(); s2.ae.onVisible(); await settle();
  s2.ae.dismiss();
  assert.equal(s2.store.get().notice, null);
  assert.equal(s2.ae.onVisible(), false);
});

test('a form opened long ago is forgotten; no token → the usual path', () => {
  const { ae, tick, refreshes } = setup([]);
  ae.opened(); tick(WAIT_MS + 1);
  assert.equal(ae.onVisible(), false);
  assert.equal(refreshes(), 0);
});
