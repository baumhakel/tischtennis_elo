// Aushang (Phase 18c, #/aushang?turnier=<id>): the tournament for the pinboard, A1 from four A3 sheets (2 × 2,
// portrait or landscape as the content fits). Blank for writing on (from „angekündigt“ on): head with a QR code to
// the tournament, per group a results matrix, a table with empty rows and every match with boxes for the sets and its
// own QR code (opens the match page); in Swiss mode round 1 with names and the later rounds as empty pools; the
// knockout bracket with its sources („Sieger Gruppe A“, „1. Schweizer Seed“). Low ink: white, lines, colour only in
// type and thin rules. No app frame (bare view).
//
// Layout: the poster is drawn once at full size in mm. Four windows (one per sheet, 6 mm white margin each) show
// it, overlapping by 8 mm at the seams; no block crosses a seam (blocks are packed into the four quarters). The
// right sheets get a cut line at their left window edge, the lower sheets at their top edge; the sheets they are
// glued onto show the glue strip.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { viewHead, linkTo } from './common.js';
import { pickTournament } from '../app/tournaments.js';
import { seedSlots, roundName, LETTERS } from '../core/tournament.js';
import { sideName, MODE_TEXT, tournamentQr } from './tournament-ui.js';
import { mountPoster } from './poster.js';

const MARGIN = 6, OVERLAP = 8, PAD = 8, SEAM_GAP = 6;
const SHEET = { hoch: [297, 420], quer: [420, 297] };

/** Geometry of a 2 × 2 poster: size, the sheets' windows and the four content regions (reading order). */
export function posterGeometry(orient) {
  const [sw, sh] = SHEET[orient];
  const ww = sw - 2 * MARGIN, wh = sh - 2 * MARGIN;
  const W = 2 * ww - OVERLAP, H = 2 * wh - OVERLAP;
  const sx = ww - OVERLAP, sy = wh - OVERLAP;                  // where the right / lower windows start
  const cols = [[PAD, sx - SEAM_GAP], [ww + SEAM_GAP, W - PAD]];
  const rows = [[PAD, sy - SEAM_GAP], [wh + SEAM_GAP, H - PAD]];
  const region = (c, r) => ({ x: cols[c][0], y: rows[r][0], w: cols[c][1] - cols[c][0], h: rows[r][1] - rows[r][0] });
  return { orient, sw, sh, ww, wh, W, H, sx, sy,
    regions: [region(0, 0), region(0, 1), region(1, 0), region(1, 1)],
    sheets: [[0, 0], [1, 0], [0, 1], [1, 1]].map(([c, r], i) => ({ n: i + 1, c, r, x: c ? sx : 0, y: r ? sy : 0 })) };
}

/**
 * Packs blocks into the regions in order. items: [{ h, gap, title }] (mm): `gap` above the block (dropped at the top
 * of a region), `title` = height of the „(Fortsetzung)“ heading a continuation needs when it starts a region.
 * → [{ region, top, cont }] per block, or null if they don't fit.
 */
export function packBlocks(items, regions) {
  const out = [];
  let r = 0, y = 0;
  for (const it of items) {
    const need = top => (top ? (it.title || 0) : it.gap) + it.h;
    while (r < regions.length && y > 0 && y + need(false) > regions[r].h) { r++; y = 0; }
    if (r >= regions.length || need(y === 0) > regions[r].h) return null;
    const cont = y === 0 && !!it.title;
    const top = y === 0 ? 0 : y + it.gap;
    out.push({ region: r, top, cont });
    y = top + (cont ? it.title : 0) + it.h;
  }
  return out;
}

let state = { orient: 'auto' };

