// Photos in the app (Phase 18b): which images are in memory, loading them (memory → IndexedDB → the web app),
// uploads and deletions, and the per-render view the views get as ctx.photos. No DOM except Image/object URLs.
//
//   createPhotos({ store, client, cache, refresh, storage, nowSerial })
//     → { view(dataset, state) → ctx.photos, prefetchAvatars(dataset), upload(o), remove(id), setFaces(on), faces() }
//
// Images are loaded in batches. When a batch is in memory (and decoded, so canvases can draw it at once),
// state.photosRev is bumped and the views re-render. A photo never changes, so nothing is ever re-fetched.
import { photoKey } from '../io/photo-cache.js';
import { photosFor, avatarOf, canDelete, canSetAvatar, refKey } from '../core/photos.js';
import { norm } from '../core/normalize.js';

const FACES_KEY = 'tt-elo-faces';

/**
 * @param {{ store, client: { upload, get, remove } | null, cache: { read, write, remove, prune },
 *           refresh: () => Promise<any>, storage?: Storage, nowSerial: () => number, later?: (fn, ms) => any }} o
 */
export function createPhotos({ store, client, cache, refresh, storage = null, nowSerial, later = (fn, ms) => setTimeout(fn, ms) }) {
  const mem = new Map();        // key → { url, img }
  const failed = new Set();     // keys that couldn't be loaded (deleted or missing): not asked again until new data
  const inflight = new Set();
  let queue = new Map();        // key → { id, size }
  let scheduled = false;
  const pending = new Map();    // id → photo uploaded from here, until the sheet shows it
  const removed = new Set();    // ids deleted from here, until the sheet shows it
  let lastRev = null;
  const waiters = new Map();    // key → [resolve] for load(): the viewer waits for one image
  const settle = (key, url) => { (waiters.get(key) || []).forEach(r => r(url)); waiters.delete(key); };

  const bump = () => store.set({ photosRev: (store.get().photosRev || 0) + 1 });
  const facesOn = () => { try { return storage?.getItem(FACES_KEY) !== '0'; } catch { return true; } };

  async function put(key, blob) {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { /* still usable as <img> */ }
    mem.set(key, { url, img });
    settle(key, url);
  }

  function want(id, size) {
    const key = photoKey(id, size);
    if (mem.has(key) || failed.has(key) || inflight.has(key)) return;
    queue.set(key, { id, size });
    if (!scheduled) { scheduled = true; later(flush, 0); }
  }

  async function flush() {
    scheduled = false;
    const batch = queue;
    queue = new Map();
    if (!batch.size) return;
    for (const k of batch.keys()) inflight.add(k);
    let changed = false;
    try {
      const local = await cache.read([...batch.keys()]);
      for (const [k, blob] of local) { await put(k, blob); changed = true; }
      const rest = [...batch].filter(([k]) => !local.has(k));
      for (const size of ['thumb', 'full']) {
        const ids = rest.filter(([, v]) => v.size === size).map(([, v]) => v.id);
        if (!ids.length) continue;
        if (!client) { ids.forEach(id => failed.add(photoKey(id, size))); continue; }
        let got;
        try { got = await client.get(ids, size); }
        catch (e) { if (e?.kind !== 'offline' && e?.kind !== 'auth') ids.forEach(id => failed.add(photoKey(id, size))); continue; }
        for (const id of ids) {
          const k = photoKey(id, size), blob = got.get(id);
          if (!blob) { failed.add(k); continue; }
          await put(k, blob);
          cache.write(k, blob);
          changed = true;
        }
      }
    } finally {
      for (const k of batch.keys()) { inflight.delete(k); if (!mem.has(k)) settle(k, null); }
    }
    if (changed) bump();
  }

  function view(dataset, state) {
    const cfg = dataset.config;
    const on = !!cfg.photos_url;
    const email = norm(state.auth.email);
    if (dataset.photos?.rev !== lastRev) {      // new data: forget what was pending or failed and is now settled
      lastRev = dataset.photos?.rev;
      const known = new Set((dataset.photos?.list || []).map(p => p.id));
      for (const id of pending.keys()) if (known.has(id)) pending.delete(id);
      for (const id of removed) if (!known.has(id)) removed.delete(id);
      failed.clear();
    }
    const alive = p => !removed.has(p.id);
    const merged = (kind, ref) => [...[...pending.values()].filter(p => p.kind === kind && p.ref === ref), ...photosFor(dataset, kind, ref)].filter(alive);
    const url = (id, size = 'thumb') => {
      const m = mem.get(photoKey(id, size));
      if (m) return m.url;
      want(id, size);
      return null;
    };
    const avatar = id => {
      const own = [...pending.values()].filter(p => p.kind === 'spieler' && p.ref === id)[0];
      if (own) return own;
      const list = photosFor(dataset, 'spieler', id).filter(alive);
      return list[0] || null;
    };
    return {
      on,
      faces: on && facesOn(),
      url,
      image(id, size = 'thumb') { const m = mem.get(photoKey(id, size)); if (!m) want(id, size); return m?.img || null; },
      list: merged,
      all(kind = 'spiel') {
        return [...[...pending.values()].filter(p => p.kind === kind), ...(dataset.photos?.list || []).filter(p => p.kind === kind)].filter(alive);
      },
      /** Promise of the image's URL (null if it can't be loaded): for the viewer, which lives outside the views. */
      load(id, size = 'full') {
        const key = photoKey(id, size), m = mem.get(key);
        if (m) return Promise.resolve(m.url);
        if (failed.has(key)) return Promise.resolve(null);
        return new Promise(resolve => { waiters.set(key, [...(waiters.get(key) || []), resolve]); want(id, size); });
      },
      count: (kind, ref) => merged(kind, ref).length,
      has: (kind, ref) => merged(kind, ref).length > 0,
      avatar,
      avatarUrl(id) { const p = avatar(id); return p ? url(p.id, 'thumb') : null; },
      avatarImage(id) { const p = avatar(id); return p ? this.image(p.id, 'thumb') : null; },
      canDelete: p => !!client && canDelete(p, email, cfg),
      canSetAvatar: id => !!client && canSetAvatar(dataset, id, email),
      canUpload: !!client && on,
    };
  }

  return {
    view,
    want,
    faces: facesOn,
    setFaces(onOff) { try { if (onOff) storage?.removeItem(FACES_KEY); else storage?.setItem(FACES_KEY, '0'); } catch { /* ignore */ } bump(); },
    /** All profile pictures in one go, after the data is shown. */
    prefetchAvatars(dataset) {
      if (!dataset.config.photos_url) return;
      for (const p of dataset.photos?.avatar.values() || []) want(p.id, 'thumb');
    },
    prune(dataset) {
      const live = new Set([...(dataset.photos?.list || []).map(p => p.id), ...pending.keys()]);
      return cache.prune(dataset.config.photos_cache_mb * 1024 * 1024, live);
    },
    /** { kind, ref, image, thumb, width, height, caption } → id. Throws PhotoError. */
    async upload(o) {
      if (!client) throw new Error('Fotos sind nicht eingerichtet.');
      const id = await client.upload(o);
      await Promise.all([put(photoKey(id, 'full'), o.image), put(photoKey(id, 'thumb'), o.thumb)]);
      cache.write(photoKey(id, 'full'), o.image);
      cache.write(photoKey(id, 'thumb'), o.thumb);
      pending.set(id, { id, kind: o.kind, ref: o.ref, width: o.width, height: o.height, caption: o.caption || '',
        by: norm(store.get().auth.email), at: nowSerial(), pending: true });
      bump();
      refresh();
      return id;
    },
    async remove(id) {
      if (!client) return;
      await client.remove(id);
      removed.add(id);
      pending.delete(id);
      cache.remove([photoKey(id, 'thumb'), photoKey(id, 'full')]);
      bump();
      refresh();
    },
  };
}

export { refKey };
