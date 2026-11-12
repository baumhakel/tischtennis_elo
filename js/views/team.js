// Team: two players who played doubles together. No team rating: each keeps their own Elo-Wert,
// the team's strength is the mean of the two. URL: #/team?a=<id>&b=<id>.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { tile, viewHead, nameOf, byName, plainTable, linkTo, profileLink, modeNote, chemValue, chemRange } from './common.js';
import { modelFor } from '../app/modes.js';
import { chemInfo, NO_CHEM } from './partners.js';
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
  if (ctx.mode === 'einzel') return [viewHead('Team', null, { back: true }), modeNote('Teams gibt es nur in den Wertungen „Alle“ und „Doppel“.')];
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
    viewHead('Team', null, { back: true, info: [
      'Zwei Spieler, die zusammen Doppel spielen. Ein Team hat keinen eigenen Elo-Wert: Jeder behält seinen eigenen, die Stärke des Teams ist der Mittelwert der beiden.',
      'Wer trägt wen: die Elo-Werte der beiden in der Wertung „Doppel“. „Trägt“ heißt, der Abstand ist größer als die übliche Schwankung eines Elo-Werts im Doppel.',
      ...chemInfo(ctx, model.stats.get('chemistry')).slice(1)] }),
    h('div', { class: 'toolbar duel-pick' }, h('span', { class: 'side' }, pick('a', a, b), h('span', { class: 'vs' }, 'und'), pick('b', b, a))),
    h('nav', { class: 'links' },
      h('a', { class: 'tap', ...profileLink(ctx, ka) }, `Profil von ${nameOf(ctx, ka)}`),
      h('a', { class: 'tap', ...profileLink(ctx, kb) }, `Profil von ${nameOf(ctx, kb)}`)),
  ];
  if (!t.n) return [...head, h('p', { class: 'empty' }, `${names} haben noch kein Doppel zusammen gespielt.`)];

  const strength = (elo.final[ka] + elo.final[kb]) / 2;
  const C = model.stats.get('chemistry'), c = ka * elo.ids.length + kb;
  const chemTile = C.tau2 > 0
    ? tile({ label: 'Teamchemie', value: chemValue(C.est[c]), tone: C.lo[c] > 0 ? 'up' : C.hi[c] < 0 ? 'down' : null,
        sub: `Siege über Erwartung pro 100 Doppel, geschrumpft (95 %: ${chemRange(C.lo[c], C.hi[c])})` })
    : tile({ label: 'Teamchemie', value: '±0', sub: NO_CHEM });
  const carry = carries(ctx, a, b);
  const shown = t.games.slice(0, cfg.recent_games_expanded);
  return [
    ...head,
    h('div', { class: 'tiles' },
      tile({ label: 'Doppel zusammen', value: fmt.int(t.n), sub: `Bilanz ${t.wins} : ${t.losses}`, link: linkTo(ctx, 'spiele', { spieler: a, partner: b }) }),
      tile({ label: 'Siegquote', value: fmt.pct(t.ratio), sub: 'zusammen' }),
      chemTile,
      tile({ label: 'Teamstärke heute', value: fmt.elo(strength), sub: `${fmt.elo(elo.final[ka])} und ${fmt.elo(elo.final[kb])}` }),
      carry ? wide(tile({ label: 'Wer trägt wen', value: carry.word, who: carry.who, sub: carry.sub })) : null),
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

/** Doppel-Elo-Werte of both (Wertung „Doppel“): who carries whom, or „auf Augenhöhe“. */
function carries(ctx, a, b) {
  const D = modelFor(ctx.baseModel, 'doppel'), E = D.elo;
  const ka = E.index.get(a), kb = E.index.get(b);
  if (ka === undefined || kb === undefined) return null;
  const ra = E.final[ka], rb = E.final[kb];
  const cfg = D.dataset.config;
  const noise = Math.sqrt(cfg.k_double * 200 / Math.LN10);   // typical spread of a Doppel-Elo-Wert
  const name = id => ctx.names.get(id) ?? id;
  const sub = `Doppel-Elo: ${name(a)} ${fmt.elo(ra)} · ${name(b)} ${fmt.elo(rb)}`;
  if (Math.abs(ra - rb) <= noise) return { word: 'auf Augenhöhe', who: null, sub };
  const [top] = ra > rb ? [a] : [b];
  return { word: 'trägt', who: name(top), sub };
}

const wide = el => { el.classList.add('tile-wide'); return el; };
