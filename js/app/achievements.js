// Abzeichen for a loaded model, computed once per sheet load (memoised per pooled model).
// The first screen never waits for them: main.js calls scheduleAchievements() after the data is
// shown, and views read peekAchievements() (null until ready; the router re-renders when ready).
import { computeAchievements } from '../core/achievements.js';
import { modelFor } from './modes.js';

const cache = new WeakMap();   // pooled model → result

/** Computes (or returns the cached) Abzeichen of a pooled model. */
export function achievementsFor(base) {
  if (!base) return null;
  let r = cache.get(base);
  if (!r) {
    r = computeAchievements(base, { einzel: modelFor(base, 'einzel'), doppel: modelFor(base, 'doppel') }, base.stats.now);
    cache.set(base, r);
  }
  return r;
}

/** The result if it is already there, else null (never computes). */
export const peekAchievements = base => (base && cache.get(base)) || null;

/** Computes in the background (idle time), then calls done(base). Later calls for the same model are no-ops. */
export function scheduleAchievements(base, done) {
  if (!base || cache.has(base)) { if (base) done(base); return; }
  const run = () => { achievementsFor(base); done(base); };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1500 });
  else setTimeout(run, 50);
}
