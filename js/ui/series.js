// Chart data builders: model → aligned arrays for uPlot. Pure (no DOM), so testable in Node.
// uPlot wants one shared x array and one y array per series, with null (never NaN) for gaps.
//
// x-axes:  'game' → global game number (1-based)   'date' → seconds (wall-clock, read as UTC)
//          'own'  → the player's own game number
import { ratingsAfter } from '../core/elo.js';
import { serialToParts, serialFromParts } from '../core/normalize.js';
import { firstGE } from '../core/stats/util.js';

const SERIAL_UNIX_DAYS = 25569;                     // serial of 1970-01-01
export const toSeconds = serial => Math.round((serial - SERIAL_UNIX_DAYS) * 86400);
export const fromSeconds = s => s / 86400 + SERIAL_UNIX_DAYS;
const nul = v => (Number.isFinite(v) ? v : null);

/** First game index of the dashboard window: last `dashboard_days` days or last `dashboard_games` games, whichever covers more. */
export function recentStart(model) {
  const N = model.dataset.games.length;
  const { dashboard_days, dashboard_games } = model.dataset.config;
  const byDays = model.stats.get('recent', { days: dashboard_days }).firstGame;
  return Math.max(0, Math.min(byDays, N - dashboard_games));
}

/** Time ranges of the Verlauf view. 'aktuell' is the dashboard window. */
export const RANGES = ['heute', 'aktuell', 'monat', 'jahr', 'insgesamt'];

/**
 * First game index of a time range, relative to `now` (sheet serial).
 * heute = since 00:00 today; monat / jahr = since the same calendar day one month / year ago.
 * @returns {number} startG (= games.length if the range holds no game)
 */
export function rangeStart(model, range, now) {
  const games = model.dataset.games;
  if (range === 'aktuell') return recentStart(model);
  if (range === 'insgesamt' || !games.length) return 0;
  const p = serialToParts(now);
  let from;
  if (range === 'heute') from = Math.floor(now);
  else {
    const y = range === 'jahr' ? p.y - 1 : p.mo === 1 ? p.y - 1 : p.y;
    const mo = range === 'jahr' ? p.mo : p.mo === 1 ? 12 : p.mo - 1;
    const last = serialToParts(serialFromParts(mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1, 1) - 1).d;   // days in that month
    from = serialFromParts(y, mo, Math.min(p.d, last), p.h, p.mi, p.s);
  }
  let lo = 0, hi = games.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (games[mid].t < from) lo = mid + 1; else hi = mid; }
  return lo;
}

/**
 * Rating curves (step functions) for players ks.
 * game/date: one x per global game from startG on (plus the state just before the window);
 * own: x = 1 … longest own-game count, whole history (startG ignored).
 * @returns {{ x: number[], ys: (number|null)[][] }}  ys[i] belongs to ks[i]
 */
export function ratingSeries(model, ks, axis, startG = 0) {
  const { elo } = model;
  if (axis === 'own') {
    // own game numbers stay absolute (the 120th game is game 120); only games in the range are drawn
    const j0 = ks.map(k => firstGE(elo.history[k].g, startG));
    const from = Math.min(Infinity, ...ks.map((k, i) => (j0[i] < elo.history[k].g.length ? j0[i] : Infinity)));
    const len = Math.max(0, ...ks.map(k => elo.history[k].r.length));
    if (!Number.isFinite(from)) return { x: [], ys: ks.map(() => []) };
    const x = Array.from({ length: len - from }, (_, j) => from + j + 1);
    return { x, ys: ks.map((k, i) => x.map(v => (v - 1 >= j0[i] ? nul(elo.history[k].r[v - 1]) : null))) };
  }
  const games = model.dataset.games;
  const N = games.length;
  const r = startG > 0 ? ratingsAfter(elo, startG - 1) : new Float64Array(elo.ids.length).fill(NaN);
  const x = [], ys = ks.map(() => []);
  const xOf = g => (axis === 'date' ? toSeconds(games[g].t) : g + 1);
  if (startG > 0) {                                     // the state entering the window
    x.push(axis === 'date' ? toSeconds(games[startG - 1].t) : startG);
    ks.forEach((k, i) => ys[i].push(nul(r[k])));
  }
  for (let g = startG; g < N; g++) {
    const d = elo.perGame.delta[g];
    for (let s = 0; s < 4; s++) {
      const k = elo.slots[4 * g + s];
      if (k !== -1) r[k] = elo.perGame.before[4 * g + s] + (s < 2 ? d : -d);
    }
    x.push(xOf(g));
    ks.forEach((k, i) => ys[i].push(nul(r[k])));
  }
  return { x, ys };
}

/**
 * Smoothed curves + band for players ks, from the 'smoothing' stat. Each player has values only
 * at their own games; the other x positions are null (draw with spanGaps).
 * @returns {{ x: number[], mean: (number|null)[][], lo: (number|null)[][], hi: (number|null)[][] }}
 */
export function smoothSeries(model, ks, axis, startG = 0) {
  const sm = model.stats.get('smoothing', { axis });
  const keep = (k, j) => model.elo.history[k].g[j] >= startG;   // smoothing uses all games; the range only clips
  const conv = axis === 'date' ? toSeconds : axis === 'game' ? v => v + 1 : v => v;
  const xs = new Set();
  for (const k of ks) sm[k].x.forEach((v, j) => { if (keep(k, j)) xs.add(conv(v)); });
  const x = [...xs].sort((a, b) => a - b);
  const pos = new Map(x.map((v, i) => [v, i]));
  const mk = () => ks.map(() => new Array(x.length).fill(null));
  const mean = mk(), lo = mk(), hi = mk();
  ks.forEach((k, i) => {
    const s = sm[k];
    for (let j = 0; j < s.x.length; j++) {
      if (!keep(k, j)) continue;
      const p = pos.get(conv(s.x[j]));
      mean[i][p] = nul(s.mean[j]); lo[i][p] = nul(s.mean[j] - s.sd[j]); hi[i][p] = nul(s.mean[j] + s.sd[j]);
    }
  });
  return { x, mean, lo, hi };
}

/** Rank after every game for players ks (null = not ranked yet). axis 'own' is treated as 'game'. */
export function rankSeries(model, ks, axis, minGames) {
  const rk = model.stats.get('ranks', { minGames });
  const n = model.elo.ids.length, games = model.dataset.games;
  const x = games.map((g, i) => (axis === 'date' ? toSeconds(g.t) : i + 1));
  const ys = ks.map(k => games.map((_, g) => rk.rank[g * n + k] || null));
  let maxRank = 1;
  for (const y of ys) for (const v of y) if (v > maxRank) maxRank = v;
  return { x, ys, maxRank };
}

/** League Elo movement (rolling) + its calm/turbulent thresholds. axis 'own' → 'game'. */
export function movementSeries(model, axis) {
  const mv = model.stats.get('movement');
  const games = model.dataset.games;
  const x = games.map((g, i) => (axis === 'date' ? toSeconds(g.t) : i + 1));
  return {
    x,
    rolling: Array.from(mv.rolling, nul),
    calm: x.map(() => nul(mv.calmAt)),
    turbulent: x.map(() => nul(mv.turbulentAt)),
    mv,
  };
}
