// Erinnerung (Phase 18c, section 7, built 27 Nov; #/aushang?turnier=<id>&erinnerung): the souvenir of a tournament
// day for the wall, A1 from four A3 sheets or A2 from two. Colourful (the low-ink rule doesn't apply): the winner
// photo large, the podium, the highlights of the day (core/souvenir.js), the photos chosen above the sheets (tap to
// include, up to four), the filled group tables and matrices or the Swiss rounds, the knockout with all sets, and
// every result. Same paper mechanics as the pinboard print (print-tournament.js): the poster is drawn once in mm,
// each sheet is a window onto it, no block crosses a seam.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { avatar } from '../ui/avatar.js';
import { linkTo, viewHead } from './common.js';
import { pickTournament } from '../app/tournaments.js';
import { souvenirFacts, playedMatches } from '../core/souvenir.js';
import { sideName, setLine, tournamentQr, MODE_TEXT } from './tournament-ui.js';
import { posterGeometry, packBlocks, marks, heading, block, accent, ACCENTS, GOLD, cup, svg, PX } from './print-tournament.js';

const MAX_PHOTOS = 4;
const state = { format: 'a1', orient: 'auto', chosen: new Map() };

export function mountSouvenir(el, ctx) {
  let key = null;
  const update = c => {
    const T = pickTournament(c.tournaments, c.params.turnier);
    const k = [c.params.turnier, c.baseModel.dataset.hash, state.format, state.orient, [...(state.chosen.get(T?.id) || [])].join(','), c.state.photosRev, !!c.badges].join('|');
    if (k === key) return;
    key = k;
    page(el, c, T, () => { key = null; update(c); });
  };
  update(ctx);
  return { update, unmount() { document.getElementById('pb-page-style')?.remove(); } };
}

/** Photos of the day: the tournament's own, then its matches' (newest first), without the winner photo. */
function dayPhotos(ctx, T) {
  if (!ctx.photos?.on) return [];
  const own = ctx.photos.list('turnier', T.id);
  const matches = ctx.photos.all('turnier_spiel').filter(p => String(p.ref).startsWith(`${T.id}#`));
  return [...own, ...matches].filter(p => p.id !== T.winnerPhoto);
}

function chosenFor(ctx, T) {
  if (!state.chosen.has(T.id)) state.chosen.set(T.id, new Set(dayPhotos(ctx, T).slice(0, 3).map(p => p.id)));
  return state.chosen.get(T.id);
}

function page(el, ctx, T, redo) {
  if (!T || !T.ok) {
    render(el, viewHead('Erinnerung', null, { back: true }), h('p', { class: 'empty' }, T ? T.problem : 'Dieses Turnier gibt es nicht (oder es ist noch ein Entwurf).'));
    return;
  }
  const photos = dayPhotos(ctx, T), chosen = chosenFor(ctx, T);
  const status = h('p', { class: 'muted small', 'aria-live': 'polite' }, 'Wird gesetzt …');
  const sheets = h('div', { class: 'pb-sheets' });
  const radio = (name, value, cur, text, set) => h('label', {}, h('input', { type: 'radio', name, value, checked: cur === value ? true : null, onchange: () => { set(value); redo(); } }), h('span', {}, text));
  const pick = photos.length ? h('div', { class: 'sv-pick' },
    h('p', { class: 'small' }, `Fotos des Tages auf dem Aushang (bis zu ${MAX_PHOTOS}, antippen zum Auswählen):`),
    h('div', { class: 'sv-thumbs' }, photos.map(p => {
      const on = chosen.has(p.id), url = ctx.photos.url(p.id, 'thumb');
      return h('button', { type: 'button', class: 'sv-thumb' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false',
        'aria-label': p.caption || (p.kind === 'turnier' ? 'Foto des Turniers' : `Foto von Spiel ${String(p.ref).split('#')[1]}`),
        disabled: !on && chosen.size >= MAX_PHOTOS ? true : null,
        onclick: () => { if (on) chosen.delete(p.id); else if (chosen.size < MAX_PHOTOS) chosen.add(p.id); redo(); } },
      url ? h('img', { src: url, alt: '' }) : h('span', { class: 'sv-thumb-wait' }, '…'));
    }))) : null;
  render(el,
    h('div', { class: 'pb-intro' },
      h('p', {}, h('a', { class: 'inline-link', ...linkTo(ctx, 'turnier', { id: T.id }) }, `‹ ${T.name}`)),
      h('h2', {}, 'Erinnerung zum Ausdrucken'),
      h('p', { class: 'small' }, 'Das Turnier als großes, buntes Plakat: A1 aus vier A3-Blättern oder A2 aus zwei. Drucken mit „Tatsächliche Größe“ / 100 %, Ränder „Keine“, „Hintergrundgrafiken“ an. Dann an den gestrichelten Linien abschneiden und auf den Klebestreifen des Nachbarblatts kleben.'),
      T.status !== 'beendet' ? h('p', { class: 'small' }, 'Das Turnier läuft noch: gedruckt wird der Stand von jetzt.') : null,
      pick,
      h('div', { class: 'pb-tools' },
        h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Größe' }, radio('sv-format', 'a1', state.format, 'A1 (4 Blätter)', v => { state.format = v; }), radio('sv-format', 'a2', state.format, 'A2 (2 Blätter)', v => { state.format = v; })),
        h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Format' }, [['auto', 'Automatisch'], ['hoch', 'Hochformat'], ['quer', 'Querformat']].map(([v, t]) => radio('sv-orient', v, state.orient, t, x => { state.orient = x; }))),
        h('button', { type: 'button', onclick: () => window.print() }, 'Drucken')),
      status),
    sheets);
  const measure = h('div', { class: 'pb-measure' });
  document.body.append(measure);
  const finish = () => { try { layout(ctx, T, [...chosen].map(id => photos.find(p => p.id === id)).filter(Boolean), sheets, measure, status); } finally { measure.remove(); } };
  (document.fonts?.ready || Promise.resolve()).then(finish, finish);
}

