// Smoke test (Phase 17): every view loads in headless Chrome without errors, in both demo sizes and all
// three Wertungen, and every link inside the app leads to a view that exists and opens without errors.
// Needs only Node and an installed Chrome (or Edge); not part of `node --test`.
//
//   node test/smoke.mjs            everything (a few minutes)
//   node test/smoke.mjs --quick    small demo, Wertung Alle only, a sample of the links
//
// Known and ignored: the blocked Google sign-in script and the missing favicon.
import { launch, viewReady, sleep } from './browser.mjs';
import { VIEWS } from '../js/views/index.js';

const quick = process.argv.includes('--quick');
const SIZES = quick ? ['demo'] : ['demo', 'demo=gross'];
const MODES = quick ? [null] : [null, 'einzel', 'doppel'];
const LINKS_PER_VIEW = quick ? 2 : 4;          // detail links followed per target view and size
const KNOWN = [/accounts\.google\.com\/gsi\/client/, /favicon\.ico/];
const IDS = new Set(VIEWS.map(v => v.id));
// views that need a parameter are reached through the links found on the other pages
const DIRECT = VIEWS.filter(v => v.menu !== false && !['player', 'h2h', 'more'].includes(v.id)).map(v => v.id);

const problems = [];
const browser = await launch();
const page = await browser.newPage({ width: 390, height: 844 });
let checked = 0;

/** Open a hash, wait for the view, return what was wrong (errors, error boxes, „not found“ fallbacks). */
async function open(size, hash) {
  page.errors.length = 0;
  await page.evaluate(h => { location.hash = h; }, hash);
  const ok = await page.waitFor(viewReady, { timeout: 20000 });
  await sleep(150);                                   // let charts and late updates run
  const state = await page.evaluate(() => ({
    title: document.title,
    errorBox: [...document.querySelectorAll('#view .error')].map(e => e.textContent.trim()).filter(Boolean)[0] || null,
    links: [...document.querySelectorAll('#view a[href^="#/"], .notice a[href^="#/"]')].map(a => a.getAttribute('href')),
  }));
  checked++;
  const errs = page.errors.filter(e => !KNOWN.some(k => k.test(e)));
  const where = `${size} ${hash}`;
  if (!ok) problems.push(`${where}: Ansicht nicht geladen (Titel „${state.title}“)`);
  if (state.errorBox) problems.push(`${where}: Fehlermeldung „${state.errorBox}“`);
  for (const e of errs) problems.push(`${where}: ${e.split('\n')[0]}`);
  return state.links;
}

for (const size of SIZES) {
  await page.goto(`?${size}#/dashboard`);
  if (!await page.waitFor(viewReady, { timeout: 60000 })) { problems.push(`${size}: die App startet nicht`); continue; }
  const found = new Map();                            // view id → Set of hrefs
  for (const mode of MODES) {
    for (const id of DIRECT) {
      const hash = `#/${id}${mode ? `?modus=${mode}` : ''}`;
      for (const href of await open(size, hash)) {
        const view = href.slice(2).split('?')[0] || 'dashboard';
        if (!IDS.has(view)) { problems.push(`${size} ${hash}: Link auf unbekannte Ansicht „${href}“`); continue; }
        if (!found.has(view)) found.set(view, new Set());
        found.get(view).add(href);
      }
    }
  }
  // follow a few links per target view (spread over the list), so every kind of detail page opens once
  for (const [view, hrefs] of found) {
    const list = [...hrefs], step = Math.max(1, Math.floor(list.length / LINKS_PER_VIEW));
    for (let i = 0; i < list.length && i / step < LINKS_PER_VIEW; i += step) await open(size, list[i]);
  }
  console.log(`${size}: ${found.size} Ansichten über Links erreicht`);
}

await browser.close();
console.log(`${checked} Seiten geprüft.`);
if (problems.length) {
  console.log(`\n${problems.length} Probleme:`);
  for (const p of [...new Set(problems)]) console.log('  ' + p);
  process.exitCode = 1;
} else {
  console.log('Keine Probleme.');
}
