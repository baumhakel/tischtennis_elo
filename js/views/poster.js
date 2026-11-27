// Aushang (Phase 19, #/aushang?monat=2026-11): the monthly wall newspaper. A3 on one page, or A2 from two A3
// sheets. One layout on the A-series ratio, drawn at A2 (420 × 594 mm) and scaled for A3 without reflowing.
// Low ink: white paper, colour in type, thin lines, small marks and light tints only; text in dark grey; charts
// as line drawings. The facts come from core/poster.js, the sentences from views/poster-text.js.
//
// A2 seam: the poster has a deliberate break at its middle (between „Wer gegen wen“ and „Rangverlauf“), so no
// text, row or chart is cut. The two halves print on A3 landscape, the lower one shifted by 8 mm (overlap) with a
// cut line, the upper one with a glue strip.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { linkTo } from './common.js';
import { posterData, lastMonth, monthBounds } from '../core/poster.js';
import { MONTHS } from '../core/window.js';
import { serialToParts } from '../core/normalize.js';
import { storyText, lineText, recordTiles, numbersRow, riddleFacts, allTimeText, allTimeSub } from './poster-text.js';
import { badgeLabel, DEFS } from './badge-defs.js';
import { medal } from '../ui/medal.js';
import { configQr, appUrl } from '../ui/qr.js';
import { loadD3 } from '../ui/charts/d3.js';
import { forecastRows, chance, monthEndLabel } from './forecast-logic.js';

// The light theme's validated series palette (the poster is always light) and its marks.
export const SLOTS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const UP = '#1D7A52', DOWN = '#C2332B', GREEN = '#1D5E46', MUTED = '#8A948E', FAINT = '#C9CFCB';
const W = 420, H = 594, M = 10, SEAM = 297, OVER = 8, BOTTOM = 20;       // mm
const TOP_BOX = [M, SEAM - 14], LOW_BOX = [SEAM + 8, H - BOTTOM];         // the two halves (y from, y to)

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
};

let format = 'a3';

/** Months that can be printed: the first month with games up to the current one, newest first. */
export function printableMonths(G, now) {
  if (!G.length) return [];
  const a = serialToParts(G[0].t), b = serialToParts(now);
  const out = [];
  for (let y = b.y, m = b.mo; y > a.y || (y === a.y && m >= a.mo); m === 1 ? (m = 12, y--) : m--) out.push({ year: y, month: m });
  return out;
}
const monthKey = x => `${x.year}-${String(x.month).padStart(2, '0')}`;
export function parseMonth(v) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(v || ''));
  return m && +m[2] >= 1 && +m[2] <= 12 ? { year: +m[1], month: +m[2] } : null;
}

export function mountPoster(el, ctx) {
  let key = null;
  const update = c => {
    const k = [c.params.monat, c.baseModel.dataset.hash, !!c.badges, !!c.forecast, format].join('|');
    if (k === key) return;
    key = k;
    page(el, c, () => { key = null; update(c); });
  };
  update(ctx);
  return { update, unmount() { document.getElementById('pp-page-style')?.remove(); } };
}

