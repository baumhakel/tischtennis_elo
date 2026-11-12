// Labor: patterns in the games, each compared with chance (app/lab.js, core/lab.js). Follows the
// Wertung. Every analysis appears only once it has enough data.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { viewHead, plainTable, tableView, linkTo, nameOf } from './common.js';
import { labFor, timedReady } from '../app/lab.js';
import { diversity } from '../core/lab.js';

export default {
  id: 'labor',
  title: 'Labor',
  mount(el, ctx) {
    const update = c => render(el, page(c));
    update(ctx);
    return { update, unmount() {} };
  },
};

const p100 = x => fmt.signed(100 * x);
const range = (lo, hi) => `${p100(lo)} bis ${p100(hi)}`;
const pText = p => (p < 0.001 ? 'p < 0,001' : `p = ${p.toFixed(2).replace('.', ',')}`);

/** One sentence: is the interval clear of 0? */
function verdict(e, better, worse) {
  if (!(e.lo > 0) && !(e.hi < 0)) return 'Kein Effekt nachweisbar: Das passt zum Zufall.';
  return e.lo > 0 ? better : worse;
}

function page(ctx) {
  const L = labFor(ctx.model), S = L.summary, cfg = ctx.model.dataset.config;
  const min = cfg.lab_min_samples;
  const waiting = L.state === 'running' || L.state === 'idle';
  const info = [
    'Für jeden Spieler in jedem Spiel: Ergebnis (1 oder 0) minus seine Siegchance vor dem Spiel. Der Mittelwert in einer Gruppe von Spielen sagt, ob dort öfter gewonnen wird, als die Elo-Werte erwarten lassen. Angegeben als Siege über Erwartung pro 100 Spiele, mit 95-%-Intervall.',
    `Vergleich mit dem Zufall: Die ganze Geschichte wird ${fmt.int(L.sims)}-mal neu ausgespielt, jedes Spiel mit der Siegchance, die es wirklich hatte. Die Elo-Werte laufen dabei mit. So wird herausgerechnet, was Elo und die Auswahl der Spiele von selbst erzeugen: Nach drei Siegen ist der Elo-Wert schon gestiegen, also ist das nächste Spiel schwerer zu „übertreffen“.`,
    `Eine Analyse erscheint erst, wenn sie mindestens ${min} Spiele hat. Analysen nach Uhrzeit und Session nutzen nur Formulareinträge, weil nur die genaue Zeiten haben.`,
  ];
  const head = viewHead('Labor', 'Muster in den Spielen, mit dem Zufall verglichen.', { info });
  const status = waiting ? h('p', { class: 'chart-note' }, 'Vergleich mit dem Zufall läuft …')
    : L.state === 'failed' ? h('p', { class: 'chart-note' }, 'Der Vergleich mit dem Zufall ist fehlgeschlagen. Bitte die Seite neu laden.') : null;
  const blocks = [streaks(ctx, S, waiting), revenge(ctx, S, waiting), cycles(ctx, S, waiting), variety(ctx), timed(ctx, L.timed, min)].filter(Boolean);
  if (!blocks.length) return [head, h('p', { class: 'empty' }, 'Noch zu wenige Spiele für eine Analyse.')];
  return [head, status, ...blocks];
}

// ───────── Hot Hand / Cold Hand ─────────

