// Jahresrückblick: swipeable cards for one player (default „Ich“) or the whole league, one calendar year.
// Every card links to what it shows and can be shared as an image. Counts all games (like the Abzeichen).
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { viewHead, linkTo } from './common.js';
import { cardHtml } from '../ui/cards.js';
import { shareButton } from '../ui/share.js';
import { reviewYears, reviewSeason, playerYear, leagueYear, yearWindow } from './review-logic.js';
import { isoWeek } from './badge-defs.js';
import { medalSpec } from './share-cards.js';
import { formatRef } from '../core/normalize.js';

export default {
  id: 'rueckblick',
  title: 'Jahresrückblick',
  mount(el, ctx) {
    const update = c => { render(el, page(c)); wireDots(el); };
    update(ctx);
    return { update, unmount() {} };
  },
};

const nameOf = (ctx, id) => ctx.names.get(id) ?? id;
const day = t => formatRef(t).slice(0, 10);
const kw = t => { const w = isoWeek(t); return `KW ${w.week}`; };
const half = x => (Number.isInteger(x) ? fmt.int(x) : fmt.dec1(x));

function page(ctx) {
  const base = ctx.baseModel, cfg = base.dataset.config;
  const years = reviewYears(base.dataset);
  const season = reviewSeason(cfg, ctx.now);
  const year = years.includes(+ctx.params.jahr) ? +ctx.params.jahr : years.includes(season.year) ? season.year : years[0];
  const who = ctx.params.wer === 'liga' ? null : (ctx.params.wer || ctx.me?.id || null);
  const facts = who ? playerYear(base, ctx.badges, year, who, ctx.now) : leagueYear(base, ctx.badges, year, ctx.now);
  const { from, to } = yearWindow(year);
  const playedThatYear = base.elo.ids.filter(id => base.elo.history[base.elo.index.get(id)].g.some(g => { const t = base.dataset.games[g].t; return t >= from && t < to; }));
  const people = playedThatYear.sort((a, b) => nameOf(ctx, a).localeCompare(nameOf(ctx, b), 'de'));

  const controls = h('div', { class: 'toolbar' },
    h('label', { for: 'rb-year' }, 'Jahr'),
    h('select', { id: 'rb-year', onchange: e => ctx.setParams({ jahr: e.target.value }) },
      years.map(y => h('option', { value: String(y), selected: y === year ? true : null }, String(y)))),
    h('label', { for: 'rb-who' }, 'Für'),
    h('select', { id: 'rb-who', onchange: e => ctx.setParams({ wer: e.target.value }) },
      h('option', { value: 'liga', selected: who ? null : true }, 'die ganze Runde'),
      people.map(id => h('option', { value: id, selected: id === who ? true : null }, nameOf(ctx, id) + (id === ctx.me?.id ? ' (du)' : '')))));

  const head = viewHead(`Jahresrückblick ${year}`, ctx.now < to ? `Bisher, Stand ${fmt.date(ctx.now)}.` : null, { key: 'rueckblick', info: [
    'Zur Seite wischen für die nächste Karte. Jede Karte führt zu dem, was sie zeigt, und lässt sich als Bild teilen.',
    'Gezählt werden alle Spiele des Kalenderjahres, Einzel und Doppel, unabhängig von der gewählten Wertung.',
    'Bei Altdaten sind die Uhrzeiten geschätzt. Angaben zu Wochen sind dann ungefähr („ca.“).',
    `Platz am Jahresende: wie in der Rangliste, ab ${cfg.default_min_games} Spielen und mit einem Spiel in den ${cfg.default_inactivity_days} Tagen davor.`] });

  if (!facts) return [head, controls, h('p', { class: 'empty' }, who ? `${nameOf(ctx, who)} hat ${year} nicht gespielt.` : `${year} gab es keine Spiele.`)];
  const specs = who ? playerCards(ctx, facts) : leagueCards(ctx, facts);
  const tag = who ? nameOf(ctx, who) : 'runde';
  return [head, controls,
    h('div', { class: 'review-track', tabindex: '0', 'aria-label': 'Karten, zur Seite wischen' },
      specs.map((s, i) => h('div', { class: 'review-slide' }, cardHtml(s),
        h('div', { class: 'review-share' }, shareButton(() => s, { name: `rueckblick-${year}-${tag}-${i + 1}` }), h('span', {}, `${i + 1} / ${specs.length}`))))),
    h('div', { class: 'review-dots', 'aria-hidden': 'true' }, specs.map((_, i) => h('span', { class: i ? '' : 'on' })))];
}

