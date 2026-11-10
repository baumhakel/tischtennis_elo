// Daten und Hinweise: where the data came from, loader issues, settings in use, account.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { CONFIG_DEFAULTS } from '../config.js';

export default {
  id: 'data',
  title: 'Daten und Hinweise',
  mount(el, ctx) {
    const update = c => render(el, page(c));
    update(ctx);
    return { update, unmount() {} };
  },
};

function page(ctx) {
  const { dataset } = ctx.model;
  const { counts, issues, config } = dataset;
  const errors = issues.filter(i => i.level === 'error'), warnings = issues.filter(i => i.level === 'warning');
  const missing = new Set(issues.filter(i => i.kind === 'missing_config').map(i => i.name));
  const d = ctx.state.data, a = ctx.state.auth;

  return h('div', { class: 'stack' },
    h('section', {},
      h('h2', {}, 'Datenstand'),
      h('dl', { class: 'facts' },
        fact('Quelle', d.source === 'sheet' ? `Google-Tabelle, gelesen ${fmt.stamp(d.updatedAt)}` : `Offline-Kopie vom ${fmt.stamp(d.updatedAt)}`),
        fact('Gewertete Spiele', fmt.int(counts.games)),
        fact('Altdaten (Excel)', `${fmt.int(counts.legacyRows)} Spiele`),
        fact('Formulareinträge', `${fmt.int(counts.spieleRows)}` + (counts.beforeCutoff ? `, davon ${fmt.int(counts.beforeCutoff)} ${counts.beforeCutoff === 1 ? 'Testeintrag' : 'Testeinträge'} vor dem ${config.responses_valid_from != null ? fmt.date(config.responses_valid_from) : '–'}` : '')),
        fact('Korrekturen', `${counts.voided} gestrichen, ${counts.swapped} mit vertauschtem Ergebnis`),
        fact('Nicht gewertet', counts.skipped ? `${counts.skipped} ${counts.skipped === 1 ? 'Zeile' : 'Zeilen'} (siehe Hinweise)` : 'keine'),
        fact('Spieler', `${fmt.int(ctx.model.elo.ids.length)} mit mindestens einem Spiel`))),

    h('section', {},
      h('h2', {}, issues.length ? `Hinweise (${issues.length})` : 'Hinweise'),
      issues.length
        ? h('ul', { class: 'issues' },
            [...errors, ...warnings].map(i => h('li', { class: i.level }, h('span', { class: 'tag' }, i.level === 'error' ? 'Fehler' : 'Hinweis'), i.message)))
        : h('p', { class: 'muted' }, 'Keine. Alle Zeilen konnten gelesen werden.')),

    h('section', {},
      h('h2', {}, 'Einstellungen (Tab „config“)'),
      h('table', { class: 'settings' }, h('tbody', {},
        Object.keys(CONFIG_DEFAULTS).map(k => h('tr', { class: missing.has(k) ? 'missing' : null },
          h('td', {}, h('code', {}, k)),
          h('td', { class: 'num' }, show(k, config[k])),
          h('td', { class: 'muted' }, missing.has(k) ? 'fehlt, Standardwert verwendet' : '')))))),

    h('section', {},
      h('h2', {}, 'Konto'),
      h('p', {}, a.demo ? 'Demo-Modus: erfundene Spieler und Spiele, keine Anmeldung.'
        : a.email ? `Angemeldet als ${a.email}.` : a.signedIn ? 'Angemeldet.' : 'Nicht angemeldet.'),
      h('div', { class: 'row' },
        a.signedIn && !a.demo ? h('button', { class: 'secondary', onclick: ctx.actions.signOut }, 'Abmelden') : null,
        h('button', { class: 'secondary', onclick: ctx.actions.clearCache }, 'Offline-Kopie löschen'))));
}

const fact = (k, v) => [h('dt', {}, k), h('dd', {}, v)];

function show(key, v) {
  if (v == null) return '–';
  if (key === 'responses_valid_from') return `${fmt.date(v)} ${fmt.time(v)}`;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}
