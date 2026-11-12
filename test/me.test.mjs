// Run: node --test test/*.test.mjs — Phase 10: „Ich“, accounts column, optional config keys
import test from 'node:test';
import assert from 'node:assert/strict';
import { demoRaw, DEMO_EMAIL } from '../js/io/demo.js';
import { load, parseAccounts } from '../js/core/loader.js';
import { compute } from '../js/core/elo.js';
import { resolveMe } from '../js/app/me.js';
import { resolveFilters, visible, resolveFocus } from '../js/core/filters.js';

const fresh = { choice: null, id: null, snoozeUntil: 0, seen: {} };
const players = new Map([
  ['p001', { id: 'p001', accounts: ['anna@x.com'] }],
  ['p002', { id: 'p002', accounts: [] }],
]);

test('resolveMe: device choice > account > ask', () => {
  assert.deepEqual(resolveMe(fresh, players, 'Anna@X.com'), { id: 'p001', source: 'account', observer: false, ask: false, accountId: 'p001' });
  assert.equal(resolveMe(fresh, players, 'someone@else.com').ask, true);
  assert.equal(resolveMe(fresh, players, null).id, null);
  const dev = resolveMe({ ...fresh, choice: 'player', id: 'p002' }, players, 'anna@x.com');
  assert.equal(dev.id, 'p002'); assert.equal(dev.source, 'device'); assert.equal(dev.accountId, 'p001');
  const obs = resolveMe({ ...fresh, choice: 'observer' }, players, 'anna@x.com');
  assert.equal(obs.observer, true); assert.equal(obs.id, null); assert.equal(obs.ask, false);
  // „Das bin ich nicht“: ignore the account, ask again
  const ask = resolveMe({ ...fresh, choice: 'ask' }, players, 'anna@x.com');
  assert.equal(ask.id, null); assert.equal(ask.ask, true);
  // snoozed card
  assert.equal(resolveMe({ ...fresh, snoozeUntil: 2000 }, players, null, 1000).ask, false);
  assert.equal(resolveMe({ ...fresh, snoozeUntil: 500 }, players, null, 1000).ask, true);
  // a stored player that no longer exists (merged away) falls back
  assert.equal(resolveMe({ ...fresh, choice: 'player', id: 'p099' }, players, 'anna@x.com').id, 'p001');
});

test('loader: google_accounts column, duplicates ignored, column optional', () => {
  assert.deepEqual(parseAccounts(' A@x.com; b@y.org , nonsense, a@x.com'), ['a@x.com', 'b@y.org']);
  const raw = demoRaw('Europe/Vienna');
  let d = load(raw);
  assert.deepEqual(d.players.get('p003').accounts, [DEMO_EMAIL]);
  assert.ok(!d.issues.some(i => i.kind === 'bad_account'));
  // the same address on two players → issue, ignored on both
  raw.players[1][3] = DEMO_EMAIL;
  d = load(raw);
  assert.ok(d.issues.some(i => i.kind === 'bad_account'));
  assert.deepEqual(d.players.get('p003').accounts, []);
  assert.deepEqual(d.players.get('p001').accounts, []);
  // without the column: no mappings, no issue
  const raw2 = demoRaw('Europe/Vienna');
  raw2.players = raw2.players.map(r => r.slice(0, 3));
  const d2 = load(raw2);
  assert.deepEqual(d2.players.get('p003').accounts, []);
  assert.ok(!d2.issues.some(i => i.kind === 'missing_column'));
});

test('config: optional form URLs — empty is fine, junk is reported, https kept', () => {
  const raw = demoRaw('Europe/Vienna');
  const row = key => raw.config.find(r => r[0] === key);
  row('form_result_url')[1] = '';
  row('form_support_url')[1] = 'kein link';
  row('form_management_url')[1] = 'https://docs.google.com/forms/d/e/abc/viewform';
  const d = load(raw);
  assert.equal(d.config.form_result_url, '');
  assert.ok(!d.issues.some(i => i.kind === 'missing_config' && i.name === 'form_result_url'));
  assert.ok(d.issues.some(i => i.kind === 'bad_config' && i.name === 'form_support_url'));
  assert.equal(d.config.form_support_url, '');
  assert.equal(d.config.form_management_url, 'https://docs.google.com/forms/d/e/abc/viewform');
});

test('focus: „Ich“ takes slot 1 unless highlighting is explicit', () => {
  const d = load(demoRaw('Europe/Vienna')), elo = compute(d);
  const f = resolveFilters({ minGames: 0, inactivityDays: 0 }, d.config);
  const vis = visible(d, elo, f, d.games.at(-1).t);
  const weakest = [...vis.shown].sort((a, b) => elo.final[a] - elo.final[b])[0];
  const me = elo.ids[weakest];
  const r = resolveFocus(f, elo, vis, d.config, me);
  assert.equal(r.slots[0], weakest);
  assert.equal(r.slots.length, Math.min(8, d.config.focus_default_count + 1));
  const ex = resolveFocus({ ...f, focus: [elo.ids[0]] }, elo, vis, d.config, me);
  assert.deepEqual(ex.ids, [elo.ids[0]]);
});
