// „Ich“: who is using the app on this device.
//
// Sources, in this order:
//   1. a choice made on this device (a player, or „Zuschauer“) — stored in localStorage only,
//      never in the URL; wins over everything else (someone may use a colleague's phone)
//   2. the signed-in Google account, if it is listed in players.google_accounts
//   3. nobody yet → the Übersicht shows a card „Wer bist du?“ (unless snoozed with „Später“)
//
// resolveMe() is pure; loadMe()/saveMe() touch localStorage and never throw.
import { STORAGE_PREFIX } from '../config.js';

const KEY = STORAGE_PREFIX + '-me';
export const SNOOZE_DAYS = 7;   // „Später“ hides the card this long (UI constant)

/**
 * choice: 'player' (id chosen on this device) · 'observer' (Zuschauer) · 'ask' („Das bin ich nicht“:
 * ignore the account mapping and ask) · null (nothing chosen: use the account mapping if any).
 * @typedef {{ choice: 'player'|'observer'|'ask'|null, id: string|null, snoozeUntil: number, seen: Object<string, number> }} MeStore
 */

/** @returns {MeStore} */
export function loadMe() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && typeof v === 'object') return { choice: v.choice ?? null, id: v.id ?? null, snoozeUntil: v.snoozeUntil || 0, seen: v.seen || {} };
  } catch { /* storage blocked or broken: start fresh */ }
  return { choice: null, id: null, snoozeUntil: 0, seen: {} };
}

export function saveMe(me) {
  try { localStorage.setItem(KEY, JSON.stringify(me)); } catch { /* private mode: keep it in memory only */ }
}

/**
 * Who „Ich“ is right now.
 * @param {MeStore} stored
 * @param {Map<string, {id, accounts?: string[]}>} players   dataset.players
 * @param {string|null} email   signed-in account
 * @param {number} nowMs
 * @returns {{ id: string|null, source: 'device'|'account'|null, observer: boolean, ask: boolean, accountId: string|null }}
 *   ask = show the „Wer bist du?“ card; accountId = the player mapped to the account (even if overridden)
 */
export function resolveMe(stored, players, email, nowMs = Date.now()) {
  const mail = (email || '').trim().toLowerCase();
  let accountId = null;
  if (mail) for (const p of players.values()) if (p.accounts?.includes(mail)) { accountId = p.id; break; }
  if (stored.choice === 'observer') return { id: null, source: 'device', observer: true, ask: false, accountId };
  if (stored.choice === 'player' && stored.id && players.has(stored.id)) {
    return { id: stored.id, source: 'device', observer: false, ask: false, accountId };
  }
  if (accountId && stored.choice !== 'ask') return { id: accountId, source: 'account', observer: false, ask: false, accountId };
  return { id: null, source: null, observer: false, ask: !(stored.snoozeUntil > nowMs), accountId };
}
