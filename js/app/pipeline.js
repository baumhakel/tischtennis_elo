// Stale-while-revalidate: show the cached snapshot at once, then read the sheet and update.
// No DOM. All side effects come in through the injected dependencies, so it is testable in Node.

import { APP_VERSION } from '../config.js';
import { load } from '../core/loader.js';
import { compute } from '../core/elo.js';
import { createStats } from '../core/stats/index.js';

/**
 * @param {Object} deps
 * @param {ReturnType<import('./store.js').createStore>} deps.store
 * @param {{ getToken(): string|null, expire(): void }} deps.auth
 * @param {(token: string) => Promise<import('../types.js').RawSheets>} deps.fetchRaw
 * @param {{ load(): Promise<any>, save(entry): Promise<boolean> }} deps.cache
 * @param {() => number} deps.now      sheet serial of the current time
 * @param {() => number} [deps.clock]  ms since epoch (Date.now)
 */
export function createPipeline({ store, auth, fetchRaw, cache, now, clock = Date.now }) {
  let running = null;
  let lastFetch = 0;

  const model = (dataset, elo) => ({ dataset, elo, stats: createStats(dataset, elo, { now: now() }) });
  const setData = patch => store.set({ data: patch });

  return {
    /** Show the cache, then refresh from the sheet if a token is available. */
    async boot() {
      const entry = await cache.load();
      if (entry?.raw) {
        try {
          const m = entry.stamp === APP_VERSION && entry.dataset && entry.elo
            ? model(entry.dataset, entry.elo)
            : (() => { const d = load(entry.raw); return model(d, compute(d)); })();   // older app version
          setData({ model: m, source: 'cache', updatedAt: entry.savedAt });
        } catch { /* unreadable cache: ignore, the sheet read below replaces it */ }
      }
      return this.refresh();
    },

    /** Read the sheet and recompute if anything changed. Safe to call repeatedly. */
    refresh() {
      if (running) return running;
      const token = auth.getToken();
      if (!token) { setData({ needsSignIn: true, loading: false }); return Promise.resolve(false); }
      setData({ loading: true, error: null, needsSignIn: false });
      running = (async () => {
        try {
          const raw = await fetchRaw(token);
          const dataset = load(raw);
          const current = store.get().data.model;
          const savedAt = clock();
          lastFetch = savedAt;
          if (current && current.dataset.hash === dataset.hash && store.get().data.source) {
            // same data: keep the computed model (and the views' state), just refresh the stamp
            setData({ source: 'sheet', updatedAt: savedAt, loading: false });
            cache.save({ stamp: APP_VERSION, hash: dataset.hash, raw, dataset: current.dataset, elo: current.elo, savedAt });
            return true;
          }
          const elo = compute(dataset);
          setData({ model: model(dataset, elo), source: 'sheet', updatedAt: savedAt, loading: false });
          cache.save({ stamp: APP_VERSION, hash: dataset.hash, raw, dataset, elo, savedAt });
          return true;
        } catch (e) {
          if (e?.kind === 'auth') { auth.expire(); setData({ loading: false, needsSignIn: true }); }
          else setData({ loading: false, error: e?.message || String(e) });
          return false;
        } finally {
          running = null;
        }
      })();
      return running;
    },

    /** Refresh if the last sheet read is older than `seconds` (0 = never automatically). */
    refreshIfStale(seconds) {
      if (seconds > 0 && clock() - lastFetch > seconds * 1000) return this.refresh();
      return Promise.resolve(false);
    },
  };
}
