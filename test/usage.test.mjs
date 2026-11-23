// Phase 17, item 6: usage counting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsage, formResponseUrl, usageConfigured, dueDays, prune, dayOf, rowFields } from '../js/app/usage.js';

const CFG = { form_usage_url: 'https://docs.google.com/forms/d/e/ABC/viewform?usp=sf_link',
  form_usage_entry_device: '11', form_usage_entry_date: 'entry.22', form_usage_entry_version: '33', form_usage_entry_counts: '44' };
const mem = () => { const m = new Map(); return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const T = (d, h = 12) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00`).getTime();

test('helpers: configured, formResponse URL, due days, pruning', () => {
  assert.ok(usageConfigured(CFG));
  assert.ok(!usageConfigured({ ...CFG, form_usage_entry_counts: '' }));
  assert.equal(formResponseUrl(CFG.form_usage_url), 'https://docs.google.com/forms/d/e/ABC/formResponse');
  const st = { device: 'd', days: { '2026-11-01': {}, '2026-11-20': {}, '2026-11-22': {}, '2026-11-23': {} }, sent: ['2026-11-20', '2026-11-01'] };
  assert.deepEqual(dueDays(st, '2026-11-23'), ['2026-11-22']);
  prune(st, '2026-11-23');
  assert.deepEqual(Object.keys(st.days).sort(), ['2026-11-20', '2026-11-22', '2026-11-23']);
  assert.deepEqual(st.sent, ['2026-11-20']);
  assert.equal(dayOf(T('2026-11-23', 0)), '2026-11-23');
});

test('nothing is counted or sent while the form is not in config; counts made before the config wait', async () => {
  const storage = mem(), sent = [];
  const u = createUsage({ storage, version: 'v1', clock: () => T('2026-11-22'), fetchImpl: async (url, o) => sent.push([url, o]) });
  u.count('dashboard');
  await u.configure({});
  assert.equal(storage.m.size, 0);
  const u2 = createUsage({ storage, version: 'v1', clock: () => T('2026-11-22'), fetchImpl: async () => {} });
  u2.count('dashboard'); u2.count('dashboard');
  await u2.configure(CFG);
  u2.count('aktion:teilen');
  const st = JSON.parse(storage.m.get('tt-elo-usage'));
  assert.deepEqual(st.days['2026-11-22'], { v: 'v1', c: { dashboard: 2, 'aktion:teilen': 1 } });
  assert.match(st.device, /.{8,}/);
});

test('completed days are sent once, as one form row each; offline days wait for the next time', async () => {
  const storage = mem(), sent = [];
  let now = T('2026-11-21'), online = true;
  const u = createUsage({ storage, version: 'v1', clock: () => now, randomId: () => 'dev-1',
    fetchImpl: async (url, o) => { if (!online) throw new Error('offline'); sent.push({ url, body: Object.fromEntries(o.body), mode: o.mode }); } });
  await u.configure(CFG);
  u.count('dashboard'); u.count('tisch');
  now = T('2026-11-22'); u.count('dashboard');
  online = false;
  now = T('2026-11-23');
  assert.equal(await u.flush(), 0);
  online = true;
  assert.equal(await u.flush(), 2);
  assert.equal(await u.flush(), 0);
  assert.deepEqual(sent.map(s => s.body['entry.22']), ['2026-11-21', '2026-11-22']);
  assert.deepEqual(sent[0], { url: 'https://docs.google.com/forms/d/e/ABC/formResponse', mode: 'no-cors',
    body: { 'entry.11': 'dev-1', 'entry.22': '2026-11-21', 'entry.33': 'v1', 'entry.44': '{"dashboard":1,"tisch":1}' } });
});

test('switched off on this device: counts are forgotten and nothing more is counted', async () => {
  const storage = mem(), states = [];
  const u = createUsage({ storage, version: 'v1', clock: () => T('2026-11-22'), fetchImpl: async () => {}, onChange: s => states.push(s) });
  await u.configure(CFG);
  u.count('dashboard');
  u.setOff(true);
  u.count('dashboard');
  assert.equal(storage.m.get('tt-elo-usage'), undefined);
  assert.deepEqual(states.at(-1), { configured: true, off: true });
  u.setOff(false);
  u.count('dashboard');
  assert.ok(storage.m.get('tt-elo-usage'));
});

test('rowFields accepts entry IDs with or without the „entry.“ prefix', () => {
  const st = { device: 'x', days: { '2026-11-22': { v: 'v', c: { a: 1 } } }, sent: [] };
  assert.deepEqual([...rowFields(CFG, st, '2026-11-22').keys()], ['entry.11', 'entry.22', 'entry.33', 'entry.44']);
});