/** The geometries to try: A1 = 2 × 2 sheets, A2 = two A3 (portrait A2 from two landscape sheets, or the reverse). */
function geometries() {
  const want = o => state.orient === 'auto' || state.orient === o;
  if (state.format === 'a2') return [want('hoch') && posterGeometry('quer', 1, 2), want('quer') && posterGeometry('hoch', 2, 1)].filter(Boolean);
  return [want('hoch') && posterGeometry('hoch'), want('quer') && posterGeometry('quer')].filter(Boolean);
}

function layout(ctx, T, photos, sheets, measure, status) {
  let chosen = null;
  // try with every result listed, then without the list (it's the first thing to go on A2), then with fewer photos
  const tries = [];
  for (let n = photos.length; n >= 0; n--) for (const full of [true, false]) tries.push({ n, full });
  for (const { n, full } of tries) {
    for (const scale of [2, 1.8, 1.6, 1.4, 1.2, 1.05, 0.92, 0.8, 0.7, 0.62]) {
      for (const g of geometries()) {
        const width = Math.min(...g.regions.map(r => r.w));
        const blocks = buildBlocks(ctx, T, photos.slice(0, n), width, scale, full);
        const probe = heading('Alle Ergebnisse (Fortsetzung)', '');
        render(measure, h('div', { class: 'pb-poster sv-poster', style: `font-size:${4 * scale}mm` }, blocks.map(b => h('div', { style: `width:${width}mm` }, b.el)), h('div', { style: `width:${width}mm` }, probe)));
        const titleH = (probe.getBoundingClientRect().height + parseFloat(getComputedStyle(probe).marginBottom)) * PX + 0.5;
        const items = blocks.map(b => ({ h: b.el.getBoundingClientRect().height * PX, gap: (b.cont ? 0 : 7) * scale, title: b.cont ? titleH : 0 }));
        let packed = packBlocks(items, g.regions);
        // spread the blocks over all sheets: the lowest fill height at which they still fit
        for (let f = 0.35; packed && f < 1; f += 0.05) {
          const p = packBlocks(items, g.regions.map(r => ({ ...r, h: r.h * f })));
          if (p) { packed = p; break; }
        }
        if (packed) { chosen = { g, blocks, packed, scale, full, dropped: photos.length - n }; break; }
      }
      if (chosen) break;
    }
    if (chosen) break;
  }
  if (!chosen) { status.textContent = 'Zu viel für dieses Format: bitte weniger Fotos wählen oder A1 nehmen.'; return; }
  const { g, blocks, packed, scale, full, dropped } = chosen;
  const poster = h('div', { class: 'pb-poster sv-poster', style: `width:${g.W}mm;height:${g.H}mm;font-size:${4 * scale}mm` });
  const regions = g.regions.map(r => h('div', { class: 'pb-region', style: `left:${r.x}mm;top:${r.y}mm;width:${r.w}mm;height:${r.h}mm` }));
  blocks.forEach((b, i) => {
    const p = packed[i], el = p.cont ? h('section', { class: 'pb-block', style: b.el.getAttribute('style') }, heading(b.cont, b.badge), b.el) : b.el;
    el.style.position = 'absolute'; el.style.top = `${p.top}mm`; el.style.width = '100%';
    regions[p.region].append(el);
  });
  poster.append(...regions);
  let style = document.getElementById('pb-page-style');
  if (!style) { style = document.createElement('style'); style.id = 'pb-page-style'; document.head.append(style); }
  style.textContent = `@page { size: A3 ${g.orient === 'hoch' ? 'portrait' : 'landscape'}; margin: 0; }`;
  const avail = Math.max(300, (sheets.parentElement?.clientWidth || 390) - 10);
  const k = Math.min(1, (avail / g.cols) / (g.sw / PX));
  render(sheets, g.sheets.map(s => {
    const win = h('div', { class: 'pb-window', style: `width:${g.ww}mm;height:${g.wh}mm` });
    const copy = poster.cloneNode(true);
    copy.style.position = 'absolute'; copy.style.left = `${-s.x}mm`; copy.style.top = `${-s.y}mm`;
    win.append(copy, ...marks(g, s));
    const sheet = h('div', { class: 'pb-sheet' + (g.orient === 'quer' ? ' quer' : ''), style: `transform:scale(${k})` }, win);
    return h('div', { class: 'pb-sheetwrap', style: `width:${g.sw / PX * k}px;height:${g.sh / PX * k}px` }, sheet);
  }));
  sheets.style.gridTemplateColumns = `repeat(${g.cols}, max-content)`;
  const n = g.cols * g.rows;
  status.textContent = `${n === 4 ? 'A1' : 'A2'} ${g.W > g.H ? 'quer' : 'hoch'} aus ${n} A3-Blättern (zusammen ${Math.round(g.W)} × ${Math.round(g.H)} mm)${scale !== 1 ? `, Schrift ${Math.round(scale * 100)} %` : ''}${full ? '' : ', ohne die Liste aller Ergebnisse (zu wenig Platz)'}${dropped ? `, ${dropped === 1 ? 'ein gewähltes Foto passt' : `${dropped} gewählte Fotos passen`} nicht mehr drauf` : ''}.`;
}

