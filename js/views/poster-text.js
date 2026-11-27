// Aushang (Phase 19): the German sentences of the wall newspaper, from core/poster.js data. No DOM.
//   storyText(story, ctxT) → { title, sub }   lineText(line, ctxT) → string   recordTiles(records, ctxT)
//   allTimeText(r, ctxT)   riddleFacts(riddle) → [string]   numbersRow(numbers, ctxT) → [{ value, label }]
//   ctxT = { names: Map id → name, monthName, cfg }
import * as fmt from '../ui/format.js';
import { badgeLabel } from './badge-defs.js';

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const n = (c, id) => c.names.get(id) ?? id;
const list = (c, ids) => ids.map(id => n(c, id)).join(' und ');
const games = k => `${fmt.int(k)} ${k === 1 ? 'Spiel' : 'Spiele'}`;
const gamesDat = k => `${fmt.int(k)} ${k === 1 ? 'Spiel' : 'Spielen'}`;   // „aus 19 Spielen“
const half = x => (Number.isInteger(x) ? fmt.int(x) : fmt.dec1(x));

export function storyText(s, c) {
  switch (s.kind) {
    case 'leader': return s.old
      ? { title: `${n(c, s.id)} stürzt ${n(c, s.old)} vom Thron`, sub: `Neu auf Platz 1, mit ${fmt.elo(s.rating)} Elo-Punkten am Monatsende.` }
      : { title: `${n(c, s.id)} erobert Platz 1`, sub: `Mit ${fmt.elo(s.rating)} Elo-Punkten an der Spitze.` };
    case 'record': return { title: `Rekord! ${allTimeText(s.record, c)}`, sub: allTimeSub(s.record) };
    case 'streak': return { title: `${n(c, s.id)}: ${s.n} Siege in Folge`, sub: `Die längste Serie im ${c.monthName}.` };
    case 'riser': return { title: `${n(c, s.id)} ist Aufsteiger des Monats`, sub: `${fmt.signed(s.gain)} Elo-Punkte aus ${gamesDat(s.games)}.` };
    case 'upset': return { title: `${list(c, s.winners)} ${s.winners.length > 1 ? 'schlagen' : 'schlägt'} ${list(c, s.losers)}`,
      sub: `Mit nur ${fmt.pct(s.chance)} Siegchance: die größte Überraschung im ${c.monthName}.` };
    case 'tournament': return { title: `${s.winner?.name ?? '?'} ${s.winner?.members ? 'gewinnen' : 'gewinnt'} das ${s.name}`, sub: 'Der Turniersieger des Monats.' };
    case 'defended': return { title: `${n(c, s.id)} bleibt an der Spitze`, sub: `Platz 1 am Anfang und am Ende des ${c.monthName}s.` };
    case 'duel': return { title: `${n(c, s.a)} gegen ${n(c, s.b)}: ${s.n} Mal`, sub: `Das Duell des Monats steht ${s.wa}:${s.wb}.` };
    default: return { title: `${games(s.games)} im ${c.monthName}`, sub: 'Ein ruhiger Monat an der Platte.' };
  }
}

export function allTimeText(r, c) {
  const who = list(c, r.who);
  if (r.kind === 'gain') return `${who} gewinnt ${fmt.elo(r.now)} Elo-Punkte in einem Spiel`;
  if (r.kind === 'upset') return `${who} gewinnt mit ${fmt.pct(r.now)} Siegchance`;
  return `${who} gewinnt ${r.now} Spiele in Folge`;
}
export const allTimeSub = r => (r.kind === 'upset' ? `Bisheriger Rekord: ${fmt.pct(r.old)}.` : `Bisheriger Rekord: ${r.kind === 'gain' ? fmt.elo(r.old) : r.old}.`);