export default {
  id: 'aushang',
  title: 'Aushang',
  mount(el, ctx) {
    if (ctx.params.turnier == null) return mountPoster(el, ctx);   // Phase 19: #/aushang?monat= is the monthly poster
    let key = null;
    const update = c => {
      const k = [c.params.turnier, c.baseModel.dataset.hash, state.orient].join('|');
      if (k === key) return;
      key = k;
      page(el, c, () => { key = null; update(c); });
    };
    update(ctx);
    return { update, unmount() { document.getElementById('pb-page-style')?.remove(); } };
  },
};

function page(el, ctx, redo) {
  const T = pickTournament(ctx.tournaments, ctx.params.turnier);
  if (!T || !T.ok) {
    render(el, viewHead('Aushang', null, { back: true }), h('p', { class: 'empty' }, T ? T.problem : 'Dieses Turnier gibt es nicht (oder es ist noch ein Entwurf).'));
    return;
  }
  if (ctx.params.erinnerung != null) {
    render(el, viewHead('Erinnerung', null, { back: true }), h('p', { class: 'empty' }, 'Der Erinnerungsdruck nach dem Turnier kommt noch.'));
    return;
  }
  const status = h('p', { class: 'muted small', 'aria-live': 'polite' }, 'Wird gesetzt …');
  const sheets = h('div', { class: 'pb-sheets' });
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Format' }, [['auto', 'Automatisch'], ['hoch', 'Hochformat'], ['quer', 'Querformat']].map(([v, t]) =>
    h('label', {}, h('input', { type: 'radio', name: 'pb-orient', value: v, checked: state.orient === v ? true : null, onchange: () => { state.orient = v; redo(); } }), h('span', {}, t))));
  render(el,
    h('div', { class: 'pb-intro' },
      h('p', {}, h('a', { class: 'inline-link', ...linkTo(ctx, 'turnier', { id: T.id }) }, `‹ ${T.name}`)),
      h('h2', {}, 'Aushang zum Ausdrucken'),
      h('p', { class: 'small' }, 'Vier A3-Blätter ergeben zusammen etwa A1. Drucken mit „Tatsächliche Größe“ / 100 %, Ränder „Keine“, „Hintergrundgrafiken“ an (für die hellen Farbflächen). Dann bei den rechten Blättern den linken Rand und bei den unteren den oberen Rand an der gestrichelten Linie abschneiden und auf den Klebestreifen des Nachbarblatts kleben.'),
      h('p', { class: 'small' }, 'Die QR-Codes vorher mit dem Handy testen (Seite „QR-Test“). Ergebnisse trägt man über die Codes in der App ein, der Aushang ist zum Mitschreiben.'),
      h('div', { class: 'pb-tools' }, seg, h('button', { type: 'button', onclick: () => window.print() }, 'Drucken')),
      status),
    sheets);
  const measure = h('div', { class: 'pb-measure' });
  document.body.append(measure);
  const finish = () => {
    try { layout(ctx, T, sheets, measure, status); } finally { measure.remove(); }
  };
  (document.fonts?.ready || Promise.resolve()).then(finish, finish);
}

/** mm per CSS px (CSS defines 1 mm = 96 / 25.4 px). */
const PX = 25.4 / 96;

