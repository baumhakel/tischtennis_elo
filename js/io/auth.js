// Google sign-in (Google Identity Services, token model). Side effects: GIS script, localStorage.
//
// Browsers only open the Google sign-in popup in direct response to a tap or click, so a token
// can only be *obtained* via signIn() from a click handler. A valid token is kept in localStorage
// until it expires (about an hour), so reopening the app within that time needs no tap.
// After expiry the app keeps showing the cached data and offers a one-tap refresh.

import { SCOPE, TOKEN_MARGIN_SECONDS, STORAGE_PREFIX } from '../config.js';

const KEY = STORAGE_PREFIX + '-auth';

export class AuthError extends Error {
  /** @param {'popup_closed'|'popup_blocked'|'scope_denied'|'unavailable'|'failed'} kind */
  constructor(kind, message) { super(message); this.kind = kind; }
}

/**
 * @param {{ clientId: string }} opts
 * @returns {{ init(): Promise<void>, ready(): boolean, getToken(): string|null, signIn(): Promise<string>,
 *             signOut(): void, expire(): void, state(): {ready:boolean, signedIn:boolean, email:string|null, expiresAt:number},
 *             onChange(fn): () => void }}
 */
export function createAuth({ clientId }) {
  let client = null;
  let saved = read();            // { t, exp, email }
  let pending = null;            // { resolve, reject } of the running signIn()
  let failed = false;            // GIS script did not load (blocked, offline)
  const listeners = new Set();

  const notify = () => listeners.forEach(fn => fn(api.state()));

  const api = {
    /** Waits for the GIS script (loaded async in index.html) and creates the token client. */
    async init() {
      const oauth2 = await waitForGis();
      if (!oauth2) { failed = true; notify(); return; }
      client = oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: onToken,
        error_callback: err => {
          const kind = err?.type === 'popup_closed' ? 'popup_closed'
            : err?.type === 'popup_failed_to_open' ? 'popup_blocked' : 'failed';
          finish(new AuthError(kind, err?.message || err?.type || 'Anmeldung fehlgeschlagen'));
        },
      });
      notify();
    },

    ready: () => !!client,

    /** The current token if it is still valid, else null. Never opens a popup. */
    getToken: () => (saved.t && Date.now() < saved.exp ? saved.t : null),

    /** Opens Google sign-in. Call only from a tap/click handler. */
    signIn() {
      if (!client) return Promise.reject(new AuthError('unavailable', 'Google-Anmeldung ist noch nicht geladen.'));
      if (pending) pending.reject(new AuthError('failed', 'Neue Anmeldung gestartet.'));
      return new Promise((resolve, reject) => {
        pending = { resolve, reject };
        client.requestAccessToken({ prompt: saved.email ? '' : 'select_account', login_hint: saved.email || undefined });
      });
    },

    signOut() {
      const t = saved.t;
      saved = {};
      write(saved);
      if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t, () => {});
      notify();
    },

    /** Forget the token (e.g. after a 401) but keep the e-mail as login hint. */
    expire() {
      saved = { email: saved.email };
      write(saved);
      notify();
    },

    state: () => ({ ready: !!client, failed, signedIn: !!api.getToken(), email: saved.email || null, expiresAt: saved.exp || 0 }),

    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };

  function onToken(resp) {
    if (resp.error) return finish(new AuthError('failed', resp.error_description || resp.error));
    if (!window.google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
      return finish(new AuthError('scope_denied', 'Bitte beim Anmelden den Zugriff auf Google Tabellen erlauben.'));
    }
    saved = {
      t: resp.access_token,
      exp: Date.now() + (Number(resp.expires_in) - TOKEN_MARGIN_SECONDS) * 1000,
      email: saved.email,
    };
    write(saved);
    finish(null, resp.access_token);
    fetchEmail(resp.access_token).then(email => {
      if (email && saved.t === resp.access_token) { saved.email = email; write(saved); notify(); }
    });
  }

  function finish(err, token) {
    const p = pending;
    pending = null;
    notify();
    if (!p) return;
    if (err) p.reject(err); else p.resolve(token);
  }

  return api;
}

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
function write(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode: token lives in memory only */ }
}

/** The signed-in account's e-mail, for display and as login hint. Uses the token itself; no extra scope. */
async function fetchEmail(token) {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + encodeURIComponent(token));
    return (await r.json()).email || null;
  } catch { return null; }
}

/** Resolves with google.accounts.oauth2 once the GIS script has loaded, or null after ~10 s. */
function waitForGis() {
  return new Promise(resolve => {
    const t0 = Date.now();
    (function poll() {
      const o = window.google?.accounts?.oauth2;
      if (o) return resolve(o);
      if (Date.now() - t0 > 10000) return resolve(null);
      setTimeout(poll, 50);
    })();
  });
}