// ───────── the blocks ─────────

// read lazily: print-tournament.js imports this module, so its constants aren't there yet at load time
const ACC = { get head() { return ACCENTS[0]; }, get win() { return GOLD; }, get facts() { return ACCENTS[2]; }, get ko() { return GOLD; }, get list() { return ACCENTS[5]; } };
const keyName = (ctx, T, key) => sideName(ctx, T.participants.find(p => p.key === key) || { key, name: key });
const sideOf = (T, key) => T.participants.find(p => p.key === key);
const idsOf = s => (s?.members ? s.members.map(m => m.id).filter(Boolean) : s?.id ? [s.id] : []);

function buildBlocks(ctx, T, photos, width, scale, full) {
  const blocks = [{ el: head(ctx, T) }];
  const add = (el, extra = {}) => blocks.push({ el, ...extra });
  const win = winnerBlock(ctx, T, width);
  if (win) add(win);
  const facts = factsBlock(ctx, T);
  if (facts) add(facts);
  photos.forEach((p, i) => add(photoBlock(ctx, T, p, width, i)));
  if (T.mode === 'gruppen') {
    for (const t of T.tables) add(block(`Gruppe ${t.letter}`, [groupTable(ctx, T, t), groupMatrix(ctx, T, t)], ACCENTS[t.group % ACCENTS.length], t.letter));
  } else if (T.swiss) {
    add(block('Schweizer System', swissRounds(ctx, T), ACCENTS[1], 'CH'));
  }
  if (T.bracket.length) add(block('K.-o.-Runde', knockout(ctx, T), ACC.ko, cup()));
  if (full) {
    const ms = playedMatches(T).concat(T.matches.filter(m => m.result?.wo));
    for (let i = 0; i < ms.length; i += 6) {
      add(h('div', { class: 'pb-block', style: accent(ACC.list) }, h('ol', { class: 'sv-results' }, ms.slice(i, i + 6).map(m => resultLine(ctx, T, m)))),
        { cont: i ? 'Alle Ergebnisse (Fortsetzung)' : 'Alle Ergebnisse', badge: '#' });
    }
  }
  return blocks;
}

