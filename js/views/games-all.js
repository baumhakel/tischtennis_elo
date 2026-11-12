// Alle Spiele: every game, newest first, with filters (see game-query.js for the URL params).
// Player, opponent, partner, type and order are controls; the other filters arrive by links
// (records, activity, calibration …) and show as chips that remove themselves on tap.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { viewHead, byName, nameOf } from './common.js';
import { parseFilter, filterParams, queryGames, hasFilter } from './game-query.js';
import { gameList } from './games.js';
import { serialFromParts } from '../core/normalize.js';

const SORT_LABELS = { neu: 'Neueste zuerst', alt: 'Älteste zuerst', elo: 'Größte Elo-Veränderung zuerst' };
const ART_LABELS = { '': 'Einzel und Doppel', einzel: 'nur Einzel', doppel: 'nur Doppel' };

export default {
  id: 'spiele',
  title: 'Alle Spiele',
  mount(el, ctx) {
    let shown = 0, key = null, last = ctx;
    function update(c) {
      last = c;
      // in Einzel/Doppel the mode already decides the type; partners only exist in doubles
      const params = c.mode === 'alle' ? c.params : { ...c.params, art: null, ...(c.mode === 'einzel' ? { partner: null } : {}) };
      const f = parseFilter(params, c.model);
      const k = JSON.stringify(filterParams(f)) + c.model.dataset.hash;
      const page = c.model.dataset.config.games_page_size;
      if (k !== key) { key = k; shown = page; }
      const gs = queryGames(c.model, f);
      render(el,
        viewHead('Alle Spiele', lead(c, f, gs.length), { back: hasFilter(f), info: 'Tippe auf ein Spiel für die Einzelheiten. Mit gewähltem Spieler: S = Sieg, N = Niederlage, rechts die eigene Elo-Veränderung. Filter, die über einen Link kamen, stehen als Chips darunter; × entfernt sie.' }),
        controls(c, f),
        chips(c, f),
        gs.length
          ? [gameList(c, gs.slice(0, shown), { as: f.spieler }),
             gs.length > shown
               ? h('div', { class: 'list-actions' },
                   h('button', { class: 'secondary', type: 'button', onclick: () => { shown += page; update(last); } },
                     `Weitere ${Math.min(page, gs.length - shown)} Spiele laden`),
                   h('span', { class: 'muted' }, `${fmt.int(shown)} von ${fmt.int(gs.length)}`))
               : null]
          : h('section', { class: 'empty' },
              h('p', {}, 'Keine Spiele passen zu diesen Filtern.'),
              hasFilter(f) ? h('button', { type: 'button', class: 'secondary', onclick: () => c.navigate('spiele', {}) }, 'Filter zurücksetzen') : null));
    }
    update(ctx);
    return { update, unmount() {} };
  },
};

function lead(ctx, f, n) {
  const s = `${fmt.int(n)} ${n === 1 ? 'Spiel' : 'Spiele'}`;
  return f.spieler ? `${s}, aus Sicht von ${ctx.names.get(f.spieler)}.` : `${s}.`;
}

function controls(ctx, f) {
  const set = patch => ctx.setParams(patch);
  const pool = byName(ctx, ctx.model.elo.ids.map((_, k) => k));
  const sel = (label, param, value, exclude, emptyLabel) => [
    h('label', { for: 'g-' + param }, label),
    h('select', { id: 'g-' + param, onchange: e => set(param === 'spieler'
        ? { spieler: e.target.value || null, gegner: null, partner: null }
        : { [param]: e.target.value || null }) },
      h('option', { value: '' }, emptyLabel),
      pool.filter(k => !exclude.includes(ctx.model.elo.ids[k])).map(k => {
        const id = ctx.model.elo.ids[k];
        return h('option', { value: id, selected: id === value ? true : null }, nameOf(ctx, k));
      }))];
  return h('div', { class: 'toolbar filters-inline' },
    h('span', { class: 'field' }, sel('Spieler', 'spieler', f.spieler, [], 'alle')),
    f.spieler ? h('span', { class: 'field' }, sel('Gegner', 'gegner', f.gegner, [f.spieler, f.partner], 'alle')) : null,
    f.spieler && ctx.mode !== 'einzel' ? h('span', { class: 'field' }, sel('Partner', 'partner', f.partner, [f.spieler, f.gegner], 'alle')) : null,
    // a select, not buttons: must not look like the Wertung switch
    ctx.mode !== 'alle' ? null : h('span', { class: 'field' },
      h('label', { for: 'g-art' }, 'Spielart'),
      h('select', { id: 'g-art', onchange: e => set({ art: e.target.value || null }) },
        Object.entries(ART_LABELS).map(([v, t]) => h('option', { value: v, selected: (f.art || '') === v ? true : null,
          disabled: f.partner && v !== 'doppel' ? true : null }, t)))),
    h('span', { class: 'field' },
      h('label', { for: 'g-sort' }, 'Reihenfolge'),
      h('select', { id: 'g-sort', onchange: e => set({ sortierung: e.target.value === 'neu' ? null : e.target.value }) },
        Object.entries(SORT_LABELS).map(([v, t]) => h('option', { value: v, selected: f.sortierung === v ? true : null }, t)))));
}

/** Filters that came in by a link, as removable chips. */
function chips(ctx, f) {
  const day = v => (v.length === 10 ? fmt.date(serialOfDay(v)) : `${fmt.date(serialOfDay(v.slice(0, 10)))}, ${v.slice(11, 16)} Uhr`);
  const list = [];
  const add = (label, patch) => list.push(h('button', { class: 'chip', type: 'button', 'aria-label': `Filter „${label}“ entfernen`,
    onclick: () => ctx.setParams(patch) }, label, h('span', { class: 'x', 'aria-hidden': 'true' }, '×')));
  if (f.von && f.bis) add(f.von === f.bis ? `am ${day(f.von)}` : `${day(f.von)} bis ${day(f.bis)}`, { von: null, bis: null });
  else if (f.von) add(`ab ${day(f.von)}`, { von: null });
  else if (f.bis) add(`bis ${day(f.bis)}`, { bis: null });
  if (f.quelle) add(f.quelle === 'altdaten' ? 'nur Altdaten' : 'nur Formulareinträge', { quelle: null });
  if (f.korrigiert) add('nur korrigierte Ergebnisse', { korrigiert: null });
  if (f.chance) add(`Siegchance ${fmt.pct(f.chance[0])} bis ${fmt.pct(f.chance[1])}`, { chance: null });
  if (f.letzte) add(`die letzten ${f.letzte}`, { letzte: null });
  return list.length ? h('div', { class: 'legend' }, list) : null;
}

// "yyyy-mm-dd" → sheet serial
function serialOfDay(s) {
  const [y, m, d] = s.split('-').map(Number);
  return serialFromParts(y, m, d);
}
