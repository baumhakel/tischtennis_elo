// Phase 18a: entering in the app (form bodies, config definitions, checks of Verwaltung.gs, arrival checks).
import test from 'node:test';
import assert from 'node:assert/strict';
import { formBody, responseUrl, prefilledUrl, entryIdsFromUrl, sendForm, FormSendError } from '../js/io/forms.js';
import { formReady, entriesFor, resultAnswers, managementAnswers, managementPages, canManage, resultKey, recentSame } from '../js/app/forms.js';
import { manageDb, checkManage, doneText, askText, reasonText, applyManage } from '../js/core/manage.js';
import { pick, resize, complete, resultSentence, wonLabel, gameText, mergeEffect, mergeText } from '../js/views/enter-logic.js';
import { createStore, initialState } from '../js/app/store.js';
import { createAfterEntry, manageOutcome, FIRST_MS, RETRY_MS } from '../js/app/after-entry.js';
import { createSubmit, demoTransport } from '../js/app/submit.js';
import { load } from '../js/core/loader.js';
import { demoRaw, demoForms } from '../js/io/demo.js';

const URL_ = 'https://docs.google.com/forms/d/e/ABC/viewform';
const CFG = {
  form_result_url: URL_, form_result_entry_winner1: '11', form_result_entry_winner2: 'entry.12', form_result_entry_loser1: '13', form_result_entry_loser2: '14',
  form_support_url: URL_, form_support_entry_topic: '21', form_support_entry_description: '22', form_support_entry_game: '23', form_support_entry_name: '',
  form_management_url: URL_, form_management_entry_action: '31', form_management_entry_old_name: '32', form_management_entry_new_name: '33',
  form_management_page_rename: 2, management_accounts: ['Julius@Example.org'], duplicate_window_minutes: 5,
};

test('formBody: entry names, empty answers left out, pageHistory for sections', () => {
  const b = formBody([['11', 'Anna'], ['entry.12', ''], ['13', 'Bernd'], ['14', null]]);
  assert.equal(b.toString(), 'entry.11=Anna&entry.13=Bernd');
  const m = formBody([['31', 'Spieler umbenennen'], ['32', 'Bernd'], ['33', 'Bernhard Ö']], { pageHistory: [0, 2] });
  assert.equal(m.get('pageHistory'), '0,2');
  assert.equal(m.get('entry.33'), 'Bernhard Ö');
  assert.deepEqual(formBody([['5', ['a', 'b']]]).getAll('entry.5'), ['a', 'b']);
});

test('responseUrl, prefilledUrl and entryIdsFromUrl (the parser Verwaltung.gs copies)', () => {
  assert.equal(responseUrl(URL_ + '?usp=sf_link'), 'https://docs.google.com/forms/d/e/ABC/formResponse');
  const u = prefilledUrl(URL_, [['31', 'Spieler umbenennen'], ['32', 'Bernd'], ['33', '']]);
  assert.ok(u.startsWith('https://docs.google.com/forms/d/e/ABC/viewform?usp=pp_url&entry.31='));
  assert.equal(new URL(u).searchParams.get('entry.32'), 'Bernd');
  assert.equal(new URL(u).searchParams.has('entry.33'), false);
  assert.deepEqual(entryIdsFromUrl('https://docs.google.com/forms/d/e/X/viewform?usp=pp_url&entry.1234567890=writeformids@example.org'), ['1234567890']);
  assert.deepEqual(entryIdsFromUrl('…/viewform?usp=pp_url&entry.111=a&entry.222=b+c&entry.111.other_option_response=x&entry.333_sentinel='), ['111', '222', '333']);
  assert.deepEqual(entryIdsFromUrl('https://docs.google.com/forms/d/e/X/viewform'), []);
});

