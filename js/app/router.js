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
export function createRouter({ store, el, makeCtx, renderEmpty }) {
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
    const deps = { model: state.data.model, filters: state.filters, params: state.params };
    if (mounted && mounted.id === def.id) {
      if (deps.model !== last.model || deps.filters !== last.filters || deps.params !== last.params) {
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
      el.removeAttribute('aria-busy');
      const p = document.createElement('p');
      p.className = 'error';
      p.textContent = /uPlot|vendor/.test(String(e?.message)) || /Failed to fetch dynamically imported module/.test(String(e?.message))
        ? 'Diese Ansicht konnte nicht geladen werden: Eine Datei fehlt (vermutlich js/vendor/uPlot.esm.js oder css/uPlot.min.css).'
        : `Diese Ansicht konnte nicht geladen werden: ${e?.message || e}`;
      el.replaceChildren(p);
      return;
    }
    if (my !== token) return;                       // a newer navigation won
    el.removeAttribute('aria-busy');
    const fresh = store.get();
    mounted = { id: def.id, instance: view.mount(el, makeCtx(fresh) || ctx) };
    last = { model: fresh.data.model, filters: fresh.filters, params: fresh.params };
    document.title = `${def.title} – Tischtennis Elo`;
  }

  store.subscribe(s => { sync(s); });
  return { start: () => sync(store.get()) };
}
