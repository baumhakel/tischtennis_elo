// Stats registry: lazy, memoised access to every derived quantity. Pure.
//
//   const stats = createStats(dataset, elo, { now });
//   stats.get('form')                    // parameters default to the config tab
//   stats.get('recent', { days: 30 })    // or are overridden per call
//
// Each stat is { name, defaults(config) → params, compute(ctx, params) → result } with
// ctx = { dataset, elo, now, times, get }. `get` lets a stat build on another one.
// Results are memoised per (name, params); they must be treated as read-only.

import { form, recent, risingStar, leaderboard } from './form.js';
import { bestRuns } from './runs.js';
import { smoothing } from './smoothing.js';
import { matrices, partners } from './matrices.js';
import { movement, upsets, calibration } from './league.js';
import { ranks, records } from './records.js';
import { activity } from './activity.js';

const STATS = [
  form, recent, risingStar, leaderboard, bestRuns, smoothing,
  matrices, partners, movement, upsets, calibration, ranks, records, activity,
];
export const REGISTRY = new Map(STATS.map(s => [s.name, s]));

/**
 * @param {import('../../types.js').Dataset} dataset
 * @param {import('../../types.js').EloResult} elo
 * @param {{ now?: number }} [opts]  now = sheet serial of "now" (nowSerial(SHEET_TIMEZONE));
 *                                   defaults to the last game's time, which keeps tests deterministic
 */
export function createStats(dataset, elo, opts = {}) {
  const times = Float64Array.from(dataset.games, g => g.t);
  const now = opts.now ?? (times.length ? times[times.length - 1] : 0);
  const memo = new Map();
  const ctx = { dataset, elo, now, times, get };

  function get(name, params = {}) {
    const stat = REGISTRY.get(name);
    if (!stat) throw new Error(`Unknown stat "${name}"`);
    const p = { ...stat.defaults(dataset.config), ...params };
    const key = name + JSON.stringify(Object.keys(p).sort().map(k => [k, p[k]]));
    if (!memo.has(key)) memo.set(key, stat.compute(ctx, p));
    return memo.get(key);
  }

  return { get, now, names: [...REGISTRY.keys()] };
}
