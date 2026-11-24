// Parts the tournament pages share (Phase 18): names with „Gast“, match rows, set lines, the group table,
// the knockout bracket.
import { h } from '../ui/dom.js';
import { avatar } from '../ui/avatar.js';
import { linkTo } from './common.js';

/** „1 Spiel“ / „3 Spiele“ */
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Display name of one side: members by their current name, guests as typed, unknown sides by their source. */
export function sideName(ctx, s) {
  if (!s?.key) return s?.label || 'offen';
  return s.id ? ctx.names.get(s.id) ?? s.name : s.name;
}

/** Name with a small face (members) and the „Gast“ tag (guests). */
export function sideLabel(ctx, s, { size = 22, strong = false } = {}) {
  if (!s?.key) return h('span', { class: 'tt-side tt-open' }, s?.label || 'offen');
  const name = sideName(ctx, s);
  return h('span', { class: 'tt-side' },
    s.id ? avatar(ctx, s.id, { size }) : null,
    strong ? h('strong', {}, name) : h('span', {}, name),
    s.guest ? h('span', { class: 'tt-guest' }, 'Gast') : null);
}

/** „11:7 · 9:11 · 11:5“ from the first-named side's view. */
export const setLine = r => (r ? r.sets.map(([a, b]) => `${a}:${b}`).join(' · ') : '');

/** One match as a tappable row: number and round, both sides (winner bold), sets or status. */
export function matchRow(ctx, T, m, { round = true } = {}) {
  const r = m.result;
  const side = (s, won) => h('span', { class: 'tt-line' + (won ? ' won' : '') }, sideLabel(ctx, s, { strong: won }),
    r ? h('span', { class: 'tt-sets' }, String(won ? Math.max(r.setsA, r.setsB) : Math.min(r.setsA, r.setsB))) : null);
  const aWon = r?.winner === 'a', bWon = r?.winner === 'b';
  const status = r ? setLine(r) : m.status === 'offen' ? 'offen' : 'wartet auf die Gegner';
  return h('li', {}, h('a', { class: 'tt-match tap', ...linkTo(ctx, 'turnierspiel', { id: T.id, nr: m.nr }) },
    h('span', { class: 'tt-meta' }, `Spiel ${m.nr}${round ? ` · ${m.label}` : ''}`),
    side(m.a, aWon), side(m.b, bWon),
    h('span', { class: 'tt-meta' + (m.status === 'offen' ? ' tt-now' : '') }, status)));
}

export const matchList = (ctx, T, ms, o) => h('ul', { class: 'tt-matches' }, ms.map(m => matchRow(ctx, T, m, o)));

/** The table of one group: place, name, games, wins:losses, sets, points. Places going on are marked. */
export function groupTableView(ctx, T, table) {
  const byKey = new Map(T.participants.map(p => [p.key, p]));
  const sideOf = key => { const p = byKey.get(key); return { key, id: p.id, name: p.name, guest: p.guest }; };
  return h('div', { class: 'tt-group' },
    h('h4', {}, `Gruppe ${table.letter}`, h('span', { class: 'muted' }, table.done ? ' · fertig' : ` · ${table.advance} ${table.advance === 1 ? 'kommt' : 'kommen'} weiter`)),
    h('table', { class: 'plain tt-table' },
      h('thead', {}, h('tr', {}, h('th', { class: 'num' }, 'Pl.'), h('th', {}, 'Name'), h('th', { class: 'num' }, 'Sp.'),
        h('th', { class: 'num' }, 'S:N'), h('th', { class: 'num' }, 'Sätze'), h('th', { class: 'num tt-pts' }, 'Punkte'))),
      h('tbody', {}, table.rows.map(r => {
        const goes = r.finalPlace != null && r.finalPlace <= table.advance, out = r.finalPlace != null && r.finalPlace > table.advance;
        return h('tr', { class: goes ? 'tt-goes' : out ? 'tt-out' : '' },
          h('td', { class: 'num' }, String(r.place)),
          h('td', {}, sideLabel(ctx, sideOf(r.key), { size: 20 }), goes ? h('span', { class: 'tt-mark', title: 'Steht als Teilnehmer der K.-o.-Runde fest' }, ' weiter') : null),
          h('td', { class: 'num' }, String(r.played)),
          h('td', { class: 'num' }, `${r.wins}:${r.losses}`),
          h('td', { class: 'num' }, `${r.setsW}:${r.setsL}`),
          h('td', { class: 'num tt-pts' }, `${r.ptsW}:${r.ptsL}`));
      }))));
}

/** The knockout as columns (one per round), scrolling sideways on a phone. */
export function bracketView(ctx, T) {
  const byNr = new Map(T.matches.map(m => [m.nr, m]));
  return h('div', { class: 'tt-bracket', role: 'list' }, T.bracket.map(r => h('section', { class: 'tt-round', role: 'listitem' },
    h('h4', {}, r.name),
    h('ul', { class: 'tt-matches' }, r.matches.map(nr => matchRow(ctx, T, byNr.get(nr), { round: false }))),
    r.third ? [h('h4', {}, 'Spiel um Platz 3'), h('ul', { class: 'tt-matches' }, matchRow(ctx, T, byNr.get(r.third), { round: false }))] : null)));
}
