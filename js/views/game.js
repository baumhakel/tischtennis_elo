// Spiel: one game. Everyone involved with Elo before → after, the win chance, links onwards.
// URL: #/spiel?ref=<game_ref>. Without a valid ref: the latest game.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { tile, viewHead, modeNote, MODE_WORD } from './common.js';
import { findGame, gameFacts, sameRefCount } from './game-query.js';
import { linkTo, gameLink } from './games.js';
import { earnedInGame } from './badges.js';
import { shareButton } from '../ui/share.js';
import { gameSpec } from './share-cards.js';

export default {
  id: 'spiel',
  title: 'Spiel',
  mount(el, ctx) {
    const update = c => render(el, page(c));
    update(ctx);
    return { update, unmount() {} };
  },
};

function page(ctx) {
  const { dataset } = ctx.model;
  const games = dataset.games;
  if (!games.length) return h('p', { class: 'empty' }, 'Noch keine Spiele.');
  let g = findGame(dataset, ctx.params.ref);
  if (g < 0 && ctx.mode !== 'alle') {
    const bg = findGame(ctx.baseModel.dataset, ctx.params.ref);
    if (bg >= 0) {
      const y = ctx.baseModel.dataset.games[bg];
      const who = ids => ids.map(id => ctx.names.get(id) ?? id).join(' & ');
      return [viewHead(`${y.double ? 'Doppel' : 'Einzel'}, ${y.approxTime ? `ca. ${fmt.date(y.t)}` : `${fmt.date(y.t)}, ${fmt.time(y.t)} Uhr`}`, null, { back: true }),
        h('p', { class: 'lead' }, `${who(y.winners)} ${y.double ? 'schlagen' : 'schlägt'} ${who(y.losers)}.`),
        modeNote(`Dieses Spiel ist ein ${y.double ? 'Doppel' : 'Einzel'} und zählt in der Wertung „${MODE_WORD[ctx.mode]}“ nicht.`)];
    }
  }
  const missing = ctx.params.ref && g < 0;
  if (g < 0) g = games.length - 1;
  const f = gameFacts(ctx.model, g);
  const x = f.game;
  const name = id => ctx.names.get(id) ?? id;
  const team = ids => ids.map(name).join(' & ');
  const W = f.players.filter(p => p.side === 'w'), L = f.players.filter(p => p.side === 'l');
  const kind = x.double ? 'Doppel' : 'Einzel';

  const side = (label, ps, cls) => h('section', { class: 'side-card ' + cls },
    h('h3', {}, label),
    h('ul', { class: 'players' }, ps.map(p => h('li', {},
      h('a', { class: 'tap', ...linkTo(ctx, 'player', { id: p.id }) },
        h('span', { class: 'who' }, name(p.id)),
        h('span', { class: 'elo' }, `${fmt.elo(p.before)} → ${fmt.elo(p.after)}`),
        h('span', { class: 'd ' + (p.delta < 0 ? 'down' : 'up') }, fmt.signed(p.delta, 1)))))));

  // Direktvergleich: singles a vs b; doubles team against team (team mode of the h2h view)
  const duelParams = x.double
    ? { a: x.winners[0], a2: x.winners[1], b: x.losers[0], b2: x.losers[1] }
    : { a: x.winners[0], b: x.losers[0] };
  const ids = [...x.winners, ...x.losers];
  const dup = sameRefCount(dataset, g);

  return [
    viewHead(`${kind}, ${x.approxTime ? `ca. ${fmt.date(x.t)}` : `${fmt.date(x.t)}, ${fmt.time(x.t)} Uhr`}`, null, { key: 'spiel', back: true, share: shareButton(() => gameSpec(ctx, g), { name: 'spiel-' + x.ref }), info: [
      'Elo-Punkte: Der Sieger bekommt K × (1 − Siegchance vorher), der Verlierer verliert gleich viele. Im Doppel gilt das für jeden Partner, und die Teamstärke ist der Mittelwert der beiden Elo-Werte.',
      ['Der Zeitstempel unten bestimmt das Spiel eindeutig. Ist das Ergebnis falsch, ihn bitte ', ctx.model.dataset.config.form_support_url ? h('a', { href: ctx.model.dataset.config.form_support_url, target: '_blank', rel: 'noopener' }, 'im Support-Formular') : 'im Support-Formular', ' unter „Betroffenes Spiel“ angeben.']].map(x => (Array.isArray(x) ? h('p', {}, x) : x)) }),
    missing ? h('p', { class: 'error' }, 'Dieses Spiel gibt es in den geladenen Daten nicht (mehr). Angezeigt wird das letzte Spiel.') : null,
    h('p', { class: 'lead' }, `${team(x.winners)} ${x.double ? 'schlagen' : 'schlägt'} ${team(x.losers)}.`),
    h('div', { class: 'sides' }, side('Gewonnen', W, 'win'), side('Verloren', L, 'loss')),
    ctx.badges ? earnedInGame(ctx, ctx.badges, ctx.mode === 'alle' ? g : findGame(ctx.baseModel.dataset, x.ref)) : null,
    h('div', { class: 'tiles' },
      tile({ label: 'Siegchance vorher', value: fmt.pct(f.eW), sub: `für ${team(x.winners)}` }),
      tile({ label: 'Elo-Punkte', value: fmt.signed(f.delta, 1), tone: 'up', sub: x.double ? 'je Sieger gewonnen, je Verlierer verloren' : 'gewonnen und verloren' }),
      x.double ? tile({ label: 'Teamstärke vorher', value: `${fmt.elo(f.rW)} : ${fmt.elo(f.rL)}`, sub: 'Mittelwert der beiden Elo-Werte' }) : null,
      tile({ label: 'Spiel Nummer', value: fmt.int(g + 1), sub: `von ${fmt.int(games.length)}` })),
    h('nav', { class: 'links', 'aria-label': 'Weiter' },
      h('a', { class: 'tap', ...linkTo(ctx, 'h2h', duelParams) }, x.double ? 'Alle Spiele dieser beiden Teams' : `Alle Begegnungen von ${name(x.winners[0])} und ${name(x.losers[0])}`),
      x.double ? [x.winners, x.losers].map(t => h('a', { class: 'tap', ...linkTo(ctx, 'team', { a: t[0], b: t[1] }) }, `Team ${team(t)}`)) : null,
      h('a', { class: 'tap', ...linkTo(ctx, 'history', {}, { focus: ids }) }, 'Im Verlauf ansehen')),
    h('div', { class: 'pager' },
      g > 0 ? h('a', { class: 'secondary-btn', ...gameLink(ctx, g - 1) }, '‹ Voriges Spiel') : h('span'),
      g < games.length - 1 ? h('a', { class: 'secondary-btn', ...gameLink(ctx, g + 1) }, 'Nächstes Spiel ›') : h('span')),
    h('dl', { class: 'facts small' },
      h('dt', {}, 'Quelle'), h('dd', {}, x.source === 'legacy'
        ? `Altdaten${x.sourceRow != null ? `, Zeile ${x.sourceRow} der Excel-Liste` : ''}; die Uhrzeit ist geschätzt`
        : `Formulareintrag, Zeile ${x.row}`),
      x.corrected ? [h('dt', {}, 'Korrektur'), h('dd', {}, 'Ergebnis nachträglich getauscht')] : null,
      h('dt', {}, 'Zeitstempel'), h('dd', {}, h('code', {}, x.ref)),
      dup > 1 ? [h('dt', {}, 'Hinweis'), h('dd', {}, `${dup} Spiele haben diesen Zeitstempel, hier steht das erste.`)] : null),
  ];
}
