// Aufsteiger: everyone's Elo change over rising_star_days, and who qualifies for „Aufsteiger der Woche“.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { viewHead, nameOf, plainTable, linkTo } from './common.js';
import { risers } from './insights.js';

export default {
  id: 'aufsteiger',
  title: 'Aufsteiger',
  mount(el, ctx) {
    const update = c => render(el, page(c));
    update(ctx);
    return { update, unmount() {} };
  },
};

function page(ctx) {
  const cfg = ctx.model.dataset.config;
  const days = cfg.rising_star_days, min = cfg.rising_star_min_games;
  const r = risers(ctx.model, days, min);
  const rows = r.rows.filter(x => !ctx.visible.inactive.has(x.k));
  const ok = x => x.qualifies && ctx.visible.isShown(x.k);
  const winner = rows.find(ok);
  const span = days === 7 ? 'der letzten sieben Tage' : `der letzten ${days} Tage`;   // rolling window up to now
  return [
    viewHead('Aufsteiger', `Elo-Veränderung ${span}.`, { info: [`Gezählt wird seit ${fmt.when(r.from, ctx.now)} Uhr: Elo-Wert jetzt minus Elo-Wert davor. Hervorgehoben (und auf der Übersicht gezeigt) wird, wer am meisten gewonnen hat, mit mindestens ${min} Spielen in dieser Zeit und ohne vorläufige Wertung.`,
      h('p', {}, 'Das Abzeichen „Aufsteiger der Woche“ zählt dagegen Kalenderwochen von Montag bis Sonntag und wird erst vergeben, wenn die Woche vorbei ist. Alle Gewinner stehen in der ', h('a', { ...linkTo(ctx, 'ruhmeshalle') }, 'Ruhmeshalle'), '.'),
      'Tippe auf eine Zeile für die Spiele dieser Zeit.'] }),
    h('nav', { class: 'links' }, h('a', { class: 'tap', ...linkTo(ctx, 'ruhmeshalle') }, 'Ruhmeshalle: Aufsteiger jeder Kalenderwoche')),
    rows.length
      ? plainTable(['Spieler', 'Veränderung', 'Spiele', 'Siege : Niederlagen'],
          rows.map(x => [
            h('span', { class: x === winner ? 'strong' : ok(x) ? null : 'muted' }, nameOf(ctx, x.k),
              x === winner ? h('span', { class: 'badge' }, 'Aufsteiger') : null,
              !ok(x) ? h('span', { class: 'sub' }, !x.qualifies ? `weniger als ${min} Spiele` : 'vorläufige Wertung') : null),
            h('span', { class: x.delta > 0.5 ? 'up' : x.delta < -0.5 ? 'down' : null }, fmt.signed(x.delta)),
            String(x.games), `${x.wins} : ${x.losses}`]),
          [1, 2, 3],
          rows.map(x => linkTo(ctx, 'spiele', { spieler: ctx.model.elo.ids[x.k], von: r.fromRef })))
      : h('p', { class: 'empty' }, `In dieser Zeit wurde nicht gespielt.`),
  ];
}
