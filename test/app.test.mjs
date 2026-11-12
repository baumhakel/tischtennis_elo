// Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, formatHash } from '../js/app/url.js';
import { createStore, initialState } from '../js/app/store.js';
import { createPipeline } from '../js/app/pipeline.js';
import { resolveFilters, visible, resolveFocus, toggleFocus } from '../js/core/filters.js';
import { batchGet, SheetsError } from '../js/io/sheets.js';
import { demoRaw } from '../js/io/demo.js';
import { load } from '../js/core/loader.js';
import { compute } from '../js/core/elo.js';
import { APP_VERSION } from '../js/config.js';

test('url: round trip, defaults, junk ignored', () => {
  const s = { view: 'matrix', params: { metric: 'wins', a: 'p 1' }, filters: { mode: 'einzel', minGames: 10, inactivityDays: 0, xAxis: 'date', focus: ['p003', null, 'p007'] } };
  const hash = formatHash(s);
  assert.equal(hash, '#/matrix?modus=einzel&min=10&inaktiv=0&x=date&fokus=p003%2C-%2Cp007&a=p+1&metric=wins');
  assert.equal(parseHash('#/x?modus=quatsch').filters.mode, null);
  assert.equal(formatHash({ view: 'x', filters: { mode: 'alle' } }), '#/x');
  assert.deepEqual(parseHash(hash), s);
  assert.deepEqual(parseHash(''), { view: 'dashboard', params: {}, filters: { mode: null, minGames: null, inactivityDays: null, xAxis: null, focus: null } });
  assert.deepEqual(parseHash('#/x?min=abc&x=sideways').filters, { mode: null, minGames: null, inactivityDays: null, xAxis: null, focus: null });
  assert.deepEqual(parseHash('#/x?fokus=').filters.focus, [null]);
  assert.equal(formatHash({ view: 'dashboard', filters: { minGames: null } }), '#/dashboard');
});

test('store: nested merge, replaceParams, subscribers get prev', () => {
  const st = createStore();
  const seen = [];
  st.subscribe((s, prev) => seen.push([s.data.loading, prev.data.loading]));
  st.set({ data: { loading: true } });
  assert.equal(st.get().data.model, null);
  st.set({ params: { a: '1' } }); st.set({ params: { b: '2' } });
  assert.deepEqual(st.get().params, { a: '1', b: '2' });
  st.set({ view: 'x', params: { c: '3' }, replaceParams: true });
  assert.deepEqual(st.get().params, { c: '3' });
  assert.deepEqual(seen[0], [true, false]);
  const f0 = st.get().filters;
  st.set({ data: { loading: false } });
  assert.equal(st.get().filters, f0, 'untouched branches keep identity (router relies on it)');
});

test('filters: config defaults, inactive hidden, provisional listed', () => {
  const raw = demoRaw('Europe/Vienna');
  const d = load(raw), elo = compute(d);
  const f = resolveFilters({ minGames: null, inactivityDays: 7, xAxis: null }, d.config);
  assert.deepEqual(f, { mode: 'alle', minGames: d.config.default_min_games, inactivityDays: 7, xAxis: d.config.default_x_axis, focus: null });
  assert.equal(resolveFilters({ mode: 'einzel' }, d.config).minGames, d.config.default_min_games_single);
  assert.equal(resolveFilters({ mode: 'doppel' }, d.config).minGames, d.config.default_min_games_double);
  assert.equal(resolveFilters({ mode: 'doppel', minGames: 3 }, d.config).minGames, 3);
  const now = d.games.at(-1).t;
  const v = visible(d, elo, { ...f, minGames: 60 }, now);
  for (let k = 0; k < elo.ids.length; k++) {
    const inactive = d.games[elo.lastG[k]].t < now - 7;
    assert.equal(v.inactive.has(k), inactive);
    if (!inactive) assert.equal(v.provisional.has(k), elo.played[k] < 60);
    assert.equal(v.isShown(k), !inactive && elo.played[k] >= 60);
  }
  assert.equal(v.listed.length + v.inactive.size, elo.ids.length);
  assert.equal(visible(d, elo, { minGames: 0, inactivityDays: 0 }, now).shown.length, elo.ids.length);
});

test('demo data loads without issues', () => {
  const d = load(demoRaw('Europe/Vienna'));
  assert.deepEqual(d.issues, []);
  assert.equal(d.counts.beforeCutoff, 1);
  assert.ok(d.games.length > 200);
});

// ── pipeline with fakes ──
function setup({ cached = null, token = 'tok', fetchImpl } = {}) {
  const store = createStore();
  const saved = [];
  let t = token, expired = 0, fetches = 0;
  const raw = demoRaw('Europe/Vienna');
  const p = createPipeline({
    store,
    auth: { getToken: () => t, expire: () => { expired++; t = null; } },
    fetchRaw: fetchImpl || (async () => { fetches++; return raw; }),
    cache: { load: async () => cached, save: async e => { saved.push(e); return true; } },
    now: () => 46000,
    clock: () => 1000 * (++fetches),
  });
  return { store, p, saved, raw, counts: () => ({ fetches, expired }) };
}

test('pipeline: no cache, token → loads, computes, saves', async () => {
  const { store, p, saved } = setup();
  await p.boot();
  const s = store.get().data;
  assert.equal(s.source, 'sheet');
  assert.ok(s.model.elo.ids.length > 5);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].stamp, APP_VERSION);
  assert.equal(s.loading, false);
});

