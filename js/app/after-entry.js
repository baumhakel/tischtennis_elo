// After entering a result (Phase 17): when the app opened the Ergebnis form (menu or Tisch) and comes back to
// the foreground, it reads the sheet right away, independent of auto_refresh_seconds. A new game is marked
// briefly in Letzte Spiele and announced in a small notice. If nothing arrived: „Noch nicht angekommen“
// with „Aktualisieren“. No DOM: main.js wires the events, ui/shell.js draws the notice.
//
//   state.notice = null | { kind: 'arrived', refs: [game_ref…] } | { kind: 'missing' } | { kind: 'checking' }
//   state.fresh  = null | [game_ref…]     games to mark in the lists, cleared after FRESH_MS

export const WAIT_MS = 30 * 60 * 1000;     // a form opened longer ago than this is forgotten
export const FRESH_MS = 8000;              // how long a new game stays marked

/** Games in `games` whose game_ref was not in `before` (form entries only: Altdaten never arrive by form). */
export function arrivedGames(before, games) {
  return games.filter(g => g.source === 'spiele' && !before.has(g.ref));
}

/**
 * @param {{ store, refresh: () => Promise<boolean>, hasToken: () => boolean, clock?: () => number, later?: (fn, ms) => any }} o
 */
export function createAfterEntry({ store, refresh, hasToken, clock = Date.now, later = setTimeout }) {
  let pending = null;   // { at, before: Set<game_ref> }

  function check() {
    const games = store.get().data.model?.dataset.games || [];
    const fresh = pending ? arrivedGames(pending.before, games) : [];
    if (fresh.length) {
      const refs = fresh.map(g => g.ref);
      pending = null;
      store.set({ notice: { kind: 'arrived', refs }, fresh: refs });
      later(() => {
        const s = store.get();
        if (s.fresh === refs) store.set({ fresh: null });
        if (s.notice?.refs === refs) store.set({ notice: null });
      }, FRESH_MS);
    } else {
      store.set({ notice: pending ? { kind: 'missing' } : null });
    }
  }

  async function reload() {
    store.set({ notice: { kind: 'checking' } });
    await refresh();
    check();
  }

  return {
    get pending() { return pending; },
    /** A link to the Ergebnis form was tapped. */
    opened() {
      const model = store.get().data.model;
      if (!model) return;
      pending = { at: clock(), before: new Set(model.dataset.games.map(g => g.ref)) };
      if (store.get().notice?.kind === 'missing') store.set({ notice: null });
    },
    /** The app is visible again. Returns true when it took care of the refresh (so the usual one can skip). */
    onVisible() {
      if (!pending) return false;
      if (clock() - pending.at > WAIT_MS) { pending = null; store.set({ notice: null }); return false; }
      if (!hasToken()) return false;
      reload();
      return true;
    },
    /** „Aktualisieren“ in the notice. */
    retry() { if (pending) reload(); },
    dismiss() { pending = null; store.set({ notice: null }); },
  };
}
