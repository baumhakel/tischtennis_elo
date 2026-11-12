// The three versions of the league: Alle (all games, the default), Einzel (singles only),
// Doppel (doubles only). Each mode is its own Elo replay with independent ratings; every player
// keeps an individual rating in every mode (no team ratings). No DOM.
//
//   modelFor(model, 'einzel')   → { dataset, elo, stats, mode } for the singles-only league
//
// The pooled model is the one the pipeline computes and caches. The other two are built on first
// use from its dataset (~25 ms each for 2000 games) and memoised per pooled model, so a new sheet
// load (new model object) starts fresh.
import { compute } from '../core/elo.js';
import { createStats } from '../core/stats/index.js';

export const MODES = ['alle', 'einzel', 'doppel'];
export const MODE_LABELS = { alle: 'Alle', einzel: 'Einzel', doppel: 'Doppel' };

const cache = new WeakMap();   // pooled model → { einzel, doppel }

/** Dataset restricted to one mode: only its games, re-indexed; everything else shared. */
export function modeDataset(dataset, mode) {
  if (mode !== 'einzel' && mode !== 'doppel') return dataset;
  const keep = mode === 'doppel';
  const games = [];
  for (const x of dataset.games) if (x.double === keep) games.push({ ...x, g: games.length });
  return { ...dataset, games, hash: `${dataset.hash}|${mode}`, mode };
}

/** The model of `mode` ('alle' | 'einzel' | 'doppel'); 'alle' (or anything unknown) is the pooled model itself. */
export function modelFor(model, mode) {
  if (!model || (mode !== 'einzel' && mode !== 'doppel')) return model;
  let m = cache.get(model);
  if (!m) cache.set(model, (m = {}));
  if (!m[mode]) {
    const dataset = modeDataset(model.dataset, mode);
    const elo = compute(dataset);
    m[mode] = { dataset, elo, stats: createStats(dataset, elo, { now: model.stats.now }), mode };
  }
  return m[mode];
}
