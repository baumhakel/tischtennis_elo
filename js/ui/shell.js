// App frame (Phase 10). Little permanent chrome; settings and status live in the menu.
//
//   app bar      „Tischtennis Elo“ (→ Übersicht) · spinner while refreshing · menu button (dot = needs attention)
//   banner       only when something is wrong: offline, stale offline copy + sign-in needed, load error
//   lens bar     Wertung switch (the one place that changes the mode) + chips for settings that differ
//                from their default (tap = open the menu there, × = reset)
//   menu         slides in from the right: Ich · Mitmachen (form links from config) · Daten · Filter · Über
//   bottom bar   Übersicht · Tisch · Profil · Entdecken; hides while scrolling down, back on the slightest scroll up
import { h, render } from './dom.js';
import * as fmt from './format.js';
import { resolveFilters } from '../core/filters.js';
import { MODES, MODE_LABELS, modelFor } from '../app/modes.js';
import { resolveMe } from '../app/me.js';
import { APP_VERSION } from '../config.js';
import { windowRange } from '../core/window.js';
import { viewById } from '../views/index.js';

const X_LABELS = { date: 'Datum', game: 'Spielnummer', own: 'Eigene Spiele' };
const TABS = [
  { id: 'dashboard', label: 'Übersicht' },
  { id: 'tisch', label: 'Tisch' },
  { id: 'player', label: 'Profil' },
  { id: 'entdecken', label: 'Entdecken' },
];
const tabOf = view => (['dashboard', 'tisch', 'player'].includes(view) ? view : 'entdecken');

/**
 * @param {HTMLElement} root
 * @param {{ store, actions: { signIn, signOut, refresh, navigate, setMe } }} o
 * @returns {{ viewEl: HTMLElement, renderEmpty(el, state): void, openMenu(section?): void, closeMenu(): void }}
 */
