// App frame: header band, status line, filter panel, bottom navigation, empty states.
import { h, render } from './dom.js';
import * as fmt from './format.js';
import { VIEWS } from '../views/index.js';
import { resolveFilters } from '../core/filters.js';
import { MODES, MODE_LABELS, modelFor } from '../app/modes.js';

const X_LABELS = { date: 'Datum', game: 'Spielnummer', own: 'Eigene Spiele' };

/**
 * @param {HTMLElement} root
 * @param {{ store, actions: { signIn, refresh, navigate } }} o
 * @returns {{ viewEl: HTMLElement, renderEmpty(el, state): void }}
 */
export function createShell(root, { store, actions }) {
  const account = h('button', { class: 'account', type: 'button' });
  const status = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const filters = h('details', { class: 'filters' });
  const viewEl = h('main', { id: 'view', tabindex: '-1' });
  // the mode switch: the only place that changes Alle / Einzel / Doppel
  const modeSeg = h('div', { class: 'seg mode-seg', role: 'radiogroup', 'aria-label': 'Wertung' },
    MODES.map(m => h('label', {},
      h('input', { type: 'radio', name: 'mode', value: m, onchange: () => store.set({ filters: { mode: m === 'alle' ? null : m } }) }),
      h('span', {}, MODE_LABELS[m]))));
  const modeBar = h('div', { class: 'mode-bar' }, h('span', { class: 'label' }, 'Wertung'), modeSeg);
  const nav = h('nav', { class: 'tabs', 'aria-label': 'Ansichten' });

  render(root,
    h('header', { class: 'band' },
      h('div', { class: 'band-inner' },
        h('h1', {}, h('a', { href: '#/dashboard', onclick: e => { e.preventDefault(); actions.navigate('dashboard'); } }, 'Tischtennis Elo')),
        account)),
    h('div', { class: 'frame' }, status, modeBar, filters, viewEl),
    nav);

  // filter controls are built once; values follow the state
  const min = h('input', { type: 'range', min: '0', step: '1', id: 'f-min' });
  const minOut = h('output', { for: 'f-min' });
  const inact = h('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', id: 'f-inact' });
  const xs = Object.entries(X_LABELS).map(([v, label]) =>
    h('label', {}, h('input', { type: 'radio', name: 'f-x', value: v }), h('span', {}, label)));
  const summary = h('summary', {});
  render(filters, summary,
    h('div', { class: 'filter-grid' },
      h('label', { for: 'f-min' }, 'Mindestanzahl Spiele'), h('div', { class: 'range' }, min, minOut),
      h('label', { for: 'f-inact' }, 'Ausblenden nach Tagen ohne Spiel'), h('div', {}, inact, h('span', { class: 'muted hint' }, '0 = nie ausblenden')),
      h('span', { class: 'label' }, 'x-Achse'), h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'x-Achse' }, xs)),
    h('button', { class: 'secondary small', type: 'button', onclick: () => store.set({ filters: { minGames: null, inactivityDays: null, xAxis: null, focus: null } }) },
      'Standardwerte wiederherstellen'));
  min.addEventListener('input', () => store.set({ filters: { minGames: Number(min.value) } }));
  inact.addEventListener('change', () => {
    const v = Math.max(0, Math.floor(Number(inact.value) || 0));
    store.set({ filters: { inactivityDays: v } });
  });
  filters.addEventListener('change', e => {
    if (e.target.name === 'f-x') store.set({ filters: { xAxis: e.target.value } });
  });

  const navItems = VIEWS.filter(v => v.nav).map(v =>
    h('a', { href: `#/${v.id}`, dataset: { view: v.id }, onclick: e => { e.preventDefault(); actions.navigate(v.id); } }, v.title));
  render(nav, navItems);

  function update(s) {
    const { data, auth } = s;
    // account button
    account.textContent = auth.signedIn ? 'Konto' : 'Anmelden';
    account.disabled = !auth.ready && !auth.signedIn;
    account.onclick = auth.signedIn ? () => actions.navigate('data') : actions.signIn;

    // status line
    const issues = data.model?.dataset.issues || [];
    const nErr = issues.filter(i => i.level === 'error').length;
    render(status,
      data.model ? h('span', {}, data.loading ? 'Wird aktualisiert …' : `Stand: ${fmt.stamp(data.updatedAt)}`,
        data.source === 'cache' && !data.loading ? h('span', { class: 'muted' }, ' (Offline-Kopie)') : null) : null,
      data.error ? h('span', { class: 'error' }, data.error) : null,
      data.model && !data.loading
        ? h('button', { class: 'link', type: 'button', onclick: auth.signedIn ? actions.refresh : actions.signIn },
            auth.signedIn ? 'Aktualisieren' : 'Anmelden und aktualisieren')
        : null,
      issues.length ? h('a', { class: 'issues-link' + (nErr ? ' has-errors' : ''), href: '#/data',
        onclick: e => { e.preventDefault(); actions.navigate('data'); } },
        nErr ? `${nErr} Fehler` : `${issues.length} ${issues.length === 1 ? 'Hinweis' : 'Hinweise'}`) : null);

    // filters
    filters.hidden = !data.model;
    modeBar.hidden = !data.model;
    if (data.model) {
      const f = resolveFilters(s.filters, data.model.dataset.config);
      for (const input of modeSeg.querySelectorAll('input')) input.checked = input.value === f.mode;
      const maxPlayed = Math.max(1, ...modelFor(data.model, f.mode).elo.played);
      min.max = String(maxPlayed);
      min.value = String(Math.min(f.minGames, maxPlayed));
      minOut.value = String(f.minGames);
      if (document.activeElement !== inact) inact.value = String(f.inactivityDays);
      for (const l of xs) l.querySelector('input').checked = l.querySelector('input').value === f.xAxis;
      summary.textContent = `Filter: ab ${f.minGames} Spielen, ` +
        (f.inactivityDays > 0 ? `in den letzten ${f.inactivityDays} Tagen aktiv` : 'auch inaktive Spieler');
    }

    // nav
    const current = VIEWS.find(v => v.id === s.view)?.nav ? s.view : 'more';
    for (const a of navItems) {
      if (a.dataset.view === current) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
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
        h('p', { class: 'error' }, 'Die Google-Anmeldung konnte nicht geladen werden. Bitte die Internetverbindung prüfen; auch ein Werbe- oder Tracking-Blocker kann sie verhindern.'),
        h('button', { type: 'button', onclick: () => location.reload() }, 'Seite neu laden')));
    }
    return render(el, h('section', { class: 'welcome' },
      h('h2', {}, 'Anmelden'),
      h('p', {}, 'Die Spiele liegen in einer Google-Tabelle. Melde dich mit einem Google-Konto an, für das sie freigegeben ist.'),
      h('button', { type: 'button', onclick: actions.signIn, disabled: !auth.ready }, auth.ready ? 'Mit Google anmelden' : 'Anmeldung wird geladen …')));
  }

  store.subscribe(update);
  update(store.get());
  return { viewEl, renderEmpty };
}