test('sendForm: POST no-cors to formResponse; offline rejects and sends nothing', async () => {
  const calls = [];
  await sendForm(URL_, formBody([['1', 'x']]), { fetchImpl: async (u, o) => { calls.push([u, o.method, o.mode, String(o.body)]); }, online: () => true });
  assert.deepEqual(calls, [['https://docs.google.com/forms/d/e/ABC/formResponse', 'POST', 'no-cors', 'entry.1=x']]);
  await assert.rejects(sendForm(URL_, formBody([]), { fetchImpl: async () => { calls.push('x'); }, online: () => false }), e => e instanceof FormSendError && e.kind === 'offline');
  await assert.rejects(sendForm(URL_, formBody([]), { fetchImpl: async () => { throw new TypeError('Failed to fetch'); }, online: () => true }), FormSendError);
  assert.equal(calls.length, 1);
});

test('form definitions from config', () => {
  assert.equal(formReady(CFG, 'result'), true);
  assert.equal(formReady({ ...CFG, form_result_entry_loser2: '' }, 'result'), false);
  assert.equal(formReady({ ...CFG, form_result_entry_loser2: '' }, 'result', ['winner1', 'loser1']), true);
  assert.equal(formReady(CFG, 'support'), false);                              // „Dein Name“ has no ID
  assert.equal(formReady(CFG, 'support', ['topic', 'description']), true);
  assert.equal(formReady({ ...CFG, form_support_url: '' }, 'support', ['topic']), false);
  const names = { p1: 'Anna', p2: 'Bernd', p3: 'Clara', p4: 'David' };
  assert.deepEqual(entriesFor(CFG, 'result', resultAnswers(['p1'], ['p2'], id => names[id])), [['11', 'Anna'], ['entry.12', ''], ['13', 'Bernd'], ['14', '']]);
  assert.deepEqual(entriesFor(CFG, 'support', { topic: 'Sonstiges', name: 'Anna', bogus: 1 }), [['21', 'Sonstiges']]);
  assert.deepEqual(managementAnswers('rename', { old_name: 'Bernd', new_name: 'Bernhard', extra: 'x' }), { action: 'Spieler umbenennen', old_name: 'Bernd', new_name: 'Bernhard' });
  assert.deepEqual(managementPages(CFG, 'rename'), [0, 2]);
  assert.equal(managementPages(CFG, 'merge'), null);
  assert.equal(canManage(CFG, 'julius@example.org'), true);
  assert.equal(canManage(CFG, 'anna@example.org'), false);
  assert.equal(canManage({ management_accounts: null }, 'julius@example.org'), false);
});

test('duplicate hint: same result from this phone within the window, team order ignored', () => {
  const k = resultKey(['p2', 'p1'], ['p3', 'p4']);
  assert.equal(k, resultKey(['p1', 'p2'], ['p4', 'p3']));
  assert.notEqual(k, resultKey(['p3', 'p4'], ['p1', 'p2']));
  const log = [{ key: k, at: 1000 }, { key: k, at: 61000 }, { key: 'x', at: 100000 }];
  assert.equal(recentSame(log, k, 61000 + 5 * 60000, 5).at, 61000);
  assert.equal(recentSame(log, k, 61000 + 5 * 60000 + 1, 5), null);
  assert.equal(recentSame(log, k, 70000, 0), null);   // 0 = off
});

function db() {
  const players = new Map([
    ['p001', { id: 'p001', name: 'Anna', active: true, accounts: ['anna@x.at'] }],
    ['p002', { id: 'p002', name: 'Bernd', active: true, accounts: [] }],
    ['p003', { id: 'p003', name: 'Bernd 2', active: false, accounts: ['b2@x.at'] }],
  ]);
  return manageDb({ players, takenNames: ['anna', 'bernd', 'bernd 2', 'berni'] });
}