/** Confetti and two rackets for the head (drawn in code, colourful). */
const confetti = () => {
  const cols = ['#F28C28', '#2563A6', '#B4364A', '#1D6B4F', '#7048A8', '#E0B000'];
  const parts = [];
  for (let i = 0; i < 26; i++) {
    const x = (i * 37) % 200, y = (i * 53) % 60, c = cols[i % cols.length];
    parts.push(i % 3 ? ['rect', { x, y, width: 3.2, height: 1.6, rx: 0.5, fill: c, transform: `rotate(${(i * 47) % 180} ${x} ${y})` }] : ['circle', { cx: x, cy: y, r: 1.4, fill: c }]);
  }
  return svg('0 0 200 60', 'sv-confetti', parts);
};

function head(ctx, T) {
  const played = playedMatches(T).length;
  const chips = [T.date != null ? fmt.date(T.date) : null, MODE_TEXT(T), `${T.participants.length} ${T.art === 'doppel' ? 'Teams' : 'Teilnehmer'}`, `${played} ${played === 1 ? 'Spiel' : 'Spiele'}`];
  return h('section', { class: 'pb-block pb-head sv-head', style: accent(ACC.head) },
    confetti(),
    h('div', { class: 'pb-head-main' },
      h('div', { class: 'pb-kicker' }, 'Erinnerung · Tischtennis-Turnier'),
      h('h2', {}, T.name),
      h('div', { class: 'pb-chips' }, chips.filter(Boolean).map(c => h('span', { class: 'pb-chip' }, c))),
      h('p', { class: 'pb-small' }, T.status === 'beendet' ? 'Danke an alle, die gespielt, gezählt und angefeuert haben!' : `Stand ${fmt.date(ctx.now)}, ${fmt.time(ctx.now)} Uhr.`)),
    h('div', { class: 'pb-head-qr' }, tournamentQr(ctx, `#/turnier?id=${encodeURIComponent(T.id)}`, T.name), h('div', { class: 'pb-qrcap' }, 'Alles in der App')));
}

/** Winner photo (large, up to about A4) and the podium (gold, silver, bronze steps). */
function winnerBlock(ctx, T, width) {
  if (!T.winner) return null;
  const step = (place, key, cls) => {
    const s = sideOf(T, key);
    const faces = idsOf(s).map(id => avatar(ctx, id, { size: 40 })).filter(Boolean);
    return h('div', { class: `sv-step ${cls}` },
      faces.length ? h('div', { class: 'sv-faces' }, faces) : null,
      h('div', { class: 'sv-step-name' }, keyName(ctx, T, key)),
      h('div', { class: 'sv-step-box' }, h('span', {}, `${place}.`)));
  };
  const third = (T.third || []).filter(Boolean);
  const podium = h('div', { class: 'sv-podium' },
    T.second ? step(2, T.second, 'silver') : h('div'),
    step(1, T.winner, 'gold'),
    third.length ? h('div', { class: 'sv-thirds' }, third.map(k => step(3, k, 'bronze'))) : h('div'));
  const shot = T.winnerPhoto && ctx.photos?.on ? ctx.photos.list('turnier', T.id).find(p => p.id === T.winnerPhoto) : null;
  const pic = shot ? photoFrame(ctx, shot, Math.min(width, 210), state.format === 'a2' ? 150 : 230, 'Siegerfoto') : null;
  return h('section', { class: 'pb-block sv-win', style: accent(ACC.win) },
    heading(`Sieger: ${keyName(ctx, T, T.winner)}`, cup()),
    pic, podium);
}

