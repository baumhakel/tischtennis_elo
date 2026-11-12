// Prognose: who is Platz 1 at the end of the month? Monte Carlo in a worker (app/forecast.js,
// core/forecast.js); this view only shows the result. Follows the Wertung, not the Zeitraum.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { viewHead, linkTo, plainTable, nameOf } from './common.js';
import { shareButton } from '../ui/share.js';
import { chance, monthEndLabel, forecastRows } from './forecast-logic.js';
import { mcError } from '../core/forecast.js';

const WERTUNG = { alle: '', einzel: ' · Wertung Einzel', doppel: ' · Wertung Doppel' };
const bar = p => h('span', { class: 'bar', role: 'presentation' }, h('span', { style: `width:${Math.round(100 * Math.max(0, Math.min(1, p)))}%` }));

export default {
  id: 'prognose',
  title: 'Prognose',
  mount(el, ctx) {
    const update = c => render(el, page(c));
    update(ctx);
    return { update, unmount() {} };
  },
};

function page(ctx) {
  const F = ctx.forecast;
  const info = method(ctx, F);
  if (!F) return [viewHead('Prognose', 'Wird berechnet …', { info }), h('p', { class: 'empty' }, 'Die Prognose rechnet im Hintergrund. Gleich geht’s weiter.')];
  const I = F.input, rows = forecastRows(F), label = monthEndLabel(F.end);
  const expected = Math.round(I.lambda);
  const lead = I.lambda > 0
    ? `Wer steht ${label} auf Platz 1? Bis dahin werden noch etwa ${expected === 1 ? 'ein Spiel' : `${fmt.int(expected)} Spiele`} erwartet.`
    : `Bis ${label} wird kein Spiel mehr erwartet: Die Rangliste steht so gut wie fest.`;
  const shown = rows.filter(r => r.p1 >= 0.005 || r.top3 >= 0.01);
  const rest = rows.length - shown.length;
  const spec = () => ({
    kicker: `Prognose · Platz 1 ${label}${WERTUNG[ctx.mode]}`,
    title: 'Tischtennis Elo',
    lines: shown.slice(0, 8).map(r => ({ label: nameOf(ctx, r.k), value: chance(r.p1) })),
  });
  return [
    viewHead('Prognose', lead, { key: 'prognose', info, share: rows.length ? shareButton(spec, { name: 'prognose' }) : null }),
    rows.length ? h('section', {},
      plainTable(['Spieler', `Platz 1`, 'Top 3', '⌀ Platz'],
        shown.map(r => [
          nameOf(ctx, r.k),
          h('span', { class: 'fc-p1' }, h('span', {}, chance(r.p1)), bar(r.p1)),
          chance(r.top3),
          Number.isFinite(r.place) ? r.place.toFixed(1).replace('.', ',') : '–',
        ]), [2, 3], shown.map(r => linkTo(ctx, 'player', { id: r.id }))),
      rest > 0 ? h('p', { class: 'chart-note' }, `${rest === 1 ? 'Ein weiterer Spieler hat' : `${rest} weitere Spieler haben`} weniger als 1\u00a0% Chance auf die Top 3.`) : null)
      : h('p', { class: 'empty' }, 'Noch niemand hat genug Spiele für die Rangliste.'),
    spotlightBlock(ctx, F),
    riserBlock(ctx, F, rows),
    backtestBlock(F),
  ];
}

function spotlightBlock(ctx, F) {
  const s = F.spot;
  if (!s || s.swing < 0.05) return null;
  const n = id => ctx.names.get(id) ?? id;
  const fav = n(s.fav);
  return h('section', {},
    h('h2', {}, 'Spitzenspiel'),
    h('a', { class: 'card tap fc-spot', ...linkTo(ctx, 'h2h', { a: s.a, b: s.b }) },
      h('strong', {}, `${n(s.a)} gegen ${n(s.b)}`),
      h('span', { class: 'meta' }, `Gewinnt ${n(s.a)}: ${fav} ${chance(s.ifA)} auf Platz 1. Gewinnt ${n(s.b)}: ${chance(s.ifB)}.`),
      h('span', { class: 'meta' }, 'Kein anderes Einzel bewegt die Prognose so stark.')));
}