function streaks(ctx, S, waiting) {
  const L = ctx.model.dataset.config.lab_hot_hand_streak;
  if (!S.hot.enough && !S.cold.enough) return null;
  const row = (e, label, better, worse) => {
    if (!e.enough) return null;
    if (waiting || !Number.isFinite(e.effect)) return h('li', {}, h('strong', {}, label), h('span', { class: 'meta' }, `${fmt.int(e.n)} Spiele, roh ${p100(e.raw)} pro 100`));
    return h('li', {},
      h('strong', {}, `${label}: ${p100(e.effect)}`),
      h('span', { class: 'meta' }, `pro 100 Spiele (95 %: ${range(e.lo, e.hi)}), ${fmt.int(e.n)} Spiele. ${verdict(e, better, worse)}`),
      h('span', { class: 'meta' }, `Roh ${p100(e.raw)}, davon ${p100(e.nullMean)} schon durch Elo und Zufall zu erwarten.`));
  };
  const P = S.hotPlayers;
  return h('section', {},
    h('h2', {}, 'Hot Hand und Cold Hand'),
    h('p', { class: 'lead' }, `Spielt man nach ${L} Siegen in Folge besser, nach ${L} Niederlagen schlechter?`),
    h('ul', { class: 'lab-list' },
      row(S.hot, `Nach ${L} Siegen`, 'Nach Siegesserien wird öfter gewonnen als erwartet: eine echte Hot Hand.', 'Nach Siegesserien wird seltener gewonnen als erwartet.'),
      row(S.cold, `Nach ${L} Niederlagen`, 'Nach Niederlagenserien wird öfter gewonnen als erwartet.', 'Nach Niederlagenserien wird seltener gewonnen als erwartet: eine echte Cold Hand.')),
    P && P.rows.length >= 2
      ? (P.tau2 > 0
        ? tableView('Pro Spieler (nach Siegesserien)', ['Spieler', 'Spiele', 'Effekt', '95 %'],
            P.rows.slice().sort((a, b) => b.est - a.est).map(r => [nameOf(ctx, r.k), fmt.int(r.n), p100(r.est), range(r.lo, r.hi)]),
            [1, 2], P.rows.slice().sort((a, b) => b.est - a.est).map(r => linkTo(ctx, 'serien', { id: ctx.model.elo.ids[r.k] })))
        : h('p', { class: 'chart-note' }, 'Zwischen den Spielern ist kein Unterschied nachweisbar.'))
      : null,
    h('nav', { class: 'links' }, h('a', { class: 'tap', ...linkTo(ctx, 'serien') }, 'Aktuelle Serien')));
}

// ───────── Revanche ─────────

function revenge(ctx, S, waiting) {
  if (ctx.mode === 'doppel' || !S.revenge.enough) return null;
  const e = S.revenge;
  return h('section', {},
    h('h2', {}, 'Revanche'),
    h('p', { class: 'lead' }, 'Gewinnt man das nächste Einzel gegen jemanden, gegen den man zuletzt verloren hat, öfter als erwartet?'),
    waiting || !Number.isFinite(e.effect)
      ? h('p', { class: 'chart-note' }, `${fmt.int(e.n)} solche Einzel, roh ${p100(e.raw)} pro 100.`)
      : h('ul', { class: 'lab-list' }, h('li', {},
          h('strong', {}, `${p100(e.effect)} pro 100 Einzel`),
          h('span', { class: 'meta' }, `95 %: ${range(e.lo, e.hi)}, ${fmt.int(e.n)} Einzel. ${verdict(e, 'Revanchen gelingen öfter als erwartet.', 'Revanchen gelingen seltener als erwartet.')}`))));
}

// ───────── Schere-Stein-Papier ─────────

function cycles(ctx, S, waiting) {
  const C = S.cycles;
  if (!C.enough) return null;
  const minH = ctx.model.dataset.config.h2h_min_games;
  const ids = ctx.model.elo.ids;
  const pair = (i, j) => h('a', { class: 'tap chip-link', ...linkTo(ctx, 'h2h', { a: ids[i], b: ids[j] }) }, `${nameOf(ctx, i)} schlägt ${nameOf(ctx, j)}`);
  const compare = (obs, nullMean, p) => (waiting || !Number.isFinite(nullMean)
    ? `${obs} gefunden.`
    : `${obs} gefunden, zufällig wären etwa ${nullMean.toFixed(1).replace('.', ',')} zu erwarten (${pText(p)}). ${p < 0.05 ? 'Das sind mehr, als der Zufall erklärt.' : 'Das passt zum Zufall.'}`);
  return h('section', {},
    h('h2', {}, 'Schere, Stein, Papier'),
    h('p', { class: 'lead' }, `Dreiecke, in denen A gegen B vorne liegt, B gegen C und C gegen A (Paare mit mindestens ${minH} Begegnungen).`),
    h('ul', { class: 'lab-list' },
      h('li', {}, h('strong', {}, 'Nach Bilanz'), h('span', { class: 'meta' }, compare(C.observed, C.nullMean, C.p))),
      h('li', {}, h('strong', {}, 'Nach Siegen über Erwartung („Stil-Duelle“)'), h('span', { class: 'meta' }, compare(C.resid, C.residNullMean, C.residP)))),
    C.list.length ? h('details', { class: 'table-view' }, h('summary', {}, `Die ${C.list.length} Dreiecke nach Bilanz`),
      h('ul', { class: 'cycles' }, C.list.map(([i, j, k]) => h('li', {}, pair(i, j), pair(j, k), pair(k, i))))) : null);
}