test('management checks = the rules of Verwaltung.gs', () => {
  const d = db();
  assert.equal(checkManage(d, 'add', { new_player: 'Clara', new_account: '' }), null);
  assert.match(checkManage(d, 'add', { new_player: '  BERNI ' }), /gibt es schon/);       // former names count, any case
  assert.match(checkManage(d, 'add', { new_player: '' }), /Namen eingeben/);
  assert.match(checkManage(d, 'add', { new_player: 'Clara', new_account: 'clara-at-x' }), /Keine E-Mail-Adresse/);
  assert.match(checkManage(d, 'add', { new_player: 'Clara', new_account: 'Anna@x.at' }), /gehört schon zu Anna/);
  assert.equal(checkManage(d, 'rename', { old_name: 'Bernd', new_name: 'Bernhard' }), null);
  assert.match(checkManage(d, 'rename', { old_name: 'Zora', new_name: 'Bernhard' }), /gibt es nicht/);
  assert.match(checkManage(d, 'activate', { inactive_player: 'Anna' }), /schon aktiv/);
  assert.equal(checkManage(d, 'activate', { inactive_player: 'Bernd 2' }), null);
  assert.match(checkManage(d, 'deactivate', { active_player: 'Bernd 2' }), /schon inaktiv/);
  assert.match(checkManage(d, 'merge', { merge_from: 'Bernd', merge_into: 'bernd' }), /mit sich selbst/);
  assert.equal(checkManage(d, 'merge', { merge_from: 'Bernd 2', merge_into: 'Bernd' }), null);
  assert.match(checkManage(d, 'accounts', { account_player: 'Anna', account: 'anna@x.at' }), /schon so/);
  assert.equal(checkManage(d, 'accounts', { account_player: 'Anna', account: '' }), null);         // empty = remove
  assert.match(checkManage(d, 'accounts', { account_player: 'Bernd', account: 'b2@x.at' }), /gehört schon zu Bernd 2/);
  assert.equal(checkManage(d, 'accounts', { account_player: 'Bernd 2', account: 'B2@x.at, new@x.at' }), null);
});

test('management texts and the script\'s reasons in German', () => {
  assert.equal(doneText('rename', { old_name: 'Bernd', new_name: 'Bernhard' }), 'Bernd heißt jetzt Bernhard');
  assert.equal(askText('merge', { merge_from: 'Bernd 2', merge_into: 'Bernd' }), 'Bernd 2 mit Bernd zusammenführen?');
  assert.equal(doneText('accounts', { account_player: 'Anna', account: '' }), 'Google-Konto von Anna entfernt');
  assert.equal(reasonText('refused: name "Bernd" already in use (p002)'), 'Den Namen „Bernd“ gibt es schon.');
  assert.equal(reasonText('refused: player is already active'), 'Der Spieler ist schon aktiv.');
  assert.equal(reasonText('refused: Google account a@b.at already belongs to p001'), 'Das Google-Konto a@b.at gehört schon zu p001.');
  assert.equal(reasonText('error: Something odd'), 'Something odd');
});

test('applyManage (demo) does what the script does', () => {
  const m = applyManage(db(), 'merge', { merge_from: 'Bernd 2', merge_into: 'Bernd' }, () => 'p004');
  const bernd = m.players.find(p => p.id === 'p002');
  assert.deepEqual([m.players.length, bernd.active, bernd.accounts, m.moves], [2, true, ['b2@x.at'], [['p003', 'p002']]]);
  const a = applyManage(db(), 'add', { new_player: 'Clara', new_account: 'C@x.at' }, () => 'p004');
  assert.deepEqual(a.players.at(-1), { id: 'p004', name: 'Clara', active: true, accounts: ['c@x.at'] });
});

test('picking players: toggle, move over, a full side drops its earliest pick, resize', () => {
  let s = { W: ['me'], L: [] };
  s = pick(s, 'L', 'b', 1);
  assert.deepEqual(s, { W: ['me'], L: ['b'] });
  s = pick(s, 'L', 'me', 1);                        // „Ich“ moves to the losers
  assert.deepEqual(s, { W: [], L: ['me'] });
  s = pick(pick({ W: [], L: [] }, 'W', 'a', 2), 'W', 'b', 2);
  s = pick(s, 'W', 'c', 2);
  assert.deepEqual(s.W, ['b', 'c']);
  assert.deepEqual(pick(s, 'W', 'b', 2).W, ['c']);
  assert.equal(complete({ W: ['a'], L: ['b'] }, 1), true);
  assert.deepEqual(resize({ W: ['a', 'b'], L: ['c', 'd'] }, 1), { W: ['a'], L: ['c'] });
  const name = id => ({ a: 'Anna', b: 'Bernd', c: 'Clara' })[id];
  assert.equal(resultSentence(['a', 'b'], ['c'], name), 'Anna & Bernd schlagen Clara');
  assert.equal(wonLabel(['a'], name), 'Anna hat gewonnen');
});