/** The personal line on a player card. */
export function lineText(l, c) {
  switch (l.kind) {
    case 'pause': return l.place ? `Im ${c.monthName} Pause · Platz ${l.place}${l.kept ? ' gehalten' : ''}` : `Im ${c.monthName} Pause`;
    case 'newLeader': return 'Neu auf Platz 1';
    case 'leader': return 'Platz 1 gehalten';
    case 'upset': return `Schlug ${n(c, l.opp)} mit ${fmt.pct(l.chance)} Siegchance`;
    case 'cracked': return `Erster Sieg gegen ${n(c, l.opp)} nach ${l.losses} Niederlagen`;
    case 'streak': return `${l.n} Siege in Folge`;
    case 'climb': return `${l.n} Plätze nach oben`;
    case 'new': return `Neu dabei seit ${fmt.date(l.t)}`;
    case 'badge': return `Abzeichen: ${badgeLabel(c.cfg, l.badge, l.level)}${l.more ? ` (+${l.more})` : ''}`;
    case 'gain': return `${fmt.signed(l.delta)} in einem Spiel`;
    case 'regular': return `Stammgast: an ${l.days} von ${l.of} Spieltagen`;
    case 'rival': return `Meist gegen ${n(c, l.opp)}: ${half(l.n)} Begegnungen`;
    default: return `${games(l.games)}, ${l.wins} gewonnen`;
  }
}

/** „Rekorde des Monats“ tiles: label, the value, who and when. */
export function recordTiles(R, c) {
  const out = [];
  if (R.upset) out.push({ label: 'Größte Überraschung', value: fmt.pct(R.upset.chance), who: `${list(c, R.upset.winners)} gegen ${list(c, R.upset.losers)}`, when: fmt.date(R.upset.t) });
  if (R.streak) out.push({ label: 'Längste Siegesserie', value: `${R.streak.n} Siege`, who: n(c, R.streak.id), when: '' });
  if (R.gain) out.push({ label: 'Größter Gewinn', value: fmt.signed(R.gain.delta), who: `${list(c, R.gain.winners)} gegen ${list(c, R.gain.losers)}`, when: fmt.date(R.gain.t) });
  if (R.bestDay) out.push({ label: 'Bester Tag', value: fmt.signed(R.bestDay.gain), who: n(c, R.bestDay.id), when: fmt.date(R.bestDay.t) });
  if (R.marathon) out.push({ label: 'Marathon', value: `${R.marathon.n} Spiele am Stück`, who: n(c, R.marathon.id), when: fmt.date(R.marathon.t) });
  if (R.duel) out.push({ label: 'Duell des Monats', value: `${R.duel.n} Mal`, who: `${n(c, R.duel.a)} ${R.duel.wa}:${R.duel.wb} ${n(c, R.duel.b)}`, when: '' });
  return out;
}

export function numbersRow(N, c) {
  return [
    { value: fmt.int(N.games), label: 'Spiele' },
    { value: fmt.int(N.days), label: 'Spieltage' },
    N.maxDay ? { value: fmt.int(N.maxDay.n), label: `Spiele am ${fmt.date(N.maxDay.t).slice(0, 6)}, dem vollsten Tag` } : null,
    { value: fmt.int(Math.round(N.eloMoved)), label: 'Elo-Punkte wechselten den Besitzer' },
    { value: fmt.int(N.active), label: 'Aktive' },
    N.newcomers ? { value: fmt.int(N.newcomers), label: N.newcomers === 1 ? 'Neuzugang' : 'Neuzugänge' } : null,
  ].filter(Boolean);
}

export function riddleFacts(r) {
  return r.facts.map(f => {
    switch (f.kind) {
      case 'games': return `${games(f.n)} in diesem Monat`;
      case 'notBefore': return `nie vor ${f.h} Uhr`;
      case 'notAfter': return `nie nach ${f.h} Uhr`;
      case 'oppStreak': return `${f.n} Siege in Folge gegen dieselbe Person`;
      case 'weekday': return `am liebsten am ${WEEKDAYS[f.d]}`;
      case 'doubles': return `${fmt.pct(f.share)} Doppel`;
      default: return `${fmt.pct(f.share)} gewonnen`;
    }
  });
}