test('pipeline: cache shown first; unchanged sheet keeps the same model object', async () => {
  const raw = demoRaw('Europe/Vienna');
  const dataset = load(raw), elo = compute(dataset);
  const { store, p } = setup({ cached: { stamp: APP_VERSION, hash: dataset.hash, raw, dataset, elo, savedAt: 5 } });
  const states = [];
  store.subscribe(s => states.push(s.data.source));
  await p.boot();
  assert.equal(states[0], 'cache');
  const m = store.get().data.model;
  assert.equal(m.dataset, dataset, 'cached model kept');
  assert.equal(store.get().data.source, 'sheet');
});

test('pipeline: cache from an older app version is recomputed from raw', async () => {
  const raw = demoRaw('Europe/Vienna');
  const { store, p } = setup({ cached: { stamp: 'old', raw, dataset: { bogus: true }, elo: null, savedAt: 5 }, token: null });
  await p.boot();
  assert.ok(store.get().data.model.elo.ids.length > 5);
  assert.equal(store.get().data.needsSignIn, true);
});

test('pipeline: 401 expires the token, keeps the cached view', async () => {
  const raw = demoRaw('Europe/Vienna');
  const dataset = load(raw), elo = compute(dataset);
  const { store, p, counts } = setup({
    cached: { stamp: APP_VERSION, raw, dataset, elo, savedAt: 5 },
    fetchImpl: async () => { throw new SheetsError('auth', 'abgelaufen', 401); },
  });
  await p.boot();
  assert.equal(counts().expired, 1);
  assert.equal(store.get().data.needsSignIn, true);
  assert.equal(store.get().data.source, 'cache');
  assert.ok(store.get().data.model);
});

test('pipeline: other errors are shown, concurrent refreshes share one request', async () => {
  let n = 0;
  const { store, p } = setup({ fetchImpl: async () => { n++; await new Promise(r => setTimeout(r, 10)); throw new SheetsError('forbidden', 'Kein Zugriff'); } });
  await Promise.all([p.refresh(), p.refresh()]);
  assert.equal(n, 1);
  assert.equal(store.get().data.error, 'Kein Zugriff');
});

test('sheets: request format and error mapping', async () => {
  let url, headers;
  const ok = async (u, o) => { url = u; headers = o.headers; return { ok: true, json: async () => ({ valueRanges: [{ values: [['key']] }, {}, {}, {}, {}, {}] }) }; };
  const raw = await batchGet({ token: 'T', spreadsheetId: 'S', fetchImpl: ok });
  assert.match(url, /spreadsheets\/S\/values:batchGet\?/);
  assert.match(url, /valueRenderOption=UNFORMATTED_VALUE/);
  assert.match(url, /dateTimeRenderOption=SERIAL_NUMBER/);
  assert.match(url, /ranges=%27Spiele%27/);
  assert.equal(headers.Authorization, 'Bearer T');
  assert.deepEqual(raw.config, [['key']]);
  assert.deepEqual(raw.spiele, []);
  for (const [status, kind] of [[401, 'auth'], [403, 'forbidden'], [404, 'not_found'], [400, 'bad_range'], [500, 'http']]) {
    await assert.rejects(batchGet({ token: 'T', spreadsheetId: 'S', fetchImpl: async () => ({ ok: false, status, json: async () => ({}) }) }),
      e => e instanceof SheetsError && e.kind === kind);
  }
  await assert.rejects(batchGet({ token: 'T', spreadsheetId: 'S', fetchImpl: async () => { throw new TypeError('fail'); } }), e => e.kind === 'network');
});

test('focus: default top N by rating, explicit slots keep colours, hidden players keep their slot', () => {
  const d = load(demoRaw('Europe/Vienna')), elo = compute(d);
  const f = resolveFilters({ minGames: 0, inactivityDays: 0 }, d.config);
  const vis = visible(d, elo, f, d.games.at(-1).t);
  const def = resolveFocus(f, elo, vis, d.config);
  assert.equal(def.explicit, false);
  assert.equal(def.slots.length, d.config.focus_default_count);
  const top = [...elo.final.keys()].sort((a, b) => elo.final[b] - elo.final[a]);
  assert.deepEqual(def.slots, top.slice(0, 3));

  const ids = ['p002', null, 'p005'];
  const ex = resolveFocus({ ...f, focus: ids }, elo, vis, d.config);
  assert.equal(ex.slotOf.get(elo.index.get('p005')), 2);
  // hide p002 via min games: p005 keeps slot 2
  const vis2 = visible(d, elo, { ...f, minGames: elo.played[elo.index.get('p002')] + 1 }, d.games.at(-1).t);
  const ex2 = resolveFocus({ ...f, focus: ids }, elo, vis2, d.config);
  assert.equal(ex2.slots[0], null);
  assert.equal(ex2.slotOf.get(elo.index.get('p005')), 2);

  assert.deepEqual(toggleFocus(ids, 'p009'), ['p002', 'p009', 'p005']);
  assert.deepEqual(toggleFocus(ids, 'p005'), ['p002']);
  assert.deepEqual(toggleFocus(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 'z').length, 8);
});
