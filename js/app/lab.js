// Labor for a mode model. The observed statistics are cheap and computed on first use (memoised
// per model); the bootstrap null runs in the Web Worker, only once the Labor page is opened
// (main.js calls scheduleLab and marks the store with data.labFor, so the router re-renders).
import { labSchedule, measure, summarize, timedGroups } from '../core/lab.js';
import { runInBackground, whenIdle } from './background.js';

const memo = new WeakMap();      // mode model → { S, obs, timed, nul, state }

function entry(model) {
  let e = memo.get(model);
  if (!e) {
    const cfg = model.dataset.config;
    const S = labSchedule(model, { streak: cfg.lab_hot_hand_streak, minH: cfg.h2h_min_games });
    const obs = measure(S, new Uint8Array(S.N).fill(1), S.eW, { lists: true });
    const timed = timedGroups(model, { gapMinutes: cfg.session_gap_minutes, minSamples: cfg.lab_min_samples });
    e = { S, obs, timed, nul: null, state: 'idle' };
    memo.set(model, e);
  }
  return e;
}

/** { summary, timed, state: 'idle' | 'running' | 'ready' | 'failed' } — the null part fills in later. */
export function labFor(model) {
  const e = entry(model), cfg = model.dataset.config;
  return { summary: summarize(e.obs, e.nul, cfg.lab_min_samples), timed: e.timed, state: e.state, sims: cfg.lab_null_simulations };
}

/** Which timed analyses have enough form entries (≥ 2 qualifying groups or cells; Revanche: 1). */
export function timedReady(timed, minSamples) {
  return timed.filter(a => (a.perPlayer
    ? a.cells.rows.length >= 2
    : a.groups.filter(g => g.n >= minSamples).length >= (a.key === 'sessionRevenge' ? 1 : 2)));
}

/** Does the Labor have anything to show for this model (Entdecken lists it only then)? */
export function labAvailable(model, shownPlayers) {
  if (!model || model.dataset.games.length === 0) return false;
  const { summary: s, timed } = labFor(model), min = model.dataset.config.lab_min_samples;
  return s.hot.enough || s.cold.enough || s.revenge.enough || s.cycles.enough
    || timedReady(timed, min).length > 0 || shownPlayers >= 3;
}

/** Starts the bootstrap null for `model` once; onUpdate(marker) when it is done. */
export function scheduleLab(model, onUpdate) {
  const e = entry(model);
  if (e.state !== 'idle') return;
  e.state = 'running';
  const key = `${model.dataset.hash}|${model.mode || 'alle'}`;
  whenIdle(() => runInBackground('lab', { S: e.S, nSims: model.dataset.config.lab_null_simulations, key }, out => {
    e.nul = out; e.state = out ? 'ready' : 'failed';
    onUpdate(`${key}#${e.state}`);
  }));
}
