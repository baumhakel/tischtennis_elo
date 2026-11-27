// Parts the tournament pages share (Phase 18, 18c): names with „Gast“ (players and doubles teams), match rows,
// set lines, the group table, the knockout bracket, the Swiss stage (rounds as columns of pools, standings), the
// pot draw („Auslosung“), and the Übersicht card.
import { h } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { avatar } from '../ui/avatar.js';
import { linkTo } from './common.js';
import { LETTERS } from '../core/tournament.js';
import { cardTournaments, suggestionsFor } from '../app/tournaments.js';
import { configQr, appUrl } from '../ui/qr.js';

/** A QR code in the style and colours set in config. hash = the page, e.g. „#/turnierspiel?id=x&nr=3“. */
export function tournamentQr(ctx, hash, label, extra = {}) {
  return configQr(ctx.baseModel.dataset.config, appUrl(hash), label, extra);
}

/** „QR-Code für dieses Spiel / Turnier“: collapsed, for the pinboard or passing a phone around. */
export function qrDetails(ctx, hash, title, label) {
  return h('details', { class: 'tt-details tt-qr' }, h('summary', {}, title),
    tournamentQr(ctx, hash, label),
    h('p', { class: 'muted small' }, 'Mit der Kamera scannen: öffnet diese Seite in der App.'));
}

/** „1 Spiel“ / „3 Spiele“ */
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const STATUS_TEXT = { test: 'Testlauf', aktiv: 'läuft', beendet: 'beendet', entwurf: 'in Vorbereitung', 'angekündigt': 'angekündigt' };
export const MODE_TEXT = T => [T.art === 'doppel' ? 'Doppel' : 'Einzel', T.mode === 'schweizer' ? 'Schweizer System, dann K.-o.' : 'Gruppen, dann K.-o.'].join(' · ');

const personName = (ctx, p) => (p.id ? ctx.names.get(p.id) ?? p.name : p.name);

/** Display name of one side: members by their current name, guests as typed, teams „Anna / Bernd“, unknown sides by their source. */
export function sideName(ctx, s) {
  if (!s?.key) return s?.label || 'offen';
  if (s.members) return s.members.map(m => personName(ctx, m)).join(' / ');
  return s.id ? ctx.names.get(s.id) ?? s.name : s.name;
}

/** Name with a small face (members; two for a team) and the „Gast“ tag (next to the guest). */
export function sideLabel(ctx, s, { size = 22, strong = false } = {}) {
  if (!s?.key) return h('span', { class: 'tt-side tt-open' }, s?.label || 'offen');
  const wrap = x => (strong ? h('strong', {}, x) : h('span', {}, x));
  if (s.members) {
    const ids = s.members.filter(m => m.id).map(m => m.id);
    const faces = ids.map(id => avatar(ctx, id, { size: Math.round(size * 0.86) })).filter(Boolean);
    return h('span', { class: 'tt-side tt-team' },
      faces.length ? h('span', { class: 'tt-faces', 'aria-hidden': 'true' }, faces) : null,
      wrap(s.members.map((m, i) => [i ? ' / ' : '', personName(ctx, m)])),
      s.members.some(m => m.guest) ? h('span', { class: 'tt-guest', title: s.members.filter(m => m.guest).map(m => m.name).join(', ') }, 'Gast') : null);
  }
  return h('span', { class: 'tt-side' },
    s.id ? avatar(ctx, s.id, { size }) : null,
    wrap(sideName(ctx, s)),
    s.guest ? h('span', { class: 'tt-guest' }, 'Gast') : null);
}

/** „11:7 · 9:11 · 11:5“ from the first-named side's view; „w. o.“ for a walkover. */
export const setLine = r => (!r ? '' : r.wo ? 'w. o. (nicht angetreten)' : r.sets.map(([a, b]) => `${a}:${b}`).join(' · '));

/** One match as a tappable row: number and round, both sides (winner bold), sets or status. */
export function matchRow(ctx, T, m, { round = true } = {}) {
  const r = m.result;
  const score = won => (r.wo ? (won ? 'w. o.' : '–') : String(won ? Math.max(r.setsA, r.setsB) : Math.min(r.setsA, r.setsB)));
  const side = (s, won) => h('span', { class: 'tt-line' + (won ? ' won' : '') }, sideLabel(ctx, s, { strong: won }),
    r ? h('span', { class: 'tt-sets' + (r.wo ? ' tt-wo' : '') }, score(won)) : null);
  const aWon = r?.winner === 'a', bWon = r?.winner === 'b';
  const status = r ? setLine(r) : m.status === 'offen' ? 'offen' : 'wartet auf die Gegner';
  return h('li', {}, h('a', { class: 'tt-match tap', ...linkTo(ctx, 'turnierspiel', { id: T.id, nr: m.nr }) },
    h('span', { class: 'tt-meta' }, `Spiel ${m.nr}${round ? ` · ${m.label}` : ''}${m.bestOf ? ` · Best of ${m.bestOf}` : ''}`),
    side(m.a, aWon), side(m.b, bWon),
    h('span', { class: 'tt-meta' + (m.status === 'offen' ? ' tt-now' : '') }, status)));
}

