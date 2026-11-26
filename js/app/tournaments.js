// Which tournaments the app shows (Phase 18, 18c). No DOM.
//   visibleTournaments(dataset, test) → { list, active, actives, announced }
//   list: angekündigt, aktiv and beendet ones (and „test“ ones with ?turniertest), newest first. „entwurf“ never.
//   actives: those going on (status aktiv, or test with ?turniertest); active = the first of them (or null).
//   Two can run at once (singles and doubles on the same day): the „Turnier“ tab then opens a small hub.
//   announced: status angekündigt (Übersicht card „Auslosung ansehen“).
//   cardTournaments(t, now, days) → what the Übersicht card shows
//   suggestionsFor(t, T, count) → „Als Nächstes“ of T, keeping people called to the other tournament out
import { suggestions } from '../core/tournament.js';

export function visibleTournaments(dataset, test = false) {
  const shown = s => s === 'aktiv' || s === 'beendet' || s === 'angekündigt' || (test && s === 'test');
  const list = (dataset.tournaments || []).filter(t => shown(t.status))
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0) || a.name.localeCompare(b.name, 'de'));
  const actives = list.filter(t => t.ok && (t.status === 'aktiv' || (test && t.status === 'test')))
    .sort((a, b) => a.name.localeCompare(b.name, 'de') || a.id.localeCompare(b.id));
  const announced = list.filter(t => t.status === 'angekündigt');
  return { list, active: actives[0] || null, actives, announced };
}

/** A tournament by ID among the visible ones; without an ID the active one (null with two: the hub), else the newest. */
export function pickTournament(tournaments, id) {
  if (!tournaments) return null;
  if (id) return tournaments.list.find(t => t.id === id) || null;
  if ((tournaments.actives?.length || 0) > 1) return null;
  return tournaments.active || tournaments.list[0] || null;
}

/** Can results be entered right now (status aktiv or test)? */
export const entryOpen = T => !!T && T.ok && (T.status === 'aktiv' || T.status === 'test');

/**
 * „Als Nächstes“ for T. With two tournaments going on, the one first by name suggests first, and the other keeps
 * the people called there out of its own suggestions where possible (nobody gets called to two tables at once).
 */
export function suggestionsFor(tournaments, T, count) {
  const others = (tournaments?.actives || []).filter(x => x.id !== T.id);
  if (!others.length || !tournaments.actives.includes(T)) return suggestions(T, count);
  const busy = new Set();
  for (const X of tournaments.actives) {
    if (X.id === T.id) return suggestions(T, count, busy);
    for (const m of suggestions(X, count, busy)) for (const k of [...m.a.people, ...m.b.people]) busy.add(k);
  }
  return suggestions(T, count, busy);
}

/**
 * The Übersicht card: running ones („Turnier läuft · 12 von 31 Spielen“), announced ones („Auslosung ansehen“), and
 * finished ones with their winner for `days` days after the tournament's day.
 * → [{ T, kind: 'aktiv' | 'angekündigt' | 'beendet' }]
 */
export function cardTournaments(tournaments, now, days = 7) {
  if (!tournaments) return [];
  const out = tournaments.actives.map(T => ({ T, kind: 'aktiv' }));
  for (const T of tournaments.announced) out.push({ T, kind: 'angekündigt' });
  for (const T of tournaments.list) {
    if (T.status !== 'beendet' || !T.ok || !T.winner) continue;
    if (T.date != null && now - Math.floor(T.date) <= days && now >= Math.floor(T.date)) out.push({ T, kind: 'beendet' });
  }
  return out;
}
