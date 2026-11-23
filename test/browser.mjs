// A tiny headless-Chrome driver for the smoke test and render checks. No installs: it starts the Chrome
// that is already on the computer and talks to it over the DevTools protocol through a pipe (no port).
// The app's files are served from this folder by answering Chrome's requests directly (no web server);
// every other request (Google sign-in, fonts) is blocked, as on a computer without internet.
//
//   const browser = await launch();            // CHROME=<path> overrides where Chrome is looked for
//   const page = await browser.newPage({ width: 390, height: 844, dark: false });
//   await page.goto('?demo#/rangliste');      // relative to the app
//   await page.waitFor(() => document.title.startsWith('Rangliste'));
//   const n = await page.evaluate(sel => document.querySelectorAll(sel).length, 'a');
//   await page.screenshot('out.png');  page.errors → console errors and uncaught exceptions
//   await page.addInitScript('…');            // runs before the app in every new document
//   await browser.close();
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const BASE = 'http://tischtennis.test/';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

export function findChrome() {
  const env = process.env.CHROME;
  const local = process.env.LOCALAPPDATA || '', pf = process.env.PROGRAMFILES || 'C:\\Program Files', pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const candidates = [
    env,
    join(pf, 'Google\\Chrome\\Application\\chrome.exe'), join(pf86, 'Google\\Chrome\\Application\\chrome.exe'), join(local, 'Google\\Chrome\\Application\\chrome.exe'),
    join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'), join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const hit = candidates.find(p => existsSync(p));
  if (!hit) throw new Error('Chrome wurde nicht gefunden. Pfad mit der Umgebungsvariable CHROME angeben.');
  return hit;
}

export async function launch({ chrome = findChrome() } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'tt-elo-chrome-'));
  const args = ['--headless=new', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-gpu', '--hide-scrollbars', '--mute-audio', `--user-data-dir=${profile}`, 'about:blank'];
  if (process.getuid?.() === 0) args.unshift('--no-sandbox');
  const proc = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const toChrome = proc.stdio[3], fromChrome = proc.stdio[4];

  let nextId = 1, buffer = '';
  const pending = new Map(), listeners = new Map();   // sessionId → handler(method, params)
  fromChrome.on('data', chunk => {
    buffer += chunk.toString('utf8');
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (msg.id && pending.has(msg.id)) {
        const { ok, fail, method } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? fail(new Error(`${method}: ${msg.error.message}`)) : ok(msg.result);
      } else if (msg.method) {
        listeners.get(msg.sessionId || '')?.(msg.method, msg.params);
      }
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((ok, fail) => {
    const id = nextId++;
    pending.set(id, { ok, fail, method });
    toChrome.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
  await new Promise((ok, fail) => { proc.once('spawn', ok); proc.once('error', fail); });

  return {
    newPage: opts => newPage(send, listeners, opts),
    async close() {
      try { await send('Browser.close'); } catch { /* already gone */ }
      await new Promise(ok => { if (proc.exitCode != null) ok(); else { proc.once('exit', ok); setTimeout(() => { proc.kill(); ok(); }, 3000); } });
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* Windows may hold files a moment longer */ }
    },
  };
}

async function newPage(send, listeners, { width = 390, height = 844, dark = false } = {}) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  const errors = [];
  let loaded = null;

  listeners.set(sessionId, async (method, p) => {
    if (method === 'Fetch.requestPaused') {
      const url = p.request.url;
      if (!url.startsWith(BASE)) return call('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
      const path = decodeURIComponent(new URL(url).pathname);
      const file = normalize(join(ROOT, path.endsWith('/') ? path + 'index.html' : path));
      let body = null;
      if (file.startsWith(ROOT)) { try { body = await readFile(file); } catch { /* 404 */ } }
      return call('Fetch.fulfillRequest', body
        ? { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: TYPES[extname(file)] || 'application/octet-stream' }], body: body.toString('base64') }
        : { requestId: p.requestId, responseCode: 404, responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }], body: '' }).catch(() => {});
    }
    if (method === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text);
    else if (method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'assert')) errors.push(p.args.map(a => a.value ?? a.description ?? '').join(' '));
    else if (method === 'Log.entryAdded' && p.entry.level === 'error') errors.push(`${p.entry.text}${p.entry.url ? ' ' + p.entry.url : ''}`);
    else if (method === 'Page.loadEventFired') loaded?.();
  });

  await call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await Promise.all(['Page.enable', 'Runtime.enable', 'Log.enable'].map(m => call(m)));
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  await call('Emulation.setTouchEmulationEnabled', { enabled: true });

  const page = {
    errors,
    call,
    /** Run a script in every new document before the page's own scripts (e.g. to record listeners). */
    addInitScript: source => call('Page.addScriptToEvaluateOnNewDocument', { source }),
    async goto(path) {
      const done = new Promise(ok => { loaded = ok; });
      await call('Page.navigate', { url: new URL(path, BASE).href });
      await Promise.race([done, sleep(15000)]);
    },
    async evaluate(fn, ...args) {
      const r = await call('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async waitFor(fn, { timeout = 15000, args = [] } = {}) {
      const until = Date.now() + timeout;
      for (;;) {
        if (await page.evaluate(fn, ...args).catch(() => false)) return true;
        if (Date.now() > until) return false;
        await sleep(50);
      }
    },
    /** Tap at the centre of the first element matching the selector (a real pointer event, so default actions run). */
    async tap(selector) {
      const box = await page.evaluate(s => { const r = document.querySelector(s)?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, selector);
      if (!box) throw new Error(`Nichts gefunden: ${selector}`);
      for (const type of ['mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    },
    async screenshot(path, { full = false } = {}) {
      const r = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
      await writeFile(path, Buffer.from(r.data, 'base64'));
    },
    close: () => send('Target.closeTarget', { targetId }),
  };
  return page;
}

export const sleep = ms => new Promise(ok => setTimeout(ok, ms));

/** Wait until the router has mounted a view (title set, nothing loading). */
export const viewReady = () => {
  const el = document.getElementById('view');
  return !!el && !el.hasAttribute('aria-busy') && el.childElementCount > 0 && / – Tischtennis Elo$/.test(document.title)
    && !/Spiele werden geladen/.test(el.textContent);
};