function page(el, ctx, redo) {
  const base = ctx.baseModel, G = base.dataset.games;
  const months = printableMonths(G, ctx.now);
  const want = parseMonth(ctx.params.monat) || lastMonth(ctx.now);
  const label = x => `${MONTHS[x.month - 1]} ${x.year}`;
  const sel = h('select', { id: 'pp-month', 'aria-label': 'Monat', onchange: e => ctx.setParams({ monat: e.target.value }) },
    months.map(x => h('option', { value: monthKey(x), selected: monthKey(x) === monthKey(want) ? true : null }, label(x) + (monthBounds(x.year, x.month).to > ctx.now ? ' (läuft noch)' : ''))));
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Format' }, [['a3', 'A3'], ['a2', 'A2 aus zwei A3']].map(([v, t]) =>
    h('label', {}, h('input', { type: 'radio', name: 'pp-format', value: v, checked: format === v ? true : null, onchange: () => { format = v; redo(); } }), h('span', {}, t))));
  const status = h('p', { class: 'muted small', 'aria-live': 'polite' }, 'Wird gesetzt …');
  const sheets = h('div', { class: 'pp-sheets' });
  render(el,
    h('div', { class: 'pb-intro' },
      h('p', {}, h('a', { class: 'inline-link', ...linkTo(ctx, 'ruhmeshalle') }, '‹ Ruhmeshalle')),
      h('h2', {}, 'Aushang drucken'),
      h('p', { class: 'small' }, 'Die Monatszeitung für die Platte. A3: ein Blatt. A2: zwei A3-Blätter quer, beim unteren den oberen Rand an der gestrichelten Linie abschneiden und auf den Klebestreifen des oberen kleben. Drucken mit „Tatsächliche Größe“ / 100 %, Ränder „Keine“.'),
      h('div', { class: 'pb-tools' }, sel, seg, h('button', { type: 'button', onclick: () => window.print() }, 'Drucken')),
      status),
    sheets);
  if (!ctx.badges) { status.textContent = 'Abzeichen und Monatssieger werden noch berechnet …'; return; }
  const data = posterData(base, ctx.badges, { ...want, now: ctx.now, tournaments: ctx.tournaments?.list || [] });
  const poster = buildPoster(ctx, data);
  const measure = h('div', { class: 'pb-measure' }, poster);
  document.body.append(measure);
  loadD3().catch(() => null).then(d3 => {
    try {
      const scales = fit(poster);                                     // type first, then the network fills its box
      drawNetwork(ctx, data, poster.querySelector('.pp-net-svg'), d3);
      measure.remove();
      paginate(ctx, poster, sheets);
      status.textContent = `${label(want)}${data.issue >= 1 ? `, Ausgabe ${data.issue}` : ''}. ${format === 'a3' ? 'A3, ein Blatt.' : 'A2 aus zwei A3-Blättern (quer).'}${scales.some(x => x < 1) ? ' Schrift verkleinert, damit alles Platz hat.' : ''}`;
    } catch (e) { measure.remove(); status.textContent = `Der Aushang konnte nicht gesetzt werden: ${e.message}`; }
  });
}

/** Shrinks the type of a half until it fits its box (sections without content are already left out). */
function fit(poster) {
  return [...poster.querySelectorAll('.pp-half')].map(half => {
    let scale = 1;
    for (const k of [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.64]) {
      scale = k;
      half.style.fontSize = `${3.8 * k}mm`;
      if (half.scrollHeight <= half.clientHeight + 1) break;
    }
    return scale;
  });
}

// ───────── pages ─────────

function paginate(ctx, poster, sheets) {
  let style = document.getElementById('pp-page-style');
  if (!style) { style = document.createElement('style'); style.id = 'pp-page-style'; document.head.append(style); }
  const px = 96 / 25.4;
  const avail = Math.max(300, (sheets.parentElement?.clientWidth || 390) - 10);
  if (format === 'a3') {
    style.textContent = '@page { size: A3 portrait; margin: 0; }';
    const k = Math.min(1, avail / (297 * px));
    const copy = poster.cloneNode(true);
    copy.style.transform = `scale(${297 / W})`;
    const sheet = h('div', { class: 'pp-sheet', style: `width:297mm;height:420mm;transform:scale(${k})` }, copy);
    render(sheets, h('div', { class: 'pb-sheetwrap', style: `width:${297 * px * k}px;height:${420 * px * k}px` }, sheet));
    return;
  }
  style.textContent = '@page { size: A3 landscape; margin: 0; }';
  const k = Math.min(1, avail / (420 * px));
  const sheet = (offset, top, marks) => {
    const copy = poster.cloneNode(true);
    copy.style.top = `${top - offset}mm`;
    const page = h('div', { class: 'pp-sheet', style: `width:420mm;height:297mm;transform:scale(${k})` }, copy, marks);
    return h('div', { class: 'pb-sheetwrap', style: `width:${420 * px * k}px;height:${297 * px * k}px` }, page);
  };
  const glue = [h('div', { class: 'pb-mark pb-glue', style: `left:0;top:${SEAM - OVER}mm;width:420mm;height:${OVER}mm` }),
    h('div', { class: 'pb-marktext', style: `left:210mm;top:${SEAM - OVER - 4}mm;transform:translateX(-50%)` }, 'Klebestreifen: Blatt 2 hier anlegen'),
    h('div', { class: 'pb-pageno', style: 'right:4mm;top:3mm' }, '1 / 2')];
  const cut = [h('div', { class: 'pb-mark', style: 'left:0;top:6mm;width:420mm;height:0;border-top:0.3mm dashed #1D5E46' }),
    h('div', { class: 'pb-marktext', style: 'left:210mm;top:1.5mm;transform:translateX(-50%)' }, '✂ hier abschneiden'),
    h('div', { class: 'pb-pageno', style: 'right:4mm;bottom:3mm' }, '2 / 2')];
  render(sheets, sheet(0, 0, glue), sheet(SEAM - OVER, 6, cut));
}