// ───────── Gegnervielfalt ─────────

function variety(ctx) {
  const ks = ctx.visible.shown;
  if (ks.length < 3) return null;
  const rows = diversity(ctx.model, ks);
  if (rows.length < 3) return null;
  const top = rows[0], low = rows[rows.length - 1];
  return h('section', {},
    h('h2', {}, 'Gegnervielfalt'),
    h('p', { class: 'lead' }, `Gegen wie viele verschiedene Gegner spielt jemand wirklich? Am vielfältigsten: ${nameOf(ctx, top.k)} (${num1(top.effective)}). Am einseitigsten: ${nameOf(ctx, low.k)} (${num1(low.effective)}).`),
    tableView('Alle Spieler', ['Spieler', 'Gegner', 'effektiv', 'Häufigster Gegner'],
      rows.map(r => [nameOf(ctx, r.k), fmt.int(r.opponents), num1(r.effective), `${nameOf(ctx, r.topJ)} (${fmt.pct(r.topShare)})`]),
      [1, 2], rows.map(r => linkTo(ctx, 'player', { id: ctx.model.elo.ids[r.k] }))),
    h('p', { class: 'chart-note' }, 'Effektive Zahl der Gegner: e hoch Entropie der Begegnungen. Wer gegen 8 Gegner gleich oft spielt, kommt auf 8, wer fast nur gegen einen spielt, auf knapp 1.'));
}
const num1 = x => x.toFixed(1).replace('.', ',');

// ───────── form entries ─────────

function timed(ctx, T, min) {
  const ready = timedReady(T, min);
  if (!ready.length) return null;
  return h('section', {},
    h('h2', {}, 'Uhrzeit, Wochentag, Sessions'),
    h('p', { class: 'lead' }, 'Nur Formulareinträge (genaue Zeiten). Eine Session endet, wenn jemand länger als ' + `${ctx.model.dataset.config.session_gap_minutes} Minuten nicht spielt.`),
    ready.map(a => {
      if (!a.perPlayer) {
        const gs = a.groups.filter(g => g.n >= min);
        return [h('h3', {}, a.title), plainTable(['', 'Spiele', 'pro 100', '95 %'],
          gs.map(g => [g.label, fmt.int(g.n), p100(g.mean), range(g.mean - 1.96 * g.se, g.mean + 1.96 * g.se)]), [1, 2, 3])];
      }
      const C = a.cells;
      return [h('h3', {}, `${a.title}, pro Spieler`),
        C.tau2 > 0
          ? plainTable(['Spieler', a.title, 'Spiele', 'pro 100', '95 %'],
              C.rows.slice().sort((x, y) => y.est - x.est).map(r => [nameOf(ctx, r.k), r.label, fmt.int(r.n), p100(r.est), range(r.lo, r.hi)]), [2, 3, 4],
              C.rows.slice().sort((x, y) => y.est - x.est).map(r => linkTo(ctx, 'player', { id: ctx.model.elo.ids[r.k] })))
          : h('p', { class: 'chart-note' }, `Kein persönliches Muster nach ${a.title === 'Uhrzeit' ? 'Uhrzeit' : 'Wochentag'} nachweisbar (${pText(C.p)}).`)];
    }));
}
