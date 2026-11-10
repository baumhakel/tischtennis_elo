// Building blocks shared by the views.
import { h } from '../ui/dom.js';
import { seriesVar } from '../ui/colors.js';
import { toggleFocus, MAX_FOCUS } from '../core/filters.js';

/** Players by display name (German collation). */
export function byName(ctx, ks) {
  return ks.slice().sort((a, b) => ctx.names.get(ctx.model.elo.ids[a]).localeCompare(ctx.names.get(ctx.model.elo.ids[b]), 'de'));
}

export const nameOf = (ctx, k) => ctx.names.get(ctx.model.elo.ids[k]) ?? ctx.model.elo.ids[k];

/**
 * Legend + picker for the highlighted players: one chip per focused player (colour key, name,
 * tap removes), a select to add one, and the key for the grey context lines.
 */
export function focusLegend(ctx, { contextLabel = 'übrige Spieler' } = {}) {
  const { focus } = ctx;
  const ids = focus.ids;
  const set = next => ctx.setFilters({ focus: next.length ? next : [null] });
  const chips = focus.slots.map((k, slot) => (k == null ? null : h('button', {
    class: 'chip', type: 'button', 'aria-label': `${nameOf(ctx, k)} nicht mehr hervorheben`,
    onclick: () => set(toggleFocus(ids, ctx.model.elo.ids[k])),
  }, h('span', { class: 'key', style: `background:${seriesVar(slot)}` }), nameOf(ctx, k), h('span', { class: 'x', 'aria-hidden': 'true' }, '×'))));

  const free = byName(ctx, ctx.visible.shown.filter(k => !focus.slotOf.has(k)));
  const full = focus.slotOf.size >= MAX_FOCUS || (ids.filter(Boolean).length >= MAX_FOCUS);
  const picker = free.length && !full ? h('select', {
    'aria-label': 'Spieler hervorheben',
    onchange: e => { if (e.target.value) set(toggleFocus(ids, e.target.value)); },
  }, h('option', { value: '' }, '+ Spieler hervorheben'),
    free.map(k => h('option', { value: ctx.model.elo.ids[k] }, nameOf(ctx, k)))) : null;

  return h('div', { class: 'legend' },
    chips,
    picker,
    h('span', { class: 'note' }, h('span', { class: 'key', style: 'display:inline-block;width:14px;height:1px;background:var(--axis);vertical-align:middle;margin-right:6px' }), contextLabel),
    !focus.explicit && focus.slotOf.size ? h('span', { class: 'note' }, `Vorauswahl: die ${focus.slotOf.size} Besten`) : null);
}

/** Collapsible table twin of a chart. rows = arrays of cells (strings or nodes); numeric columns by index. */
export function tableView(summary, head, rows, numeric = []) {
  const num = i => (numeric.includes(i) ? 'num' : null);
  return h('details', { class: 'table-view' },
    h('summary', {}, summary),
    h('table', { class: 'plain' },
      h('thead', {}, h('tr', {}, head.map((t, i) => h('th', { class: num(i) }, t)))),
      h('tbody', {}, rows.map(r => h('tr', {}, r.map((c, i) => h('td', { class: num(i) }, c)))))));
}

/** Stat tile. tone: 'up' | 'down' | null colours the value (text tokens, not series colours). */
export function tile({ label, value, who, sub, tone = null, onclick }) {
  return h(onclick ? 'button' : 'div', { class: 'tile', type: onclick ? 'button' : null, onclick,
    style: onclick ? 'text-align:left;border:0;border-radius:0;font:inherit;color:inherit;cursor:pointer' : null },
    h('span', { class: 't-label' }, label),
    h('span', { class: 't-value' + (tone ? ' ' + tone : '') }, value),
    who ? h('span', { class: 't-who' }, who) : null,
    sub ? h('span', { class: 't-sub' }, sub) : null);
}

export function viewHead(title, lead) {
  return [h('div', { class: 'view-head' }, h('h2', {}, title)), lead ? h('p', { class: 'lead' }, lead) : null];
}

/** Labelled select for view options; writes to the view params. */
export function paramSelect(ctx, { label, param, options, value }) {
  const id = 'opt-' + param;
  return [h('label', { for: id }, label),
    h('select', { id, onchange: e => ctx.setParams({ [param]: e.target.value }) },
      options.map(([v, t]) => h('option', { value: v, selected: v === value ? true : null }, t)))];
}

/** Segmented control (radio group) writing to a view param. options = [[value, label], …] */
export function segmented(ctx, { label, param, options, value }) {
  const name = 'seg-' + param;
  return h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label },
    options.map(([v, t]) => h('label', {},
      h('input', { type: 'radio', name, value: v, checked: v === value ? true : null,
        onchange: () => ctx.setParams({ [param]: v }) }),
      h('span', {}, t))));
}

export const X_AXIS_NAMES = { date: 'Datum', game: 'Spielnummer', own: 'Nummer des eigenen Spiels' };
