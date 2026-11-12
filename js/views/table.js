// Tisch: „we are standing at the table“. Who is here → who plays, the most balanced doubles split,
// what each result would do (Elo and Platz, in this Wertung and the other one that counts), a
// pre-filled result form, hypothetical games, „Wo hole ich meine Punkte?“ and suggestions.
// Nothing here writes anything; the state lives in this module for the session (not in the URL).
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { resolveFilters, visible } from '../core/filters.js';
import { modelFor } from '../app/modes.js';
import { viewHead, nameOf as nameOfK, plainTable, linkTo } from './common.js';
import {
  outcome, splits, whoPlays, gamesTodayWeek, prefillUrl, applyGames, standings, ratingOf,
  winsNeeded, shrunkResiduals, suggestions,
} from './table-logic.js';

const MAX_PRESENT = 8;
const session = { present: null, kind: null, kindChosen: false, pick: 0, rounds: new Map(), satOut: new Map(), hypo: [] };

export default {
  id: 'tisch',
  title: 'Tisch',
  mount(el, ctx) {
    let last = ctx;
    const update = c => { last = c; render(el, page(c, () => update(last))); };
    update(ctx);
    return { update, unmount() {} };
  },
};

function page(ctx, rerender) {
  const { model, baseModel, me } = ctx;
  const names = ctx.names;
  const name = id => names.get(id) ?? id;
  if (session.present === null) session.present = me.id ? [me.id] : [];
  session.present = session.present.filter(id => baseModel.dataset.players.has(id));

  // which game type: the Wertung decides in Einzel/Doppel; in Alle doubles once four are here
  const kinds = ctx.mode === 'einzel' ? ['einzel'] : ctx.mode === 'doppel' ? ['doppel'] : ['einzel', 'doppel'];
  // follows the number of people unless chosen by hand
  if (!kinds.includes(session.kind) || !session.kindChosen) session.kind = kinds.length === 1 ? kinds[0] : session.present.length >= 4 ? 'doppel' : 'einzel';
  const need = session.kind === 'doppel' ? 4 : 2;

  const set = fn => { fn(); rerender(); };
  const players = [...baseModel.dataset.players.values()]
    .filter(p => p.active || session.present.includes(p.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

  // ── who is at the table ──
  const presentBox = h('div', { class: 'legend table-present' },
    session.present.map(id => h('button', { class: 'chip', type: 'button', 'aria-label': `${name(id)} entfernen`,
      onclick: () => set(() => { session.present = session.present.filter(x => x !== id); session.pick = 0; }) },
      name(id), h('span', { class: 'x', 'aria-hidden': 'true' }, '×'))),
    session.present.length < MAX_PRESENT ? h('select', { 'aria-label': 'Spieler hinzufügen', onchange: e => {
      const id = e.target.value;
      if (id) set(() => { session.present = [...session.present, id]; session.pick = 0; });
    } }, h('option', { value: '' }, '+ Spieler'), players.filter(p => !session.present.includes(p.id)).map(p => h('option', { value: p.id }, p.name))) : null);

  const kindSel = kinds.length > 1 ? h('span', { class: 'field' }, h('label', { for: 't-kind' }, 'Spielart'),
    h('select', { id: 't-kind', onchange: e => set(() => { session.kind = e.target.value; session.kindChosen = true; session.pick = 0; }) },
      kinds.map(k => h('option', { value: k, selected: k === session.kind ? true : null }, k === 'doppel' ? 'Doppel' : 'Einzel')))) : null;

  const head = [
    viewHead('Tisch', 'Wer steht am Tisch?', { info: [
      'Wähle, wer da ist. Bei mehr Leuten als Plätzen spielen die, die heute am wenigsten gespielt haben (danach: wer zuletzt Pause hatte, wer diese Woche weniger gespielt hat). „Nächste Runde“ wechselt durch.',
      'Im Doppel steht die ausgeglichenste Aufteilung oben. Siegchance und Elo-Punkte rechnen genau wie die Wertung: Der Sieger bekommt K × (1 − Siegchance), im Doppel zählt der Mittelwert der Partner.',
      'Nichts hier wird gespeichert, bis jemand das Ergebnis-Formular absendet.'] }),
    kindSel ? h('div', { class: 'toolbar' }, kindSel) : null,
    presentBox,
  ];

  // ── the game ──
  let game = null, waiting = null;
  if (session.present.length < need) {
    waiting = h('p', { class: 'muted' }, session.kind === 'doppel'
      ? `Für ein Doppel fehlen noch ${need - session.present.length}.`
      : session.present.length ? 'Noch einen Gegner wählen.' : 'Wähle mindestens zwei Spieler.');
  } else {
    const counts = gamesTodayWeek(baseModel.dataset, ctx.now);
    const { play, out } = whoPlays(session.present, need, { ...counts, rounds: session.rounds, satOut: session.satOut, names });
    let A, B, options = null;
    if (need === 4) {
      const s = splits(model, play);
      const pick = Math.min(session.pick, 2);
      ({ A, B } = s[pick]);
      options = h('div', { class: 'splits', role: 'radiogroup', 'aria-label': 'Aufteilung' }, s.map((x, i) =>
        h('button', { type: 'button', class: 'split' + (i === pick ? ' on' : ''), role: 'radio', 'aria-checked': String(i === pick),
          onclick: () => set(() => { session.pick = i; }) },
          h('span', { class: 'split-teams' }, `${x.A.map(name).join(' & ')}`, h('span', { class: 'vs' }, ' gegen '), `${x.B.map(name).join(' & ')}`),
          h('span', { class: 'split-chance' }, `${fmt.pct(x.eA)} : ${fmt.pct(1 - x.eA)}`, i === 0 ? h('span', { class: 'badge' }, 'am ausgeglichensten') : null))));
    } else {
      [A, B] = [[play[0]], [play[1]]];
    }
    game = [
      options,
      preview(ctx, A, B, name, set),
      out.length ? h('div', { class: 'list-actions' },
        h('span', { class: 'muted' }, `Pause: ${out.map(name).join(', ')}`),
        h('button', { type: 'button', class: 'secondary small', onclick: () => set(() => {
          for (const id of play) session.rounds.set(id, (session.rounds.get(id) || 0) + 1);
          for (const id of out) session.satOut.set(id, (session.satOut.get(id) || 0) + 1);
          session.pick = 0;
        }) }, 'Nächste Runde')) : null,
    ];
  }

  return [head, waiting, game, whatIf(ctx, name, set), pointsTable(ctx, name, set), suggestionList(ctx, name, set)];
}

// ── preview of one game: chance, and what each result would do ──

function preview(ctx, A, B, name, set) {
  const type = A.length > 1 ? 'doppel' : 'einzel';
  const typeWord = type === 'doppel' ? 'Doppel' : 'Einzel';
  // the Wertung shown first, and the other Wertung this game also counts in
  const primary = ctx.mode;
  const secondary = primary === 'alle' ? type : 'alle';
  const view = mode => {
    const m = modelFor(ctx.baseModel, mode);
    const f = resolveFilters({ ...ctx.state.filters, mode }, m.dataset.config);
    return { m, f, vis: visible(m.dataset, m.elo, f, ctx.now) };
  };
  const P = view(primary), S = view(secondary);
  const label = ids => ids.map(name).join(' & ');
  const cfg = ctx.baseModel.dataset.config;

  const side = (W, L) => {
    const o1 = outcome(P.m, P.vis, P.f.minGames, W, L), o2 = outcome(S.m, S.vis, S.f.minGames, W, L);
    const rank = (a, b) => (a == null && b == null ? 'vorläufig' : a == null ? `neu Platz ${b}` : b == null ? 'vorläufig' : a === b ? `Platz ${a}` : `Platz ${a} → ${b}`);
    const url = prefillUrl(cfg, W, L, name);
    return h('section', { class: 'outcome' },
      h('h3', {}, `Wenn ${label(W)} ${W.length > 1 ? 'gewinnen' : 'gewinnt'}`),
      h('ul', { class: 'outcome-list' }, o1.players.map(p => {
        const q = o2.players.find(x => x.id === p.id);
        return h('li', {},
          h('span', { class: 'who' }, name(p.id)),
          h('span', { class: 'd ' + (p.delta < 0 ? 'down' : 'up') }, fmt.signed(p.delta, 1)),
          h('span', { class: 'rk' }, rank(p.rankBefore, p.rankAfter)),
          h('span', { class: 'second' }, `${WORD[secondary]}: ${fmt.signed(q.delta, 1)} · ${rank(q.rankBefore, q.rankAfter)}`));
      })),
      h('div', { class: 'menu-actions' },
        url ? h('a', { class: 'button-link', href: url, target: '_blank', rel: 'noopener' }, 'Ergebnis eintragen') : null,
        h('button', { type: 'button', class: 'secondary small', onclick: () => set(() => { session.hypo.push({ winners: W, losers: L }); }) }, 'Was wäre, wenn …')));
  };

  const { eW } = outcome(P.m, P.vis, P.f.minGames, A, B);
  return h('section', { class: 'preview' },
    h('h2', {}, `${label(A)} gegen ${label(B)}`),
    h('div', { class: 'chance-bar', role: 'img', 'aria-label': `Siegchance ${label(A)} ${fmt.pct(eW)}, ${label(B)} ${fmt.pct(1 - eW)}` },
      h('span', { class: 'a', style: `width:${(eW * 100).toFixed(1)}%` }, fmt.pct(eW)),
      h('span', { class: 'b' }, fmt.pct(1 - eW))),
    h('p', { class: 'muted small' }, `${typeWord} in der Wertung „${WORD[primary]}“. Klein darunter: Wertung „${WORD[secondary]}“.`),
    h('div', { class: 'outcomes' }, side(A, B), side(B, A)));
}

const WORD = { alle: 'Alle', einzel: 'Einzel', doppel: 'Doppel' };

// ── Was-wäre-wenn ──

function whatIf(ctx, name, set) {
  if (!session.hypo.length) return null;
  const { model, visible: vis, filters } = ctx;
  const fits = g => ctx.mode === 'alle' || (ctx.mode === 'doppel') === (g.winners.length > 1);
  const games = session.hypo.filter(fits);
  const skipped = session.hypo.length - games.length;
  const after = applyGames(model, games);
  const r0 = standings(model, vis, filters.minGames), r1 = standings(model, vis, filters.minGames, after);
  const ids = [...after.ratings.keys()].sort((a, b) => after.ratings.get(b) - after.ratings.get(a));
  const pl = (r, id) => (r.get(id) == null ? '–' : String(r.get(id)));
  return h('section', { class: 'whatif' },
    h('h2', {}, 'Was wäre, wenn …'),
    h('ol', { class: 'hypo' }, session.hypo.map((g, i) => h('li', { class: fits(g) ? null : 'muted' },
      `${g.winners.map(name).join(' & ')} ${g.winners.length > 1 ? 'schlagen' : 'schlägt'} ${g.losers.map(name).join(' & ')}`,
      h('button', { type: 'button', class: 'link', 'aria-label': 'Spiel entfernen', onclick: () => set(() => { session.hypo.splice(i, 1); }) }, '×')))),
    skipped ? h('p', { class: 'muted small' }, `${skipped} ${skipped === 1 ? 'Spiel zählt' : 'Spiele zählen'} in dieser Wertung nicht.`) : null,
    games.length ? plainTable(['Spieler', 'Elo-Wert', 'Veränderung', 'Platz'],
      ids.map(id => {
        const d = after.ratings.get(id) - ratingOf(model, id);
        return [name(id), `${fmt.elo(ratingOf(model, id))} → ${fmt.elo(after.ratings.get(id))}`,
          h('span', { class: d > 0 ? 'up' : d < 0 ? 'down' : null }, fmt.signed(d, 1)), `${pl(r0, id)} → ${pl(r1, id)}`];
      }), [1, 2, 3]) : null,
    h('div', { class: 'menu-actions' }, h('button', { type: 'button', class: 'secondary small', onclick: () => set(() => { session.hypo = []; }) }, 'Alle entfernen')));
}

// ── Wo hole ich meine Punkte? ──

function pointsTable(ctx, name) {
  const { model, visible: vis, filters, me } = ctx;
  if (ctx.mode === 'doppel' || !me.id) return null;
  const k = model.elo.index.get(me.id);
  if (k === undefined) return null;
  const ranks = standings(model, vis, filters.minGames);
  const myRank = ranks.get(me.id);
  const above = myRank > 1 ? [...ranks.entries()].filter(([, r]) => r < myRank).sort((a, b) => b[1] - a[1])[0] : null;
  const res = shrunkResiduals(model);
  const rows = vis.listed.filter(j => j !== k).map(j => {
    const id = model.elo.ids[j];
    const o = outcome(model, vis, filters.minGames, [me.id], [id]);
    const lohnend = res.at(k, j);
    return { id, j, p: o.eW, win: o.delta, lose: outcome(model, vis, filters.minGames, [id], [me.id]).delta,
      need: above ? winsNeeded(model, me.id, id, above[0]) : null, lohnend };
  }).sort((a, b) => (b.lohnend ?? -9) - (a.lohnend ?? -9) || b.p - a.p);
  const per10 = v => (v == null ? '–' : fmt.signed(10 * v, 1));
  const showLohnend = res.tau2 > 0;   // only useful things: without a detectable pattern the column would be all zeros
  const head = ['Gegner', 'Chance', 'Sieg / Niederlage', above ? `Für Platz ${above[1]}` : null, showLohnend ? 'lohnend' : null];
  const cols = head.map((x, i) => (x == null ? null : i)).filter(i => i != null);
  return h('section', { class: 'points' },
    viewHead('Wo hole ich meine Punkte?', null, { key: 'tisch-punkte', info: [
      'Pro Gegner: deine Siegchance im Einzel und die Elo-Punkte bei Sieg und bei Niederlage' + (above ? `. „Für Platz ${above[1]}“: so viele Siege in Folge gegen diesen Gegner bräuchtest du, um vorbeizuziehen.` : '.'),
      'Laut Elo ist der erwartete Gewinn jedes Spiels genau null. Gegen Stärkere gibt es mehr Punkte, aber seltener. Die Wahl des Gegners ändert also nur das Risiko, außer Elo liegt bei einem Gegner daneben.',
      showLohnend
        ? '„lohnend“: wie viel öfter du gegen diesen Gegner gewinnst, als Elo erwartet, pro 10 Begegnungen. Zur Null hin geschrumpft (empirischer Bayes), damit wenige Spiele nicht täuschen.'
        : 'Ob du gegen jemanden öfter gewinnst, als Elo erwartet, wird hier gezeigt, sobald die Daten ein solches Muster erkennen lassen. Derzeit ist keines erkennbar.'] }),
    plainTable(cols.map(i => head[i]),
      rows.map(r => {
        const cells = [nameOfK(ctx, r.j), fmt.pct(r.p),
          h('span', {}, h('span', { class: 'up' }, fmt.signed(r.win, 1)), ' / ', h('span', { class: 'down' }, fmt.signed(-r.lose, 1))),
          above ? (r.need == null ? '–' : String(r.need)) : null,
          showLohnend ? h('span', { class: r.lohnend > 0.005 ? 'up' : r.lohnend < -0.005 ? 'down' : null }, per10(r.lohnend)) : null];
        return cols.map(i => cells[i]);
      }),
      cols.slice(1).map((_, i) => i + 1),
      rows.map(r => linkTo(ctx, 'h2h', { a: me.id, b: r.id }))));
}

// ── Wer sollte als Nächstes spielen? ──

function suggestionList(ctx, name, set) {
  if (ctx.mode === 'doppel') return null;
  const cfg = ctx.model.dataset.config;
  const list = suggestions(ctx.model, ctx.visible, ctx.now, cfg.suggestions_recent_days, cfg.suggestions_count);
  if (!list.length) return null;
  const when = t => (Number.isFinite(t) ? `zuletzt ${fmt.ago(t, ctx.now)}` : 'noch nie gegeneinander');
  return h('section', { class: 'suggest' },
    viewHead('Wer sollte als Nächstes spielen?', null, { key: 'tisch-vorschlag', info:
      `Paarungen, deren Ergebnis am meisten über die Wertung verrät: möglichst nah an 50 % Siegchance, mit Vorrang für Paare, die in den letzten ${cfg.suggestions_recent_days} Tagen selten gegeneinander gespielt haben. Tippe auf eine Paarung, um sie an den Tisch zu holen.` }),
    h('ol', { class: 'games' }, list.map(s => h('li', {},
      h('a', { class: 'game neutral tap', href: '#/tisch', onclick: e => {
        e.preventDefault();
        set(() => { session.present = [s.a, s.b]; session.kind = 'einzel'; session.kindChosen = false; session.pick = 0; });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } },
        h('span', { class: 'who' }, `${name(s.a)} gegen ${name(s.b)}`),
        h('span', { class: 'd' }, `${fmt.pct(s.p)} : ${fmt.pct(1 - s.p)}`),
        h('span', { class: 'meta' }, when(s.lastT)))))));
}