/** A photo at a fixed size in mm (so the layout doesn't wait for the image), with an optional caption. */
function photoFrame(ctx, p, maxW, maxH, caption) {
  const ar = p.width && p.height ? p.width / p.height : 4 / 3;
  let w = maxW, hgt = w / ar;
  if (hgt > maxH) { hgt = maxH; w = hgt * ar; }
  const url = ctx.photos.url(p.id, 'full') || ctx.photos.url(p.id, 'thumb');
  return h('figure', { class: 'sv-photo' },
    h('div', { class: 'sv-photo-frame', style: `width:${w.toFixed(1)}mm;height:${hgt.toFixed(1)}mm` }, url ? h('img', { src: url, alt: p.caption || '' }) : h('span', {}, 'Foto wird geladen …')),
    caption ? h('figcaption', {}, caption) : null);
}

function photoBlock(ctx, T, p, width, i) {
  const nr = p.kind === 'turnier_spiel' ? Number(String(p.ref).split('#')[1]) : null;
  const m = nr ? T.matches.find(x => x.nr === nr) : null;
  const cap = [p.caption, m ? `Spiel ${m.nr}: ${sideName(ctx, m.a)} gegen ${sideName(ctx, m.b)}` : null].filter(Boolean).join(' · ');
  return h('section', { class: 'pb-block sv-photoblock', style: accent(ACCENTS[(3 + i) % ACCENTS.length]) }, photoFrame(ctx, p, Math.min(width, 210), state.format === 'a2' ? 115 : 200, cap || null));
}

const matchTitle = (ctx, m) => `${sideName(ctx, m.a)} gegen ${sideName(ctx, m.b)}`;
const winnerName = (ctx, m) => sideName(ctx, m.result.winner === 'a' ? m.a : m.b);

/** The highlights of the day as colourful tiles. */
function factsBlock(ctx, T) {
  const f = souvenirFacts(T, { games: ctx.baseModel.dataset.games, elo: ctx.baseModel.elo });
  const tiles = [];
  const tile = (title, big, sub, i) => tiles.push(h('div', { class: 'sv-tile', style: accent(ACCENTS[i % ACCENTS.length]) }, h('div', { class: 'sv-tile-t' }, title), h('div', { class: 'sv-tile-big' }, big), h('div', { class: 'sv-tile-sub' }, sub)));
  if (f.closestSet) tile('Engster Satz', `${f.closestSet.a}:${f.closestSet.b}`, `Spiel ${f.closestSet.m.nr}, Satz ${f.closestSet.set}: ${matchTitle(ctx, f.closestSet.m)}`, 0);
  if (f.comeback) tile('Größte Aufholjagd', `nach 0:${f.comeback.deficit}`, `${winnerName(ctx, f.comeback.m)} gewinnt Spiel ${f.comeback.m.nr} noch (${setLine(f.comeback.m.result)})`, 2);
  if (f.upset) tile('Größte Überraschung', fmt.pct(f.upset.chance), `Siegchance von ${winnerName(ctx, f.upset.m)} in Spiel ${f.upset.m.nr}, und trotzdem gewonnen`, 4);
  if (f.longest) tile('Längstes Spiel', `${fmt.int(f.longest.points)} Punkte`, `Spiel ${f.longest.m.nr}: ${matchTitle(ctx, f.longest.m)}`, 1);
  if (f.mostPoints) tile('Meiste Punkte des Tages', fmt.int(f.mostPoints.points), keyName(ctx, T, f.mostPoints.key), 3);
  const best = f.eloDay[0];
  if (best && best.delta > 0) tile('Elo-Punkte des Tages', fmt.signed(best.delta), `${ctx.names.get(best.id) ?? best.id}${f.eloDay[1]?.delta > 0 ? ` · danach ${ctx.names.get(f.eloDay[1].id) ?? ''} ${fmt.signed(f.eloDay[1].delta)}` : ''}`, 5);
  if (!tiles.length) return null;
  return block('Höhepunkte des Tages', h('div', { class: 'sv-tiles' }, tiles), ACC.facts, '★');
}

function groupTable(ctx, T, t) {
  return h('table', { class: 'pb-table sv-table' },
    h('tr', {}, ['Platz', 'Name', 'S:N', 'Sätze', 'Punkte'].map(x => h('th', {}, x))),
    t.rows.map(r => h('tr', { class: r.place <= t.advance ? 'up' : '' },
      h('td', { class: 'place' }, `${r.place}.`), h('td', { class: 'name' }, keyName(ctx, T, r.key)),
      h('td', {}, `${r.wins}:${r.losses}`), h('td', {}, `${r.setsW}:${r.setsL}`), h('td', {}, `${r.ptsW}:${r.ptsL}`))));
}

