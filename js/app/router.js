// Mounts the current view and keeps it updated. View contract:
//   { id, title, mount(el, ctx) → { update(ctx), unmount() } }
// The router only calls update() when something the view depends on changed.

import { VIEWS, viewById, loadView } from '../views/index.js';

/**
 * @param {Object} o
 * @param {ReturnType<import('./store.js').createStore>} o.store
 * @param {HTMLElement} o.el                      container for the view
 * @param {(state) => any} o.makeCtx              builds the view context (null while no data)
 * @param {(el: HTMLElement, state) => void} o.renderEmpty  shown while there is no data yet
 */
export function createRouter({ store, el, makeCtx, renderEmpty, renderEmptyWindow }) {
  let mounted = null;     // { id, instance }
  let token = 0;          // guards against out-of-order dynamic imports
  let last = {};

  async function sync(state) {
    const def = viewById(state.view) || VIEWS[0];
    const ctx = state.data.model ? makeCtx(state) : null;
    if (!ctx) {
      if (mounted) { mounted.instance.unmount?.(); mounted = null; }
      renderEmpty(el, state);
      last = {};
      return;
    }
    if (ctx.window?.empty && def.zeit) {   // Zeitraum without games: one message for every view that follows it
      if (mounted) { mounted.instance.unmount?.(); mounted = null; }
      ++token;
      renderEmptyWindow(el, def, ctx);
      last = {};
      document.title = `${def.title} – Tischtennis Elo`;
      return;
    }
    const deps = { model: state.data.model, filters: state.filters, params: state.params, me: state.me, email: state.auth.email, badges: state.data.badgesFor, forecast: state.data.forecastFor, lab: state.data.labFor, fresh: state.fresh, photos: state.photosRev };
    if (mounted && mounted.id === def.id) {
      if (deps.model !== last.model || deps.filters !== last.filters || deps.params !== last.params || deps.me !== last.me || deps.email !== last.email || deps.badges !== last.badges || deps.forecast !== last.forecast || deps.lab !== last.lab || deps.fresh !== last.fresh || deps.photos !== last.photos) {
        mounted.instance.update?.(ctx);
      }
      last = deps;
      return;
    }
    const my = ++token;
    if (mounted) { mounted.instance.unmount?.(); mounted = null; }
    el.replaceChildren();
    el.setAttribute('aria-busy', 'true');
    let view;
    try { view = await loadView(def); }
    catch (e) {
      if (my !== token) return;
      // Usually a file that couldn't be fetched, e.g. right after a new version went online (files of two
      // versions mixed, or one fetched while GitHub Pages was still publishing). The browser remembers a
      // failed module for the rest of the page's life, so only a reload helps: once by itself, then by a button
      // (an app on the iOS home screen has no reload button of its own).
      if (reloadOnce()) return;
      el.removeAttribute('aria-busy');
      const p = document.createElement('p');
      p.className = 'error';
      p.textContent = 'Diese Ansicht konnte nicht geladen werden. Meist hilft Neuladen, zum Beispiel wenn gerade eine neue Version veröffentlicht wurde. Hilft das nicht, bitte die Internetverbindung prüfen.';
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'secondary';
      again.textContent = 'Neu laden';
      again.addEventListener('click', () => location.reload());
      const detail = document.createElement('p');
      detail.className = 'muted small';
      detail.textContent = `Technisch: ${e?.message || e}`;
      el.replaceChildren(p, again, detail);
      return;
    }
    clearReloadOnce();
    if (my !== token) return;                       // a newer navigation won
    el.removeAttribute('aria-busy');
    const fresh = store.get();
    mounted = { id: def.id, instance: view.mount(el, makeCtx(fresh) || ctx) };
    last = { model: fresh.data.model, filters: fresh.filters, params: fresh.params, me: fresh.me, email: fresh.auth.email, badges: fresh.data.badgesFor, forecast: fresh.data.forecastFor, lab: fresh.data.labFor, fresh: fresh.fresh, photos: fresh.photosRev };
    document.title = `${def.title} – Tischtennis Elo`;
  }

  store.subscribe(s => { sync(s); });
  return { start: () => sync(store.get()) };
}

// A failed view load reloads the page once by itself; a second failure within a minute shows the message.
const RELOAD_KEY = 'tt-elo-view-reload';
function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 60000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch { return false; }
  location.reload();
  return true;
}
function clearReloadOnce() { try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* ignore */ } }