function riserBlock(ctx, F, rows) {
  const cfg = ctx.model.dataset.config;
  const list = rows.filter(r => r.riser >= 0.01).sort((a, b) => b.riser - a.riser).slice(0, 3);
  if (!list.length || !(F.input.lambda > 0)) return null;
  return h('section', {},
    h('h2', {}, 'Monatsaufsteiger'),
    h('p', { class: 'lead' }, `Wer gewinnt diesen Monat die meisten Elo-Punkte (mindestens ${cfg.monthly_min_games} Spiele)?`),
    plainTable(['Spieler', 'Chance', 'Bisher', 'Spiele'],
      list.map(r => [nameOf(ctx, r.k), chance(r.riser), r.monthGames ? fmt.signed(r.gain) : '–', fmt.int(r.monthGames)]),
      [1, 2, 3], list.map(r => linkTo(ctx, 'player', { id: r.id }))));
}

function backtestBlock(F) {
  const head = h('summary', {}, 'Wie gut war die Prognose bisher?');
  if (F.bt === undefined) return h('details', { class: 'table-view' }, head, h('p', { class: 'chart-note' }, 'Wird berechnet …'));
  if (!F.bt) return h('details', { class: 'table-view' }, head, h('p', { class: 'chart-note' }, 'Dafür gibt es noch zu wenige abgeschlossene Monate.'));
  const { brier, bins, forecasts } = F.bt;
  const num = x => x.toFixed(2).replace('.', ',');
  const used = bins.filter(b => b.n > 0);
  return h('details', { class: 'table-view' }, head,
    h('p', { class: 'chart-note' }, `${fmt.int(forecasts)} Prognosen aus vergangenen Monaten, jeweils am 1., 10. und 20. gerechnet, nur mit den Spielen bis dahin. Danach verglichen mit Platz 1 am Monatsende.`),
    plainTable(['Verfahren', 'Fehler'], [
      ['Diese Prognose', num(brier.model)],
      ['„Wer jetzt führt, bleibt vorne“', num(brier.leader)],
      ['Chance nach Elo-Abstand, ohne Simulation', num(brier.softmax)],
    ], [1]),
    h('p', { class: 'chart-note' }, 'Fehler: Brier-Score, über alle Spieler einer Prognose zusammengezählt (0 = perfekt, 2 = sicher falsch). Kleiner ist besser.'),
    forecasts >= 20 && used.length >= 2 ? [
      h('p', { class: 'chart-note' }, 'Stimmen die Prozente? Je Bereich: wie oft der Spieler dann wirklich Platz 1 wurde.'),
      plainTable(['Vorhergesagt', 'Tatsächlich', 'Fälle'],
        used.map(b => [`${fmt.pct(b.lo)} bis ${fmt.pct(b.hi)}`, fmt.pct(b.freq), fmt.int(b.n)]), [1, 2]),
    ] : null);
}

function method(ctx, F) {
  const cfg = ctx.model.dataset.config;
  const err = F?.res ? Math.max(...forecastRows(F).map(r => 2 * mcError(r.p1, F.res.n)), 0) : 0;
  const I = F?.input;
  return [
    `Die Prognose spielt den Rest des Monats ${fmt.int(cfg.forecast_simulations)}-mal durch. Wie viele Spiele noch kommen, schätzt sie aus den letzten ${cfg.forecast_rate_days} Tagen${I ? ` (zuletzt ${I.perDay.toFixed(1).replace('.', ',')} Spiele pro Werktag)` : ''}, und wer gegen wen spielt auch: Paarungen von damals kommen wieder vor.`,
    'Elo-Werte sind nur Schätzungen. Deshalb bekommt jeder Spieler in jedem Durchlauf eine etwas andere „wahre“ Stärke, gestreut wie sein Elo-Wert zuletzt geschwankt hat. Wer stärker ist, gewinnt öfter, und die Elo-Werte ändern sich wie im echten Spiel.',
    `Platz 1 zählt nach der Standard-Wertung: mindestens ${ctx.mode === 'einzel' ? cfg.default_min_games_single : ctx.mode === 'doppel' ? cfg.default_min_games_double : cfg.default_min_games} Spiele und nicht länger als ${cfg.default_inactivity_days} Tage ohne Spiel am Monatsende.`,
    F?.res ? `Durch den Zufall der Simulation schwanken die Prozente um höchstens ±${Math.max(1, Math.round(100 * err))} Prozentpunkt${Math.round(100 * err) > 1 ? 'e' : ''}. Die Zahlen gelten für heute und ändern sich mit jedem neuen Spiel.` : null,
    'Spitzenspiel: das Einzel zwischen zwei Anwärtern, dessen Ausgang die Chance des Favoriten am stärksten verschiebt.',
  ].filter(Boolean);
}

