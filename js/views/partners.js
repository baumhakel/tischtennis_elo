// Doppelpartner: who plays doubles with whom, and which teams beat expectations.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { viewHead, paramSelect, nameOf, linkTo, profileLink, modeNote, chemValue, chemRange } from './common.js';
import { matrixTable } from './matrix-table.js';
import { order } from './matrix-metrics.js';
import { bestTeams } from './duels.js';


const METRICS = [
  { id: 'spiele', stat: 'games', label: 'Doppel zusammen', kind: 'seq', fmt: v => String(Math.round(v)),
    lead: 'Wie oft zwei Spieler gemeinsam ein Doppel gespielt haben.' },
  { id: 'quote', stat: 'winRatio', label: 'Siegquote zusammen (%)', kind: 'div', mid: 0.5, fmt: v => String(Math.round(100 * v)),
    lead: 'Anteil der gemeinsamen Doppel, die das Team gewonnen hat.' },
  { id: 'chemie', label: 'Teamchemie (pro 100 Doppel)', kind: 'div', mid: 0, fmt: v => fmt.signed(100 * v),
    lead: 'Siege über Erwartung pro 100 Doppel, geschrumpft. Positiv heißt: Die beiden harmonieren.' },
];

export const NO_CHEM = 'In den Daten ist keine echte Teamchemie nachweisbar.';

/** The (i) for Teamchemie, shared with the Team page. */
export function chemInfo(ctx, C) {
  const p = C.p < 0.001 ? 'unter 0,001' : C.p.toFixed(3).replace('.', ',');
  return [
    'Lesart der Matrix: Zeile mit Spalte. Leere Felder: Die beiden haben nie zusammen gespielt. Tippe auf ein Feld oder ein Team für die Teamseite.',
    'Teamchemie: Siege minus die Summe der Siegchancen vor jedem gemeinsamen Doppel, pro 100 Doppel. Weil wenige Doppel viel Zufall enthalten, wird jeder Wert zur Null hin geschrumpft, umso stärker, je weniger Doppel das Team hat (empirischer Bayes-Ansatz). Die Klammer ist das 95-%-Intervall.',
    C.fitted
      ? `Wie stark sich Teams wirklich unterscheiden, wird aus den ${C.fitted} Teams mit mindestens ${ctx.model.dataset.config.team_min_games} Doppeln geschätzt: Streuung ${C.tau2 > 0 ? `etwa ${fmt.signed(100 * C.tau).replace('+', '±')} pro 100 Doppel` : 'null'}. Test auf echte Unterschiede: p = ${p}.`
      : 'Noch kein Team hat genug gemeinsame Doppel für die Schätzung.',
  ];
}

export default {
  id: 'partners',
  title: 'Doppelpartner',
  mount(el, ctx) {
    const update = c => {
      if (c.mode === 'einzel') return render(el, viewHead('Doppelpartner'), modeNote('In der Wertung „Einzel“ gibt es keine Doppel.'));
      const metric = METRICS.find(m => m.id === c.params.metrik) || METRICS[0];
      const P = c.model.stats.get('partners');
      const C = c.model.stats.get('chemistry');
      const values = metric.id === 'chemie' ? C.est : P[metric.stat];
      const noChem = !(C.tau2 > 0);
      const n = c.model.elo.ids.length;
      const ks = order(c.visible.shown.filter(k => c.model.elo.doubles[k] > 0), 'elo', { elo: c.model.elo, normed: null, names: k => nameOf(c, k) });
      const cfg = c.model.dataset.config;
      const teams = bestTeams(c.model, ks, cfg.team_min_games);
      const team = (i, j) => linkTo(c, 'team', { a: c.model.elo.ids[i], b: c.model.elo.ids[j] });
      render(el,
        viewHead('Doppelpartner', metric.lead, { info: chemInfo(c, C) }),
        h('div', { class: 'toolbar' }, paramSelect(c, { label: 'Kennzahl', param: 'metrik', value: metric.id, options: METRICS.map(m => [m.id, m.label]) })),
        ks.length < 2 ? h('p', { class: 'empty' }, 'Zu wenige Doppelspieler sichtbar.')
          : metric.id === 'chemie' && noChem ? h('p', { class: 'empty' }, NO_CHEM)
          : matrixTable(c, values, n, ks, metric,
              { cell: (i, j) => team(i, j), head: k => profileLink(c, k) }),
        h('h2', {}, 'Teams'),
        teams.length
          ? [h('p', { class: 'lead' }, noChem
              ? `${NO_CHEM} Alle Teams mit mindestens ${cfg.team_min_games} gemeinsamen Doppeln, die häufigsten zuerst.`
              : `Alle Teams mit mindestens ${cfg.team_min_games} gemeinsamen Doppeln, sortiert nach Teamchemie (rechts, pro 100 Doppel). Links die Siegquote.`),
             h('ol', { class: 'upsets' }, (noChem ? teams.slice().sort((x, y) => y.n - x.n) : teams).map(t => h('li', { class: 'linked' }, h('a', { class: 'row tap', ...team(t.i, t.j) },
              h('span', { class: 'pct' }, fmt.pct(t.ratio)),
              h('span', { class: 'who' }, `${nameOf(c, t.i)} & ${nameOf(c, t.j)}`),
              noChem ? h('span', { class: 'd' }) : h('span', { class: 'd ' + (t.lo > 0 ? 'up' : t.hi < 0 ? 'down' : '') }, chemValue(t.est)),
              h('span', { class: 'meta' }, noChem
                ? `${t.n} Doppel, ${t.wins} Siege`
                : `${t.n} Doppel, ${t.wins} Siege, Teamchemie ${chemRange(t.lo, t.hi)} (95 %)`)))))]
          : h('p', { class: 'muted' }, `Noch kein Team mit mindestens ${cfg.team_min_games} gemeinsamen Doppeln.`));
    };
    update(ctx);
    return { update, unmount() {} };
  },
};
