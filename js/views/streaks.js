// Serien: current win and loss streaks of everyone. ?id=… puts that player's streak first.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { viewHead, nameOf, plainTable, linkTo } from './common.js';
import { streaks, ownRange } from './insights.js';

export default {
  id: 'serien',
  title: 'Serien',
  mount(el, ctx) {
    const update = c => render(el, page(c));
    update(ctx);
    return { update, unmount() {} };
  },
};

function page(ctx) {
  const { model } = ctx;
  const games = model.dataset.games;
  const mark = model.elo.index.get(ctx.params.id);
  const all = streaks(model).filter(s => !ctx.visible.inactive.has(s.k));
  const first = list => (mark === undefined ? list : [...list.filter(s => s.k === mark), ...list.filter(s => s.k !== mark)]);
  const section = (title, list, word) => [
    h('h2', {}, title),
    list.length
      ? plainTable(['Spieler', word, 'seit'],
          list.map(s => {
            const startG = model.elo.history[s.k].g.at(-s.n);
            return [h('span', { class: s.k === mark ? 'strong' : null }, nameOf(ctx, s.k)), String(s.n),
              fmt.when(games[startG].t, ctx.now, games[startG].approxTime)];
          }),
          [1],
          list.map(s => linkTo(ctx, 'spiele', ownRange(model, s.k, model.elo.lastG[s.k], s.n))))
      : h('p', { class: 'muted' }, 'Gerade niemand.'),
  ];
  return [
    viewHead('Serien', 'Wie viele Spiele in Folge jemand zuletzt gewonnen oder verloren hat. Tippe auf eine Zeile für die Spiele der Serie.'),
    section('Siegesserien', first(all.filter(s => s.win)), 'Siege in Folge'),
    section('Niederlagenserien', first(all.filter(s => !s.win)), 'Niederlagen in Folge'),
    h('nav', { class: 'links' }, h('a', { class: 'tap', ...linkTo(ctx, 'records') }, 'Die längsten Serien aller Zeiten: Rekorde')),
  ];
}