function wireDots(el) {
  const track = el.querySelector('.review-track'), dots = el.querySelectorAll('.review-dots span');
  if (!track || !dots.length) return;
  track.addEventListener('scroll', () => {
    const i = Math.round(track.scrollLeft / track.clientWidth);
    dots.forEach((d, j) => d.classList.toggle('on', j === i));
  }, { passive: true });
}

function playerCards(ctx, f) {
  const cfg = ctx.baseModel.dataset.config, id = f.id, name = nameOf(ctx, id);
  const kicker = `Jahresrückblick ${f.year}${f.running ? ' · bisher' : ''}`;
  const games = ctx.baseModel.dataset.games;
  const yearGames = linkTo(ctx, 'spiele', { spieler: id, von: `${f.year}-01-01`, bis: `${f.year}-12-31` });
  const cards = [];
  cards.push({ kicker, title: name, big: fmt.int(f.games), bigLabel: f.games === 1 ? 'Spiel' : 'Spiele',
    sub: `an ${fmt.int(f.days)} ${f.days === 1 ? 'Tag' : 'Tagen'} · Platz ${f.gamesRank} von ${f.gamesOf} nach Spielen`,
    lines: [{ label: 'Einzel', value: fmt.int(f.singles) }, { label: 'Doppel', value: fmt.int(f.doubles) }], link: yearGames });
  const diff = f.eloEnd - f.eloStart;
  cards.push({ kicker, title: 'Elo-Wert im Jahr', big: fmt.signed(diff), tone: diff >= 0 ? 'up' : 'down',
    bigLabel: `${fmt.elo(f.eloStart)} → ${fmt.elo(f.eloEnd)}`,
    sub: f.place ? `${f.running ? 'Gerade' : 'Am Jahresende'} Platz ${f.place} von ${f.placeOf}` : null,
    spark: f.spark, sparkLabels: [f.newcomer ? `erstes Spiel ${fmt.date(games[f.firstG].t)}` : '1. Jänner', f.running ? 'heute' : '31. Dezember'], link: linkTo(ctx, 'player', { id }) });
  const lines = [];
  if (f.streak) lines.push({ label: 'Längste Siegesserie', value: `${f.streak.len} Siege`,
    link: linkTo(ctx, 'spiele', { spieler: id, von: games[f.streak.fromG].ref, bis: games[f.streak.toG].ref }) });
  cards.push({ kicker, title: 'Bilanz', big: `${f.wins} : ${f.losses}`, bigLabel: 'Siege : Niederlagen',
    sub: `Siegquote ${fmt.pct(f.wins / f.games)}`, lines });
  if (f.bestWeek) cards.push({ kicker, title: 'Beste Woche', big: fmt.signed(f.bestWeek.gain), tone: 'up',
    bigLabel: `Elo-Punkte in der ${kw(f.bestWeek.from)}${f.approx ? ' (ca.)' : ''}`,
    sub: `${fmt.date(f.bestWeek.from)} bis ${fmt.date(f.bestWeek.from + 6)} · ${f.bestWeek.games} Spiele, ${f.bestWeek.wins} Siege`,
    link: linkTo(ctx, 'spiele', { spieler: id, von: day(f.bestWeek.from), bis: day(f.bestWeek.from + 6) }) });
  if (f.upset) {
    const x = games[f.upset.g], opp = x.losers.map(o => nameOf(ctx, o)).join(' & ');
    cards.push({ kicker, title: 'Größte Überraschung', big: fmt.pct(f.upset.chance), bigLabel: 'Siegchance vor dem Spiel',
      sub: `Sieg gegen ${opp}, ${x.approxTime ? 'ca. ' : ''}${fmt.date(x.t)}`, link: linkTo(ctx, 'spiel', { ref: x.ref }) });
  }
  const people = [];
  if (f.opponent) people.push({ label: 'Häufigster Gegner', value: `${nameOf(ctx, f.opponent.id)} · ${half(f.opponent.meetings)}×`, link: linkTo(ctx, 'h2h', { a: id, b: f.opponent.id }) });
  if (f.partner) people.push({ label: 'Häufigster Partner', value: `${nameOf(ctx, f.partner.id)} · ${f.partner.games} Doppel`, link: linkTo(ctx, 'team', { a: id, b: f.partner.id }) });
  if (f.favourite) people.push({ label: 'Lieblingsgegner', value: `${nameOf(ctx, f.favourite.id)} · ${half(f.favourite.wins)} : ${half(f.favourite.meetings - f.favourite.wins)}`, tone: 'up', link: linkTo(ctx, 'h2h', { a: id, b: f.favourite.id }) });
  if (f.nemesis) people.push({ label: 'Angstgegner', value: `${nameOf(ctx, f.nemesis.id)} · ${half(f.nemesis.wins)} : ${half(f.nemesis.meetings - f.nemesis.wins)}`, tone: 'down', link: linkTo(ctx, 'h2h', { a: id, b: f.nemesis.id }) });
  if (people.length) cards.push({ kicker, title: 'Gegner und Partner', lines: people,
    note: f.nemesis || f.favourite ? `Angst- und Lieblingsgegner ab ${cfg.h2h_min_games} Begegnungen in diesem Jahr.` : null });
  if (f.badges.length) cards.push({ kicker, title: 'Abzeichen', big: fmt.int(f.badges.length), bigLabel: f.badges.length === 1 ? 'neue Stufe' : 'neue Stufen',
    medals: f.badges.slice(-10).reverse().map(e => medalSpec(cfg, e)), link: linkTo(ctx, 'abzeichen', { spieler: id }) });
  return cards;
}

