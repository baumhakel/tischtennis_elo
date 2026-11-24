// Turnierspiel (Phase 18, #/turnierspiel?id=&nr=): one tournament match. Both sides, the Siegchance and Elo-Punkte
// (members only), the sets once played, and the set entry: the points of each set, checked as they are typed
// (to 11, two clear, no set after the match is decided), then a confirmation and the app sends the
// Turnierergebnis form itself. A wrong result is fixed by entering it again (the latest entry counts).
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { viewHead } from './common.js';
import { linkTo } from './common.js';
import { pickTournament, entryOpen } from '../app/tournaments.js';
import { validateSets } from '../core/tournament.js';
import { formReady } from '../app/forms.js';
import { previewGame } from './table-logic.js';
import { findGame } from './game-query.js';
import { openSheet } from '../ui/sheet.js';
import { photoStrip } from './photo-ui.js';
import { sideLabel, sideName, setLine } from './tournament-ui.js';
import { withEnds } from '../ui/avatar.js';

// typed points per match, kept while the page is open (not in the URL): key `id#nr` → [[a, b] …] as strings
const drafts = new Map();

export default {
  id: 'turnierspiel',
  title: 'Turnierspiel',
  mount(el, ctx) {
    let last = ctx;
    // a redraw (store change, arriving photo) must not take the cursor out of a set field
    const update = c => {
      last = c;
      const f = document.activeElement?.dataset?.pt ? [document.activeElement.dataset.pt, document.activeElement.selectionStart] : null;
      render(el, page(c, () => update(last)));
      const next = f && el.querySelector(`[data-pt="${f[0]}"]`);
      if (next) { next.focus(); if (f[1] != null) next.setSelectionRange(f[1], f[1]); }
    };
    update(ctx);
    return { update, unmount() {} };
  },
};

function page(ctx, rerender) {
  const T = pickTournament(ctx.tournaments, ctx.params.id);
  const nr = Number(ctx.params.nr);
  const m = T?.ok ? T.matches.find(x => x.nr === nr) : null;
  if (!m) return [viewHead('Turnierspiel', null, { back: true }), h('p', { class: 'empty' }, 'Dieses Spiel gibt es nicht.')];
  const r = m.result;
  const members = m.a.id && m.b.id;
  const head = viewHead(`Spiel ${m.nr} · ${m.label}`, `${T.name} · Best of ${m.bestOf}, Sätze bis ${T.points}`, { back: true, key: 'turnierspiel', info: [
    'Eingetragen werden die Punkte jedes Satzes, immer aus Sicht der zuerst genannten Seite. Die App prüft, ob die Sätze gültig sind (bis 11, zwei Punkte Vorsprung) und ob das Spiel entschieden ist.',
    'Ein falsches Ergebnis einfach noch einmal eintragen: es gilt immer der letzte Eintrag eines Spiels.',
    'Spiele zwischen zwei Mitgliedern zählen normal für Elo. Ist ein Gast dabei, zählt das Spiel nur im Turnier.'] });
  return [
    head,
    h('section', { class: 'tt-versus' },
      h('div', { class: 'tt-vs-side' + (r?.winner === 'a' ? ' won' : '') }, sideLabel(ctx, m.a, { size: 48, strong: r?.winner === 'a' })),
      h('div', { class: 'tt-vs-mid' + (r ? '' : ' tt-vs-word') }, r ? `${r.setsA}:${r.setsB}` : 'gegen'),
      h('div', { class: 'tt-vs-side' + (r?.winner === 'b' ? ' won' : '') }, sideLabel(ctx, m.b, { size: 48, strong: r?.winner === 'b' }))),
    r ? h('p', { class: 'tt-setline' }, `Sätze: ${setLine(r)}`, h('span', { class: 'muted' }, ` · eingetragen ${fmt.time(r.t)}`)) : null,
    m.status === 'wartet' ? h('p', { class: 'muted' }, `Die Gegner stehen noch nicht fest: ${sideName(ctx, m.a)} gegen ${sideName(ctx, m.b)}.`) : null,
    members ? eloBox(ctx, m) : m.a.key && m.b.key ? h('p', { class: 'muted small' }, 'Mit Gast: zählt nur im Turnier, nicht für Elo.') : null,
    entryOpen(T) && m.a.key && m.b.key ? entry(ctx, T, m, rerender) : null,
    photoStrip(ctx, 'turnier_spiel', `${T.id}#${m.nr}`),
    h('p', { class: 'muted small' }, h('a', { class: 'inline-link', ...linkTo(ctx, 'turnier', { id: T.id }) }, `Zum ${T.name}`)),
  ];
}

/** Siegchance before (Elo-Werte now) or, once played, a link to the game with its Elo-Punkte. */
function eloBox(ctx, m) {
  const ds = ctx.baseModel.dataset;
  if (m.result) {
    const g = findGame(ds, m.result.ref);
    const x = g >= 0 ? ds.games[g] : null;
    const d = x ? ctx.baseModel.elo.perGame?.delta?.[g] : null;
    return h('p', { class: 'small' }, Number.isFinite(d) ? `Elo-Punkte: ${fmt.signed(d, 1)} für den Sieger · ` : '',
      x ? h('a', { class: 'inline-link', ...linkTo(ctx, 'spiel', { ref: m.result.ref }) }, 'Zum Spiel in der Wertung') : 'Noch nicht in der Wertung (Testlauf?).');
  }
  if (!ctx.baseModel.elo.index.has(m.a.id) && !ctx.baseModel.elo.index.has(m.b.id)) return null;
  const p = previewGame(ctx.baseModel, [m.a.id], [m.b.id]);
  return withEnds(ctx, [m.a.id], [m.b.id], h('div', { class: 'chance-bar', role: 'img', 'aria-label': `Siegchance ${sideName(ctx, m.a)} ${fmt.pct(p.eW)}, ${sideName(ctx, m.b)} ${fmt.pct(1 - p.eW)}` },
    h('span', { class: 'a', style: `width:${(p.eW * 100).toFixed(1)}%` }, fmt.pct(p.eW)),
    h('span', { class: 'b' }, fmt.pct(1 - p.eW))));
}

