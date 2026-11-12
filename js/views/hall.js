// Ruhmeshalle: the Aufsteiger of every completed calendar week (the badge „Aufsteiger der Woche“),
// the week that is still running, and everyone who stood on Platz 1, with how long.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { viewHead, plainTable, tableView, linkTo } from './common.js';
import { formatRef } from '../core/normalize.js';
import { isoWeek } from './badge-defs.js';
import { monthLabel } from '../core/window.js';
import { serialToParts } from '../core/normalize.js';

export default {
  id: 'ruhmeshalle',
  title: 'Ruhmeshalle',
  mount(el, ctx) {
    const update = c => render(el, page(c));
    update(ctx);
    return { update, unmount() {} };
  },
};

const day = t => formatRef(t).slice(0, 10);
const nameOf = (ctx, id) => ctx.names.get(id) ?? id;
const weekLabel = from => { const w = isoWeek(from); return `KW ${w.week}/${String(w.year).slice(2)}`; };
const range = (from, to) => `${fmt.date(from)} – ${fmt.date(to - 1)}`;
/** Games of that player in that week (Alle Spiele). */
const weekGames = (ctx, id, from, to) => linkTo(ctx, 'spiele', { spieler: id, von: day(from), bis: day(to - 1) });

function page(ctx) {
  const A = ctx.badges;
  const cfg = ctx.baseModel.dataset.config;
  const head = viewHead('Ruhmeshalle', 'Monatssieger, Aufsteiger jeder Woche und alle auf Platz 1.', { info: [
    `Monatsaufsteiger: meiste Elo-Punkte im Kalendermonat, mit mindestens ${cfg.monthly_min_games} Spielen im Monat und ${cfg.achievement_rank_min_games} Spielen insgesamt. Platz 1 am Monatsende: der Stand um Mitternacht am letzten Tag. Beides wird erst vergeben, wenn der Monat vorbei ist. Eine Zeile öffnet die Rangliste dieses Monats.`,
    `Aufsteiger der Woche: meiste Elo-Punkte von Montag bis Sonntag, mit mindestens ${cfg.rising_star_min_games} Spielen in der Woche und mindestens ${cfg.achievement_rank_min_games} Spielen insgesamt. Vergeben wird erst, wenn die Woche vorbei ist. Gezählt werden alle Spiele, unabhängig von der Wertung.`,
    'Die Kachel „Aufsteiger (letzte 7 Tage)“ auf der Übersicht zählt dagegen immer die letzten sieben Tage bis jetzt.',
    `Platz 1: unter den Spielern mit mindestens ${cfg.achievement_rank_min_games} Spielen, die in den ${cfg.achievement_rank_active_days} Tagen davor gespielt haben. Wer länger nicht spielt, verliert Platz 1 nach dieser Frist.`] });
  if (!A) return [head, h('p', { class: 'empty' }, 'Wird berechnet …')];

  const weeks = A.weekly.filter(w => w.id);
  const tally = new Map();
  for (const w of weeks) tally.set(w.id, (tally.get(w.id) || 0) + 1);
  const most = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const run = A.running;

  const weekRows = () => weeks.map(w => [weekLabel(w.from), nameOf(ctx, w.id), h('span', { class: 'up' }, fmt.signed(w.gain)), String(w.games)]);
  const weekLinks = weeks.map(w => weekGames(ctx, w.id, w.from, w.to));
  const SHOW = 8;

  const reigns = A.reigns;
  const main = reigns.filter(r => r.days >= 1 || r.current);   // the full list also shows changes within a day
  const reignRow = r => [nameOf(ctx, r.id), fmt.date(r.from), r.current ? 'bis heute' : fmt.date(r.to), fmt.int(Math.floor(r.days))];
  const reignLink = r => linkTo(ctx, 'abzeichen', { spieler: r.id });
  const longest = reigns.slice().sort((a, b) => b.days - a.days)[0];

  const mLabel = m => { const p = serialToParts(m); return monthLabel(p.y, p.mo); };
  const mRange = (from, to) => `${day(from)}..${day(to - 1)}`;
  const months = A.monthly.filter(m => m.riser || m.leader);
  const monthRows = () => months.map(m => [mLabel(m.from), m.riser ? [nameOf(ctx, m.riser.id), ' ', h('span', { class: 'up' }, fmt.signed(m.riser.gain))] : '–', m.leader ? nameOf(ctx, m.leader) : '–']);
  const monthLinks = () => months.map(m => linkTo(ctx, 'rangliste', {}, { range: mRange(m.from, m.to) }));
  const rm = A.runningMonth;

  return [
    head,
    h('h3', { class: 'sec' }, 'Monatssieger'),
    rm ? h('a', { class: 'running tap', ...linkTo(ctx, 'rangliste', {}, { range: 'monat' }) },
      h('span', { class: 'run-label' }, `${mLabel(rm.from)} · läuft noch`),
      h('span', { class: 'run-who' }, rm.riser ? `${nameOf(ctx, rm.riser.id)} führt mit ${fmt.signed(rm.riser.gain)} aus ${rm.riser.games} Spielen` : `Noch hat niemand ${cfg.monthly_min_games} Spiele in diesem Monat.`),
      h('span', { class: 'run-sub' }, `${rm.leader ? `Gerade auf Platz 1: ${nameOf(ctx, rm.leader)}. ` : ''}Entschieden wird am Monatsende.`)) : null,
    months.length ? [
      plainTable(['Monat', 'Aufsteiger', 'Platz 1 am Ende'], monthRows().slice(0, SHOW), [], monthLinks().slice(0, SHOW)),
      months.length > SHOW ? tableView(`Alle ${months.length} Monate`, ['Monat', 'Aufsteiger', 'Platz 1 am Ende'], monthRows(), [], monthLinks()) : null,
    ] : h('p', { class: 'empty' }, 'Noch ist kein Monat mit einem Sieger vorbei.'),
    h('h3', { class: 'sec' }, 'Aufsteiger der Woche'),
    h('div', { class: 'running' },
      h('span', { class: 'run-label' }, `${run ? weekLabel(run.from) : 'Diese Woche'} · läuft noch`),
      run?.id
        ? h('a', { class: 'run-who tap', ...weekGames(ctx, run.id, run.from, run.to) }, `${nameOf(ctx, run.id)} führt mit ${fmt.signed(run.gain)} aus ${run.games} Spielen`)
        : h('span', { class: 'run-who muted' }, `Noch hat niemand ${cfg.rising_star_min_games} Spiele diese Woche.`),
      h('span', { class: 'run-sub' }, 'Entschieden wird am Montag um 0 Uhr.')),
    weeks.length ? [
      plainTable(['Woche', 'Aufsteiger', 'Punkte', 'Spiele'], weekRows().slice(0, SHOW), [2, 3], weekLinks.slice(0, SHOW)),
      weeks.length > SHOW ? tableView(`Alle ${weeks.length} Wochen`, ['Woche', 'Aufsteiger', 'Punkte', 'Spiele'], weekRows(), [2, 3], weekLinks) : null,
      most.length ? h('p', { class: 'note-line' }, 'Am häufigsten: ', most.slice(0, 3).map(([id, n], i) => [i ? ', ' : '',
        h('a', { ...linkTo(ctx, 'abzeichen', { spieler: id }) }, nameOf(ctx, id)), ` (${n}-mal)`])) : null,
    ] : h('p', { class: 'empty' }, 'Noch ist keine Woche mit einem Aufsteiger vorbei.'),
    h('h3', { class: 'sec' }, 'Platz 1'),
    reigns.length ? [
      plainTable(['Spieler', 'von', 'bis', 'Tage'], main.slice(0, SHOW).map(reignRow), [3], main.slice(0, SHOW).map(reignLink)),
      reigns.length > Math.min(SHOW, main.length) ? tableView(`Alle ${reigns.length} Wechsel auf Platz 1, auch kürzer als ein Tag`, ['Spieler', 'von', 'bis', 'Tage'], reigns.map(reignRow), [3], reigns.map(reignLink)) : null,
      longest ? h('p', { class: 'note-line' }, `Am längsten am Stück: ${nameOf(ctx, longest.id)} mit ${fmt.int(Math.floor(longest.days))} Tagen.`) : null,
    ] : h('p', { class: 'empty' }, 'Noch stand niemand auf Platz 1.'),
    h('nav', { class: 'links' }, h('a', { class: 'tap', ...linkTo(ctx, 'abzeichen') }, 'Alle Abzeichen')),
  ];
}
