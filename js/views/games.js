// Shared game rows: one look for every list of games. Each row opens the Spiel page.
//
//   gameList(ctx, gs, { as })    <ol> of rows; as = player ID → rows from that player's view
//   recentGames()                stateful „Letzte Spiele“ block with „Mehr anzeigen“
//   gameLink(ctx, g)             { href, onclick } for anything that should open game g
import { h } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { gameFacts, lastGames } from './game-query.js';
import { linkTo } from './common.js';

export { linkTo };

const team = (ctx, ids) => ids.map(id => ctx.names.get(id) ?? id).join(' & ');

/** Link props to game g (by game_ref). */
export const gameLink = (ctx, g) => linkTo(ctx, 'spiel', { ref: ctx.model.dataset.games[g].ref });

/** One game as a list row. */
export function gameRow(ctx, g, { as = null } = {}) {
  const f = gameFacts(ctx.model, g, as);
  const x = f.game;
  const kind = x.double ? 'Doppel' : 'Einzel';
  const time = fmt.when(x.t, ctx.now, x.approxTime);
  let mark, who, delta, meta;
  if (f.as) {
    mark = h('span', { class: 'res ' + (f.won ? 'w' : 'l'), 'aria-label': f.won ? 'Sieg' : 'Niederlage' }, f.won ? 'S' : 'N');
    who = (f.partners.length ? `mit ${team(ctx, f.partners)} ` : '') + `gegen ${team(ctx, f.opponents)}`;
    delta = h('span', { class: 'd ' + (f.ownDelta < 0 ? 'down' : 'up') }, fmt.signed(f.ownDelta, 1));
    meta = `${time} · ${kind} · Siegchance ${fmt.pct(f.ownChance)}`;
  } else {
    mark = null;
    who = `${team(ctx, x.winners)} ${x.double ? 'schlagen' : 'schlägt'} ${team(ctx, x.losers)}`;
    delta = h('span', { class: 'd up' }, fmt.signed(f.delta, 1));
    meta = `${time} · ${kind} · Siegchance ${fmt.pct(f.eW)}`;
  }
  return h('li', {},
    h('a', { class: 'game tap' + (mark ? '' : ' neutral'), ...gameLink(ctx, g) },
      mark,
      h('span', { class: 'who' }, who),
      delta,
      h('span', { class: 'meta' }, meta)));
}

export function gameList(ctx, gs, opts = {}) {
  return h('ol', { class: 'games' }, gs.map(g => gameRow(ctx, g, opts)));
}

/**
 * „Letzte Spiele“ with „Mehr anzeigen“ (recent_games → recent_games_expanded).
 * The expanded state lives here, so it survives updates of the view.
 * @returns {{ el: HTMLElement, update(ctx, { as?: string }): void }}
 */
export function recentGames() {
  const el = h('section', { class: 'recent' });
  let expanded = false, last = null;
  function update(ctx, { as = null } = {}) {
    last = [ctx, as];
    const cfg = ctx.model.dataset.config;
    const max = Math.max(cfg.recent_games, cfg.recent_games_expanded);
    const all = lastGames(ctx.model, max, as);
    const n = expanded ? max : cfg.recent_games;
    const shown = all.slice(0, n);
    el.replaceChildren(
      h('h2', {}, 'Letzte Spiele'),
      shown.length ? gameList(ctx, shown, { as }) : h('p', { class: 'muted' }, 'Noch keine Spiele.'),
      h('div', { class: 'list-actions' },
        all.length > cfg.recent_games
          ? h('button', { class: 'link', type: 'button', 'aria-expanded': String(expanded),
              onclick: () => { expanded = !expanded; const [c, a] = last; update(c, { as: a }); } },
            expanded ? 'Weniger anzeigen' : 'Mehr anzeigen')
          : null,
        h('a', { class: 'more-link', ...linkTo(ctx, 'spiele', as ? { spieler: as } : {}) },
          as ? `Alle Spiele von ${ctx.names.get(as) ?? as}` : 'Alle Spiele')));
  }
  return { el, update };
}