export const matchList = (ctx, T, ms, o) => h('ul', { class: 'tt-matches' }, ms.map(m => matchRow(ctx, T, m, o)));

const sideOfKey = (T, key) => T.participants.find(p => p.key === key);

/** The table of one group: place, name, games, wins:losses, sets, points. Places going on are marked. */
export function groupTableView(ctx, T, table) {
  return h('div', { class: 'tt-group' },
    h('h4', {}, `Gruppe ${table.letter}`, h('span', { class: 'muted' }, table.done ? ' · fertig' : ` · ${table.advance} ${table.advance === 1 ? 'kommt' : 'kommen'} weiter`)),
    h('table', { class: 'plain tt-table' },
      h('thead', {}, h('tr', {}, h('th', { class: 'num' }, 'Pl.'), h('th', {}, 'Name'), h('th', { class: 'num' }, 'Sp.'),
        h('th', { class: 'num' }, 'S:N'), h('th', { class: 'num' }, 'Sätze'), h('th', { class: 'num tt-pts' }, 'Punkte'))),
      h('tbody', {}, table.rows.map(r => {
        const goes = r.finalPlace != null && r.finalPlace <= table.advance, out = r.finalPlace != null && r.finalPlace > table.advance;
        return h('tr', { class: goes ? 'tt-goes' : out ? 'tt-out' : '' },
          h('td', { class: 'num' }, String(r.place)),
          h('td', {}, sideLabel(ctx, sideOfKey(T, r.key), { size: 20 }), goes ? h('span', { class: 'tt-mark', title: 'Steht als Teilnehmer der K.-o.-Runde fest' }, ' weiter') : null),
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

// ───────── Swiss stage (Phase 18c) ─────────

/** The Swiss stage as columns, one per round: its pools (0–0 → 1–0 / 0–1 → …), who is through and who is out. */
export function swissView(ctx, T) {
  const S = T.swiss;
  const byNr = new Map(T.matches.map(m => [m.nr, m]));
  const people = list => h('ul', { class: 'tt-swiss-names' }, list.map(x => h('li', {}, sideLabel(ctx, sideOfKey(T, x.key), { size: 18 }), h('span', { class: 'muted' }, ` ${x.record}`))));
  return h('div', { class: 'tt-bracket tt-swiss', role: 'list' }, S.rounds.map(rd => h('section', { class: 'tt-round', role: 'listitem' },
    h('h4', {}, `Runde ${rd.r}`),
    rd.pools.map(p => h('div', { class: 'tt-pool' },
      h('h5', {}, p.label, p.floatIn.length ? h('span', { class: 'muted' }, ` · dazu ${p.floatIn.map(k => sideName(ctx, sideOfKey(T, k))).join(', ')} von oben`) : null),
      h('ul', { class: 'tt-matches' }, p.nrs.map(nr => matchRow(ctx, T, byNr.get(nr), { round: false }))))),
    rd.byes.length ? h('p', { class: 'small' }, 'Freilos (zählt als Sieg): ', rd.byes.map(k => sideLabel(ctx, sideOfKey(T, k), { size: 18 }))) : null,
    rd.weiter.length ? h('div', { class: 'tt-pool tt-through' }, h('h5', {}, 'Weiter'), people(rd.weiter)) : null,
    rd.raus.length ? h('div', { class: 'tt-pool tt-gone' }, h('h5', {}, 'Ausgeschieden'), people(rd.raus)) : null)));
}

/** Standings of the Swiss stage: record, Buchholz, sets, points; through and out marked. */
export function swissTable(ctx, T) {
  const S = T.swiss;
  return h('table', { class: 'plain tt-table' },
    h('thead', {}, h('tr', {}, h('th', { class: 'num' }, 'Pl.'), h('th', {}, 'Name'), h('th', { class: 'num' }, 'S:N'),
      h('th', { class: 'num', title: 'Buchholz: Summe der Siege aller bisherigen Gegner' }, 'Bh.'), h('th', { class: 'num' }, 'Sätze'), h('th', { class: 'num tt-pts' }, 'Punkte'))),
    h('tbody', {}, S.standings.map(r => h('tr', { class: r.status === 'weiter' ? 'tt-goes' : r.status === 'raus' ? 'tt-out' : '' },
      h('td', { class: 'num' }, String(r.place)),
      h('td', {}, sideLabel(ctx, sideOfKey(T, r.key), { size: 20 }), r.status === 'weiter' ? h('span', { class: 'tt-mark' }, ' weiter') : null),
      h('td', { class: 'num' }, `${r.wins}:${r.losses}`),
      h('td', { class: 'num' }, String(r.buchholz)),
      h('td', { class: 'num' }, `${r.setsW}:${r.setsL}`),
      h('td', { class: 'num tt-pts' }, `${r.ptsW}:${r.ptsL}`)))));
}

// ───────── pot draw („Auslosung“) ─────────

/**
 * The pot draw revealed pot by pot: the pots on top, the groups below filling up. shown = pots revealed so far.
 * onStep(n) is called with the new number (tap „Nächster Topf“ / „Alles zeigen“).
 */
export function potReveal(ctx, T, shown, onStep) {
  const pots = T.pots || [];
  const groups = T.groups.map((g, i) => ({ letter: g.letter, entries: [] }));
  pots.slice(0, shown).forEach((pot, k) => pot.forEach(e => groups[e.group]?.entries.push({ key: e.key, pot: k + 1 })));
  return h('section', { class: 'tt-draw' },
    h('h3', {}, 'Auslosung'),
    h('p', { class: 'muted small' }, 'Topf 1 sind die Stärksten nach Elo-Wert, einer pro Gruppe, dann Topf 2 und so weiter. Das Los verteilt jeden Topf auf die Gruppen.'),
    h('ol', { class: 'tt-pots' }, pots.map((pot, k) => h('li', { class: k < shown ? 'done' : '' },
      h('span', { class: 'tt-pot-label' }, `Topf ${k + 1}`),
      h('span', { class: 'tt-pot-names' }, pot.map((e, i) => [i ? ', ' : '', sideName(ctx, sideOfKey(T, e.key))]))))),
    h('div', { class: 'tt-draw-groups' }, groups.map(g => h('div', { class: 'tt-draw-group' }, h('h4', {}, `Gruppe ${g.letter}`),
      h('ul', {}, g.entries.map(e => h('li', { class: e.pot === shown ? 'fresh' : '' }, sideLabel(ctx, sideOfKey(T, e.key), { size: 18 }))))))),
    shown < pots.length ? h('div', { class: 'menu-actions' },
      h('button', { type: 'button', onclick: () => onStep(shown + 1) }, shown ? 'Nächster Topf' : 'Topf 1 ziehen'),
      h('button', { type: 'button', class: 'secondary', onclick: () => onStep(pots.length) }, 'Alles zeigen')) : null);
}

/** After the start: one collapsed line with the pots. */
export function potSummary(ctx, T) {
  if (!T.pots?.length) return null;
  return h('details', { class: 'tt-details' }, h('summary', {}, 'Auslosung (Töpfe)'),
    h('ol', { class: 'tt-pots small' }, T.pots.map((pot, k) => h('li', { class: 'done' }, h('span', { class: 'tt-pot-label' }, `Topf ${k + 1}`),
      h('span', { class: 'tt-pot-names' }, pot.map((e, i) => [i ? ', ' : '', sideName(ctx, sideOfKey(T, e.key)), e.group >= 0 ? ` (${LETTERS[e.group]})` : '']))))));
}

// ───────── Übersicht card ─────────

/** „Weihnachtsturnier am 21.12. · Auslosung ansehen“, „Turnier läuft · 12 von 31 Spielen“, the winner afterwards. */
export function tournamentCards(ctx) {
  const cards = cardTournaments(ctx.tournaments, Math.floor(ctx.now), ctx.baseModel.dataset.config.tournament_card_days);
  if (!cards.length) return null;
  return h('ul', { class: 'tt-cards' }, cards.map(({ T, kind }) => {
    let title, desc;
    if (kind === 'aktiv') {
      title = `${T.name} läuft`;
      const next = suggestionsFor(ctx.tournaments, T, 1)[0];
      desc = [`${T.played} von ${T.mode === 'schweizer' && !T.swiss?.done ? 'höchstens ' : ''}${T.mode === 'schweizer' && !T.swiss?.done ? T.maxTotal : T.total} Spielen`,
        next ? `als Nächstes: ${sideName(ctx, next.a)} gegen ${sideName(ctx, next.b)}` : null].filter(Boolean).join(' · ');
    } else if (kind === 'angekündigt') {
      title = `${T.name}${T.date != null ? ` am ${fmt.date(T.date)}` : ''}`;
      desc = T.ok ? `${MODE_TEXT(T)} · ${plural(T.participants.length, T.art === 'doppel' ? 'Team' : 'Teilnehmer', T.art === 'doppel' ? 'Teams' : 'Teilnehmer')} · Auslosung ansehen` : 'Auslosung ansehen';
    } else {
      const w = T.participants.find(p => p.key === T.winner);
      title = `${T.name}: ${sideName(ctx, w)} gewinnt`;
      desc = 'Ergebnisse und Fotos ansehen';
    }
    return h('li', {}, h('a', { class: 'hub-card tap tt-card tt-card-' + (kind === 'angekündigt' ? 'soon' : kind), ...linkTo(ctx, 'turnier', { id: T.id }) },
      h('span', { class: 'hub-title' }, title), h('span', { class: 'hub-desc' }, desc)));
  }));
}
