// After entering something (Phase 17, generalised in Phase 18a). The app reads the sheet again and says whether
// the entry arrived. Three ways in:
//   opened()             a link to the Ergebnis form was tapped: check when the app is visible again
//   sent()               the app sent a result itself (io/forms.js): check after FIRST_MS and once more after RETRY_MS
//   manage(request, how) a Verwaltung action: how = 'opened' (pre-filled form in the browser, check on return)
//                        or 'sent' (demo: checked like sent()). Arrival = a new row in management_log for that action.
// A new game is marked briefly in Letzte Spiele and announced in a small notice. If nothing arrived:
// „Noch nicht angekommen“ with „Aktualisieren“. No DOM: main.js wires the events, ui/shell.js draws the notice.
//
//   state.notice = null | { kind: 'arrived', refs } | { kind: 'missing', text? } | { kind: 'checking', text? }
//                | { kind: 'done', text } | { kind: 'refused', text }   (Verwaltung)
//                | { kind: 'sent', text } | { kind: 'offline' }        (set by app/submit.js)
//   state.fresh  = null | [game_ref…]     games to mark in the lists, cleared after FRESH_MS
import { reasonText } from '../core/manage.js';

export const WAIT_MS = 30 * 60 * 1000;     // a form opened longer ago than this is forgotten
export const FRESH_MS = 8000;              // how long a new game (or a done notice) stays
export const FIRST_MS = 1500;              // sent from the app: first look at the sheet after this …
export const RETRY_MS = 4000;              // … and once more after this if it isn't there yet

/** Games in `games` whose game_ref was not in `before` (form entries only: Altdaten never arrive by form). */
export function arrivedGames(before, games) {
  return games.filter(g => g.source === 'spiele' && !before.has(g.ref));
}

/**
 * What a Verwaltung action did, from the log rows written since it was sent: { ok, text } or null (nothing yet).
 * request = { action, done } (done = the text for success, core/manage.js doneText).
 */
export function manageOutcome(request, newRows) {
  const row = newRows.filter(r => r.action === request.action).at(-1);
  if (!row) return null;
  return /^ok$/i.test(row.status) ? { ok: true, text: request.done } : { ok: false, text: `Nicht geändert: ${reasonText(row.status)}` };
}

/**
 * @param {{ store, refresh: () => Promise<boolean>, hasToken: () => boolean, clock?: () => number, later?: (fn, ms) => any }} o
 */
export function createAfterEntry({ store, refresh, hasToken, clock = Date.now, later = setTimeout }) {
  let pending = null;   // { at, before: Set<game_ref>, logLen, request? }

  function capture(request = null) {
    const ds = store.get().data.model?.dataset;
    if (!ds) return false;
    pending = { at: clock(), before: new Set(ds.games.map(g => g.ref)), logLen: (ds.log || []).length, request };
    return true;
  }

  const finish = (notice, fresh = null) => {
    pending = null;
    store.set({ notice, ...(fresh ? { fresh } : {}) });
    if (notice.kind === 'refused') return;   // a refusal stays until it is closed
    later(() => {
      const s = store.get();
      if (fresh && s.fresh === fresh) store.set({ fresh: null });
      if (s.notice === notice || (fresh && s.notice?.refs === fresh)) store.set({ notice: null });
    }, FRESH_MS);
  };

  /** Did it arrive? Announces it if so. final: say „missing“ if not. */
  function check(final = true) {
    if (!pending) { store.set({ notice: null }); return false; }
    const ds = store.get().data.model?.dataset;
    if (pending.request) {
      const out = ds ? manageOutcome(pending.request, (ds.log || []).slice(pending.logLen)) : null;
      if (out) { finish({ kind: out.ok ? 'done' : 'refused', text: out.text }); return true; }
      if (final) store.set({ notice: { kind: 'missing', text: 'Noch keine Änderung angekommen.' } });
      return false;
    }
    const fresh = arrivedGames(pending.before, ds?.games || []);
    if (fresh.length) {
      const refs = fresh.map(g => g.ref);
      finish({ kind: 'arrived', refs }, refs);
      return true;
    }
    if (final) store.set({ notice: { kind: 'missing' } });
    return false;
  }

  async function reload() {
    store.set({ notice: { kind: 'checking' } });
    await refresh();
    check();
  }

  /** Sent from the app: look after FIRST_MS, and once more after RETRY_MS. */
  function watchSent(text) {
    store.set({ notice: { kind: 'checking', text } });
    let tries = 0;
    const step = async () => {
      if (!pending) return;
      await refresh();
      if (!pending) return;
      if (!check(++tries >= 2) && tries < 2) later(step, RETRY_MS);
    };
    later(step, FIRST_MS);
  }

  return {
    get pending() { return pending; },
    /** A link to the Ergebnis form was tapped. */
    opened() {
      if (!capture()) return;
      if (store.get().notice?.kind === 'missing') store.set({ notice: null });
    },
    /** The app is about to send a result itself (call before sending: the games known now are the „before“). */
    sending() { return capture(); },
    /** The result was sent: check the sheet shortly. */
    sent() { if (pending) watchSent('Gesendet · wird geprüft …'); },
    /** Sending failed: forget it. */
    failed() { pending = null; },
    /** A Verwaltung action: 'opened' = pre-filled form in the browser (checked on return), 'sent' = sent by the app (demo). */
    manage(request, how = 'opened') {
      if (!capture(request)) return;
      if (how === 'sent') watchSent('Wird geprüft …');
      else if (store.get().notice?.kind === 'missing') store.set({ notice: null });
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
