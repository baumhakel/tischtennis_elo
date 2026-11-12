// Pure helpers for game lists and the game page (no DOM).
//
// Games are referenced by game_ref ("yyyy-mm-dd hh:mm:ss"), never by position: positions differ
// between the pooled data and the singles/doubles subsets.
//
// Filters of the Alle Spiele view (all optional, all strings as in the URL):
//   spieler   player ID; with gegner / partner relative to this player
//   gegner    player ID on the other side      partner  player ID on the same side
//   art       'einzel' | 'doppel'
//   von, bis  game_ref or date (yyyy-mm-dd), inclusive
//   quelle    'altdaten' | 'formular'           korrigiert  '1' = only games with a swapped result
//   chance    'lo-hi' (0…1): pre-game win chance in [lo, hi) (hi = 1 inclusive) — of the player's
//             side when spieler is set, otherwise of either side
//   letzte    N: only the last N games that pass the other filters
//   sortierung 'neu' (default) | 'alt' | 'elo' (largest Elo change first)

const refIndexCache = new WeakMap();

/** game_ref → first global index with that ref. */
export function refIndex(dataset) {
  let m = refIndexCache.get(dataset);
  if (!m) {
    m = new Map();
    dataset.games.forEach((g, i) => { if (!m.has(g.ref)) m.set(g.ref, i); });
    refIndexCache.set(dataset, m);
  }
  return m;
}

/** Global index of a game_ref, or -1. */
export function findGame(dataset, ref) {
  const i = ref ? refIndex(dataset).get(ref) : undefined;
  return i === undefined ? -1 : i;
}

/** How many games share this game's ref (normally 1). */
export function sameRefCount(dataset, g) {
  const ref = dataset.games[g].ref;
  let n = 0;
  for (let i = refIndex(dataset).get(ref); i < dataset.games.length && dataset.games[i].ref === ref; i++) n++;
  return n;
}

/**
 * Is a side's pre-game win chance in the range [lo, hi)? Same convention as the calibration bins:
 * the winning side (chance eW) counts if lo ≤ eW < hi (hi = 1 inclusive); the losing side
 * (chance 1 − eW) is the mirror image, so it counts if 1 − hi ≤ eW < 1 − lo. A game at exactly
 * 50 % thus puts the winner in 50–60 % and the loser in 40–50 %.
 */
export function sideInRange(eW, winner, lo, hi) {
  if (winner) return eW >= lo && (eW < hi || hi >= 1);
  return eW >= 1 - hi && (eW < 1 - lo || lo <= 0);
}

export const SORTS = ['neu', 'alt', 'elo'];
const FILTER_KEYS = ['spieler', 'gegner', 'partner', 'art', 'von', 'bis', 'quelle', 'korrigiert', 'chance', 'letzte'];

/** Clean filter object from view params; unknown or invalid values are dropped. */
export function parseFilter(params, model) {
  const ids = model.elo.index;
  const f = {};
  const id = v => (v && ids.has(v) ? v : null);
  f.spieler = id(params.spieler);
  f.gegner = f.spieler && id(params.gegner) !== f.spieler ? id(params.gegner) : null;
  f.partner = f.spieler && ![f.spieler, f.gegner].includes(id(params.partner)) ? id(params.partner) : null;
  f.art = ['einzel', 'doppel'].includes(params.art) ? params.art : null;
  if (f.partner) f.art = 'doppel';
  const day = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(v) ? v : null);
  f.von = day(params.von);
  f.bis = day(params.bis);
  f.quelle = ['altdaten', 'formular'].includes(params.quelle) ? params.quelle : null;
  f.korrigiert = params.korrigiert === '1' ? '1' : null;
  const m = /^(\d*\.?\d+)-(\d*\.?\d+)$/.exec(params.chance || '');
  f.chance = m && Number(m[1]) < Number(m[2]) && Number(m[1]) >= 0 && Number(m[2]) <= 1 ? [Number(m[1]), Number(m[2])] : null;
  const n = Number(params.letzte);
  f.letzte = Number.isInteger(n) && n > 0 ? n : null;
  f.sortierung = SORTS.includes(params.sortierung) ? params.sortierung : 'neu';
  return f;
}

