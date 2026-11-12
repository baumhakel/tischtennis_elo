// Team: two players who played doubles together. No team rating: each keeps their own Elo-Wert,
// the team's strength is the mean of the two. URL: #/team?a=<id>&b=<id>.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { tile, viewHead, nameOf, byName, plainTable, linkTo, profileLink, modeNote } from './common.js';
import { bestTeams } from './duels.js';
import { teamFacts } from './insights.js';
import { gameList } from './games.js';

export default {
  id: 'team',
  title: 'Team',
  mount(el, ctx) {
    const update = c => render(el, page(c));
    update(ctx);
    return { update, unmount() {} };
  },
};

function page(ctx) {
  const { model } = ctx;
  const { elo } = model;
  const cfg = model.dataset.config;
  if (ctx.mode === 'einzel') return [viewHead('Team'), modeNote('Teams gibt es nur in den Wertungen „Alle“ und „Doppel“.')];
  const pool = byName(ctx, elo.ids.map((_, k) => k).filter(k => elo.doubles[k] > 0));
  if (pool.length < 2) return [viewHead('Team'), h('p', { class: 'empty' }, 'Noch zu wenige Doppel gespielt.')];
  const valid = id => id && elo.index.has(id) && elo.doubles[elo.index.get(id)] > 0;
  let a = valid(ctx.params.a) ? ctx.params.a : null, b = valid(ctx.params.b) && ctx.params.b !== a ? ctx.params.b : null;
  if (!a || !b) {
    // default: the team with the best chemistry among those with team_min_games together, else the most frequent one
    const best = bestTeams(model, ctx.visible.shown, cfg.team_min_games)[0]
      ?? bestTeams(model, ctx.visible.shown, 1).sort((x, y) => y.n - x.n)[0];
    if (!a && !b && best) { a = elo.ids[best.i]; b = elo.ids[best.j]; }
    else {
      a = a || b || elo.ids[pool[0]];
      const partners = pool.filter(k => elo.ids[k] !== a && elo.partner.games[elo.index.get(a) * elo.ids.length + k] > 0);
      b = elo.ids[partners[0] ?? pool.find(k => elo.ids[k] !== a)];
    }
  }
  const ka = elo.index.get(a), kb = elo.index.get(b);
  const t = teamFacts(model, a, b);
  const pick = (param, value, other) => h('select', { 'aria-label': 'Spieler', onchange: e => ctx.setParams({ [param]: e.target.value }) },
    pool.filter(k => elo.ids[k] !== other).map(k => h('option', { value: elo.ids[k], selected: elo.ids[k] === value ? true : null }, nameOf(ctx, k))));
  const names = `${nameOf(ctx, ka)} & ${nameOf(ctx, kb)}`;
  const head = [
    viewHead('Team', 'Zwei Spieler, die zusammen Doppel spielen. Ein Team hat keinen eigenen Elo-Wert: Jeder behält seinen eigenen, die Stärke des Teams ist der Mittelwert der beiden.'),
    h('div', { class: 'toolbar duel-pick' }, h('span', { class: 'side' }, pick('a', a, b), h('span', { class: 'vs' }, 'und'), pick('b', b, a))),
    h('nav', { class: 'links' },
      h('a', { class: 'tap', ...profileLink(ctx, ka) }, `Profil von ${nameOf(ctx, ka)}`),
      h('a', { class: 'tap', ...profileLink(ctx, kb) }, `Profil von ${nameOf(ctx, kb)}`)),
  ];
  if (!t.n) return [...head, h('p', { class: 'empty' }, `${names} haben noch kein Doppel zusammen gespielt.`)];

  const strength = (elo.final[ka] + elo.final[kb]) / 2;
  const sgn = v => fmt.signed(v, 1).replace('±0,0', '±0');
  const shown = t.games.slice(0, cfg.recent_games_expanded);
  return [
    ...head,
    h('div', { class: 'tiles' },
      tile({ label: 'Doppel zusammen', value: fmt.int(t.n), sub: `Bilanz ${t.wins} : ${t.losses}`, link: linkTo(ctx, 'spiele', { spieler: a, partner: b }) }),
      tile({ label: 'Siegquote', value: fmt.pct(t.ratio), sub: 'zusammen' }),
      tile({ label: 'Siege über Erwartung', value: sgn(t.chem), tone: t.chem > 0.05 ? 'up' : t.chem < -0.05 ? 'down' : null,
        sub: `${sgn(t.perGame)} pro Doppel; Erwartung laut Elo vor jedem Spiel` }),
      tile({ label: 'Teamstärke heute', value: fmt.elo(strength), sub: `${fmt.elo(elo.final[ka])} und ${fmt.elo(elo.final[kb])}` })),
    h('h2', {}, 'Gegnerteams'),
    plainTable(['Gegner', 'Doppel', 'Bilanz'],
      t.opponents.map(o => [o.ids.map(id => ctx.names.get(id) ?? id).join(' & '), String(o.n), `${o.wins} : ${o.losses}`]),
      [1, 2],
      t.opponents.map(o => linkTo(ctx, 'h2h', { a, a2: b, b: o.ids[0], b2: o.ids[1] }))),
    h('h2', {}, 'Letzte Doppel'),
    gameList(ctx, shown, { as: a }),
    t.n > shown.length ? h('div', { class: 'list-actions' }, h('a', { class: 'more-link', ...linkTo(ctx, 'spiele', { spieler: a, partner: b }) }, `Alle ${t.n} Doppel`)) : null,
  ];
}
