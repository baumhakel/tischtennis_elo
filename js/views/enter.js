// Ergebnis eintragen (Phase 18a, #/eintragen): Einzel or Doppel, who won, who lost, the Siegchance and the
// Elo-Punkte as on Tisch, a confirmation, then the app sends the Ergebnis form itself (app/submit.js) and
// says whether the game arrived. Wrong entries are fixed via `corrections`, as before (no undo).
// The picks live in this module for the session (not in the URL).
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { resolveFilters, visible } from '../core/filters.js';
import { modelFor } from '../app/modes.js';
import { formReady } from '../app/forms.js';
import { viewHead } from './common.js';
import { outcome } from './table-logic.js';
import { pick, resize, complete, resultSentence } from './enter-logic.js';
import { confirmResult } from './enter-confirm.js';

const session = { kind: null, s: null, sending: false };

export default {
  id: 'eintragen',
  title: 'Ergebnis eintragen',
  mount(el, ctx) {
    let last = ctx;
    const update = c => { last = c; render(el, page(c, () => update(last))); };
    update(ctx);
    return { update, unmount() {} };
  },
};

const WORD = { alle: 'Alle', einzel: 'Einzel', doppel: 'Doppel' };

function page(ctx, rerender) {
  const cfg = ctx.baseModel.dataset.config;
  const name = id => ctx.names.get(id) ?? ctx.baseModel.dataset.players.get(id)?.name ?? id;
  const head = viewHead('Ergebnis eintragen', null, { info: [
    'Wähle die Sieger und die Verlierer. Die App trägt das Spiel ins Ergebnis-Formular ein, genau als hättest du es selbst ausgefüllt, und zeigt danach, ob es angekommen ist.',
    'Ein falsch eingetragenes Spiel bitte über „Problem melden“ (auf der Seite des Spiels) melden. Es wird dann korrigiert.'] });
  if (!formReady(cfg, 'result')) {
    return [head, h('p', {}, 'Das Eintragen in der App ist noch nicht eingerichtet.'),
      cfg.form_result_url ? h('p', {}, h('a', { class: 'button-link', href: cfg.form_result_url, target: '_blank', rel: 'noopener', 'data-form': 'ergebnis' }, 'Zum Ergebnis-Formular')) : null];
  }

  if (!session.kind) session.kind = ctx.mode === 'doppel' ? 'doppel' : 'einzel';
  const size = session.kind === 'doppel' ? 2 : 1;
  const players = [...ctx.baseModel.dataset.players.values()].filter(p => p.active).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const activeIds = new Set(players.map(p => p.id));
  if (!session.s) session.s = { W: ctx.me.id && activeIds.has(ctx.me.id) ? [ctx.me.id] : [], L: [] };
  session.s = { W: session.s.W.filter(id => activeIds.has(id)), L: session.s.L.filter(id => activeIds.has(id)) };
  // „Ich“ first, then by name
  const order = ctx.me.id && activeIds.has(ctx.me.id) ? [ctx.me.id, ...players.map(p => p.id).filter(id => id !== ctx.me.id)] : players.map(p => p.id);
  const set = fn => { fn(); rerender(); };

  const kindSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Spielart' },
    [['einzel', 'Einzel'], ['doppel', 'Doppel']].map(([v, t]) => h('label', {},
      h('input', { type: 'radio', name: 'enter-kind', value: v, checked: v === session.kind ? true : null,
        onchange: () => set(() => { session.kind = v; session.s = resize(session.s, v === 'doppel' ? 2 : 1); }) }),
      h('span', {}, t))));

  const group = (side, label) => {
    const mine = session.s[side], other = session.s[side === 'W' ? 'L' : 'W'];
    return h('section', { class: 'pick-group' },
      h('h3', {}, label, h('span', { class: 'muted small' }, ` · ${mine.length} von ${size}`)),
      h('div', { class: 'pick-chips', role: 'group', 'aria-label': label }, order.map(id => h('button', {
        type: 'button', class: 'chip pick' + (mine.includes(id) ? ' on' : '') + (other.includes(id) ? ' elsewhere' : ''),
        'aria-pressed': String(mine.includes(id)),
        onclick: () => set(() => { session.s = pick(session.s, side, id, size); }),
      }, name(id), id === ctx.me.id ? h('span', { class: 'muted' }, ' (ich)') : null))));
  };

  const ready = complete(session.s, size);
  return [
    head,
    h('div', { class: 'toolbar' }, kindSeg),
    group('W', 'Gewonnen'),
    group('L', 'Verloren'),
    ready ? previewBox(ctx, session.s.W, session.s.L, name) : h('p', { class: 'muted' }, size === 2 ? 'Wähle je zwei Spieler für Sieger und Verlierer.' : 'Wähle den Sieger und den Verlierer.'),
    h('div', { class: 'menu-actions enter-actions' },
      h('button', { type: 'button', disabled: !ready || session.sending ? true : null, onclick: () => {
        confirmResult(ctx, session.s.W, session.s.L, name, async () => {
          session.sending = true; rerender();
          const r = await ctx.actions.sendResult(session.s.W, session.s.L);
          session.sending = false;
          if (r === 'sent') {
            session.s = { W: ctx.me.id && activeIds.has(ctx.me.id) ? [ctx.me.id] : [], L: [] };
            ctx.navigate('dashboard');   // the new game shows up in Letzte Spiele there
          } else rerender();
        });
      } }, session.sending ? 'Wird gesendet …' : 'Eintragen …')),
    h('p', { class: 'muted small' }, 'Lieber selbst ausfüllen? ',
      h('a', { class: 'inline-link', href: cfg.form_result_url, target: '_blank', rel: 'noopener', 'data-form': 'ergebnis' }, 'Zum Ergebnis-Formular')),
  ];
}

/** Siegchance and Elo-Punkte for the picked game, in the current Wertung (or Alle if the game doesn't count there). */
function previewBox(ctx, W, L, name) {
  const type = W.length > 1 ? 'doppel' : 'einzel';
  const mode = ctx.mode === 'alle' || ctx.mode === type ? ctx.mode : 'alle';
  const m = modelFor(ctx.baseModel, mode);
  const f = resolveFilters({ ...ctx.state.filters, mode }, m.dataset.config);
  const o = outcome(m, visible(m.dataset, m.elo, f, ctx.now), f.minGames, W, L);
  const label = ids => ids.map(name).join(' & ');
  return h('section', { class: 'preview' },
    h('h2', {}, resultSentence(W, L, name)),
    h('div', { class: 'chance-bar', role: 'img', 'aria-label': `Siegchance vorher ${label(W)} ${fmt.pct(o.eW)}, ${label(L)} ${fmt.pct(1 - o.eW)}` },
      h('span', { class: 'a', style: `width:${(o.eW * 100).toFixed(1)}%` }, fmt.pct(o.eW)),
      h('span', { class: 'b' }, fmt.pct(1 - o.eW))),
    h('p', { class: 'small' }, `Siegchance vorher für ${label(W)}: ${fmt.pct(o.eW)} · Elo-Punkte: ${fmt.signed(o.delta, 1)} für ${W.length > 1 ? 'jeden Sieger' : 'den Sieger'}, ${fmt.signed(-o.delta, 1)} für ${L.length > 1 ? 'jeden Verlierer' : 'den Verlierer'}`),
    h('p', { class: 'muted small' }, `Wertung „${WORD[mode]}“.`));
}