function layout(ctx, T, sheets, measure, status) {
  const orients = state.orient === 'auto' ? ['hoch', 'quer'] : [state.orient];
  let chosen = null;
  for (const scale of [1.5, 1.3, 1.15, 1, 0.9, 0.8, 0.72]) {   // as large as it fits (read from a few steps away)
    for (const o of orients) {
      const g = posterGeometry(o);
      const width = Math.min(g.regions[0].w, g.regions[2].w);
      const blocks = buildBlocks(ctx, T, width, scale);
      const probe = heading('Gruppe A, Spiele (Fortsetzung)', 'A');   // same element as a real continuation heading
      render(measure, h('div', { class: 'pb-poster', style: `font-size:${4 * scale}mm` }, blocks.map(b => h('div', { style: `width:${width}mm` }, b.el)), h('div', { style: `width:${width}mm` }, probe)));
      const titleH = (probe.getBoundingClientRect().height + parseFloat(getComputedStyle(probe).marginBottom)) * PX + 0.5;
      const items = blocks.map(b => ({ h: b.el.getBoundingClientRect().height * PX, gap: (b.cont ? 0 : 7) * scale, title: b.cont ? titleH : 0 }));
      const packed = packBlocks(items, g.regions);
      if (packed) { chosen = { g, blocks, packed, scale }; break; }
    }
    if (chosen) break;
  }
  if (!chosen) { status.textContent = 'Zu viel Inhalt für vier A3-Blätter: bitte weniger Gruppen oder Spiele, oder den Aushang in zwei Teilen drucken.'; return; }
  const { g, blocks, packed, scale } = chosen;
  // the poster: blocks in their regions, plus seam marks
  const poster = h('div', { class: 'pb-poster', style: `width:${g.W}mm;height:${g.H}mm;font-size:${4 * scale}mm` });
  const regions = g.regions.map(r => h('div', { class: 'pb-region', style: `left:${r.x}mm;top:${r.y}mm;width:${r.w}mm;height:${r.h}mm` }));
  blocks.forEach((b, i) => {
    const p = packed[i], el = p.cont ? h('section', { class: 'pb-block', style: b.el.getAttribute('style') }, heading(b.cont, b.badge), b.el) : b.el;
    el.style.position = 'absolute'; el.style.top = `${p.top}mm`; el.style.width = '100%';
    regions[p.region].append(el);
  });
  poster.append(...regions);
  // page setup for printing
  let style = document.getElementById('pb-page-style');
  if (!style) { style = document.createElement('style'); style.id = 'pb-page-style'; document.head.append(style); }
  style.textContent = `@page { size: A3 ${g.orient === 'hoch' ? 'portrait' : 'landscape'}; margin: 0; }`;
  // four sheets, each a window onto the poster
  const avail = Math.max(300, (sheets.parentElement?.clientWidth || 390) - 10);
  const k = Math.min(1, (avail / 2) / (g.sw / PX));
  render(sheets, g.sheets.map(s => {
    const win = h('div', { class: 'pb-window', style: `width:${g.ww}mm;height:${g.wh}mm` });
    const copy = poster.cloneNode(true);
    copy.style.position = 'absolute'; copy.style.left = `${-s.x}mm`; copy.style.top = `${-s.y}mm`;
    win.append(copy, ...marks(g, s));
    const sheet = h('div', { class: 'pb-sheet' + (g.orient === 'quer' ? ' quer' : ''), style: `transform:scale(${k})` }, win);
    return h('div', { class: 'pb-sheetwrap', style: `width:${g.sw / PX * k}px;height:${g.sh / PX * k}px` }, sheet);
  }));
  sheets.style.gridTemplateColumns = 'repeat(2, max-content)';
  status.textContent = `${g.orient === 'hoch' ? 'Hochformat' : 'Querformat'}, vier A3-Blätter (zusammen ${Math.round(g.W)} × ${Math.round(g.H)} mm)${scale !== 1 ? `, Schrift ${Math.round(scale * 100)} %` : ''}.`;
}

