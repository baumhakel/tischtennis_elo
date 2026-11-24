// Tap audit (Phase 17): lists every tappable element of every view and checks it against the UI rules:
//   one target per element (no link or control inside another) · at least 44 × 44 px · a chevron on every
//   tappable tile or row that opens a page, and on nothing else · nothing that looks tappable without being so.
// Runs over both demo sizes, the three Wertungen and „Ich“ set / not set, like the smoke test.
//
//   node test/tap-audit.mjs [report.md] [--quick]
//
// Writes a Markdown report (inventory per view + every finding) and a JSON file next to it.
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, viewReady, sleep } from './browser.mjs';
import { VIEWS } from '../js/views/index.js';
import { demoRaw } from '../js/io/demo.js';

const quick = process.argv.includes('--quick');
const outMd = process.argv.slice(2).find(a => !a.startsWith('--')) || join(tmpdir(), 'tap-audit.md');
const SIZES = quick ? ['demo'] : ['demo', 'demo=gross'];
const MODES = quick ? [null] : [null, 'einzel', 'doppel'];
const MES = quick ? ['ich'] : ['ich', 'zuschauer'];
const IDS = new Set(VIEWS.map(v => v.id));
const DIRECT = VIEWS.filter(v => v.menu !== false && !['player', 'h2h', 'more'].includes(v.id)).map(v => v.id)
  .concat(['eintragen', 'melden', 'verwalten']);   // Phase 18a: reached from the menu (Mitmachen)
const MIN = 44;

