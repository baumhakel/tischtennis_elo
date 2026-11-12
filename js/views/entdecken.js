// Entdecken: the hub behind the third tab. Short groups of cards with a one-line description each,
// instead of one long list. Pages that only make sense with context (Spiel, Team, Siegchance) are
// reached by links, not listed here.
import { h, render } from '../ui/dom.js';
import { viewHead, linkTo } from './common.js';

const GROUPS = [
  { title: 'Abzeichen', items: [
    ['abzeichen', 'Abzeichen', 'Wer was geschafft hat und was als Nächstes kommt'],
    ['ruhmeshalle', 'Ruhmeshalle', 'Aufsteiger jeder Woche und alle auf Platz 1'],
  ] },
  { title: 'Rangliste & Verlauf', items: [
    ['history', 'Verlauf', 'Elo-Werte über die Zeit, roh oder geglättet'],
    ['rank', 'Rangverlauf', 'Wer wann auf welchem Platz stand'],
    ['aufsteiger', 'Aufsteiger', 'Wer in den letzten sieben Tagen Punkte gewonnen oder verloren hat'],
    ['serien', 'Serien', 'Aktuelle Sieges- und Niederlagenserien'],
    ['records', 'Rekorde', 'Höchste Werte, längste Serien, Platz 1'],
  ] },
  { title: 'Spiele', items: [
    ['spiele', 'Alle Spiele', 'Jedes Spiel, filterbar nach Spielern'],
    ['upsets', 'Überraschungen', 'Siege gegen die Elo-Vorhersage'],
    ['activity', 'Aktivität', 'Wer wann wie viel spielt'],
    ['movement', 'Elo-Bewegung', 'Wie unruhig die Liga gerade ist'],
  ] },
  { title: 'Duelle & Teams', items: [
    ['h2h', 'Direktvergleich', 'Zwei Spieler oder zwei Teams im Vergleich'],
    ['matrix', 'Matrix', 'Jeder gegen jeden: Begegnungen, Siege, Elo-Bilanz'],
    ['partners', 'Doppelpartner', 'Wer mit wem zusammen gewinnt'],
  ] },
  { title: 'Statistik', items: [
    ['calibration', 'Kalibrierung', 'Wie gut die Siegchancen stimmen'],
  ] },
];

export default {
  id: 'entdecken',
  title: 'Entdecken',
  mount(el, ctx) {
    const update = c => render(el,
      viewHead('Entdecken'),
      GROUPS.map(g => h('section', { class: 'hub-group' },
        h('h3', {}, g.title),
        h('ul', { class: 'hub' }, g.items
          .filter(([id]) => !(c.mode === 'einzel' && id === 'partners'))   // no doubles in the singles league
          .map(([id, title, desc]) => h('li', {}, h('a', { class: 'hub-card tap', ...linkTo(c, id) },
            h('span', { class: 'hub-title' }, title), h('span', { class: 'hub-desc' }, desc))))))));
    update(ctx);
    return { update, unmount() {} };
  },
};