// ───────── the poster ─────────

function buildPoster(ctx, D) {
  const cfg = ctx.baseModel.dataset.config;
  const monthName = MONTHS[D.month - 1];
  const T = { names: ctx.names, monthName, cfg };
  const name = id => ctx.names.get(id) ?? id;
  const slotOf = new Map(D.bump.series.filter(x => x.slot != null).map(x => [x.id, SLOTS[x.slot]]));
  const mast = masthead_(cfg, D);
  const [head, ...teasers] = D.stories;
  const story = storyText(head, T);

  // 1. masthead and headline
  const masthead = h('header', { class: 'pp-mast' },
    h('div', { class: 'pp-mast-main' },
      h('div', { class: 'pp-title' }, mast.title),
      h('div', { class: 'pp-subtitle' }, [mast.issue, `Die Monatszeitung der Tischtennisplatte · ${monthName} ${D.year}`].filter(Boolean).join(' · ')),
      h('h1', { class: 'pp-headline' }, story.title),
      h('p', { class: 'pp-dek' }, story.sub, D.running ? ' (Der Monat läuft noch: Stand heute.)' : '')),
    teasers.length ? h('aside', { class: 'pp-teasers' }, h('div', { class: 'pp-kicker' }, 'Außerdem'),
      teasers.slice(0, 3).map(t => { const x = storyText(t, T); return h('div', { class: 'pp-teaser' }, h('strong', {}, x.title), h('span', {}, x.sub)); })) : null);

  // 2. numbers
  const numbers = h('section', { class: 'pp-numbers' }, h('h2', {}, 'Der Monat in Zahlen'),
    h('div', { class: 'pp-numrow' }, numbersRow(D.numbers, T).map(x => h('div', { class: 'pp-num' }, h('b', {}, x.value), h('span', {}, x.label)))));

  // 3. one card per active player
  const cols = D.players.length > 20 ? 6 : 5;
  const cards = h('section', { class: 'pp-cards-sec' }, h('h2', {}, 'Alle Spieler'),
    h('div', { class: 'pp-cards', style: `grid-template-columns:repeat(${cols}, 1fr)` }, D.players.map(p => card(ctx, p, T, slotOf.get(p.id)))));

  // 4. the network
  const net = h('section', { class: 'pp-net' }, h('h2', {}, 'Wer gegen wen'),
    h('div', { class: 'pp-net-box' }, s('svg', { class: 'pp-net-svg', viewBox: '0 0 400 120', preserveAspectRatio: 'xMidYMid meet' })),
    h('p', { class: 'pp-caption' }, [
      D.network.busiest ? `${fmt.int(Math.round(D.network.busiest.n))} Begegnungen: ${name(D.network.busiest.a)} gegen ${name(D.network.busiest.b)}, das meistgespielte Duell. ` : '',
      D.network.unmet ? `${name(D.network.unmet.a)} und ${name(D.network.unmet.b)} ${D.network.unmet.ever ? 'haben noch nie gegeneinander gespielt' : `haben im ${monthName} nicht gegeneinander gespielt`}. Wer fordert?` : '',
      ' Linien: Begegnungen im Monat (je dicker, desto öfter). Kreise: Spiele im Monat, Rand grün = Elo gewonnen, rot = verloren.'].join('')));

  // 5. Rangverlauf
  const bump = D.bump.days.length >= 2 && D.bump.series.length >= 2 ? h('section', { class: 'pp-bump' }, h('h2', {}, 'Rangverlauf'),
    bumpChart(ctx, D, slotOf), h('p', { class: 'pp-caption' }, `Platz am Ende jedes Tages im ${monthName}. Farbig: Platz 1 und die größten Bewegungen.`)) : null;

  // 6. records
  const tiles = recordTiles(D.records, T);
  const records = tiles.length ? h('section', { class: 'pp-records' }, h('h2', {}, 'Rekorde des Monats'),
    h('div', { class: 'pp-rec-grid' }, tiles.map(t => h('div', { class: 'pp-rec' }, h('span', { class: 'pp-rec-label' }, t.label), h('b', {}, t.value),
      h('span', { class: 'pp-rec-who' }, t.who), t.when ? h('span', { class: 'pp-rec-when' }, t.when) : null))),
    D.allTime.length ? h('div', { class: 'pp-alltime' }, h('strong', {}, 'Allzeit-Rekord gebrochen!'),
      D.allTime.map(r => h('div', {}, `${allTimeText(r, T)}. ${allTimeSub(r)}`))) : null) : null;

  // tournament of the month (December: the Christmas tournament)
  const tour = D.tournament ? tournamentBlock(ctx, D.tournament) : null;

  // 7. badges
  const max = cfg.poster_max_badges || 12;
  const byBadge = new Map();
  for (const b of D.badges) { const k = `${b.badge}|${b.level}`; if (!byBadge.has(k)) byBadge.set(k, { ...b, ids: [] }); if (!byBadge.get(k).ids.includes(b.id)) byBadge.get(k).ids.push(b.id); }
  const groups = [...byBadge.values()].sort((x, y) => y.level - x.level || y.ids.length - x.ids.length);
  const badges = groups.length ? h('section', { class: 'pp-badges' }, h('h2', {}, 'Abzeichen'),
    h('div', { class: 'pp-badge-grid' }, groups.slice(0, max).map(b => h('div', { class: 'pp-badge' },
      medal(DEFS[b.badge]?.motif || 'ball', DEFS[b.badge] && b.level ? b.level : -1, { size: 28 }),
      h('div', {}, h('strong', {}, badgeLabel(cfg, b.badge, b.level)), h('span', {}, b.ids.map(name).join(', ')))))),
    groups.length > max ? h('p', { class: 'pp-caption' }, `… und ${groups.length - max} weitere. Alle in der App unter Abzeichen.`) : null) : null;

  // 8. Ruhmeshalle strip
  const hall = D.hall.length ? h('section', { class: 'pp-hall' }, h('h2', {}, `Ruhmeshalle ${D.year}`),
    h('div', { class: 'pp-hall-row' }, D.hall.map(m => h('div', { class: 'pp-hall-m' + (m.from === D.from ? ' now' : '') },
      h('span', { class: 'pp-hall-mon' }, MONTHS[serialToParts(m.from).mo - 1]),
      h('span', {}, h('i', {}, 'Aufsteiger '), m.riser ? `${name(m.riser.id)} ${fmt.signed(m.riser.gain)}` : '–'),
      h('span', {}, h('i', {}, 'Platz 1 '), m.leader ? name(m.leader) : '–'))))) : null;

  // 9. Ausblick (Prognose), only when there is one
  const F = ctx.mode === 'alle' ? ctx.forecast : null;
  const rows = F?.res && F.input.lambda > 0 ? forecastRows(F).slice(0, 3) : [];
  const outlook = rows.length ? h('section', { class: 'pp-outlook' }, h('h2', {}, 'Ausblick'),
    h('p', { class: 'pp-caption' }, `Chance auf Platz 1 am ${monthEndLabel(F.end).replace('Ende ', 'Ende ')} (Prognose der App):`),
    rows.map(r => h('div', { class: 'pp-fc' }, h('span', {}, name(r.id)), h('span', { class: 'pp-fc-bar' }, h('i', { style: `width:${Math.round(r.p1 * 100)}%` })), h('b', {}, chance(r.p1)))),
    F.spot && F.spot.swing >= 0.05 ? h('p', { class: 'pp-spot' }, h('strong', {}, 'Spitzenspiel: '), `${name(F.spot.a)} gegen ${name(F.spot.b)}. Kein anderes Einzel bewegt die Prognose so stark.`) : null) : null;

  // 10. corner for guests and the riddle
  const riddle = D.riddle;
  const corner = h('section', { class: 'pp-corner' },
    h('div', { class: 'pp-new' },
      configQr(cfg, appUrl('#/'), 'Tischtennis Elo'),
      h('div', {}, h('h2', {}, 'Neu hier? So geht’s'),
        h('ol', {}, h('li', {}, 'Spielen, gegen wen du willst.'), h('li', {}, 'Ergebnis eintragen: QR-Code am anderen Aushang scannen.'), h('li', {}, 'In der App deinen Elo-Wert und Platz ansehen (Code links).')))),
    riddle ? h('div', { class: 'pp-riddle' }, h('h2', {}, 'Wer bin ich?'), h('ul', {}, riddleFacts(riddle).map(f => h('li', {}, f)))) : null);

  const top = h('div', { class: 'pp-half pp-top', style: `top:${TOP_BOX[0]}mm;height:${TOP_BOX[1] - TOP_BOX[0]}mm` }, masthead, numbers, cards, net);
  const low = h('div', { class: 'pp-half pp-low', style: `top:${LOW_BOX[0]}mm;height:${LOW_BOX[1] - LOW_BOX[0]}mm` },
    bump, h('div', { class: 'pp-cols' }, h('div', {}, records, tour), h('div', {}, badges)), hall,
    h('div', { class: 'pp-cols pp-end' }, outlook || h('div'), corner));
  const answer = riddle ? h('div', { class: 'pp-answer', style: `top:${H - BOTTOM + 3}mm` }, `Auflösung: ${name(riddle.id)}`) : null;
  return h('div', { class: 'pp-poster', style: `width:${W}mm;height:${H}mm` },
    h('div', { class: 'pp-seam', style: `top:${SEAM - 6}mm` }), top, low, answer,
    h('div', { class: 'pp-foot', style: `top:${H - BOTTOM + 3}mm` }, [mast.title, mast.issue, `gedruckt ${fmt.date(ctx.now)}`].filter(Boolean).join(' · ')));
}

