// Google Forms from the app (Phase 18a). The app enters data the same way a person does: it sends a form
// response. Everything here is pure (body building, links, parsing) except sendForm, the one function that
// touches the network. Form addresses and question IDs come from `config`, never from this public code.
//
//   formBody([[id, value] …], { pageHistory })  → URLSearchParams for …/formResponse
//   responseUrl(url)        respondent link (…/viewform) → …/formResponse
//   prefilledUrl(url, [[id, value] …])  → …/viewform?usp=pp_url&entry.<id>=…   (opens the form filled in)
//   entryIdsFromUrl(url)    the question IDs in a pre-filled link, in order (Verwaltung.gs has a copy)
//   sendForm(url, body)     POST with mode no-cors; resolves when sent, rejects with FormSendError('offline')
//
// With mode no-cors the browser hides Google's answer, so a sent response is not proof that it arrived.
// The app checks arrival by reading the sheet again (app/after-entry.js).

/** „123“, „entry.123“ → „entry.123“. */
export const entryName = id => 'entry.' + String(id).trim().replace(/^entry\./, '');

const isEmpty = v => v == null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === '');

/**
 * Body of one form response. Empty answers are left out (an optional question stays unanswered).
 * pageHistory: for a form with sections, the sections visited, e.g. [0, 3]; Google drops answers of
 * sections that are not in it.
 * @param {[string|number, string|string[]][]} entries  [question ID, answer]
 * @param {{ pageHistory?: number[] }} [o]
 */
export function formBody(entries, { pageHistory = null } = {}) {
  const body = new URLSearchParams();
  for (const [id, value] of entries) {
    if (isEmpty(value)) continue;
    for (const v of Array.isArray(value) ? value : [value]) body.append(entryName(id), String(v));
  }
  if (pageHistory?.length) body.set('pageHistory', pageHistory.join(','));
  return body;
}

/** The form's respondent link (…/viewform) → the address that takes a response (…/formResponse). */
export function responseUrl(url) {
  const u = new URL(url);
  u.pathname = u.pathname.replace(/\/(viewform|formResponse)?\/?$/, '') + '/formResponse';
  u.search = '';
  return u.href;
}

/** The form opened with these answers filled in. The person still taps „Senden“ there. */
export function prefilledUrl(url, entries) {
  const u = new URL(url);
  u.pathname = u.pathname.replace(/\/(viewform|formResponse)?\/?$/, '') + '/viewform';
  u.search = '';
  u.searchParams.set('usp', 'pp_url');
  for (const [id, value] of entries) {
    if (isEmpty(value)) continue;
    for (const v of Array.isArray(value) ? value : [value]) u.searchParams.append(entryName(id), String(v));
  }
  return u.href;
}

/**
 * Question IDs in a pre-filled link, in the order they appear: …?usp=pp_url&entry.111=a&entry.222=b → ['111', '222'].
 * Suffixes like „entry.111.other_option_response“ or „_sentinel“ count as the same question.
 */
export function entryIdsFromUrl(url) {
  const ids = [];
  const query = String(url).split('?')[1] || '';
  for (const part of query.split('&')) {
    const m = /^entry\.(\d+)/.exec(decodeURIComponent(part.split('=')[0] || ''));
    if (m && !ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

export class FormSendError extends Error {
  /** @param {'offline'} kind */
  constructor(kind, message) { super(message); this.kind = kind; }
}

/**
 * Send one response. Resolves once the browser has sent it (Google's answer can't be read: no-cors).
 * Rejects with FormSendError('offline') when there is no connection; then nothing was sent.
 */
export async function sendForm(url, body, { fetchImpl = (...a) => fetch(...a), online = () => typeof navigator === 'undefined' || navigator.onLine !== false } = {}) {
  if (!online()) throw new FormSendError('offline', 'Keine Verbindung, nichts gesendet.');
  try {
    await fetchImpl(responseUrl(url), { method: 'POST', mode: 'no-cors', body });
  } catch {
    throw new FormSendError('offline', 'Keine Verbindung, nichts gesendet.');
  }
}