/** Cut line, glue strip and page number for one sheet (coordinates inside its window). */
function marks(g, s) {
  const out = [];
  const box = (style, cls = 'pb-mark') => h('div', { class: cls, style });
  const text = (t, style) => h('div', { class: 'pb-marktext', style }, t);
  // glue strips: on the left sheets at their right edge, on the upper sheets at their bottom edge
  if (s.c === 0) {
    out.push(box(`left:${g.sx}mm;top:0;width:${OVERLAP}mm;height:${g.wh}mm`, 'pb-mark pb-glue'),
      box(`left:${g.sx}mm;top:0;width:0;height:${g.wh}mm;border-left:0.3mm solid #1D5E46`, 'pb-mark'),
      text('Klebestreifen: Blatt ' + (s.n + 1) + ' hier anlegen', `left:${g.sx - 2}mm;top:${g.wh / 2}mm;transform:translate(-100%,0) rotate(-90deg);transform-origin:100% 0`));
  } else {
    out.push(box(`left:0;top:0;width:0;height:${g.wh}mm;border-left:0.3mm dashed #1D5E46`, 'pb-mark'),
      text('✂ hier abschneiden', `left:1.5mm;top:${g.wh / 2}mm;transform:rotate(90deg);transform-origin:0 0`));
  }
  if (s.r === 0) {
    out.push(box(`left:0;top:${g.sy}mm;width:${g.ww}mm;height:${OVERLAP}mm`, 'pb-mark pb-glue'),
      box(`left:0;top:${g.sy}mm;width:${g.ww}mm;height:0;border-top:0.3mm solid #1D5E46`, 'pb-mark'),
      text('Klebestreifen: Blatt ' + (s.n + 2) + ' hier anlegen', `left:${g.ww / 2}mm;top:${g.sy - 4}mm;transform:translateX(-50%)`));
  } else {
    out.push(box(`left:0;top:0;width:${g.ww}mm;height:0;border-top:0.3mm dashed #1D5E46`, 'pb-mark'),
      text('✂ hier abschneiden', `left:${g.ww / 2}mm;top:1mm;transform:translateX(-50%)`));
  }
  // page number in the outer corner (never under another sheet)
  const pos = `${s.c ? 'right' : 'left'}:0.8mm;${s.r ? 'bottom' : 'top'}:0.6mm`;   // outside the poster frame (4.4 mm)
  out.push(h('div', { class: 'pb-pageno', style: pos }, `${s.n} / 4`));
  return out;
}

// ───────── the blocks ─────────

// Colours (Phase 18c, rework 27 Nov): one accent per section, each with a pale tint and a fainter one. Ink goes into
// lines, type and small marks; areas get only the pale tints (low ink, but not just white).
const ACCENTS = [
  ['#1D6B4F', '#E2F1EA', '#F4FAF7'],   // green
  ['#2563A6', '#E3EDF8', '#F5F9FD'],   // blue
  ['#C2571A', '#FCEADC', '#FEF7F1'],   // orange
  ['#7048A8', '#EEE7F7', '#F9F6FC'],   // violet
  ['#B4364A', '#F9E3E7', '#FDF4F6'],   // raspberry
  ['#127A80', '#DDF1F2', '#F3FAFA'],   // teal
  ['#6E7F1F', '#EEF2DC', '#F8FAF0'],   // olive
  ['#8A5A2B', '#F3E9DE', '#FAF6F1'],   // brown
];
const GOLD = ['#9A7300', '#FAF0D2', '#FDF9EC'];
const accent = ([c, t, f]) => `--c:${c};--t:${t};--f:${f}`;

function buildBlocks(ctx, T, width, scale) {
  const blocks = [{ el: head(ctx, T) }];
  const add = (title, body, acc, badge) => blocks.push({ el: block(title, body, acc, badge) });
  // match lists in small pieces (two rows each), so they fill the quarters; a piece at the top of a quarter gets a heading
  const chunk = (title, ms, acc, badge) => {
    for (let i = 0; i < ms.length; i += 2) {
      blocks.push({ el: h('div', { class: 'pb-block', style: accent(acc) }, matchRows(ctx, T, ms.slice(i, i + 2), i)), cont: i ? `${title} (Fortsetzung)` : title, badge });
    }
  };
  if (T.mode === 'gruppen') {
    for (const t of T.tables) {
      const acc = ACCENTS[t.group % ACCENTS.length];
      const ms = T.matches.filter(m => m.stage === 'gruppe' && m.group === t.group);
      add(`Gruppe ${t.letter}`, [groupMatrix(ctx, T, t), groupTable(ctx, T, t),
        h('p', { class: 'pb-small' }, `${t.advance} ${t.advance === 1 ? 'kommt' : 'kommen'} weiter · Best of ${T.settings.bestOf.gruppe}`)], acc, t.letter);
      chunk(`Gruppe ${t.letter}, Spiele`, ms, acc, t.letter);
    }
  } else {
    const acc = ACCENTS[1];
    const r1 = T.swiss.rounds[0];
    add('Schweizer Runde 1', [h('p', { class: 'pb-small' }, swissRule(T)),
      r1.byes.length ? h('p', {}, 'Freilos: ', r1.byes.map(k => sideName(ctx, T.participants.find(p => p.key === k))).join(', ')) : null], acc, '1');
    chunk('Runde 1', r1.nrs.map(nr => T.matches[nr - 1]), acc, '1');
    add('Schweizer Runden 2 und weiter', swissDiagram(T), ACCENTS[5], '2+');
  }
  add('K.-o.-Runde', knockout(ctx, T, width), GOLD, cup());
  return blocks;
}

