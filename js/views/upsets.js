// Überraschungen: games the favourite lost, biggest surprise first.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { viewHead, linkTo } from './common.js';

export default {
  id: 'upsets',
  title: 'Überraschungen',
  mount(el, ctx) {
    const update = c => render(el, page(c));
    update(ctx);
    return { update, unmount() {} };
  },
};

function page(ctx) {
  const { model, names } = ctx;
  const { games, config } = model.dataset;
  const { perGame } = model.elo;
  const up = model.stats.get('upsets');
  const team = ids => ids.map(id => names.get(id) ?? id).join(' & ');
  const list = Array.from(up.order.slice(0, config.upsets_list_length));
  return [
    viewHead('Überraschungen', `Die ${list.length} größten Überraschungen: Spiele, in denen der Sieger laut Elo die kleinste Siegchance hatte. Im Doppel zählt der Mittelwert des Teams.`),
    h('ol', { class: 'upsets' }, list.map(g => {
      const x = games[g];
      return h('li', { class: 'linked' }, h('a', { class: 'row tap', ...linkTo(ctx, 'spiel', { ref: x.ref }) },
        h('span', { class: 'pct', 'aria-label': `Siegchance ${fmt.pct(perGame.eW[g])}` }, fmt.pct(perGame.eW[g])),
        h('span', { class: 'who' }, `${team(x.winners)} gewinnt gegen ${team(x.losers)}`),
        h('span', { class: 'd', 'aria-label': `Elo-Gewinn ${fmt.signed(perGame.delta[g], 1)}` }, fmt.signed(perGame.delta[g], 1)),
        h('span', { class: 'meta' },
          `${x.approxTime ? 'ca. ' : ''}${fmt.date(x.t)}${x.double ? ', Doppel' : ''}, Elo vor dem Spiel ${fmt.elo(perGame.rW[g])} gegen ${fmt.elo(perGame.rL[g])}`)));
    })),
  ];
}