/**
 * The masthead from config: poster_masthead (the name, e.g. „Top Spin“) and poster_issue (the issue line, e.g.
 * „Ausgabe {monat}/{jahr}“ → „Ausgabe 11/26“). Placeholders: {monat} 11 · {jahr} 26 · {jahr4} 2026 · {nr} the
 * running number (from November 2026) · {monatsname} November. An empty poster_issue leaves the line out.
 */
export function mastheadText(cfg, D) {
  const fill = t => String(t || '').replace(/\{(monat|jahr4|jahr|nr|monatsname)\}/g, (_, k) => ({
    monat: String(D.month).padStart(2, '0'), jahr: String(D.year).slice(2), jahr4: String(D.year),
    nr: String(Math.max(1, D.issue)), monatsname: MONTHS[D.month - 1] })[k]);
  return { title: fill(cfg.poster_masthead || 'Top Spin').trim(), issue: fill(cfg.poster_issue ?? 'Ausgabe {monat}/{jahr}').trim() };
}
const masthead_ = mastheadText;

function card(ctx, p, T, color) {
  const name = ctx.names.get(p.id) ?? p.id;
  const move = p.place == null || p.placeStart == null ? (p.new ? 'neu' : '') : p.placeStart > p.place ? `▲ ${p.placeStart - p.place}` : p.placeStart < p.place ? `▼ ${p.place - p.placeStart}` : '=';
  const img = ctx.photos?.faces ? ctx.photos.avatarUrl(p.id) : null;
  return h('div', { class: 'pp-card' + (p.place === 1 ? ' first' : '') + (p.games ? '' : ' pause'), style: color ? `--slot:${color}` : null },
    h('div', { class: 'pp-card-head' },
      h('span', { class: 'pp-place' }, p.place ? `${p.place}.` : '–'),
      img ? h('img', { class: 'pp-face', src: img, alt: '' }) : null,
      h('span', { class: 'pp-name' }, name),
      h('span', { class: 'pp-move ' + (move.startsWith('▲') ? 'up' : move.startsWith('▼') ? 'down' : '') }, move)),
    h('div', { class: 'pp-card-elo' }, h('b', {}, fmt.elo(p.rating)), p.games ? h('span', { class: p.delta > 0.5 ? 'up' : p.delta < -0.5 ? 'down' : '' }, fmt.signed(p.delta)) : null,
      p.provisional ? h('span', { class: 'pp-prov' }, 'vorläufig') : null),
    p.spark.length >= 2 ? spark(p.spark, color) : h('div', { class: 'pp-spark-empty' }),
    p.games ? h('div', { class: 'pp-card-stats' }, `${p.games} Spiele · ${p.wins}:${p.losses}`) : null,
    h('div', { class: 'pp-line' }, lineText(p.line, T)));
}

