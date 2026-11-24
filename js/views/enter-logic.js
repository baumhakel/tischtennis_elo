// Pure helpers for entering in the app (Phase 18a): picking players for a result, the sentences shown,
// the text that identifies a game in a support report, what a merge does. No DOM.
import * as fmt from '../ui/format.js';

/**
 * Tap on a player chip. Tapping a selected player removes them; a player on the other side moves over;
 * a full side drops its earliest pick. Nobody is ever on both sides.
 * @param {{ W: string[], L: string[] }} s   @param {'W'|'L'} side   @param {number} size  players per side
 */
export function pick(s, side, id, size) {
  const other = side === 'W' ? 'L' : 'W';
  if (s[side].includes(id)) return { ...s, [side]: s[side].filter(x => x !== id) };
  const mine = [...s[side], id];
  return { ...s, [other]: s[other].filter(x => x !== id), [side]: mine.slice(Math.max(0, mine.length - size)) };
}

/** Switching Einzel ↔ Doppel keeps the first picks that still fit. */
export const resize = (s, size) => ({ W: s.W.slice(0, size), L: s.L.slice(0, size) });

/** Both sides complete for this size? */
export const complete = (s, size) => s.W.length === size && s.L.length === size;

/** „Anna schlägt Bernd“ / „Anna & Bernd schlagen Clara & David“. */
export function resultSentence(W, L, name) {
  const team = ids => ids.map(name).join(' & ');
  return `${team(W)} ${W.length > 1 ? 'schlagen' : 'schlägt'} ${team(L)}`;
}

/** „Anna & Bernd haben gewonnen“ / „Anna hat gewonnen“ (the buttons on Tisch). */
export const wonLabel = (W, name) => `${W.map(name).join(' & ')} ${W.length > 1 ? 'haben' : 'hat'} gewonnen`;

/**
 * The game in a support report: date, time, players and the game_ref, so the game can be found without
 * searching: „Di 24.11.2026, 12:03 Uhr · Anna schlägt Bernd · Zeitstempel 2026-11-24 12:03:12“.
 */
export function gameText(x, name) {
  const when = x.approxTime ? `ca. ${fmt.date(x.t)}` : `${fmt.date(x.t)}, ${fmt.time(x.t)} Uhr`;
  return `${when} · ${resultSentence(x.winners, x.losers, name)} · Zeitstempel ${x.ref}`;
}

/**
 * What a merge does to the games: from's games count for into; games with both become invalid.
 * @returns {{ games: number, both: number }}
 */
export function mergeEffect(dataset, fromId, intoId) {
  let games = 0, both = 0;
  for (const g of dataset.games) {
    const ids = [...g.winners, ...g.losers];
    if (!ids.includes(fromId)) continue;
    games++;
    if (ids.includes(intoId)) both++;
  }
  return { games, both };
}

/** „Bernd 2 verschwindet, seine 14 Spiele zählen für Bernd.“ (+ games that become invalid) */
export function mergeText(fromName, intoName, { games, both }) {
  const n = games === 1 ? 'sein eines Spiel zählt' : `seine ${fmt.int(games)} Spiele zählen`;
  const main = games ? `${fromName} verschwindet, ${n} für ${intoName}.` : `${fromName} verschwindet, ${intoName} bleibt.`;
  const bad = both ? ` ${both === 1 ? 'Ein Spiel, in dem beide stehen, wird' : `${fmt.int(both)} Spiele, in denen beide stehen, werden`} ungültig.` : '';
  return main + bad;
}