test('support game text and what a merge does', () => {
  const name = id => ({ p1: 'Anna', p2: 'Bernd' })[id];
  const t = gameText({ t: 46350.5, ref: '2026-11-24 12:00:00', winners: ['p1'], losers: ['p2'] }, name);
  assert.match(t, /24\.11\.2026, 12:00 Uhr · Anna schlägt Bernd · Zeitstempel 2026-11-24 12:00:00/);
  const ds = { games: [{ winners: ['p3'], losers: ['p1'] }, { winners: ['p3', 'p2'], losers: ['p1', 'p4'] }, { winners: ['p3'], losers: ['p2'] }, { winners: ['p1'], losers: ['p2'] }] };
  assert.deepEqual(mergeEffect(ds, 'p3', 'p2'), { games: 3, both: 2 });
  assert.equal(mergeText('Bernd 2', 'Bernd', { games: 3, both: 2 }), 'Bernd 2 verschwindet, seine 3 Spiele zählen für Bernd. 2 Spiele, in denen beide stehen, werden ungültig.');
});

// ── arrival checks ──
const game = ref => ({ ref, source: 'spiele', winners: ['p1'], losers: ['p2'] });
function setup(steps) {
  const store = createStore(initialState());
  store.set({ data: { model: { dataset: { games: [game('a')], log: [] } } } });
  const timers = [];
  const ae = createAfterEntry({
    store, hasToken: () => true, clock: () => 0, later: (fn, ms) => timers.push([fn, ms]),
    refresh: async () => { const d = steps.shift(); if (d) store.set({ data: { model: { dataset: d } } }); return true; },
  });
  const run = async () => { const [fn, ms] = timers.shift(); await fn(); await new Promise(r => setTimeout(r, 0)); return ms; };
  return { store, ae, run, timers };
}

test('sent from the app: looks after FIRST_MS, again after RETRY_MS, then „missing“ or „arrived“', async () => {
  const a = setup([null, { games: [game('a'), game('b')], log: [] }]);
  a.ae.sending(); a.ae.sent();
  assert.equal(a.store.get().notice.kind, 'checking');
  assert.equal(await a.run(), FIRST_MS);
  assert.equal(a.store.get().notice.kind, 'checking');           // not there yet: no „missing“ after the first look
  assert.equal(await a.run(), RETRY_MS);
  assert.deepEqual(a.store.get().notice, { kind: 'arrived', refs: ['b'] });

  const b = setup([null, null]);
  b.ae.sending(); b.ae.sent();
  await b.run(); await b.run();
  assert.deepEqual(b.store.get().notice, { kind: 'missing' });
});

test('Verwaltung: the new management_log row decides; a refusal stays with its reason', async () => {
  assert.equal(manageOutcome({ action: 'rename', done: 'x' }, [{ action: 'add', status: 'ok' }]), null);
  const a = setup([{ games: [game('a')], log: [{ action: 'rename', status: 'ok' }] }]);
  a.ae.manage({ action: 'rename', done: 'Bernd heißt jetzt Bernhard' }, 'opened');
  assert.equal(a.ae.onVisible(), true);
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(a.store.get().notice, { kind: 'done', text: 'Bernd heißt jetzt Bernhard' });

  const b = setup([{ games: [game('a')], log: [{ action: 'rename', status: 'refused: name "Bernd" already in use (p002)' }] }]);
  b.ae.manage({ action: 'rename', done: 'x' }, 'opened');
  b.ae.onVisible(); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(b.store.get().notice, { kind: 'refused', text: 'Nicht geändert: Den Namen „Bernd“ gibt es schon.' });
  assert.equal(b.timers.length, 0);   // stays until closed

  const c = setup([null]);
  c.ae.manage({ action: 'rename', done: 'x' }, 'opened');
  c.ae.onVisible(); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(c.store.get().notice, { kind: 'missing', text: 'Noch keine Änderung angekommen.' });
});

