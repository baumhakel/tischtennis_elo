// Turnier (Phase 18, #/turnier?id=): one tournament on one page. While it runs: what to play next, open matches,
// the group tables (who is through), the knockout bracket, a rough end time. Afterwards: the podium with the
// winner photo. Without an ID: the tournament going on now, else the newest.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { viewHead, tile, linkTo } from './common.js';
import { pickTournament, entryOpen } from '../app/tournaments.js';
import { suggestions, timeLeft } from '../core/tournament.js';
import { sideLabel, sideName, matchList, groupTableView, bracketView, plural } from './tournament-ui.js';
import { photoStrip, thumbButton, showPhotos } from './photo-ui.js';
import { demoResult } from './tournament-match.js';

export const STATUS_TEXT = { test: 'Testlauf', aktiv: 'läuft', beendet: 'beendet', entwurf: 'in Vorbereitung' };

export default {
  id: 'turnier',
  title: 'Turnier',
  mount(el, ctx) {
    const update = c => render(el, page(c));
    update(ctx);
    return { update, unmount() {} };
  },
};

function page(ctx) {
  const T = pickTournament(ctx.tournaments, ctx.params.id);
  const fromList = !!ctx.params.id;
  if (!T) {
    return [viewHead('Turnier', null, { back: fromList }),
      h('p', { class: 'empty' }, ctx.params.id ? 'Dieses Turnier gibt es nicht (oder es ist noch in Vorbereitung).' : 'Gerade läuft kein Turnier.'),
      ctx.tournaments?.list.length ? h('p', {}, h('a', { class: 'inline-link', ...linkTo(ctx, 'turniere') }, 'Alle Turniere')) : null];
  }
  const head = viewHead(T.name, [T.date != null ? fmt.date(T.date) : null, STATUS_TEXT[T.status]].filter(Boolean).join(' · '), {
    back: fromList, key: 'turnier', info: [
      'Erst spielt jede Gruppe jeder gegen jeden, dann geht es im K.-o.-System weiter. In der Tabelle zählen Siege, bei Gleichstand der direkte Vergleich, dann die Satz- und dann die Punktdifferenz, zuletzt das Los.',
      '„weiter“ heißt: steht sicher in der K.-o.-Runde, egal wie die übrigen Gruppenspiele ausgehen. Ein K.-o.-Spiel kann beginnen, sobald beide Gegner feststehen.',
      'Spiele zwischen zwei Mitgliedern zählen ganz normal für Elo. Spiele mit Gästen zählen nur im Turnier.',
      'Ein falsch eingetragenes Ergebnis wird einfach noch einmal eingetragen: es gilt immer der letzte Eintrag eines Spiels.'] });
  if (!T.ok) return [head, h('p', { class: 'empty' }, T.problem)];

  const open = T.matches.filter(m => m.status === 'offen');
  const time = !T.done && T.status !== 'beendet' ? timeLeft(T, ctx.baseModel.dataset.config.tournament_game_minutes) : null;
  const winner = T.winner ? T.participants.find(p => p.key === T.winner) : null;
  const groupMatches = g => T.matches.filter(m => m.stage === 'gruppe' && m.group === g);
  return [
    head,
    T.status === 'test' ? h('p', { class: 'hint' }, 'Testlauf: nur mit ?turniertest zu sehen, zählt nicht für Elo.') : null,
    T.done || winner ? podium(ctx, T) : null,
    h('div', { class: 'tiles' },
      tile({ label: 'Gespielt', value: `${T.played} von ${T.total}`, sub: T.done ? 'alle Spiele' : plural(open.length, 'Spiel kann jetzt beginnen', 'Spiele können jetzt beginnen') }),
      time ? tile({ label: 'Noch etwa', value: time.minutes >= 60 ? `${Math.floor(time.minutes / 60)} h ${String(time.minutes % 60).padStart(2, '0')}` : `${time.minutes} min`,
        sub: time.measured ? `bei ${time.per} min pro Spiel bisher` : `geschätzt mit ${time.per} min pro Spiel` })
        : tile({ label: 'Teilnehmer', value: String(T.participants.length), sub: guestsText(T) })),
    !T.done && open.length ? nextUp(ctx, T) : null,
    T.tables.length ? h('section', {}, h('h3', {}, T.tables.length > 1 ? 'Gruppen' : 'Tabelle'),
      T.tables.map(t => [groupTableView(ctx, T, t),
        h('details', { class: 'tt-details' }, h('summary', {}, `Spiele der Gruppe ${t.letter} (${groupMatches(t.group).filter(m => m.result).length} von ${groupMatches(t.group).length})`),
          matchList(ctx, T, groupMatches(t.group), { round: false }))])) : null,
    T.bracket.length ? h('section', {}, h('h3', {}, 'K.-o.-Runde'), bracketView(ctx, T)) : null,
    photoStrip(ctx, 'turnier', T.id, { title: 'Fotos vom Turnier' }),
    issues(T),
    h('p', { class: 'muted small' }, h('a', { class: 'inline-link', ...linkTo(ctx, 'spiele', { quelle: 'turnier' }) }, 'Alle Turnierspiele, die für Elo zählen'),
      ctx.tournaments.list.length > 1 ? [' · ', h('a', { class: 'inline-link', ...linkTo(ctx, 'turniere') }, 'Alle Turniere')] : null),
  ];
}