/** The set entry: one row per set, two number fields; checked live. */
function entry(ctx, T, m, rerender) {
  const cfg = ctx.baseModel.dataset.config;
  if (!formReady(cfg, 'tournament', ['tournament', 'match', 'set1', 'set2'])) {
    return h('p', { class: 'muted' }, 'Das Eintragen in der App ist für Turniere noch nicht eingerichtet.');
  }
  const key = `${T.id}#${m.nr}`;
  if (!drafts.has(key)) drafts.set(key, Array.from({ length: m.bestOf }, () => ['', '']));
  const rows = drafts.get(key);
  const parsed = rows.map(([a, b]) => (a === '' && b === '' ? null : /^\d{1,2}$/.test(a) && /^\d{1,2}$/.test(b) ? [Number(a), Number(b)] : 'bad'));
  const v = validateSets(parsed, m.bestOf, T.points);
  const touched = parsed.some(x => x != null);
  const status = h('p', { class: 'tt-check ' + (v.ok ? 'ok' : touched ? 'bad' : ''), 'aria-live': 'polite' },
    v.ok ? `${sideName(ctx, v.winner === 'a' ? m.a : m.b)} gewinnt ${Math.max(v.setsA, v.setsB)}:${Math.min(v.setsA, v.setsB)}.` : touched ? v.reason : 'Punkte je Satz eintragen.');
  const send = h('button', { type: 'button', class: 'primary', disabled: v.ok ? null : true, onclick: () => confirm(ctx, T, m, v, () => { drafts.delete(key); rerender(); }) },
    m.result ? 'Neues Ergebnis senden' : 'Ergebnis senden');
  const input = (i, j) => h('input', {
    type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 2, class: 'tt-pt', value: rows[i][j],
    'aria-label': `Satz ${i + 1}, Punkte ${sideName(ctx, j ? m.b : m.a)}`,
    oninput: e => {
      rows[i][j] = e.target.value.replace(/\D/g, '').slice(0, 2);
      rerender();   // check and button; the cursor stays (mount)
    },
    dataset: { pt: `${i}-${j}` },
  });
  return h('section', { class: 'tt-entry' },
    h('h3', {}, m.result ? 'Ergebnis korrigieren' : 'Ergebnis eintragen'),
    m.result ? h('p', { class: 'muted small' }, 'Ein neuer Eintrag ersetzt den bisherigen.') : null,
    h('table', { class: 'plain tt-sets-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Satz'), h('th', { class: 'num' }, sideName(ctx, m.a)), h('th', { class: 'num' }, sideName(ctx, m.b)))),
      h('tbody', {}, rows.map((_, i) => h('tr', { class: parsed[i] === 'bad' ? 'bad' : '' },
        h('td', {}, String(i + 1)), h('td', { class: 'num' }, input(i, 0)), h('td', { class: 'num' }, input(i, 1)))))),
    status,
    h('div', { class: 'menu-actions' }, send,
      touched ? h('button', { type: 'button', class: 'secondary', onclick: () => { drafts.delete(key); rerender(); } }, 'Leeren') : null));
}

function confirm(ctx, T, m, v, done) {
  const w = v.winner === 'a' ? m.a : m.b, l = v.winner === 'a' ? m.b : m.a;
  openSheet({
    title: `${sideName(ctx, w)} schlägt ${sideName(ctx, l)} ${Math.max(v.setsA, v.setsB)}:${Math.min(v.setsA, v.setsB)} · eintragen?`,
    body: [h('p', {}, `Spiel ${m.nr}, Sätze ${v.sets.map(([a, b]) => `${a}:${b}`).join(', ')} (aus Sicht von ${sideName(ctx, m.a)}).`),
      m.result ? h('p', { class: 'hint' }, 'Das ersetzt das bisherige Ergebnis.') : null],
    actions: [
      { label: 'Abbrechen' },
      { label: 'Eintragen', primary: true, onclick: () => { ctx.actions.sendTournament(T.id, m, v.sets); done(); } },
    ],
  });
}

/** Demo only: a random but valid result for match m (the stronger side wins more often), sent like a real one. */
export function demoResult(ctx, T, m) {
  if (!m) return;
  const rnd = Math.random, need = Math.floor(m.bestOf / 2) + 1, sets = [];
  let a = 0, b = 0;
  const p = m.a.id && m.b.id ? previewGame(ctx.baseModel, [m.a.id], [m.b.id]).eW : 0.5;
  while (a < need && b < need) {
    const lo = rnd() < 0.2 ? 10 + Math.floor(rnd() * 3) : Math.floor(rnd() * 10), hi = lo >= 10 ? lo + 2 : T.points;
    if (rnd() < p) { sets.push([hi, lo]); a++; } else { sets.push([lo, hi]); b++; }
  }
  ctx.actions.sendTournament(T.id, m, sets);
}
