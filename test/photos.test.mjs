// Phase 18b: photos (tab „fotos“, permissions, sizing, the web app client, loading and caching in the app).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePhotos, photosFor, avatarOf, canDelete, canSetAvatar, fitSize, squareCrop, initials, uploaderName } from '../js/core/photos.js';
import { photoClient, PhotoError, blobToBase64, base64ToBlob } from '../js/io/photos.js';
import { createPhotos } from '../js/app/photos.js';
import { createStore, initialState } from '../js/app/store.js';
import { load } from '../js/core/loader.js';
import { demoRaw, demoForms } from '../js/io/demo.js';
import { batchGet } from '../js/io/sheets.js';

const HEAD = ['id', 'kind', 'ref', 'file_id', 'thumb_id', 'width', 'height', 'caption', 'uploaded_by', 'uploaded_at', 'deleted_at', 'deleted_by'];
const players = new Map([['p1', { id: 'p1', name: 'Anna', accounts: ['anna@x.at'] }], ['p2', { id: 'p2', name: 'Bernd', accounts: [] }]]);
const grid = [HEAD,
  ['f0001', 'spieler', 'p1', 'a', 'b', 256, 256, '', 'anna@x.at', 46300, '', ''],
  ['f0002', 'spieler', 'p1', 'a', 'b', 256, 256, '', 'ANNA@x.at', 46310, '', ''],
  ['f0003', 'spiel', '2026-11-24 12:03:12', 'a', 'b', 1600, 1200, 'Matchball!', 'bernd@x.at', 46320, '', ''],
  ['f0004', 'spiel', '2026-11-24 12:03:12', 'a', 'b', 1600, 1200, '', 'bernd@x.at', 46321, 46322, 'bernd@x.at'],
  ['f0005', 'spieler', 'p9', 'a', 'b', 256, 256, '', 'x@x.at', 46330, '', ''],
];

test('the tab „fotos“: deleted rows dropped, newest first, profile picture = newest of the player', () => {
  const ph = parsePhotos(grid, players);
  assert.deepEqual(ph.list.map(p => p.id), ['f0005', 'f0003', 'f0002', 'f0001']);
  const ds = { photos: ph, players };
  assert.equal(avatarOf(ds, 'p1').id, 'f0002');
  assert.equal(avatarOf(ds, 'p2'), null);
  assert.equal(avatarOf(ds, 'p9'), null);                         // not a player (any more)
  assert.deepEqual(photosFor(ds, 'spiel', '2026-11-24 12:03:12').map(p => [p.id, p.caption]), [['f0003', 'Matchball!']]);
  assert.equal(ph.list[2].by, 'anna@x.at');
  assert.deepEqual(parsePhotos([], players).list, []);
  assert.deepEqual(parsePhotos([['id', 'other']], players).list, []);
  assert.notEqual(parsePhotos(grid.slice(0, -1), players).rev, ph.rev);
});

test('who may delete and who may set a profile picture', () => {
  const p = { by: 'bernd@x.at' };
  assert.equal(canDelete(p, 'Bernd@x.at', {}), true);
  assert.equal(canDelete(p, 'anna@x.at', { management_accounts: null }), false);
  assert.equal(canDelete(p, 'anna@x.at', { management_accounts: ['ANNA@x.at'] }), true);
  assert.equal(canDelete(p, null, {}), false);
  const ds = { players };
  assert.equal(canSetAvatar(ds, 'p1', 'Anna@X.at'), true);
  assert.equal(canSetAvatar(ds, 'p1', 'bernd@x.at'), false);         // only for yourself (decided 24 Nov)
  assert.equal(canSetAvatar(ds, 'p2', 'bernd@x.at'), false);         // no account mapped: nobody
  assert.equal(uploaderName(ds, 'anna@x.at'), 'Anna');
  assert.equal(uploaderName(ds, 'nobody@x.at'), null);
});