function leagueCards(ctx, f) {
  const kicker = `Jahresrückblick ${f.year}${f.running ? ' · bisher' : ''}`;
  const games = ctx.baseModel.dataset.games;
  const P = (id, value, tone) => ({ label: nameOf(ctx, id), value, tone, link: linkTo(ctx, 'player', { id }) });
  const cards = [];
  cards.push({ kicker, title: 'Die ganze Runde', big: fmt.int(f.games), bigLabel: 'Spiele',
    sub: `${f.players} Spieler · ${fmt.int(f.singles)} Einzel, ${fmt.int(f.doubles)} Doppel`,
    link: linkTo(ctx, 'spiele', { von: `${f.year}-01-01`, bis: `${f.year}-12-31` }) });
  if (f.top.length) cards.push({ kicker, title: f.running ? 'Rangliste heute' : 'Rangliste am Jahresende',
    lines: f.top.map((r, i) => ({ ...P(r.id, fmt.elo(r.rating)), label: `${i + 1}. ${nameOf(ctx, r.id)}` })) });
  if (f.mostGames.length) cards.push({ kicker, title: 'Die Fleißigsten', lines: f.mostGames.map(x => P(x.id, `${fmt.int(x.games)} Spiele`)) });
  if (f.gainers.length) cards.push({ kicker, title: 'Aufsteiger des Jahres', lines: f.gainers.map(x => P(x.id, fmt.signed(x.gain), x.gain >= 0 ? 'up' : 'down')),
    note: `Ab ${ctx.baseModel.dataset.config.default_min_games} Spielen im Jahr.` });
  if (f.leaders.length) cards.push({ kicker, title: 'Platz 1', big: fmt.int(f.leaders.length), bigLabel: f.leaders.length === 1 ? 'Spieler auf Platz 1' : 'verschiedene Spieler auf Platz 1',
    sub: f.longest ? `Am längsten am Stück: ${nameOf(ctx, f.longest.id)}, ${fmt.int(Math.floor(f.longest.days))} Tage` : null,
    lines: f.leaders.slice(0, 4).map(x => P(x.id, `${fmt.int(Math.floor(x.days))} Tage`)), link: null });
  if (f.risers.length) cards.push({ kicker, title: 'Aufsteiger der Woche', lines: f.risers.map(x => ({ label: nameOf(ctx, x.id), value: `${x.n}-mal`, link: linkTo(ctx, 'ruhmeshalle') })) });
  if (f.upset) {
    const x = games[f.upset.g];
    cards.push({ kicker, title: 'Größte Überraschung', big: fmt.pct(f.upset.chance), bigLabel: 'Siegchance vor dem Spiel',
      sub: `${x.winners.map(o => nameOf(ctx, o)).join(' & ')} gegen ${x.losers.map(o => nameOf(ctx, o)).join(' & ')}, ${x.approxTime ? 'ca. ' : ''}${fmt.date(x.t)}`,
      link: linkTo(ctx, 'spiel', { ref: x.ref }) });
  }
  if (f.busiestWeek) cards.push({ kicker, title: 'Die vollste Woche', big: fmt.int(f.busiestWeek.games), bigLabel: `Spiele in der ${kw(f.busiestWeek.from)}${f.approx ? ' (ca.)' : ''}`,
    sub: `${fmt.date(f.busiestWeek.from)} bis ${fmt.date(f.busiestWeek.from + 6)}`,
    link: linkTo(ctx, 'spiele', { von: day(f.busiestWeek.from), bis: day(f.busiestWeek.from + 6) }) });
  return cards;
}