test('submit: result sent with display names, remembered for the duplicate hint; offline keeps nothing', async () => {
  const store = createStore(initialState());
  const players = new Map([['p1', { id: 'p1', name: 'Anna' }], ['p2', { id: 'p2', name: 'Bernd  B.' }]]);
  store.set({ data: { model: { dataset: { config: CFG, players, games: [], log: [] } } } });
  const sent = [], mem = new Map();
  const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  let fail = false, t = 1e6;
  const events = [];
  const afterEntry = { sending: () => events.push('sending'), sent: () => events.push('sent'), failed: () => events.push('failed') };
  const transport = { send: async (form, cfg, answers) => { if (fail) throw new Error('offline'); sent.push([form, answers]); } };
  const s = createSubmit({ store, afterEntry, transport, storage, clock: () => t, later: () => {} });
  assert.equal(await s.result(['p1'], ['p2']), 'sent');
  assert.deepEqual(sent[0], ['result', { winner1: 'Anna', winner2: '', loser1: 'Bernd B.', loser2: '' }]);
  assert.deepEqual(events, ['sending', 'sent']);
  t += 60000;
  assert.equal(s.recentResult(['p1'], ['p2']), 1e6);
  assert.equal(s.recentResult(['p2'], ['p1']), null);
  fail = true;
  assert.equal(await s.result(['p1'], ['p2']), 'offline');
  assert.deepEqual(store.get().notice, { kind: 'offline' });
  assert.deepEqual(events.slice(-2), ['sending', 'failed']);
  assert.equal(await s.support({ topic: 'Sonstiges', description: 'x' }), 'offline');
  fail = false;
  assert.equal(await s.support({ topic: 'Sonstiges', description: 'x' }), 'sent');
  assert.equal(store.get().notice.kind, 'sent');
  const url = s.managementUrl('rename', { old_name: 'Bernd B.', new_name: 'Bernhard' });
  assert.equal(new URL(url).searchParams.get('entry.31'), 'Spieler umbenennen');
  assert.equal(new URL(url).searchParams.get('entry.32'), 'Bernd B.');
});

test('loader reads management_log; a new log row changes the hash', () => {
  const raw = demoRaw('Europe/Vienna');
  const d1 = load(raw);
  assert.equal(d1.log.length, 12);
  assert.deepEqual([d1.log[0].action, d1.log[0].new, d1.log[0].status], ['add', 'Anna', 'ok']);
  assert.ok(d1.takenNames.includes('anna'));
  raw.management_log.push([d1.log[0].t + 1, 'rename', 'p001', 'Anna', 'Annabell', 'x@y.at', 'refused: name "Annabell" already in use (p009)']);
  assert.notEqual(load(raw).hash, d1.hash);
  assert.deepEqual(load({ ...raw, management_log: [] }).log, []);
});

test('demo: a result sent from the app arrives in the data; a Verwaltung action is done like the script', async () => {
  const demo = demoForms('Europe/Vienna');
  const before = load(demo.apply(demoRaw('Europe/Vienna')));
  await demoTransport(demo).send('result', before.config, { winner1: 'Anna', winner2: '', loser1: 'Bernd', loser2: '' });
  await demo.submit('management', { action: 'rename', fields: { old_name: 'Anna', new_name: 'Annabell' } });
  await demo.submit('management', { action: 'add', fields: { new_player: 'annabell', new_account: '' } });
  const after = load(demo.apply(demoRaw('Europe/Vienna')));
  assert.equal(after.games.length, before.games.length + 1);
  const known = new Set(before.games.map(g => g.ref));
  const last = after.games.find(g => !known.has(g.ref));
  assert.deepEqual([last.winners, last.losers], [['p001'], ['p002']]);
  assert.equal(after.players.get('p001').name, 'Annabell');
  assert.deepEqual(after.log.slice(-2).map(r => r.status.slice(0, 7)), ['ok', 'refused']);
  assert.ok(formReady(after.config, 'result') && formReady(after.config, 'support') && formReady(after.config, 'management'));
  assert.equal(canManage(after.config, 'demo@beispiel.at'), true);
});
