// Sign-in (io/auth.js) with a fake Google Identity Services: the e-mail scope (24 Nov 2026), old tokens dropped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCOPE, SHEETS_SCOPE, EMAIL_SCOPE, STORAGE_PREFIX } from '../js/config.js';

const store = new Map();
globalThis.localStorage = { getItem: k => store.get(KEY) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
let tokenClient = null;
globalThis.window = {
  google: { accounts: { oauth2: {
    initTokenClient(o) { tokenClient = o; return { requestAccessToken: opts => { tokenClient.lastRequest = opts; } }; },
    hasGrantedAllScopes: (resp, ...scopes) => scopes.every(s => resp.scope.split(' ').includes(s)),
  } } },
};
globalThis.fetch = async () => ({ json: async () => ({ email: 'anna@x.at' }) });
const { createAuth } = await import('../js/io/auth.js');
const KEY = STORAGE_PREFIX + '-auth';

test('the app asks for the e-mail and the sheet; only the sheet is required', async () => {
  assert.equal(SCOPE, `${EMAIL_SCOPE} ${SHEETS_SCOPE}`);
  store.clear();
  const auth = createAuth({ clientId: 'c' });
  await auth.init();
  assert.equal(tokenClient.scope, SCOPE);
  const p = auth.signIn();
  tokenClient.callback({ access_token: 'T1', expires_in: 3600, scope: `${SHEETS_SCOPE} ${EMAIL_SCOPE} openid` });
  assert.equal(await p, 'T1');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(auth.state().email, 'anna@x.at');
  const q = auth.signIn();
  tokenClient.callback({ access_token: 'T2', expires_in: 3600, scope: EMAIL_SCOPE });
  await assert.rejects(q, e => e.kind === 'scope_denied');
});

test('a token saved before the e-mail scope is dropped once (the address stays as login hint)', async () => {
  store.clear();
  localStorage.setItem(KEY, JSON.stringify({ t: 'OLD', exp: Date.now() + 3e6, email: 'anna@x.at' }));
  const auth = createAuth({ clientId: 'c' });
  assert.equal(auth.getToken(), null);
  assert.equal(auth.state().email, 'anna@x.at');
  assert.deepEqual(JSON.parse(store.get(KEY)), { email: 'anna@x.at' });
  // a new token remembers that it carries the e-mail scope, so it is kept next time
  await auth.init();
  const p = auth.signIn();
  tokenClient.callback({ access_token: 'NEW', expires_in: 3600, scope: `${SHEETS_SCOPE} ${EMAIL_SCOPE}` });
  await p;
  assert.equal(createAuth({ clientId: 'c' }).getToken(), 'NEW');
});
