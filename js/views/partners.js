// Doppelpartner: who plays doubles with whom, and which teams beat expectations.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { viewHead, paramSelect, nameOf, linkTo, profileLink, modeNote } from './common.js';
import { matrixTable } from './matrix-table.js';
import { order } from './matrix-metrics.js';
import { bestTeams } from './duels.js';

const sgn = v => fmt.signed(v, 2).replace('±0,0', '±0');

const METRICS = [
  { id: 'spiele', stat: 'games', label: 'Doppel zusammen', kind: 'seq', fmt: v => String(Math.round(v)),
    lead: 'Wie oft zwei Spieler gemeinsam ein Doppel gespielt haben.' },
  { id: 'quote', stat: 'winRatio', label: 'Siegquote zusammen (%)', kind: 'div', mid: 0.5, fmt: v => String(Math.round(100 * v)),
    lead: 'Anteil der gemeinsamen Doppel, die das Team gewonnen hat.' },
  { id: 'chemie', stat: 'chemistryPerGame', label: 'Siege über Erwartung pro Doppel', kind: 'div', mid: 0, fmt: sgn,
    lead: 'Gewinnt das Team öfter, als die Elo-Werte vor jedem Spiel erwarten ließen? Positiv heißt: Die beiden harmonieren.' },
];

export default {
  id: 'partners',
  title: 'Doppelpartner',
  mount(el, ctx) {
    const update = c => {
      if (c.mode === 'einzel') return render(el, viewHead('Doppelpartner'), modeNote('In der Wertung „Einzel“ gibt es keine Doppel.'));
      const metric = METRICS.find(m => m.id === c.params.metrik) || METRICS[0];
      const P = c.model.stats.get('partners');
      const n = c.model.elo.ids.length;
      const ks = order(c.visible.shown.filter(k => c.model.elo.doubles[k] > 0), 'elo', { elo: c.model.elo, normed: null, names: k => nameOf(c, k) });
      const cfg = c.model.dataset.config;
      const teams = bestTeams(c.model, ks, cfg.team_min_games);
      const team = (i, j) => linkTo(c, 'team', { a: c.model.elo.ids[i], b: c.model.elo.ids[j] });
      render(el,
        viewHead('Doppelpartner', metric.lead),
        h('div', { class: 'toolbar' }, paramSelect(c, { label: 'Kennzahl', param: 'metrik', value: metric.id, options: METRICS.map(m => [m.id, m.label]) })),
        ks.length < 2 ? h('p', { class: 'empty' }, 'Zu wenige Doppelspieler sichtbar.')
          : matrixTable(c, P[metric.stat], n, ks, { ...metric, note: 'Lesart: Zeile mit Spalte. Leere Felder: Die beiden haben nie zusammen gespielt. Tippe auf ein Feld für das Team.' },
              { cell: (i, j) => team(i, j), head: k => profileLink(c, k) }),
        h('h2', {}, 'Teams'),
        teams.length
          ? [h('p', { class: 'lead' }, `Alle Teams mit mindestens ${cfg.team_min_games} gemeinsamen Doppeln, sortiert nach Siegen über Erwartung pro Doppel (rechts). Links die Siegquote.`),
             h('ol', { class: 'upsets' }, teams.map(t => h('li', { class: 'linked' }, h('a', { class: 'row tap', ...team(t.i, t.j) },
              h('span', { class: 'pct' }, fmt.pct(t.ratio)),
              h('span', { class: 'who' }, `${nameOf(c, t.i)} & ${nameOf(c, t.j)}`),
              h('span', { class: 'd ' + (t.perGame < 0 ? 'down' : '') }, sgn(t.perGame)),
              h('span', { class: 'meta' }, `${t.n} Doppel, ${t.wins} Siege, insgesamt ${sgn(t.chem)} Siege über Erwartung`)))))]
          : h('p', { class: 'muted' }, `Noch kein Team mit mindestens ${cfg.team_min_games} gemeinsamen Doppeln.`));
    };
    update(ctx);
    return { update, unmount() {} };
  },
};