/** Filter object back to view params (null = absent). */
export function filterParams(f) {
  const p = {};
  for (const k of FILTER_KEYS) p[k] = f[k] == null ? null : k === 'chance' ? `${f.chance[0]}-${f.chance[1]}` : String(f[k]);
  p.sortierung = f.sortierung && f.sortierung !== 'neu' ? f.sortierung : null;
  return p;
}

/** True if any filter (other than the sort order) is set. */
export const hasFilter = f => FILTER_KEYS.some(k => f[k] != null);

/** Side of player id in game x: 'w', 'l' or null. */
export function sideOf(x, id) {
  return x.winners.includes(id) ? 'w' : x.losers.includes(id) ? 'l' : null;
}

/**
 * Global indices of the games passing filter f, in the requested order.
 * @returns {number[]}
 */
export function queryGames(model, f) {
  const { games } = model.dataset;
  const eW = model.elo.perGame.eW;
  const after = (ref, lim) => (lim.length === 10 ? ref.slice(0, 10) >= lim : ref >= lim);
  const before = (ref, lim) => (lim.length === 10 ? ref.slice(0, 10) <= lim : ref <= lim);
  let out = [];
  for (let i = 0; i < games.length; i++) {
    const x = games[i];
    if (f.art && (f.art === 'doppel') !== x.double) continue;
    let s = null;
    if (f.spieler) {
      s = sideOf(x, f.spieler);
      if (!s) continue;
      const mine = s === 'w' ? x.winners : x.losers, theirs = s === 'w' ? x.losers : x.winners;
      if (f.partner && !mine.includes(f.partner)) continue;
      if (f.gegner && !theirs.includes(f.gegner)) continue;
    }
    if (f.von && !after(x.ref, f.von)) continue;
    if (f.bis && !before(x.ref, f.bis)) continue;
    if (f.quelle && (f.quelle === 'altdaten') !== (x.source === 'legacy')) continue;
    if (f.korrigiert && !x.corrected) continue;
    if (f.chance) {
      const [lo, hi] = f.chance;
      const ok = s ? sideInRange(eW[i], s === 'w', lo, hi) : sideInRange(eW[i], true, lo, hi) || sideInRange(eW[i], false, lo, hi);
      if (!ok) continue;
    }
    out.push(i);
  }
  if (f.letzte) out = out.slice(-f.letzte);
  if (f.sortierung === 'neu') out.reverse();
  else if (f.sortierung === 'elo') {
    const d = model.elo.perGame.delta;
    out.sort((a, b) => d[b] - d[a] || b - a);
  }
  return out;
}

/** The last n games (newest first), optionally only those of player id. */
export function lastGames(model, n, id = null) {
  const { games } = model.dataset;
  const out = [];
  for (let i = games.length - 1; i >= 0 && out.length < n; i--) {
    if (!id || sideOf(games[i], id)) out.push(i);
  }
  return out;
}

/**
 * Everything the game page and the game rows show about game g.
 * players: per participant { id, side 'w'|'l', before, after, delta }.
 * With `as` (a player ID in the game): won, own delta and own win chance from that player's view.
 */
export function gameFacts(model, g, as = null) {
  const x = model.dataset.games[g];
  const { perGame, slots, ids } = model.elo;
  const delta = perGame.delta[g], eW = perGame.eW[g];
  const players = [];
  for (let s = 0; s < 4; s++) {
    const k = slots[4 * g + s];
    if (k < 0) continue;
    const win = s < 2;
    const before = perGame.before[4 * g + s];
    players.push({ id: ids[k], k, side: win ? 'w' : 'l', before, after: before + (win ? delta : -delta), delta: win ? delta : -delta });
  }
  const out = { g, game: x, double: x.double, delta, eW, rW: perGame.rW[g], rL: perGame.rL[g], players };
  if (as) {
    const s = sideOf(x, as);
    if (s) {
      out.as = as;
      out.won = s === 'w';
      out.ownDelta = out.won ? delta : -delta;
      out.ownChance = out.won ? eW : 1 - eW;
      out.partners = (out.won ? x.winners : x.losers).filter(id => id !== as);
      out.opponents = out.won ? x.losers : x.winners;
    }
  }
  return out;
}
