// The single app state object. No DOM.
//
// state = {
//   view:    'dashboard' | …                       current view id
//   params:  { [key]: string }                     view-specific, e.g. { metric: 'wins' }
//   filters: { mode, minGames, inactivityDays, xAxis, focus }   null = default (mode: Alle; others: config tab)
//            focus = player IDs by colour slot (null = empty slot), at most 8
//   data:    { model, source: null|'cache'|'sheet', updatedAt, loading, error, needsSignIn }
//   auth:    { ready, signedIn, email, expiresAt }
//   me:      { choice, id, snoozeUntil, seen }      „Ich“ on this device (app/me.js); replaced as a whole
// }
// model = { dataset, elo, stats } once loaded.

export function initialState() {
  return {
    view: 'dashboard',
    params: {},
    filters: { mode: null, minGames: null, inactivityDays: null, xAxis: null, focus: null },
    data: { model: null, source: null, updatedAt: 0, loading: false, error: null, needsSignIn: false },
    auth: { ready: false, signedIn: false, email: null, expiresAt: 0 },
    me: { choice: null, id: null, snoozeUntil: 0, seen: {} },
  };
}

/**
 * @param {ReturnType<typeof initialState>} state
 * @returns {{ get(): any, set(patch: object | ((s) => object)): void, subscribe(fn: (s, prev) => void): () => void }}
 *   set() merges one level deep for the object-valued keys (params, filters, data, auth),
 *   so set({ data: { loading: true } }) keeps the model. To replace params entirely, pass
 *   { params: …, replaceParams: true }.
 */
export function createStore(state = initialState()) {
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      const prev = state;
      const next = { ...state };
      for (const [k, v] of Object.entries(p)) {
        if (k === 'replaceParams') continue;
        const merge = v && typeof v === 'object' && !Array.isArray(v) && ['filters', 'data', 'auth'].includes(k)
          || (k === 'params' && !p.replaceParams);
        next[k] = merge ? { ...state[k], ...v } : v;
      }
      state = next;
      subs.forEach(fn => fn(state, prev));
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}