/** Section heading: a small badge (group letter, round, cup) in the accent, the title, a fine rule. */
const heading = (title, badge) => h('h3', { class: 'pb-h3' }, badge != null ? h('span', { class: 'pb-badge' }, badge) : null, h('span', {}, title));

const block = (title, body, acc = ACCENTS[0], badge = null) => h('section', { class: 'pb-block', style: accent(acc) }, title ? heading(title, badge) : null, body);

const NS = 'http://www.w3.org/2000/svg';
function svg(viewBox, cls, parts) {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', viewBox); el.setAttribute('class', cls); el.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of parts) {
    const x = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, v);
    el.append(x);
  }
  return el;
}

/** A small cup (knockout badge), drawn in the current colour. */
const cup = () => svg('0 0 24 24', 'pb-cup', [
  ['path', { d: 'M7 3h10v5a5 5 0 0 1-10 0z', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linejoin': 'round' }],
  ['path', { d: 'M7 5H4v1a3 3 0 0 0 3 3M17 5h3v1a3 3 0 0 1-3 3M12 13v4M8 21h8M9 17h6', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round' }],
]);

/** The head's picture: a table from above (outline), the net, a racket and a ball in the accent colours. */
const tableArt = () => svg('0 0 120 64', 'pb-art', [
  ['rect', { x: '4', y: '8', width: '92', height: '50', rx: '3', fill: '#E2F1EA', stroke: '#1D6B4F', 'stroke-width': '1.6' }],
  ['line', { x1: '4', y1: '33', x2: '96', y2: '33', stroke: '#1D6B4F', 'stroke-width': '0.8' }],
  ['line', { x1: '50', y1: '4', x2: '50', y2: '62', stroke: '#1D6B4F', 'stroke-width': '2.4', 'stroke-dasharray': '1.2 1.6' }],
  ['circle', { cx: '74', cy: '20', r: '3.6', fill: '#F28C28' }],
  ['path', { d: 'M78 21 q6 -2 9 1', fill: 'none', stroke: '#F28C28', 'stroke-width': '0.8', 'stroke-dasharray': '1.4 1.4' }],
  ['circle', { cx: '104', cy: '42', r: '11', fill: '#F9E3E7', stroke: '#B4364A', 'stroke-width': '1.6' }],
  ['rect', { x: '99', y: '50', width: '4.5', height: '12', rx: '1.8', transform: 'rotate(35 101 56)', fill: '#8A5A2B' }],
]);

function head(ctx, T) {
  const chips = [T.date != null ? fmt.date(T.date) : null, T.art === 'doppel' ? 'Doppel' : 'Einzel',
    T.mode === 'schweizer' ? 'Schweizer System + K.-o.' : 'Gruppen + K.-o.', `${T.participants.length} ${T.art === 'doppel' ? 'Teams' : 'Teilnehmer'}`, `Sätze bis ${T.points}`];
  return h('section', { class: 'pb-block pb-head', style: accent(ACCENTS[0]) },
    h('div', { class: 'pb-head-main' },
      h('div', { class: 'pb-kicker' }, 'Tischtennis · Turnier'),
      h('h2', {}, T.name),
      h('div', { class: 'pb-chips' }, chips.filter(Boolean).map(c => h('span', { class: 'pb-chip' }, c))),
      h('div', { class: 'pb-howto' }, tableArt(), h('div', {},
        h('p', {}, h('strong', {}, 'Ergebnis eintragen: '), 'QR-Code des Spiels scannen (oder rechts den des Turniers), Sätze in der App eintragen. Es gilt immer der letzte Eintrag eines Spiels.'),
        h('p', { class: 'pb-small' }, T.started != null ? `Auslosung fest seit ${fmt.date(T.started)}.`
          : T.status === 'angekündigt' || T.status === 'test' ? `Stand der Auslosung: ${fmt.date(ctx.now)}, ${fmt.time(ctx.now)} Uhr (kann sich bis zum Start noch ändern).`
            : `Gedruckt ${fmt.date(ctx.now)}, ${fmt.time(ctx.now)} Uhr.`)))),
    h('div', { class: 'pb-head-qr' }, tournamentQr(ctx, `#/turnier?id=${encodeURIComponent(T.id)}`, T.name), h('div', { class: 'pb-qrcap' }, 'Turnier in der App')));
}

const nameOf = (ctx, T, key) => sideName(ctx, T.participants.find(p => p.key === key));

function groupMatrix(ctx, T, t) {
  const keys = T.groups[t.group].keys;
  return h('table', { class: 'pb-matrix' },
    h('tr', {}, h('th', {}, ''), keys.map((_, j) => h('th', {}, String(j + 1)))),
    keys.map((k, i) => h('tr', {}, h('th', {}, `${i + 1} ${nameOf(ctx, T, k)}`), keys.map((_, j) => h('td', { class: i === j ? 'cell self' : 'cell' })))));
}

function groupTable(ctx, T, t) {
  return h('table', { class: 'pb-table' },
    h('tr', {}, ['Platz', 'Name', 'Siege', 'Sätze', 'Punkte'].map(x => h('th', {}, x))),
    T.groups[t.group].keys.map((_, i) => h('tr', { class: i < t.advance ? 'up' : '' }, h('td', { class: 'box place' }, `${i + 1}.`), h('td', { class: 'name' }), h('td', { class: 'box' }), h('td', { class: 'box' }), h('td', { class: 'box' }))));
}

/** Match rows: number, both sides (names or where they come from), a box per set, the match's QR code. */
function matchRows(ctx, T, ms, from = 0) {
  return h('div', { class: 'pb-matches' }, ms.map((m, i) => matchBox(ctx, T, m, { odd: (from + i) % 2 === 1 })));
}

function matchBox(ctx, T, m, { label = null, odd = false } = {}) {
  const side = s => h('div', { class: 'pb-side' }, s.key ? sideName(ctx, s) : '',
    s.from && m.stage === 'ko' ? h('span', { class: 'from' }, s.from) : null);
  return h('div', { class: 'pb-match' + (odd ? ' odd' : '') + (m.label === 'Finale' ? ' final' : '') },
    h('div', { class: 'pb-nr' }, h('span', { class: 'pb-nr-n' }, m.nr ? String(m.nr) : ''), h('small', {}, label || `Best of ${m.bestOf}`)),
    h('div', { class: 'pb-sides' }, side(m.a), side(m.b)),
    h('div', { class: 'pb-sets' }, Array.from({ length: m.bestOf || 3 }, (_, i) => h('div', { class: 'pb-set' }, h('i', {}, String(i + 1)), h('span'), h('span')))),
    m.nr ? tournamentQr(ctx, `#/turnierspiel?id=${encodeURIComponent(T.id)}&nr=${m.nr}`, `Spiel ${m.nr}`, { ecl: 'M' }) : h('div'));
}

function swissRule(T) {
  const s = T.settings;
  return `${s.swissWins} Siege: weiter · ${s.swissLosses} Niederlagen: ausgeschieden. Die nächste Runde steht in der App, sobald alle Spiele der Runde eingetragen sind (dort unter „Als Nächstes“). Best of ${s.bestOf.schweizer ?? s.bestOf.gruppe}${s.bestOf.entscheidung ? `, Entscheidungsspiele Best of ${s.bestOf.entscheidung}` : ''}.`;
}

/** Rounds 2 … as columns of empty pools (expected size from the binomial spread), with lines to write on. */
function swissDiagram(T) {
  const W = T.settings.swissWins, L = T.settings.swissLosses, n = T.participants.length;
  const choose = (a, b) => { let r = 1; for (let i = 1; i <= b; i++) r = r * (a - b + i) / i; return r; };
  const cols = [];
  for (let r = 2; r <= W + L - 1; r++) {
    const pools = [];
    for (let w = Math.min(W - 1, r - 1); w >= 0; w--) {
      const l = r - 1 - w;
      if (l >= L) continue;
      const players = n * choose(r - 1, w) / 2 ** (r - 1);
      const lines = Math.max(1, Math.ceil(players / 2));
      pools.push(h('div', { class: 'pb-pool' + (w === W - 1 || l === L - 1 ? ' decisive' : '') }, h('b', {}, `${w}–${l}`),
        Array.from({ length: lines }, () => h('div', { class: 'pb-line' }, 'Spiel ___'))));
    }
    cols.push(h('div', {}, h('h4', {}, `Runde ${r}`), pools));
  }
  return h('div', { class: 'pb-swiss' }, cols);
}

/** The bracket: the real knockout matches, or (Swiss, before it is known) the expected one with seed labels. */
function knockout(ctx, T) {
  let rounds;
  if (T.bracket.length) {
    const byNr = new Map(T.matches.map(m => [m.nr, m]));
    rounds = T.bracket.map(r => ({ name: r.name, ms: [...r.matches.map(nr => byNr.get(nr)), ...(r.third ? [byNr.get(r.third)] : [])] }));
  } else {
    // Swiss before the end: expected size, seeds as labels, match numbers to write in
    const { slots } = seedSlots(T.swiss?.expectedKo || 2);
    let sides = slots.map(s => (s ? { from: `${s.seed}. Schweizer Seed` } : null));
    rounds = [];
    while (sides.length > 1) {
      const name = roundName(sides.length), ms = [], next = [];
      for (let i = 0; i < sides.length; i += 2) {
        const [a, b] = [sides[i], sides[i + 1]];
        if (!a || !b) { next.push(a || b); continue; }
        ms.push({ nr: null, a: { key: null, from: a.from }, b: { key: null, from: b.from }, bestOf: T.settings.bestOf[name.toLowerCase()] ?? T.settings.bestOf.gruppe, stage: 'ko' });
        next.push({ from: `Sieger ${name}` });
      }
      rounds.push({ name, ms });
      sides = next;
    }
    if (T.settings.third && rounds.length >= 2) rounds.at(-1).ms.push({ nr: null, a: { key: null, from: 'Verlierer Halbfinale' }, b: { key: null, from: 'Verlierer Halbfinale' }, bestOf: T.settings.bestOf['spiel um platz 3'] ?? T.settings.bestOf.gruppe, stage: 'ko', third: true });
  }
  return h('div', { class: 'pb-ko' }, rounds.map(r => h('div', { class: 'pb-ko-round' }, h('h4', {}, r.name),
    r.ms.map(m => matchBox(ctx, T, m, { label: m.third ? `Platz 3 · Best of ${m.bestOf}` : `Best of ${m.bestOf}` })))));
}

export { LETTERS };