// player names of both demo sizes → „<Spieler>“ in labels, so rows of different players group together
const NAMES = new Set();
for (const s of ['klein', 'gross']) for (const r of demoRaw('Europe/Vienna', s).players.slice(1)) NAMES.add(r[1]);
const nameRe = new RegExp(`\\b(${[...NAMES].sort((a, b) => b.length - a.length).join('|')})\\b`, 'g');
const TIERS = /\b(Gebietsliga|Landesliga|Bundesliga|Champions League|Universumsliga|Götterliga|noch nicht)\b/g;
const pattern = text => text.replace(nameRe, '‹Spieler›').replace(TIERS, '‹Stufe›').replace(/[+−-]?\d[\d.,:\s]*\d|\d/g, '#')
  .replace(/(‹Spieler›)( (&|und|gegen|·|#|‹Spieler›))*( ‹Spieler›)+/g, '‹Spieler› …').replace(/\s+/g, ' ').trim().slice(0, 60);

// record which elements get click-like listeners (the app adds them with addEventListener)
const INIT = `(() => {
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (this instanceof Element && /^(click|pointerdown|pointerup|mousedown|touchstart|touchend)$/.test(type)) (this.__tt ||= new Set()).add(type);
    return add.call(this, type, fn, opts);
  };
})();`;

/** Runs in the page: every element that is, or looks, tappable. */
function collect() {
  // label[for] only focuses its control, which is the target and reported itself
  const SEL = 'a[href],button,select,input:not([type=hidden]),textarea,summary,[role=button],[role=tab],[role=link],[role=radio]';
  const listens = el => !!el.__tt;
  const isTap = el => el.matches(SEL) || listens(el);
  const chev = el => {
    const target = el.tagName === 'TR' ? el.lastElementChild : el;
    if (!target) return false;
    const a = getComputedStyle(target, '::after');
    return a.content !== 'none' && a.width === '6px' && a.borderTopWidth !== '0px';
  };
  const area = el => (el.closest('#view') ? 'view' : el.closest('#menu') ? 'menu' : el.closest('nav.tabs') ? 'tabs'
    : el.closest('.lens') ? 'lens' : el.closest('.notice') ? 'notice' : el.closest('.share-sheet') ? 'share' : 'appbar');
  const label = el => (el.getAttribute('aria-label') || el.title || el.innerText || el.textContent || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 90);
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('[hidden]') || !el.checkVisibility?.({ visibilityProperty: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const tap = isTap(el);
    const cs = getComputedStyle(el);
    const cue = chev(el);
    const pointer = cs.cursor === 'pointer';
    const underline = cs.textDecorationLine.includes('underline') && el.childElementCount === 0 && el.textContent.trim() !== '';
    if (el.closest('.u-wrap')) continue;               // chart surfaces: tooltips only, no targets (decided 11 Nov 2026)
    // a row's own link (first cell of a tappable row) is the row's target, not a second one
    if (el.matches('a.row-link') && el.closest('tr.tap-row')) continue;
    const ancestor = el.parentElement?.closest(SEL) || [...ancestors(el.parentElement)].find(listens);
    if (!tap && (ancestor || (!cue && !pointer && !underline))) continue;   // part of a tappable thing, or plain
    if (!tap && el.querySelector(SEL)) continue;       // a wrapper whose child is the target (e.g. a matrix cell)
    if (!tap && el.tagName === 'TD' && el.parentElement.classList.contains('tap-row')) continue;
    // labels wrap their input: the label is the target, the (visually hidden) input is not reported
    if (el.matches('input') && el.closest('label')) continue;
    // an absolutely placed ::before with negative insets widens the touch target (e.g. the (i) button)
    const b = getComputedStyle(el, '::before');
    let ew = r.width, eh = r.height;
    if (b.content !== 'none' && b.position === 'absolute') {
      const px = v => (v.endsWith('px') ? parseFloat(v) : 0);
      ew = r.width - Math.min(0, px(b.left)) - Math.min(0, px(b.right));
      eh = r.height - Math.min(0, px(b.top)) - Math.min(0, px(b.bottom));
    }
    out.push({
      area: area(el), tag: el.tagName.toLowerCase(), cls: [...el.classList].slice(0, 3).join(' '),
      text: label(el), href: el.getAttribute('href'), external: el.matches('a[href^="http"]'),
      w: Math.round(ew), h: Math.round(eh), inline: cs.display === 'inline',
      tap, cue, pointer, underline, nested: tap && !!ancestor, listens: listens(el),
      control: el.matches('select,input,textarea,label[for],[role=radio],[role=tab]') || (el.tagName === 'LABEL' && !!el.querySelector('input')),
      block: ['block', 'flex', 'grid', 'table-row', 'list-item'].includes(cs.display) && r.width > 200,
      inTable: !!el.closest('td,th'), matrix: !!el.closest('table.matrix'), inChart: !!el.closest('svg,canvas,.u-wrap'),
    });
  }
  return out;
  function* ancestors(e) { for (; e; e = e.parentElement) yield e; }
}

const records = [];
const browser = await launch();
let pages = 0;
for (const me of MES) {
  for (const size of SIZES) {
    const page = await browser.newPage({ width: 390, height: 844 });
    await page.addInitScript(INIT);
    if (me === 'zuschauer') await page.addInitScript(`localStorage.setItem('tt-elo-me', JSON.stringify({ choice: 'observer', id: null, snoozeUntil: 0, seen: {} }))`);
    await page.goto(`?${size}#/dashboard`);
    if (!await page.waitFor(viewReady, { timeout: 60000 })) throw new Error(`${size}: App startet nicht`);
    await sleep(1500);                                  // Abzeichen and Prognose arrive after the first screen
    for (const mode of MODES) {
      const seen = new Map();
      const visit = async hash => {
        await page.evaluate(h => { location.hash = h; }, hash);
        await page.waitFor(viewReady, { timeout: 20000 });
        await sleep(250);
        const view = await page.evaluate(() => location.hash.slice(2).split('?')[0] || 'dashboard');
        for (const r of await page.evaluate(collect)) {
          if (r.area !== 'view' && r.area !== 'notice') continue;   // the frame is audited once below
          records.push({ ...r, view, size, mode: mode || 'alle', me, page: hash });
          if (r.href?.startsWith('#/')) {
            const target = r.href.slice(2).split('?')[0];
            const keys = [...new URLSearchParams(r.href.split('?')[1] || '').keys()].filter(k => k !== 'modus').sort().join(',');
            const k = `${target}|${keys}`;
            if (!seen.has(k)) seen.set(k, r.href);
          }
        }
        pages++;
      };
      for (const id of DIRECT) await visit(`#/${id}${mode ? `?modus=${mode}` : ''}`);
      for (const href of seen.values()) if (IDS.has(href.slice(2).split('?')[0])) await visit(href);
    }
    // the frame: app bar, lens bar, bottom bar, and the menu opened
    await page.evaluate(() => { location.hash = '#/rangliste?min=5'; });   // a deviating filter shows a lens chip
    await page.waitFor(viewReady); await sleep(300);
    for (const r of await page.evaluate(collect)) if (r.area !== 'view') records.push({ ...r, view: 'Rahmen', size, mode: 'alle', me, page: '#/rangliste?min=5' });
    await page.evaluate(() => document.querySelector('.menu-btn').click()); await sleep(400);
    for (const r of await page.evaluate(collect)) if (r.area === 'menu') records.push({ ...r, view: 'Menü', size, mode: 'alle', me, page: 'Menü' });
    if (page.errors.some(e => !/gsi\/client|favicon/.test(e))) console.log('Fehler:', page.errors.filter(e => !/gsi\/client|favicon/.test(e)).slice(0, 3));
    await page.close();
  }
}
await browser.close();

// ───────── checks ─────────
const kind = r => (r.control ? 'Steuerung' : r.tag === 'tr' ? 'Tabellenzeile' : r.tag === 'a' ? (r.external ? 'Link nach außen' : r.inline ? 'Textlink' : 'Link') : r.tag === 'button' ? 'Knopf' : r.tap ? r.tag : 'sieht tippbar aus');
const targetOf = r => (r.href?.startsWith('#/') ? r.href.slice(2).split('?')[0] || 'dashboard' : r.external ? 'extern' : r.href ? r.href : r.listens || r.tag === 'button' ? 'Aktion' : '–');
const opensPage = r => r.tag === 'a' && r.href?.startsWith('#/') || (r.tag === 'tr' && r.listens);
const FIND = {
  nested: { title: 'Ziel in einem Ziel (Link oder Knopf in einem tippbaren Element)', test: r => r.nested },
  small: { title: `Kleiner als ${MIN} × ${MIN} px (außer Textlinks im Fließtext, Tabellenzeilen und Matrixzellen)`, test: r => r.tap && !r.inline && !r.matrix && r.tag !== 'tr' && (r.w < MIN || r.h < MIN) },
  smallRow: { title: `Tabellenzeile niedriger als ${MIN} px`, test: r => r.tap && r.tag === 'tr' && r.h < MIN },
  inline: { title: 'Zur Durchsicht: Textlink im Fließtext (so hoch wie die Zeile, erlaubt)', info: true, test: r => r.tap && r.inline && r.tag === 'a' && !r.matrix },
  matrix: { title: 'Zur Durchsicht: Zellen und Namen der Matrizen (dichte Tabelle, Ausnahme von 44 px)', info: true, test: r => r.tap && r.matrix },
  noCue: { title: 'Kachel oder Zeile öffnet eine Seite, aber ohne Pfeil', test: r => opensPage(r) && !r.cue && !r.inline && !r.control && r.area === 'view' && r.block },
  cueNoPage: { title: 'Pfeil auf einem Knopf oder einer Steuerung (der Pfeil heißt: öffnet eine Seite)', test: r => r.cue && r.tap && r.tag !== 'a' && r.tag !== 'tr' },
  fake: { title: 'Sieht tippbar aus, ist es aber nicht (Pfeil, Zeiger oder Unterstreichung ohne Ziel)', test: r => !r.tap },
};
const key = r => `${r.view}|${kind(r)}|${pattern(r.text)}|${targetOf(r)}`;
const findings = Object.fromEntries(Object.keys(FIND).map(k => [k, new Map()]));
const inventory = new Map();   // view → key → summary
for (const r of records) {
  const k = key(r);
  if (!inventory.has(r.view)) inventory.set(r.view, new Map());
  const inv = inventory.get(r.view);
  const e = inv.get(k) || { kind: kind(r), label: pattern(r.text), target: targetOf(r), n: 0, cue: new Set(), minW: Infinity, minH: Infinity, cls: r.cls, modes: new Set() };
  e.n++; e.cue.add(r.cue); e.minW = Math.min(e.minW, r.w); e.minH = Math.min(e.minH, r.h); e.modes.add(r.mode);
  inv.set(k, e);
  for (const [f, def] of Object.entries(FIND)) {
    if (!def.test(r)) continue;
    const m = findings[f];
    const x = m.get(k) || { view: r.view, kind: kind(r), label: pattern(r.text), target: targetOf(r), cls: r.cls, w: r.w, h: r.h, n: 0, page: r.page };
    x.n++; x.w = Math.min(x.w, r.w); x.h = Math.min(x.h, r.h);
    m.set(k, x);
  }
}

// same kind → same target: links whose label is just a player's name, by target
const nameTargets = new Map();
for (const r of records) {
  if (!r.tap || !NAMES.has(r.text) || r.control) continue;
  const t = targetOf(r);
  const k = `${t}`;
  if (!nameTargets.has(k)) nameTargets.set(k, new Set());
  nameTargets.get(k).add(`${r.view} (${r.cls || r.tag})`);
}

const esc = s => String(s).replace(/\|/g, '\\|');
const lines = [`# Tap audit`, '', `${pages} Seitenaufrufe · ${records.length} Elemente · Läufe: ${SIZES.join(', ')} × ${MODES.map(m => m || 'alle').join(', ')} × „Ich“ ${MES.join(' / ')}`, ''];
lines.push('## Befunde', '');
for (const [f, def] of Object.entries(FIND)) {
  const list = [...findings[f].values()].sort((a, b) => a.view.localeCompare(b.view) || b.n - a.n);
  lines.push(`### ${def.title} (${list.length})`, '');
  if (!list.length) { lines.push('Keine.', ''); continue; }
  lines.push('| Ansicht | Art | Beschriftung | Ziel | Klasse | min. Größe | Anzahl |', '|---|---|---|---|---|---|---|');
  for (const x of list) lines.push(`| ${x.view} | ${x.kind} | ${esc(x.label)} | ${x.target} | ${x.cls} | ${x.w} × ${x.h} | ${x.n} |`);
  lines.push('');
}
lines.push('## Spielernamen als Link: wohin sie führen', '');
for (const [t, where] of nameTargets) lines.push(`- **${t}**: ${[...where].sort().join(', ')}`);
lines.push('', '## Inventar je Ansicht', '');
for (const [view, inv] of [...inventory].sort((a, b) => a[0].localeCompare(b[0]))) {
  lines.push(`### ${view}`, '', '| Art | Beschriftung | Ziel | Pfeil | min. Größe | Anzahl |', '|---|---|---|---|---|---|');
  for (const e of [...inv.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label)))
    lines.push(`| ${e.kind} | ${esc(e.label)} | ${e.target} | ${[...e.cue].map(c => (c ? 'ja' : 'nein')).join('/')} | ${e.minW} × ${e.minH} | ${e.n} |`);
  lines.push('');
}
await writeFile(outMd, lines.join('\n'));
await writeFile(outMd.replace(/\.md$/, '') + '.json', JSON.stringify(records));
const total = Object.entries(findings).filter(([f]) => !FIND[f].info).reduce((s, [, m]) => s + m.size, 0);
console.log(`${pages} Seiten, ${records.length} Elemente, ${total} Befunde → ${outMd}`);
for (const [f, def] of Object.entries(FIND)) console.log(`  ${findings[f].size.toString().padStart(4)}  ${def.title}`);
if (total) process.exitCode = 1;
