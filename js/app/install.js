// „Als App installieren“ (Phase 17): Android / Chrome offer their own install dialog (beforeinstallprompt),
// iOS has none, so the menu shows the two steps there. Hidden once the app runs from the home screen.
// No service worker on purpose (the data cache exists already; a worker mostly adds stale-version bugs).
//
//   state.install = null | 'prompt' (the browser's dialog is available) | 'ios' (show the steps)

/** Pure: what the menu offers. */
export function installMode({ standalone, ios, canPrompt }) {
  if (standalone) return null;
  if (canPrompt) return 'prompt';
  return ios ? 'ios' : null;
}

export function isIos(nav) {
  return /iPhone|iPad|iPod/.test(nav.userAgent || '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

/** @param {{ store, win?: Window }} o  → { prompt() } */
export function createInstall({ store, win = window }) {
  let deferred = null;
  const standalone = () => win.matchMedia?.('(display-mode: standalone)').matches || win.navigator.standalone === true;
  const update = () => store.set({ install: installMode({ standalone: standalone(), ios: isIos(win.navigator), canPrompt: !!deferred }) });
  win.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; update(); });
  win.addEventListener('appinstalled', () => { deferred = null; store.set({ install: null }); });
  update();
  return {
    async prompt() {
      if (!deferred) return;
      const e = deferred;
      deferred = null;
      e.prompt();
      try { await e.userChoice; } catch { /* dismissed */ }
      update();
    },
  };
}
