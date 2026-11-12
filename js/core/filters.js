// Global display filters. Pure. Filters never change the computation, only who is shown.

/**
 * Effective filters: values set by the user (URL / controls) win, otherwise the config tab.
 * mode: 'alle' (default) | 'einzel' | 'doppel'; the min-games default depends on it
 * (default_min_games, default_min_games_single, default_min_games_double).
 * @param {{minGames:number|null, inactivityDays:number|null, xAxis:string|null, mode?:string|null}} filters
 * @param {import('../types.js').AppConfig} config
 */
export function resolveFilters(filters, config) {
  const mode = filters.mode === 'einzel' || filters.mode === 'doppel' ? filters.mode : 'alle';
  const minDefault = mode === 'einzel' ? config.default_min_games_single
    : mode === 'doppel' ? config.default_min_games_double : config.default_min_games;
  return {
    mode,
    minGames: filters.minGames ?? minDefault,
    inactivityDays: filters.inactivityDays ?? config.default_inactivity_days,
    xAxis: filters.xAxis ?? config.default_x_axis,
    focus: filters.focus ?? null,           // resolved against the data by resolveFocus()
  };
}

export const MAX_FOCUS = 8;   // = categorical palette size (design limit, not a setting)

/**
 * Highlighted players → colour slots. Explicit focus (URL) wins; otherwise the top
 * `focus_default_count` shown players by current rating. Players not shown (hidden by the
 * filters) are skipped but keep their slot, so the others never change colour.
 * @returns {{ slots: (number|null)[], slotOf: Map<number, number>, explicit: boolean }}
 *   slots[i] = player k in colour slot i (0-based) or null; slotOf: k → slot
 */
export function resolveFocus(f, elo, vis, config, meId = null) {
  let ids;
  const explicit = Array.isArray(f.focus);
  if (explicit) ids = f.focus.slice(0, MAX_FOCUS);
  else {
    ids = [...vis.shown].sort((a, b) => elo.final[b] - elo.final[a])
      .slice(0, Math.min(MAX_FOCUS, config.focus_default_count)).map(k => elo.ids[k]);
    // „Ich“ always gets slot 1 (unless highlighting was set explicitly); the best players follow
    if (meId && elo.index.has(meId)) ids = [meId, ...ids.filter(id => id !== meId)].slice(0, MAX_FOCUS);
  }
  const slots = ids.map(id => {
    const k = id == null ? undefined : elo.index.get(id);
    return k !== undefined && vis.isShown(k) ? k : null;
  });
  const slotOf = new Map();
  slots.forEach((k, i) => { if (k != null) slotOf.set(k, i); });
  return { slots, slotOf, explicit, ids };
}

/** New focus list after toggling player id (adds into the first free slot; removal leaves a hole). */
export function toggleFocus(ids, id) {
  const list = (ids || []).slice();
  const i = list.indexOf(id);
  if (i >= 0) list[i] = null;
  else {
    const free = list.indexOf(null);
    if (free >= 0) list[free] = id;
    else if (list.length < MAX_FOCUS) list.push(id);
    else return list;                       // all slots taken
  }
  while (list.length && list[list.length - 1] == null) list.pop();
  return list;
}

/**
 * Which players (by k) are shown where.
 *   inactive     no game in the last `inactivityDays` days (0 = filter off) → hidden everywhere
 *   provisional  fewer than `minGames` games → listed in tables (marked), hidden in graphs and
 *                matrices, not eligible for records or highlights
 *   listed       for tables: not inactive, in elo.ids order
 *   shown        for graphs / matrices / records: listed and not provisional
 * @returns {{ listed: number[], shown: number[], provisional: Set<number>, inactive: Set<number>, isShown: (k:number)=>boolean }}
 */
export function visible(dataset, elo, f, now) {
  const inactive = new Set(), provisional = new Set(), listed = [], shown = [];
  for (let k = 0; k < elo.ids.length; k++) {
    const lastT = dataset.games[elo.lastG[k]].t;
    if (f.inactivityDays > 0 && lastT < now - f.inactivityDays) { inactive.add(k); continue; }
    listed.push(k);
    if (elo.played[k] < f.minGames) provisional.add(k);
    else shown.push(k);
  }
  const shownSet = new Set(shown);
  return { listed, shown, provisional, inactive, isShown: k => shownSet.has(k) };
}
