// Phase 17, item 5: what „Als App installieren“ offers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installMode, isIos, createInstall } from '../js/app/install.js';
import { createStore, initialState } from '../js/app/store.js';

test('installMode: nothing when installed, the browser dialog when offered, the steps on iOS', () => {
  assert.equal(installMode({ standalone: true, ios: true, canPrompt: true }), null);
  assert.equal(installMode({ standalone: false, ios: false, canPrompt: true }), 'prompt');
  assert.equal(installMode({ standalone: false, ios: true, canPrompt: false }), 'ios');
  assert.equal(installMode({ standalone: false, ios: false, canPrompt: false }), null);
});

test('isIos: iPhone and iPad (also iPadOS posing as a Mac), not Android', () => {
  assert.ok(isIos({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }));
  assert.ok(isIos({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 }));
  assert.ok(!isIos({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 }));
  assert.ok(!isIos({ userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)' }));
});

test('createInstall: the deferred browser prompt is offered once and used on tap', async () => {
  const handlers = {};
  const win = { navigator: { userAgent: 'Android' }, matchMedia: () => ({ matches: false }), addEventListener: (t, fn) => { handlers[t] = fn; } };
  const store = createStore(initialState());
  const ins = createInstall({ store, win });
  assert.equal(store.get().install, null);
  let prompted = 0;
  handlers.beforeinstallprompt({ preventDefault() {}, prompt() { prompted++; }, userChoice: Promise.resolve({ outcome: 'accepted' }) });
  assert.equal(store.get().install, 'prompt');
  await ins.prompt();
  assert.equal(prompted, 1);
  assert.equal(store.get().install, null);
  handlers.appinstalled();
  assert.equal(store.get().install, null);
});
