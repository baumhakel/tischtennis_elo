// Entdecken: the hub behind the third tab. Short groups of cards with a one-line description each,
// instead of one long list. Pages that only make sense with context (Spiel, Team, Siegchance) are
// reached by links, not listed here.
import { h, render } from '../ui/dom.js';
import { viewHead, linkTo } from './common.js';
import { labAvailable } from '../app/lab.js';

const GROUPS = [
  { title: 'Abzeichen und Rückblick', items: [
    ['abzeichen', 'Abzeichen', 'Wer was geschafft hat und was als Nächstes kommt'],
    ['ruhmeshalle', 'Ruhmeshalle', 'Monatssieger, Aufsteiger jeder Woche, alle auf Platz 1'],
    ['rueckblick', 'Jahresrückblick', 'Das Jahr in Karten, für dich oder die ganze Runde'],
  ] },
  { title: 'Rangliste & Verlauf', items: [
    ['rangliste', 'Rangliste', 'Die ganze Tabelle, auch für einen Monat oder ein Jahr'],
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
    ['doppelspezialist', 'Doppelspezialist', 'Wer im Doppel stärker ist als im Einzel'],
  ] },
  { title: 'Statistik', items: [
    ['prognose', 'Prognose', 'Wer am Monatsende auf Platz 1 steht, in Prozent'],
    ['calibration', 'Kalibrierung', 'Wie gut die Siegchancen stimmen'],
    ['labor', 'Labor', 'Hot Hand, Revanche, Schere-Stein-Papier: Muster gegen den Zufall geprüft'],
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
          .filter(([id]) => id !== 'labor' || labAvailable(c.model, c.visible.shown.length))   // only with something to show
          .map(([id, title, desc]) => h('li', {}, h('a', { class: 'hub-card tap', ...linkTo(c, id) },
            h('span', { class: 'hub-title' }, title), h('span', { class: 'hub-desc' }, desc))))))));
    update(ctx);
    return { update, unmount() {} };
  },
};
