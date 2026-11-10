// IndexedDB snapshot of the last load: raw tabs + computed results. Side effect: storage.
// Every failure (private mode, quota, old browser) degrades to "no cache"; it never throws.

import { STORAGE_PREFIX } from '../config.js';

const STORE = 'snapshots';
const KEY = 'latest';

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
    const req = indexedDB.open(STORAGE_PREFIX, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req?.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
  }));
}

/**
 * @typedef {Object} CacheEntry
 * @property {string} stamp   APP_VERSION that computed `dataset` and `elo`
 * @property {string} hash    Dataset.hash
 * @property {import('../types.js').RawSheets} raw
 * @property {import('../types.js').Dataset} dataset
 * @property {import('../types.js').EloResult} elo
 * @property {number} savedAt  ms since epoch of the sheet read
 */

/** @returns {Promise<CacheEntry|null>} */
export async function loadCache() {
  try { return (await run('readonly', s => s.get(KEY))) || null; } catch { return null; }
}

/** @param {CacheEntry} entry @returns {Promise<boolean>} */
export async function saveCache(entry) {
  try { await run('readwrite', s => s.put(entry, KEY)); return true; } catch { return false; }
}

export async function clearCache() {
  try { await run('readwrite', s => s.delete(KEY)); } catch { /* nothing to clear */ }
}
