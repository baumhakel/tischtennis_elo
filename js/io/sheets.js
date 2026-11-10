// Sheets API access: one batchGet for all tabs the loader needs. Side effect: network.

import { TABS, FETCH_TIMEOUT_MS } from '../config.js';

export class SheetsError extends Error {
  /**
   * @param {'auth'|'forbidden'|'not_found'|'bad_range'|'network'|'timeout'|'http'} kind
   * @param {string} message  German, for the UI
   */
  constructor(kind, message, status = 0) { super(message); this.kind = kind; this.status = status; }
}

/**
 * Reads every tab in TABS. Dates come back as serial numbers, values unformatted.
 * @param {{ token: string, spreadsheetId: string, fetchImpl?: typeof fetch, timeoutMs?: number }} opts
 * @returns {Promise<import('../types.js').RawSheets>}
 */
export async function batchGet({ token, spreadsheetId, fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS }) {
  const keys = Object.keys(TABS);
  const params = new URLSearchParams({
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
    majorDimension: 'ROWS',
  });
  for (const k of keys) params.append('ranges', `'${TABS[k].replace(/'/g, "''")}'`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${params}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, { headers: { Authorization: 'Bearer ' + token }, signal: ctrl.signal });
  } catch (e) {
    throw e?.name === 'AbortError'
      ? new SheetsError('timeout', 'Die Tabelle antwortet nicht – später erneut versuchen.')
      : new SheetsError('network', 'Keine Verbindung zu Google – Internetverbindung prüfen.');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { /* no JSON body */ }
    switch (res.status) {
      case 401: throw new SheetsError('auth', 'Anmeldung abgelaufen – bitte neu anmelden.', 401);
      case 403: throw new SheetsError('forbidden', 'Dieses Google-Konto hat keinen Zugriff auf die Tabelle. Bitte mit einem freigegebenen Konto anmelden.', 403);
      case 404: throw new SheetsError('not_found', 'Tabelle nicht gefunden – SPREADSHEET_ID in js/config.js prüfen.', 404);
      case 400: throw new SheetsError('bad_range',
        `Ein Tab fehlt in der Tabelle (erwartet: ${keys.map(k => TABS[k]).join(', ')}). ${detail}`.trim(), 400);
      default: throw new SheetsError('http', `Fehler beim Laden (${res.status}). ${detail}`.trim(), res.status);
    }
  }

  const body = await res.json();
  const raw = {};
  keys.forEach((k, i) => { raw[k] = body.valueRanges?.[i]?.values || []; });
  return raw;
}
