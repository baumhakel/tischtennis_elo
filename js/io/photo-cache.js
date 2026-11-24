// Photos on the device (Phase 18b): IndexedDB, one entry per photo and size, key „<id>:thumb“ / „<id>:full“.
// A photo file never changes (a new picture gets a new ID), so an entry is valid forever: no revalidation.
// Full images are capped (oldest first out), previews are kept. Every failure degrades to „not cached“.
import { STORAGE_PREFIX } from '../config.js';

const DB = STORAGE_PREFIX + '-photos';
const STORE = 'images';

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbp = null;
const db = () => (dbp ||= open().catch(e => { dbp = null; throw e; }));

function tx(mode, fn) {
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out);
    t.onerror = t.onabort = () => reject(t.error);
  }));
}

export const photoKey = (id, size) => `${id}:${size}`;

/** keys → Map key → Blob (missing keys are left out). */
export async function readPhotos(keys) {
  const out = new Map();
  if (!keys.length) return out;
  try {
    await tx('readonly', s => {
      for (const k of keys) {
        const r = s.get(k);
        r.onsuccess = () => { if (r.result?.blob) out.set(k, r.result.blob); };
      }
    });
  } catch { /* no cache */ }
  return out;
}

export async function writePhoto(key, blob) {
  try { await tx('readwrite', s => s.put({ blob, at: Date.now(), bytes: blob.size }, key)); } catch { /* full or blocked */ }
}

export async function deletePhotos(keys) {
  try { await tx('readwrite', s => { for (const k of keys) s.delete(k); }); } catch { /* nothing */ }
}

/** Keep full images within maxBytes (oldest out), and drop entries of photos that no longer exist. */
export async function prunePhotos(maxBytes, liveIds = null) {
  try {
    const items = [];
    await tx('readonly', s => {
      const r = s.openCursor();
      r.onsuccess = () => {
        const c = r.result;
        if (!c) return;
        items.push({ key: c.key, at: c.value.at, bytes: c.value.bytes || 0 });
        c.continue();
      };
    });
    const drop = items.filter(x => liveIds && !liveIds.has(String(x.key).split(':')[0])).map(x => x.key);
    const full = items.filter(x => String(x.key).endsWith(':full') && !drop.includes(x.key)).sort((a, b) => b.at - a.at);
    let sum = 0;
    for (const x of full) { sum += x.bytes; if (sum > maxBytes) drop.push(x.key); }
    if (drop.length) await deletePhotos(drop);
    return drop.length;
  } catch { return 0; }
}