test('sizes and crop', () => {
  assert.deepEqual(fitSize(4032, 3024, 1600), { w: 1600, h: 1200 });
  assert.deepEqual(fitSize(800, 600, 1600), { w: 800, h: 600 });     // never scaled up
  assert.deepEqual(squareCrop(400, 300), { sx: 50, sy: 0, size: 300 });
  assert.deepEqual(squareCrop(400, 300, { zoom: 2, x: -1, y: 1 }), { sx: 0, sy: 150, size: 150 });
  assert.deepEqual(squareCrop(400, 300, { x: 5 }), { sx: 100, sy: 0, size: 300 });   // clamped
  assert.equal(initials('Anna Berger'), 'AB');
  assert.equal(initials('Clara'), 'C');
  assert.equal(initials('Bernd 2'), 'B2');
});

test('loader reads „fotos“ into the data, and it is part of the hash', () => {
  const raw = demoRaw('Europe/Vienna');
  const d = load(raw);
  assert.ok(d.photos.count >= 10);
  assert.equal(d.photos.avatar.has('p003'), false);                 // the demo account has no picture yet
  assert.equal(d.photos.avatar.has('p001'), true);
  assert.notEqual(load({ ...raw, fotos: raw.fotos.slice(0, -1) }).hash, d.hash);
  assert.equal(load({ ...raw, fotos: [] }).photos.count, 0);
});

test('demo: an uploaded photo appears in the data, a deleted one disappears', () => {
  const demo = demoForms('Europe/Vienna');
  const id = demo.addPhoto({ kind: 'spieler', ref: 'p003', image: 'I', thumb: 'T', width: 512, height: 512 });
  let d = load(demo.apply(demoRaw('Europe/Vienna')));
  assert.equal(d.photos.avatar.get('p003').id, id);
  assert.equal(demo.photoFile(id, 'thumb'), 'T');
  demo.removePhoto(id);
  d = load(demo.apply(demoRaw('Europe/Vienna')));
  assert.equal(d.photos.avatar.has('p003'), false);
});

test('base64 round trip', async () => {
  const b = new Blob([new Uint8Array([0xff, 0xd8, 1, 2, 3, 250])]);
  const s = await blobToBase64(b);
  assert.deepEqual([...new Uint8Array(await base64ToBlob(s).arrayBuffer())], [0xff, 0xd8, 1, 2, 3, 250]);
});

test('client: token in the body, text/plain, errors in German', async () => {
  const calls = [];
  const ok = body => ({ ok: true, json: async () => body });
  const c = photoClient({ url: () => 'https://script.google.com/macros/s/X/exec', token: () => 'TOK',
    fetchImpl: async (u, o) => { calls.push([u, o.method, o.headers['Content-Type'], JSON.parse(o.body)]); return ok({ ok: true, id: 'f0007', images: { f1: btoa('ab') } }); } });
  const id = await c.upload({ kind: 'spiel', ref: 'r', image: new Blob(['x']), thumb: new Blob(['y']), width: 2, height: 1, caption: 'Hi' });
  assert.equal(id, 'f0007');
  assert.deepEqual([calls[0][1], calls[0][2], calls[0][3].token, calls[0][3].action, calls[0][3].image], ['POST', 'text/plain;charset=utf-8', 'TOK', 'upload', btoa('x')]);
  const got = await c.get(Array.from({ length: 61 }, (_, i) => 'f' + i), 'thumb');
  assert.equal(calls.length, 3);                                    // 60 per request
  assert.equal(await got.get('f1').text(), 'ab');
  const refused = photoClient({ url: () => 'u', token: () => 'T', fetchImpl: async () => ok({ ok: false, error: 'forbidden', message: 'Nein.' }) });
  await assert.rejects(refused.remove('f1'), e => e instanceof PhotoError && e.kind === 'forbidden' && e.message === 'Nein.');
  const offline = photoClient({ url: () => 'u', token: () => 'T', fetchImpl: async () => { throw new TypeError('fail'); } });
  await assert.rejects(offline.get(['f1']), e => e.kind === 'offline');
  await assert.rejects(photoClient({ url: () => 'u', token: () => null }).get(['f1']), e => e.kind === 'auth');
});

