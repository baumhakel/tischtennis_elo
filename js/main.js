// Boot: wires the modules together. The only file that knows about all of them.
import { CLIENT_ID, SPREADSHEET_ID, SHEET_TIMEZONE } from './config.js';
import { nowSerial, clean } from './core/normalize.js';
import { resolveFilters, visible, resolveFocus } from './core/filters.js';
import { createAuth } from './io/auth.js';
import { batchGet } from './io/sheets.js';
import { loadCache, saveCache, clearCache } from './io/cache.js';
import { demoRaw, demoAuth } from './io/demo.js';
import { createStore, initialState } from './app/store.js';
import { parseHash, formatHash } from './app/url.js';
import { createPipeline } from './app/pipeline.js';
import { createRouter } from './app/router.js';
import { createShell } from './ui/shell.js';
import { modelFor } from './app/modes.js';

const demoParam = new URLSearchParams(location.search).get('demo');
const demo = demoParam !== null;
const now = () => nowSerial(SHEET_TIMEZONE);

// ── dependencies (demo mode swaps Google and the cache for stand-ins) ──
const auth = demo ? demoAuth() : createAuth({ clientId: CLIENT_ID });
const fetchRaw = demo
  ? async () => demoRaw(SHEET_TIMEZONE, demoParam)
  : token => batchGet({ token, spreadsheetId: SPREADSHEET_ID });
let memo = null;
const cache = demo
  ? { load: async () => memo, save: async e => { memo = e; return true; } }
  : { load: loadCache, save: saveCache };

// ── state, with the URL as the source of view, params and filters ──
const store = createStore({ ...initialState(), ...parseHash(location.hash), auth: auth.state() });
const pipeline = createPipeline({ store, auth, fetchRaw, cache, now });

const actions = {
  /** filters (optional): patch of the global filters, e.g. { focus: [...] } to highlight players. */
  navigate(view, params = {}, filters = null) {
    store.set({ view, params, replaceParams: true, ...(filters ? { filters } : {}) });
    document.getElementById('view')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  },
  setParams: patch => store.set({ params: patch }),
  setFilters: patch => store.set({ filters: patch }),
  async signIn() {
    try { await auth.signIn(); await pipeline.refresh(); }
    catch (e) {
      if (e?.kind !== 'popup_closed') store.set({ data: { error: e?.message || 'Anmeldung fehlgeschlagen.' } });
    }
  },
  refresh: () => (auth.getToken() ? pipeline.refresh() : actions.signIn()),
  signOut() { auth.signOut(); store.set({ data: { needsSignIn: true } }); },
  async clearCache() {
    await clearCache();
    memo = null;
    store.set({ data: { error: null } });
    pipeline.refresh();
  },
};

const shell = createShell(document.getElementById('app'), { store, actions });

const router = createRouter({
  store,
  el: shell.viewEl,
  renderEmpty: shell.renderEmpty,
  makeCtx(state) {
    const base = state.data.model;
    if (!base) return null;
    const filters = resolveFilters(state.filters, base.dataset.config);
    const model = modelFor(base, filters.mode);          // views only ever see the current mode's model
    const t = model.stats.now;
    const names = new Map([...model.dataset.players.values()].map(p => [p.id, clean(p.name)]));
    const vis = visible(model.dataset, model.elo, filters, t);
    return {
      state, model, baseModel: base, mode: filters.mode, filters, params: state.params, now: t, names,
      visible: vis,
      focus: resolveFocus(filters, model.elo, vis, model.dataset.config),
      navigate: actions.navigate, setParams: actions.setParams, setFilters: actions.setFilters, actions,
    };
  },
});

// URL ↔ state: a view change adds a history entry (back button), filter/param changes replace it.
let writing = false;
store.subscribe((s, prev) => {
  const hash = formatHash(s);
  if (hash === location.hash || (hash === '#/dashboard' && !location.hash)) return;
  writing = true;
  if (s.view !== prev.view) history.pushState(null, '', hash); else history.replaceState(null, '', hash);
  writing = false;
});
window.addEventListener('hashchange', () => { if (!writing) store.set({ ...parseHash(location.hash), replaceParams: true }); });
window.addEventListener('popstate', () => store.set({ ...parseHash(location.hash), replaceParams: true }));

// auth state into the store
auth.onChange(a => store.set({ auth: a }));

// reload when the app comes back to the foreground and the data is older than auto_refresh_seconds
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !auth.getToken()) return;
  const cfg = store.get().data.model?.dataset.config;
  pipeline.refreshIfStale(cfg ? cfg.auto_refresh_seconds : 0);
});

router.start();
auth.init();
pipeline.boot();
