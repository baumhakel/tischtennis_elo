// Prognose for the current mode model, once per sheet load, mode and day. No DOM.
// The simulation runs in the Web Worker (app/background.js); where workers are not available it
// runs on the main thread in idle time. Views read peekForecast() (null until the first part is
// ready); main.js calls scheduleForecast() and marks the store, so the router re-renders.
//
//   result: { key, t, end, input, res, spot, bt }   bt: undefined = still running, null = too little history
import { forecastInput, backtestInputs, seedFrom } from '../core/forecast.js';
import { runInBackground, whenIdle } from './background.js';

const cache = new Map();          // key → result (only the current data is kept)

export const forecastKey = model => `${model.dataset.hash}|${model.mode || 'alle'}|${Math.floor(model.stats.now)}`;

/** The result if (partly) there, else null. Never computes. */
export function peekForecast(model) {
  const e = model && cache.get(forecastKey(model));
  return e && e.res ? e : null;
}

/**
 * Starts the Prognose for `model` (a mode model, never a window). onUpdate(marker) is called after
 * each part (main result, then the backtest). Later calls for the same key are no-ops.
 */
export function scheduleForecast(model, onUpdate) {
  if (!model || !model.dataset.games.length) return;
  const key = forecastKey(model);
  if (cache.has(key)) return;
  for (const k of cache.keys()) if (!k.startsWith(model.dataset.hash.split('|')[0])) cache.delete(k);   // old data
  const entry = { key, t: model.stats.now, end: null, input: null, res: null, spot: null, bt: undefined };
  cache.set(key, entry);
  whenIdle(() => startJobs(model, key, entry, onUpdate));   // after the first screen
}

function startJobs(model, key, entry, onUpdate) {
  const cfg = model.dataset.config, mode = model.mode || 'alle', t = model.stats.now;
  const seed = seedFrom(key);
  const I = forecastInput(model, mode, t);
  entry.input = I; entry.end = I.end;
  runInBackground('forecast-main', { I, n: cfg.forecast_simulations, quick: cfg.forecast_quick_simulations, seed }, out => {
    if (!out) { cache.delete(key); return; }
    entry.res = out.res; entry.spot = out.spot;
    onUpdate(`${key}#main`);
    const items = backtestInputs(model, mode, t);
    runInBackground('forecast-backtest', { items, quick: cfg.forecast_quick_simulations, seed: seed + 7, bins: cfg.calibration_bins }, o => {
      entry.bt = o ? o.bt : null;
      onUpdate(`${key}#bt`);
    });
  });
}