test('sheets: a missing optional tab („fotos“) is read as empty instead of failing', async () => {
  const seen = [];
  const fetchImpl = async url => {
    const ranges = new URL(url).searchParams.getAll('ranges');
    seen.push(ranges.length);
    if (ranges.some(r => r.includes('fotos'))) return { ok: false, status: 400, json: async () => ({ error: { message: 'Unable to parse range: fotos' } }) };
    return { ok: true, json: async () => ({ valueRanges: ranges.map(() => ({ values: [['x']] })) }) };
  };
  const raw = await batchGet({ token: 'T', spreadsheetId: 'S', fetchImpl });
  assert.deepEqual(raw.fotos, []);
  assert.deepEqual(raw.config, [['x']]);
  await batchGet({ token: 'T', spreadsheetId: 'S', fetchImpl });
  assert.equal(seen.length, 3);                                    // remembered: no third failing request
});

// ── the app side: memory → device cache → web app, one batch, never twice ──
globalThis.URL.createObjectURL ||= () => 'blob:x';
class FakeImage { set src(v) { this._s = v; } get src() { return this._s; } async decode() {} }
globalThis.Image ||= FakeImage;

function setup({ cached = [], remote = {} } = {}) {
  const store = createStore(initialState());
  store.set({ auth: { email: 'anna@x.at' } });
  const cache = new Map(cached.map(k => [k, new Blob(['c'])]));
  const asked = [];
  const timers = [];
  const ph = createPhotos({
    store, nowSerial: () => 46400, refresh: async () => {}, later: fn => timers.push(fn),
    cache: { read: async ks => new Map(ks.filter(k => cache.has(k)).map(k => [k, cache.get(k)])), write: async (k, b) => cache.set(k, b), remove: async ks => ks.forEach(k => cache.delete(k)), prune: async () => 0 },
    client: {
      async get(ids, size) { asked.push([ids, size]); return new Map(ids.filter(id => remote[id]).map(id => [id, new Blob([remote[id]])])); },
      async upload() { return 'f0100'; }, async remove() {},
    },
  });
  const ds = { config: { photos_url: 'https://x', photos_cache_mb: 10 }, players, photos: parsePhotos(grid, players) };
  const run = async () => { while (timers.length) await timers.shift()(); };
  return { store, ph, ds, cache, asked, run };
}

test('app: images come from the device cache first, the rest in one request, and are never asked twice', async () => {
  const s = setup({ cached: ['f0002:thumb'], remote: { f0003: 'g' } });
  const v = s.ph.view(s.ds, s.store.get());
  assert.equal(v.faces, true);
  assert.equal(v.avatarUrl('p1'), null);                           // not in memory yet: asked for
  assert.equal(v.url('f0003'), null);
  assert.equal(v.url('f0001'), null);
  await s.run();
  assert.deepEqual(s.asked, [[['f0003', 'f0001'], 'thumb']]);    // f0002 came from the device
  assert.equal(s.store.get().photosRev, 1);
  const v2 = s.ph.view(s.ds, s.store.get());
  assert.ok(v2.avatarUrl('p1'));
  assert.ok(v2.url('f0003'));
  assert.equal(v2.url('f0001'), null);                             // missing on the server: not asked again
  await s.run();
  assert.equal(s.asked.length, 1);
  assert.ok(s.cache.has('f0003:thumb'));                           // stored for next time
});

test('app: an upload shows at once, a deletion hides at once; permissions follow the rules', async () => {
  const s = setup();
  const id = await s.ph.upload({ kind: 'spieler', ref: 'p1', image: new Blob(['i']), thumb: new Blob(['t']), width: 9, height: 9 });
  let v = s.ph.view(s.ds, s.store.get());
  assert.equal(v.avatar('p1').id, id);
  assert.ok(v.avatarUrl('p1'));
  assert.equal(v.canSetAvatar('p1'), true);
  assert.equal(v.canSetAvatar('p2'), false);
  const game = v.list('spiel', '2026-11-24 12:03:12')[0];
  assert.equal(v.canDelete(game), false);                          // uploaded by Bernd
  await s.ph.remove('f0003');
  v = s.ph.view(s.ds, s.store.get());
  assert.equal(v.list('spiel', '2026-11-24 12:03:12').length, 0);
  s.ph.setFaces(false);
  assert.equal(s.ph.view(s.ds, s.store.get()).faces, true);      // no storage given: always on
  const off = s.ph.view({ ...s.ds, config: { photos_url: '' } }, s.store.get());
  assert.equal(off.on, false);
  assert.equal(off.faces, false);
});