const guestsText = T => { const g = T.participants.filter(p => p.guest).length; return g ? `davon ${plural(g, 'Gast', 'Gäste')}` : 'alle aus der Runde'; };

/** „Als Nächstes“: the suggested matches with a direct way to enter them, then every other open match. */
function nextUp(ctx, T) {
  const n = Math.max(ctx.baseModel.dataset.config.tournament_suggestions, 1);
  const sug = suggestions(T, n);
  const rest = T.matches.filter(m => m.status === 'offen' && !sug.includes(m));
  const demo = ctx.state.auth?.demo && entryOpen(T);
  return h('section', {},
    h('h3', {}, 'Als Nächstes'),
    h('p', { class: 'muted small' }, 'Ein Vorschlag: wer am wenigsten gespielt oder am längsten gewartet hat. Jedes offene Spiel darf jederzeit gespielt werden.'),
    matchList(ctx, T, sug),
    rest.length ? h('details', { class: 'tt-details' }, h('summary', {}, `Weitere offene Spiele (${rest.length})`), matchList(ctx, T, rest)) : null,
    demo ? h('div', { class: 'menu-actions' }, h('button', { type: 'button', class: 'secondary small',
      onclick: e => { e.currentTarget.disabled = true; demoResult(ctx, T, sug[0]); } }, 'Nächstes Ergebnis (Demo)')) : null);
}

/** Winner, runner-up and third, with the winner photo if one is chosen. */
function podium(ctx, T) {
  const p = key => T.participants.find(x => x.key === key);
  const line = (place, key) => key ? h('li', { class: `tt-place tt-place-${place}` }, h('span', { class: 'tt-rank' }, `${place}.`), sideLabel(ctx, p(key), { size: place === 1 ? 40 : 28, strong: place === 1 })) : null;
  const photos = ctx.photos?.on ? ctx.photos.list('turnier', T.id) : [];
  const shot = T.winnerPhoto ? photos.find(x => x.id === T.winnerPhoto) : null;
  return h('section', { class: 'tt-podium' },
    h('h3', {}, T.done ? `${sideName(ctx, p(T.winner))} gewinnt` : 'Sieger'),
    shot ? h('div', { class: 'tt-winner-photo' }, thumbButton(ctx, shot, () => showPhotos(ctx, photos, photos.indexOf(shot)), 220)) : null,
    h('ol', { class: 'tt-places' }, line(1, T.winner), line(2, T.second), T.third.map(k => line(3, k))));
}

function issues(T) {
  if (!T.issues.length) return null;
  return h('details', { class: 'tt-details' }, h('summary', {}, plural(T.issues.length, 'Eintrag wird nicht gewertet', 'Einträge werden nicht gewertet')),
    h('ul', { class: 'small' }, T.issues.map(i => h('li', {}, i.text, i.row ? h('span', { class: 'muted' }, ` (Zeile ${i.row})`) : null))),
    h('p', { class: 'muted small' }, 'Ein neuer, richtiger Eintrag für dasselbe Spiel ersetzt den falschen.'));
}
