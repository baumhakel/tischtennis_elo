// Which tournaments the app shows (Phase 18). No DOM.
//   visibleTournaments(dataset, test) → { list, active }
//   list: aktiv and beendet ones (and „test“ ones with ?turniertest), newest first. „entwurf“ never.
//   active: the one the bottom bar's „Turnier“ tab opens (status aktiv, or test with ?turniertest), else null.

export function visibleTournaments(dataset, test = false) {
  const shown = s => s === 'aktiv' || s === 'beendet' || (test && s === 'test');
  const list = (dataset.tournaments || []).filter(t => shown(t.status))
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0) || a.name.localeCompare(b.name, 'de'));
  const active = list.find(t => t.status === 'aktiv' && t.ok) || (test ? list.find(t => t.status === 'test' && t.ok) : null) || null;
  return { list, active };
}

/** A tournament by ID among the visible ones; without an ID the active one, else the newest. */
export function pickTournament(tournaments, id) {
  if (!tournaments) return null;
  if (id) return tournaments.list.find(t => t.id === id) || null;
  return tournaments.active || tournaments.list[0] || null;
}

/** Can results be entered right now (status aktiv or test, not finished)? */
export const entryOpen = T => !!T && T.ok && (T.status === 'aktiv' || T.status === 'test');
