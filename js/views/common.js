// Building blocks shared by the views.
import { h } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { seriesVar } from '../ui/colors.js';
import { toggleFocus, MAX_FOCUS } from '../core/filters.js';
import { formatHash } from '../app/url.js';

/**
 * Props for an in-app link: real href (long-press, new tab, Back) plus in-app navigation.
 * filters (optional) patches the global filters, e.g. { focus: [id] } to highlight a player.
 * Never pass the mode here: a tap never changes the mode.
 */
export function linkTo(ctx, view, params = {}, filters = null) {
  return {
    href: formatHash({ view, params, filters: { ...ctx.state.filters, ...(filters || {}) } }),
    onclick: e => { e.preventDefault(); ctx.navigate(view, params, filters); },
  };
}

/** Link props to player k's profile. */
export const profileLink = (ctx, k) => linkTo(ctx, 'player', { id: ctx.model.elo.ids[k] });

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
    !focus.explicit && focus.slotOf.size ? h('span', { class: 'note' }, presetText(ctx, focus)) : null);
}

/**
 * Plain table. rows = arrays of cells (strings or nodes); numeric columns by index.
 * links (optional): per row link props (linkTo) or null; the whole row is tappable, the first
 * cell carries the real link (keyboard, long-press).
 */
export function plainTable(head, rows, numeric = [], links = null) {
  const num = i => (numeric.includes(i) ? 'num' : null);
  return h('table', { class: 'plain' },
    h('thead', {}, h('tr', {}, head.map((t, i) => h('th', { class: num(i) }, t)))),
    h('tbody', {}, rows.map((r, ri) => {
      const L = links?.[ri];
      return h('tr', L ? { class: 'tap-row', onclick: e => { if (!e.target.closest('a')) L.onclick(e); } } : {},
        r.map((c, i) => h('td', { class: num(i) }, i === 0 && L ? h('a', { class: 'row-link', ...L }, c) : c)));
    })));
}

/** Collapsible table twin of a chart (see plainTable for links). */
export function tableView(summary, head, rows, numeric = [], links = null) {
  return h('details', { class: 'table-view' }, h('summary', {}, summary), plainTable(head, rows, numeric, links));
}

/**
 * Stat tile. tone: 'up' | 'down' | null colours the value (text tokens, not series colours).
 * link: props from linkTo() → the whole tile is a link (chevron cue). onclick: a button.
 */
export function tile({ label, value, who, sub, tone = null, onclick, link }) {
  const tag = link ? 'a' : onclick ? 'button' : 'div';
  return h(tag, { class: 'tile' + (link || onclick ? ' tap' : ''), type: onclick && !link ? 'button' : null,
    ...(link || (onclick ? { onclick } : {})),
    style: onclick && !link ? 'text-align:left;border:0;border-radius:0;font:inherit;color:inherit;cursor:pointer' : null },
    h('span', { class: 't-label' }, label),
    h('span', { class: 't-value' + (tone ? ' ' + tone : '') }, value),
    who ? h('span', { class: 't-who' }, who) : null,
    sub ? h('span', { class: 't-sub' }, sub) : null);
}

/** „Vorauswahl: die 3 Besten“ or, with „Ich“ in slot 1, „Vorauswahl: du und die 3 Besten“. */
function presetText(ctx, focus) {
  const meK = ctx.me?.id != null ? ctx.model.elo.index.get(ctx.me.id) : undefined;
  const mine = meK !== undefined && focus.slots[0] === meK;
  const best = focus.slotOf.size - (mine ? 1 : 0);
  const others = best > 0 ? `die ${best} Besten` : '';
  return `Vorauswahl: ${mine ? (others ? `du und ${others}` : 'du') : others}`;
}

const openInfos = new Set();   // pages whose (i) is open survive re-renders

/**
 * Page head: title, an (i) next to it that unfolds a short explanation (no vertical space until
 * tapped), at most a one-line lead, and „‹ Zurück“ on detail pages reached by a link.
 * @param {string} title
 * @param {string|Node|null} lead   one line at most
 * @param {{ info?: string|Node|Array, back?: boolean, key?: string }} [o]
 *   info: explanation (strings become paragraphs); key: identifies the page for the open state
 */
export function viewHead(title, lead = null, { info = null, back = false, key = title, share = null } = {}) {
  const paras = info == null ? null : (Array.isArray(info) ? info : [info]).map(x => (typeof x === 'string' ? h('p', {}, x) : x));
  const id = 'info-' + String(key).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const open = openInfos.has(key);
  const box = paras ? h('div', { class: 'info-box', id, hidden: !open }, paras) : null;
  const btn = paras ? h('button', {
    class: 'info-btn', type: 'button', 'aria-expanded': String(open), 'aria-controls': id, 'aria-label': 'Wie kommen diese Werte zustande?',
    onclick: e => {
      const now = box.hidden;
      box.hidden = !now;
      e.currentTarget.setAttribute('aria-expanded', String(now));
      if (now) openInfos.add(key); else openInfos.delete(key);
    },
  }, 'i') : null;
  return [
    back ? h('button', { class: 'back-link', type: 'button', onclick: goBack }, '‹ Zurück') : null,
    h('div', { class: 'view-head' }, h('h2', {}, title), btn, share),   // share: a shareButton() (ui/share.js) or null
    box,
    lead ? h('p', { class: 'lead' }, lead) : null,
  ];
}

/** Back within the app if the previous entry is ours, otherwise to the Übersicht. */
function goBack() {
  if (history.state && history.state.inApp) history.back();
  else location.hash = '#/dashboard';
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

/**
 * Note for content that doesn't exist in the current mode. Points to the switch; never switches
 * itself (a tap never changes the mode).
 */
export function modeNote(text) {
  return h('p', { class: 'mode-note' }, text, ' Oben unter „Wertung“ umschalten.');
}

/** Player id has no games in the current mode (but exists in the pooled data)? */
export const missingInMode = (ctx, id) => !!id && ctx.mode !== 'alle' && !ctx.model.elo.index.has(id) && ctx.baseModel.elo.index.has(id);

export const MODE_WORD = { einzel: 'Einzel', doppel: 'Doppel' };

export const X_AXIS_NAMES = { date: 'Datum', game: 'Spielnummer', own: 'Nummer des eigenen Spiels' };

/** Teamchemie for people: „+6“ (Siege über Erwartung pro 100 Doppel) and „−3 bis +15“. */
export const chemValue = est => fmt.signed(100 * est);
export const chemRange = (lo, hi) => `${fmt.signed(100 * lo)} bis ${fmt.signed(100 * hi)}`;