function spark(values, color) {
  const n = values.length, lo = Math.min(...values), hi = Math.max(...values), span = Math.max(hi - lo, 1);
  const pts = values.map((v, i) => `${(i / (n - 1) * 100).toFixed(2)},${(18 - (v - lo) / span * 16).toFixed(2)}`).join(' ');
  return s('svg', { class: 'pp-spark', viewBox: '0 0 100 20', preserveAspectRatio: 'none' },
    s('polyline', { points: pts, fill: 'none', stroke: color || '#5f6863', 'stroke-width': color ? 1.6 : 1.1, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' }));
}

/** Bump chart: Platz per day, thin grey lines, the highlighted ones in their slot colour with names. */
function bumpChart(ctx, D, slotOf) {
  const days = D.bump.days, N = Math.max(2, D.bump.size), w = 400, hgt = 92, padL = 6, padR = 30, padT = 3, padB = 7;
  const x = i => padL + i / (days.length - 1) * (w - padL - padR);
  const y = pl => padT + (pl - 1) / Math.max(1, N - 1) * (hgt - padT - padB);
  const kids = [];
  for (let pl = 1; pl <= N; pl++) kids.push(s('text', { x: 1, y: y(pl) + 1, class: 'pp-ax' }, String(pl)));
  days.forEach((d, i) => { const day = serialToParts(d).d; if (day === 1 || day % 7 === 1) kids.push(s('text', { x: x(i), y: hgt - 1, class: 'pp-ax', 'text-anchor': 'middle' }, `${day}.`)); });
  const order = D.bump.series.slice().sort((a, b) => (a.slot != null) - (b.slot != null));
  for (const ser of order) {
    let d = '', pen = false, last = null;
    ser.places.forEach((pl, i) => {
      if (pl == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(2)} ${y(pl).toFixed(2)}`; pen = true; last = { i, pl };
    });
    if (!d) continue;
    const c = slotOf.get(ser.id);
    kids.push(s('path', { d, fill: 'none', stroke: c || FAINT, 'stroke-width': c ? 0.9 : 0.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    if (last) kids.push(s('text', { x: x(last.i) + 1.5, y: y(last.pl) + 1.1, class: 'pp-lab' + (c ? ' hi' : ''), fill: c || '#5f6863' }, ctx.names.get(ser.id) ?? ser.id));
  }
  return s('svg', { class: 'pp-bump-svg', viewBox: `0 0 ${w} ${hgt}` }, kids);
}

/** The network of the month: d3-force with its fixed start (same month → same picture), run to rest. */
function drawNetwork(ctx, D, svg, d3) {
  const box = svg.parentElement.getBoundingClientRect();
  const vw = 400, vh = Math.max(60, Math.round(400 * box.height / Math.max(1, box.width)));
  svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
  const nodes = D.network.nodes.map(n => ({ ...n }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const links = D.network.edges.filter(e => byId.has(e.a) && byId.has(e.b)).map(e => ({ source: e.a, target: e.b, n: e.n }));
  const linked = new Set(links.flatMap(l => [l.source, l.target]));
  const maxN = Math.max(1, ...links.map(l => l.n)), maxG = Math.max(1, ...nodes.map(n => n.games));
  const r = n => 1.6 + 3.2 * Math.sqrt(n.games / maxG);
  if (d3) {
    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(n => n.id).distance(l => 55 - 30 * l.n / maxN).strength(l => 0.25 + 0.5 * l.n / maxN))
      .force('charge', d3.forceManyBody().strength(-160))
      .force('x', d3.forceX(0).strength(n => (linked.has(n.id) ? 0.05 : 0.01)))
      .force('y', d3.forceY(0).strength(n => (linked.has(n.id) ? 0.09 : 0.01)))
      .force('collide', d3.forceCollide(n => r(n) + 9))
      .force('ring', d3.forceRadial(130, 0, 0).strength(n => (linked.has(n.id) ? 0 : 0.4)))
      .stop();
    for (let i = 0; i < 400; i++) sim.tick();
  } else nodes.forEach((n, i) => { const a = i / nodes.length * 2 * Math.PI; n.x = Math.cos(a) * 100; n.y = Math.sin(a) * 50; });
  // fit into the box (keep the aspect, labels need room on the right)
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // stretched to the box on both axes (a wide, low box: the layout is spread sideways, labels need room on the right)
  const kx = (vw - 70) / Math.max(1, x1 - x0), ky = (vh - 14) / Math.max(1, y1 - y0);
  const px = n => 12 + (n.x - x0) * kx, py = n => 7 + (n.y - y0) * ky;
  const kids = [];
  for (const l of links) {
    const a = typeof l.source === 'object' ? l.source : byId.get(l.source), b = typeof l.target === 'object' ? l.target : byId.get(l.target);
    kids.push(s('line', { x1: px(a), y1: py(a), x2: px(b), y2: py(b), stroke: '#9aa29e', 'stroke-width': (0.25 + 1.6 * l.n / maxN).toFixed(2), 'stroke-linecap': 'round', opacity: 0.85 }));
  }
  for (const n of nodes) {
    const c = n.games === 0 ? FAINT : n.delta > 0.5 ? UP : n.delta < -0.5 ? DOWN : MUTED;
    kids.push(s('circle', { cx: px(n), cy: py(n), r: r(n), fill: '#fff', stroke: c, 'stroke-width': 0.9 }));
    kids.push(s('text', { x: px(n) + r(n) + 1.4, y: py(n) + 1.4, class: 'pp-lab' + (n.games ? '' : ' faint') }, ctx.names.get(n.id) ?? n.id));
  }
  svg.replaceChildren(...kids);
}

function tournamentBlock(ctx, t) {
  const img = t.photo && ctx.photos?.on ? ctx.photos.url(t.photo, 'thumb') : null;
  const side = x => (x ? x.name : '?');
  const f = t.final;
  return h('section', { class: 'pp-tour' }, h('h2', {}, t.name),
    h('div', { class: 'pp-tour-row' },
      img ? h('img', { class: 'pp-tour-img', src: img, alt: `Siegerfoto ${t.name}` }) : null,
      h('div', {},
        h('p', { class: 'pp-tour-win' }, h('span', { class: 'pp-cup' }, '1.'), side(t.winner)),
        t.second ? h('p', {}, h('span', { class: 'pp-cup' }, '2.'), side(t.second)) : null,
        t.third.length ? h('p', {}, h('span', { class: 'pp-cup' }, '3.'), t.third.map(side).join(', ')) : null,
        f ? h('p', { class: 'pp-caption' }, `Finale: ${f.a.name} gegen ${f.b.name} ${f.result.setsA}:${f.result.setsB} (${f.result.sets.map(x => x.join(':')).join(', ')})`) : null,
        h('p', { class: 'pp-caption' }, `${fmt.date(t.date)} · ${t.participants} ${t.participants === 1 ? 'Teilnehmer' : 'Teilnehmer'}`))));
}