export function createShell(root, { store, actions }) {
  const viewEl = h('main', { id: 'view', tabindex: '-1' });

  // ── app bar ──
  const spinner = h('span', { class: 'spinner', role: 'status', 'aria-label': 'Wird aktualisiert', hidden: true });
  const dot = h('span', { class: 'dot', hidden: true });
  const menuBtn = h('button', { class: 'menu-btn', type: 'button', 'aria-label': 'Menü', 'aria-expanded': 'false', 'aria-controls': 'menu',
    onclick: () => openMenu() }, h('span', { class: 'burger', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), dot);
  const appBar = h('header', { class: 'band' },
    h('div', { class: 'band-inner' },
      h('h1', {}, h('a', { href: '#/dashboard', onclick: e => { e.preventDefault(); actions.navigate('dashboard'); } }, 'Tischtennis Elo')),
      spinner, menuBtn));

  // ── banner (exceptions only) ──
  const banner = h('div', { class: 'banner', role: 'status', 'aria-live': 'polite', hidden: true });

  // ── lens bar ──
  const modeSeg = h('div', { class: 'seg mode-seg', role: 'radiogroup', 'aria-label': 'Wertung' },
    MODES.map(m => h('label', {},
      h('input', { type: 'radio', name: 'mode', value: m, onchange: () => store.set({ filters: { mode: m === 'alle' ? null : m } }) }),
      h('span', {}, MODE_LABELS[m]))));
  const chips = h('div', { class: 'lens-chips' });
  const lens = h('div', { class: 'lens', hidden: true }, modeSeg, chips);

  // ── bottom bar ──
  const tabs = TABS.map(t => h('a', { href: `#/${t.id}`, dataset: { tab: t.id }, onclick: e => {
    e.preventDefault();
    if (tabOf(store.get().view) === t.id && (t.id !== 'player' || !meId || store.get().params.id === meId)) {
      window.scrollTo({ top: 0, behavior: 'smooth' });   // tapping the active tab scrolls to the top
      return;
    }
    actions.navigate(t.id, t.id === 'player' && meId ? { id: meId } : {});
  } }, t.label));
  const nav = h('nav', { class: 'tabs', 'aria-label': 'Ansichten' }, tabs);

  // ── menu ──
  const menuBody = h('div', { class: 'drawer-body' });
  const drawer = h('aside', { class: 'drawer', id: 'menu', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Menü', hidden: true },
    h('div', { class: 'drawer-head' }, h('h2', {}, 'Menü'),
      h('button', { class: 'close', type: 'button', 'aria-label': 'Menü schließen', onclick: () => closeMenu() }, '×')),
    menuBody);
  const backdrop = h('div', { class: 'backdrop', hidden: true, onclick: () => closeMenu() });

  render(root, appBar, h('div', { class: 'frame' }, banner, lens, viewEl), nav, backdrop, drawer);

  // filter controls are built once; values follow the state
  const min = h('input', { type: 'range', min: '0', step: '1', id: 'f-min' });
  const minOut = h('output', { for: 'f-min' });
  const inact = h('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', id: 'f-inact' });
  const xs = Object.entries(X_LABELS).map(([v, label]) =>
    h('label', {}, h('input', { type: 'radio', name: 'f-x', value: v }), h('span', {}, label)));
  min.addEventListener('input', () => store.set({ filters: { minGames: Number(min.value) } }));
  inact.addEventListener('change', () => store.set({ filters: { inactivityDays: Math.max(0, Math.floor(Number(inact.value) || 0)) } }));
  const filterGrid = h('div', { class: 'filter-grid' },
    h('label', { for: 'f-min' }, 'Mindestanzahl Spiele'), h('div', { class: 'range' }, min, minOut),
    h('label', { for: 'f-inact' }, 'Ausblenden nach Tagen ohne Spiel'), h('div', {}, inact, h('span', { class: 'muted hint' }, '0 = nie ausblenden')),
    h('span', { class: 'label' }, 'x-Achse'), h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'x-Achse' }, xs));
  filterGrid.addEventListener('change', e => { if (e.target.name === 'f-x') store.set({ filters: { xAxis: e.target.value } }); });
  // Zeitraum: preset or own range (two dates); only some views follow it (views/index.js, zeit: true)
  const RANGE_LABELS = { gesamt: 'Gesamt', monat: 'Dieser Monat', vormonat: 'Letzter Monat', jahr: 'Dieses Jahr', eigen: 'Eigener Zeitraum' };
  const rangeSel = h('select', { id: 'f-range' }, Object.entries(RANGE_LABELS).map(([v, t]) => h('option', { value: v }, t)));
  const rFrom = h('input', { type: 'date', id: 'f-range-from', 'aria-label': 'von' }), rTo = h('input', { type: 'date', id: 'f-range-to', 'aria-label': 'bis' });
  const own = h('div', { class: 'range-own', hidden: true }, rFrom, h('span', {}, 'bis'), rTo);
  const setOwn = () => { if (rFrom.value && rTo.value && rFrom.value <= rTo.value) store.set({ filters: { range: `${rFrom.value}..${rTo.value}` } }); };
  rangeSel.addEventListener('change', () => {
    if (rangeSel.value === 'eigen') { own.hidden = false; setOwn(); }
    else { own.hidden = true; store.set({ filters: { range: rangeSel.value } }); }
  });
  rFrom.addEventListener('change', setOwn); rTo.addEventListener('change', setOwn);
  const rangeGrid = h('div', { class: 'filter-grid' },
    h('label', { for: 'f-range' }, 'Zeitraum'), h('div', {}, rangeSel, own,
      h('span', { class: 'muted hint' }, 'Gilt für Rangliste, Rekorde, Matrix, Doppelpartner, Aktivität, Überraschungen, Alle Spiele und Kalibrierung. Die Elo-Werte laufen durch.')));
  const filterResets = h('div', { class: 'menu-actions' });
  const filterSection = h('section', { class: 'menu-section', id: 'menu-filter' }, h('h3', {}, 'Filter'), rangeGrid, filterGrid, filterResets);
  // persistent section containers: only their contents are re-rendered (the slider must never move while dragged)
  const box = id => h('div', { id: `menu-${id}-box` });
  const ichBox = box('ich'), mitBox = box('mitmachen'), datenBox = box('daten'), ueberBox = box('ueber');
  render(menuBody, ichBox, mitBox, datenBox, filterSection, ueberBox);

  let meId = null, picking = false, lastFocus = null;

  function openMenu(section) {
    lastFocus = document.activeElement;
    drawer.hidden = false; backdrop.hidden = false;
    requestAnimationFrame(() => { drawer.classList.add('open'); backdrop.classList.add('open'); });
    menuBtn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('menu-open');
    const target = section && drawer.querySelector(`#menu-${section}`);
    (target || drawer.querySelector('.close')).scrollIntoView?.({ block: 'start' });
    drawer.querySelector('.close').focus({ preventScroll: true });
  }
  function closeMenu() {
    if (drawer.hidden) return;
    drawer.classList.remove('open'); backdrop.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('menu-open');
    picking = false;
    setTimeout(() => { drawer.hidden = true; backdrop.hidden = true; }, 200);
    lastFocus?.focus?.({ preventScroll: true });
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

  // ── bottom bar gets out of the way while scrolling down ──
  let lastY = window.scrollY;
  window.addEventListener('scroll', () => {
    const y = window.scrollY, atEnd = window.innerHeight + y >= document.documentElement.scrollHeight - 40;
    if (y < 80 || atEnd || y < lastY - 4) nav.classList.remove('away');
    else if (y > lastY + 8) nav.classList.add('away');
    if (Math.abs(y - lastY) > 4) lastY = y;
  }, { passive: true });

  function update(s) {
    const { data, auth } = s;
    const model = data.model;
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    const issues = model?.dataset.issues || [];
    const nErr = issues.filter(i => i.level === 'error').length;
    const f = model ? resolveFilters(s.filters, model.dataset.config) : null;
    const me = model ? resolveMe(s.me, model.dataset.players, auth.email) : null;
    meId = me?.id || null;

    // app bar
    spinner.hidden = !(data.loading && model);
    dot.hidden = !model || (auth.signedIn && online && !nErr);

    // banner: only exceptional states
    const stamp = data.updatedAt ? fmt.stamp(data.updatedAt) : '';
    let msg = null;
    if (model && !online) msg = [`Offline · Offline-Kopie von ${stamp}`];
    else if (model && data.error) msg = [h('span', { class: 'error' }, data.error), ' ',
      h('button', { class: 'link', type: 'button', onclick: auth.signedIn ? actions.refresh : actions.signIn }, 'Erneut versuchen')];
    else if (model && data.source === 'cache' && !data.loading && !auth.signedIn) msg = [`Offline-Kopie von ${stamp} · `,
      h('button', { class: 'link', type: 'button', onclick: actions.signIn }, 'Anmelden und aktualisieren')];
    banner.hidden = !msg;
    if (msg) render(banner, msg);

    // lens bar
    lens.hidden = !model;
    // Zeitraum chip: only on views that follow it, and only when it differs from the default
    function rangeChip(chip) {
      if (!viewById(s.view)?.zeit || f.range === model.dataset.config.default_time_range) return null;
      const r = windowRange(f.range, model.stats.now);
      return r || f.range === 'gesamt' ? chip(r ? `Zeitraum: ${r.label}` : 'Zeitraum: gesamt', () => store.set({ filters: { range: null } })) : null;
    }
    if (model) {
      for (const input of modeSeg.querySelectorAll('input')) input.checked = input.value === f.mode;
      const chip = (label, reset) => h('span', { class: 'chip lens-chip' },
        h('button', { type: 'button', class: 'chip-label', onclick: () => openMenu('filter') }, label),
        h('button', { type: 'button', class: 'x', 'aria-label': `„${label}“ zurücksetzen`, onclick: reset }, '×'));
      render(chips,
        s.filters.minGames != null ? chip(`ab ${f.minGames} Spielen`, () => store.set({ filters: { minGames: null } })) : null,
        s.filters.inactivityDays != null ? chip(f.inactivityDays > 0 ? `aktiv in ${f.inactivityDays} Tagen` : 'auch inaktive', () => store.set({ filters: { inactivityDays: null } })) : null,
        s.filters.xAxis != null ? chip(`x-Achse: ${X_LABELS[f.xAxis]}`, () => store.set({ filters: { xAxis: null } })) : null,
        Array.isArray(s.filters.focus) ? chip('Hervorhebung angepasst', () => store.set({ filters: { focus: null } })) : null,
        rangeChip(chip));
    }

    // filter controls
    if (model) {
      const custom = !['gesamt', 'monat', 'vormonat', 'jahr'].includes(f.range);
      rangeSel.value = custom ? 'eigen' : f.range;
      if (custom) { own.hidden = false; const [a, b] = f.range.split('..'); if (document.activeElement !== rFrom) rFrom.value = a; if (document.activeElement !== rTo) rTo.value = b; }
      else if (rangeSel !== document.activeElement) own.hidden = true;
      const maxPlayed = Math.max(1, ...modelFor(model, f.mode).elo.played);
      min.max = String(maxPlayed);
      min.value = String(Math.min(f.minGames, maxPlayed));
      minOut.value = String(f.minGames);
      if (document.activeElement !== inact) inact.value = String(f.inactivityDays);
      for (const l of xs) l.querySelector('input').checked = l.querySelector('input').value === f.xAxis;
      render(filterResets,
        Array.isArray(s.filters.focus) ? h('button', { class: 'secondary small', type: 'button', onclick: () => store.set({ filters: { focus: null } }) }, 'Hervorhebung zurücksetzen') : null,
        h('button', { class: 'secondary small', type: 'button', onclick: () => store.set({ filters: { minGames: null, inactivityDays: null, xAxis: null, focus: null, range: null } }) },
          'Standardwerte wiederherstellen'));
    }

    // menu sections
    renderMenu(s, me, f, issues, nErr, online);

    // bottom bar
    const current = tabOf(s.view);
    for (const a of tabs) {
      if (a.dataset.tab === current) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
  }

  function renderMenu(s, me, f, issues, nErr, online) {
    const { data, auth } = s;
    const model = data.model;
    const cfg = model?.dataset.config;
    const players = model ? [...model.dataset.players.values()].sort((a, b) => a.name.localeCompare(b.name, 'de')) : [];
    const nameOf = id => model?.dataset.players.get(id)?.name ?? id;
    const set = patch => actions.setMe({ ...s.me, ...patch });

    // Ich
    let ich = null;
    if (model) {
      const picker = () => {
        const sel = h('select', { 'aria-label': 'Spieler' },
          h('option', { value: '' }, 'Spieler wählen …'),
          players.map(p => h('option', { value: p.id, selected: p.id === me.id ? true : null }, p.name)));
        return h('div', { class: 'menu-actions' }, sel,
          h('button', { type: 'button', class: 'small', onclick: () => { if (sel.value) { picking = false; set({ choice: 'player', id: sel.value }); } } }, 'Das bin ich'),
          h('button', { type: 'button', class: 'secondary small', onclick: () => { picking = false; set({ choice: 'observer', id: null }); } }, 'Ich schaue nur zu'));
      };
      ich = h('section', { class: 'menu-section', id: 'menu-ich' }, h('h3', {}, 'Ich'),
        me.observer ? h('p', {}, 'Du schaust zu.')
          : me.id ? h('p', {}, 'Du bist ', h('strong', {}, nameOf(me.id)), me.source === 'account' ? ' (über dein Google-Konto).' : '.')
          : h('p', { class: 'muted' }, 'Noch nicht festgelegt.'),
        picking ? picker() : h('div', { class: 'menu-actions' },
          h('button', { type: 'button', class: 'secondary small', onclick: () => { picking = true; renderMenu(store.get(), me, f, issues, nErr, online); } },
            me.id || me.observer ? 'Ändern' : 'Festlegen'),
          me.source === 'account' ? h('button', { type: 'button', class: 'secondary small', onclick: () => set({ choice: 'ask', id: null, snoozeUntil: 0 }) }, 'Das bin ich nicht') : null,
          me.source === 'device' && me.accountId ? h('button', { type: 'button', class: 'secondary small', onclick: () => set({ choice: null, id: null }) }, `Wie Google-Konto (${nameOf(me.accountId)})`) : null),
        h('p', { class: 'muted small' }, 'Wird nur auf diesem Gerät gespeichert.'));
    }

    // Mitmachen: form links come from the config tab (never from the public code)
    const forms = cfg ? [
      [cfg.form_result_url, 'Ergebnis eintragen'],
      [cfg.form_support_url, 'Problem melden oder Idee einreichen'],
      [cfg.form_management_url, 'Spieler verwalten'],
    ].filter(([u]) => u) : [];
    const mitmachen = forms.length ? h('section', { class: 'menu-section', id: 'menu-mitmachen' }, h('h3', {}, 'Mitmachen'),
      h('ul', { class: 'menu-links' }, forms.map(([u, label]) =>
        h('li', {}, h('a', { class: 'tap', href: u, target: '_blank', rel: 'noopener' }, label))))) : null;

    // Daten
    const stamp = data.updatedAt ? fmt.stamp(data.updatedAt) : null;
    const daten = h('section', { class: 'menu-section', id: 'menu-daten' }, h('h3', {}, 'Daten'),
      h('p', {}, model ? (data.loading ? 'Wird aktualisiert …' : `Stand: ${stamp}`) : 'Noch keine Daten geladen.',
        model && data.source === 'cache' && !data.loading ? h('span', { class: 'muted' }, ' (Offline-Kopie)') : null,
        !online ? h('span', { class: 'error' }, ' · offline') : null),
      h('div', { class: 'menu-actions' },
        model && !data.loading ? h('button', { type: 'button', class: 'small', onclick: () => { closeMenu(); (auth.signedIn ? actions.refresh : actions.signIn)(); } },
          auth.signedIn ? 'Aktualisieren' : 'Anmelden und aktualisieren') : null),
      h('p', { class: 'small' }, auth.signedIn
        ? ['Angemeldet als ', h('strong', {}, auth.email || 'Google-Konto'), ' · ',
           h('button', { class: 'link', type: 'button', onclick: () => { closeMenu(); actions.signOut(); } }, 'Abmelden')]
        : h('button', { class: 'link', type: 'button', onclick: () => { closeMenu(); actions.signIn(); } }, 'Mit Google anmelden')),
      model ? h('ul', { class: 'menu-links' }, h('li', {}, h('a', { class: 'tap', href: '#/data', onclick: e => { e.preventDefault(); actions.navigate('data'); } },
        'Daten und Hinweise', issues.length ? h('span', { class: 'count' + (nErr ? ' has-errors' : '') }, nErr ? `${nErr} Fehler` : String(issues.length)) : null))) : null);

    // Über
    const ueber = h('section', { class: 'menu-section', id: 'menu-ueber' }, h('h3', {}, 'Über'),
      h('details', {}, h('summary', {}, 'So funktioniert die Wertung'),
        h('p', {}, 'Jeder hat einen Elo-Wert (Start 1400). Nach jedem Spiel bekommt der Sieger Punkte, der Verlierer verliert gleich viele: umso mehr, je unwahrscheinlicher der Sieg laut den Werten vorher war. Im Doppel zählt der Mittelwert der beiden Partner.'),
        h('p', {}, '„Alle“ wertet Einzel und Doppel zusammen, „Einzel“ und „Doppel“ sind eigene Wertungen mit eigenen Elo-Werten.'),
        h('p', {}, 'Wer weniger Spiele als die Mindestanzahl hat, steht vorläufig in der Liste, wer länger nicht gespielt hat, wird ausgeblendet. Beides lässt sich unter „Filter“ ändern und ändert nie die Elo-Werte.')),
      h('p', { class: 'muted small' }, `Version ${APP_VERSION}`));

    filterSection.hidden = !model;
    render(ichBox, ich); render(mitBox, mitmachen); render(datenBox, daten); render(ueberBox, ueber);
  }

  function renderEmpty(el, s) {
    const { data, auth } = s;
    if (data.loading) return render(el, h('p', { class: 'empty' }, 'Spiele werden geladen …'));
    if (data.error) {
      return render(el, h('section', { class: 'empty' },
        h('p', { class: 'error' }, data.error),
        h('button', { type: 'button', onclick: auth.signedIn ? actions.refresh : actions.signIn }, 'Erneut versuchen')));
    }
    if (auth.failed) {
      return render(el, h('section', { class: 'empty' },
        h('p', { class: 'error' }, 'Die Google-Anmeldung konnte nicht geladen werden. Bitte die Internetverbindung prüfen. Auch ein Werbe- oder Tracking-Blocker kann sie verhindern.'),
        h('button', { type: 'button', onclick: () => location.reload() }, 'Seite neu laden')));
    }
    return render(el, h('section', { class: 'welcome' },
      h('h2', {}, 'Anmelden'),
      h('p', {}, 'Die Spiele liegen in einer Google-Tabelle. Melde dich mit einem Google-Konto an, für das sie freigegeben ist.'),
      h('button', { type: 'button', onclick: actions.signIn, disabled: !auth.ready }, auth.ready ? 'Mit Google anmelden' : 'Anmeldung wird geladen …')));
  }

  /** A view that follows the Zeitraum, but the window has no games (in this Wertung). */
  function renderEmptyWindow(el, def, ctx) {
    render(el, h('section', { class: 'empty' },
      h('h2', {}, def.title),
      h('p', {}, `Im Zeitraum ${ctx.window.label} gibt es ${ctx.mode === 'alle' ? 'keine Spiele' : ctx.mode === 'einzel' ? 'keine Einzel' : 'keine Doppel'}.`),
      h('div', { class: 'row' },
        h('button', { type: 'button', onclick: () => openMenu('filter') }, 'Zeitraum ändern'),
        h('button', { type: 'button', class: 'secondary', onclick: () => store.set({ filters: { range: 'gesamt' } }) }, 'Ohne Zeitraum'))));
  }

  window.addEventListener('online', () => update(store.get()));
  window.addEventListener('offline', () => update(store.get()));
  store.subscribe(update);
  update(store.get());
  return { viewEl, renderEmpty, renderEmptyWindow, openMenu, closeMenu };
}
