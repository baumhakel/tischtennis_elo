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
import { windowModel } from './app/window.js';
import { windowRange } from './core/window.js';
import { viewById } from './views/index.js';
import { loadMe, saveMe, resolveMe } from './app/me.js';
import { scheduleAchievements, peekAchievements } from './app/achievements.js';
import { scheduleForecast, peekForecast } from './app/forecast.js';
import { scheduleLab } from './app/lab.js';

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
const store = createStore({ ...initialState(), ...parseHash(location.hash), auth: auth.state(), me: loadMe() });
const pipeline = createPipeline({ store, auth, fetchRaw, cache, now });

const actions = {
  /** filters (optional): patch of the global filters, e.g. { focus: [...] } to highlight players. */
  navigate(view, params = {}, filters = null) {
    shell?.closeMenu();
    store.set({ view, params, replaceParams: true, ...(filters ? { filters } : {}) });
    document.getElementById('view')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  },
  setParams: patch => store.set({ params: patch }),
  setFilters: patch => store.set({ filters: patch }),
  /** „Ich“ on this device (app/me.js): stored in localStorage only. */
  setMe(me) { saveMe(me); store.set({ me }); },
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

let shell = null;
shell = createShell(document.getElementById('app'), { store, actions });

const router = createRouter({
  store,
  el: shell.viewEl,
  renderEmpty: shell.renderEmpty,
  renderEmptyWindow: shell.renderEmptyWindow,
  makeCtx(state) {
    const base = state.data.model;
    if (!base) return null;
    const filters = resolveFilters(state.filters, base.dataset.config);
    const full = modelFor(base, filters.mode);          // views only ever see the current mode's model
    const def = viewById(state.view);
    const range = def?.zeit ? windowRange(filters.range, full.stats.now) : null;
    const model = range ? windowModel(full, range) : full;   // Zeitraum: the games in the window (core/window.js)
    const t = model.stats.now;
    const names = new Map([...model.dataset.players.values()].map(p => [p.id, clean(p.name)]));
    const vis = visible(model.dataset, model.elo, filters, t);
    const me = resolveMe(state.me, base.dataset.players, state.auth.email);
    return {
      badges: peekAchievements(base),                       // null until computed in the background
      forecast: peekForecast(full),                         // Prognose of this mode, null until ready
      badgeSeen: me.id && me.id in bootSeen ? bootSeen[me.id] : Infinity,   // „neu“ = earned after this
      state, model, baseModel: base, fullModel: full, mode: filters.mode, filters, params: state.params, now: t, names,
      window: range ? { ...range, empty: model.dataset.games.length === 0 } : null,
      visible: vis, me,
      focus: resolveFocus(filters, model.elo, vis, model.dataset.config, me.id),
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
  // inApp marks entries the app pushed itself, so „‹ Zurück“ knows whether history.back() stays in the app
  if (s.view !== prev.view) history.pushState({ inApp: true }, '', hash); else history.replaceState(history.state, '', hash);
  writing = false;
});
window.addEventListener('hashchange', () => { if (!writing) store.set({ ...parseHash(location.hash), replaceParams: true }); });
window.addEventListener('popstate', () => store.set({ ...parseHash(location.hash), replaceParams: true }));

// ── Abzeichen: computed in the background once the data is shown (app/achievements.js) ──
// „neu“ marker: what was seen when the app started (per player); the first time nothing is „neu“.
const bootSeen = { ...(store.get().me.seen?.badges || {}) };
function markSeen() {
  const s = store.get(), base = s.data.model, A = peekAchievements(base);
  if (!A) return;
  const me = resolveMe(s.me, base.dataset.players, s.auth.email);
  if (!me.id) return;
  const t = A.players.get(me.id)?.earned.at(-1)?.t ?? 0;
  const seen = s.me.seen?.badges || {};
  if (!(me.id in bootSeen)) bootSeen[me.id] = seen[me.id] ?? t;
  if (seen[me.id] !== t) actions.setMe({ ...s.me, seen: { ...s.me.seen, badges: { ...seen, [me.id]: t } } });
}
store.subscribe((s, prev) => {
  if (s.data.model && s.data.model !== prev.data.model) {
    scheduleAchievements(s.data.model, base => {
      if (store.get().data.model === base) store.set({ data: { badgesFor: base } });
      markSeen();
    });
  } else if (s.me !== prev.me || s.auth.email !== prev.auth.email) markSeen();
  // Prognose of the current mode, in a worker (app/forecast.js); also after a mode change
  if (s.data.model && (s.data.model !== prev.data.model || s.filters.mode !== prev.filters.mode)) {
    const base = s.data.model;
    const full = modelFor(base, resolveFilters(s.filters, base.dataset.config).mode);
    scheduleForecast(full, marker => { if (store.get().data.model === base) store.set({ data: { forecastFor: marker } }); });
  }
  // Labor bootstrap: only while the Labor page is open (app/lab.js; no-op once started for this model)
  if (s.data.model && s.view === 'labor') {
    const base = s.data.model;
    const full = modelFor(base, resolveFilters(s.filters, base.dataset.config).mode);
    scheduleLab(full, marker => { if (store.get().data.model === base) store.set({ data: { labFor: marker } }); });
  }
});

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