/** Results matrix: the row player's sets against the column player („2:1“, „w. o.“). */
function groupMatrix(ctx, T, t) {
  const keys = T.groups[t.group].keys;
  const ms = T.matches.filter(m => m.stage === 'gruppe' && m.group === t.group && m.result);
  const cell = (ki, kj) => {
    const m = ms.find(x => (x.a.key === ki && x.b.key === kj) || (x.a.key === kj && x.b.key === ki));
    if (!m) return { text: '', cls: '' };
    const mine = m.a.key === ki ? 'a' : 'b', won = m.result.winner === mine;
    if (m.result.wo) return { text: won ? 'w. o.' : '–', cls: won ? 'won' : 'lost' };
    const [x, y] = mine === 'a' ? [m.result.setsA, m.result.setsB] : [m.result.setsB, m.result.setsA];
    return { text: `${x}:${y}`, cls: won ? 'won' : 'lost' };
  };
  return h('table', { class: 'pb-matrix sv-matrix' },
    h('tr', {}, h('th', {}, ''), keys.map((_, j) => h('th', {}, String(j + 1)))),
    keys.map((k, i) => h('tr', {}, h('th', {}, `${i + 1} ${keyName(ctx, T, k)}`), keys.map((kj, j) => {
      if (i === j) return h('td', { class: 'cell self' });
      const c = cell(k, kj);
      return h('td', { class: `cell ${c.cls}` }, c.text);
    }))));
}

const resultMini = (ctx, m) => {
  const r = m.result, aw = r?.winner === 'a', bw = r?.winner === 'b';
  return h('div', { class: 'sv-mini' + (m.label === 'Finale' ? ' final' : '') },
    h('div', { class: 'sv-mini-meta' }, `Spiel ${m.nr} · ${m.label}`),
    h('div', { class: 'sv-mini-side' + (aw ? ' won' : '') }, sideName(ctx, m.a), r ? h('b', {}, r.wo ? (aw ? 'w. o.' : '–') : String(r.setsA)) : null),
    h('div', { class: 'sv-mini-side' + (bw ? ' won' : '') }, sideName(ctx, m.b), r ? h('b', {}, r.wo ? (bw ? 'w. o.' : '–') : String(r.setsB)) : null),
    r && !r.wo ? h('div', { class: 'sv-mini-sets' }, setLine(r)) : null);
};

function swissRounds(ctx, T) {
  const byNr = new Map(T.matches.map(m => [m.nr, m]));
  return h('div', { class: 'sv-swiss' }, T.swiss.rounds.map(rd => h('div', {},
    h('h4', {}, `Runde ${rd.r}`),
    rd.pools.map(p => h('div', { class: 'sv-pool' }, h('b', {}, p.label), p.nrs.map(nr => resultMini(ctx, byNr.get(nr))))),
    rd.byes.length ? h('p', { class: 'pb-small' }, 'Freilos: ', rd.byes.map(k => keyName(ctx, T, k)).join(', ')) : null)));
}

function knockout(ctx, T) {
  const byNr = new Map(T.matches.map(m => [m.nr, m]));
  return h('div', { class: 'pb-ko sv-ko' }, T.bracket.map(r => h('div', { class: 'pb-ko-round' }, h('h4', {}, r.name),
    r.matches.map(nr => resultMini(ctx, byNr.get(nr))),
    r.third ? [h('h4', {}, 'Spiel um Platz 3'), resultMini(ctx, byNr.get(r.third))] : null)));
}

function resultLine(ctx, T, m) {
  const r = m.result, aw = r.winner === 'a';
  return h('li', {}, h('span', { class: 'sv-nr' }, String(m.nr)),
    h('span', { class: 'sv-what' }, m.label),
    h('span', { class: 'sv-who' }, h(aw ? 'b' : 'span', {}, sideName(ctx, m.a)), ' – ', h(aw ? 'span' : 'b', {}, sideName(ctx, m.b))),
    h('span', { class: 'sv-score' }, setLine(r)));
}
