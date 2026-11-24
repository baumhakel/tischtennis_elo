// The photo web app (Fotos.gs, Phase 18b): one POST endpoint, JSON as text (no preflight), the user's access
// token in every request. Side effect: network. The address comes from config (photos_url), never from the code.
//
//   photoClient({ url: () => string, token: () => string|null, fetchImpl? })
//     → { upload({ kind, ref, image: Blob, thumb: Blob, width, height, caption }) → id,
//         get(ids, 'thumb'|'full') → Map id → Blob, remove(id) }
//   Errors: PhotoError with kind 'offline' | 'auth' | 'forbidden' | 'limit' | 'too_large' | 'not_found' | 'setup' | 'error'
//   and a German message.

export class PhotoError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

const MESSAGES = {
  offline: 'Keine Verbindung, nichts hochgeladen.',
  auth: 'Anmeldung abgelaufen. Bitte neu anmelden.',
  forbidden: 'Dieses Google-Konto darf das nicht.',
  error: 'Die Fotos sind gerade nicht erreichbar. Bitte später noch einmal versuchen.',
};

/** Blob → base64 (without the data: prefix). */
export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** base64 → Blob. */
export function base64ToBlob(b64, type = 'image/jpeg') {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function photoClient({ url, token, fetchImpl = (...a) => fetch(...a), timeoutMs = 60000 }) {
  async function call(req) {
    const t = token();
    if (!t) throw new PhotoError('auth', MESSAGES.auth);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new PhotoError('offline', MESSAGES.offline);
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetchImpl(url(), { method: 'POST', body: JSON.stringify({ ...req, token: t }),
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', signal: ctrl?.signal });
    } catch {
      throw new PhotoError('offline', MESSAGES.offline);
    } finally { if (timer) clearTimeout(timer); }
    let body = null;
    try { body = await res.json(); } catch { /* not JSON: e.g. a Google error page */ }
    if (!res.ok || !body) throw new PhotoError('error', MESSAGES.error);
    if (!body.ok) throw new PhotoError(body.error || 'error', body.message || MESSAGES[body.error] || MESSAGES.error);
    return body;
  }

  return {
    async upload({ kind, ref, image, thumb, width, height, caption = '' }) {
      const [a, b] = await Promise.all([blobToBase64(image), blobToBase64(thumb)]);
      return (await call({ action: 'upload', kind, ref, image: a, thumb: b, width, height, caption })).id;
    },
    async get(ids, size = 'thumb') {
      const out = new Map();
      const per = size === 'full' ? 4 : 60;
      for (let i = 0; i < ids.length; i += per) {
        const body = await call({ action: 'get', ids: ids.slice(i, i + per), size });
        for (const [id, b64] of Object.entries(body.images || {})) out.set(id, base64ToBlob(b64));
      }
      return out;
    },
    async remove(id) { await call({ action: 'delete', id }); },
  };
}
