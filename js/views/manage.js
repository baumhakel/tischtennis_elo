// Spieler verwalten (Phase 18a, #/verwalten?aktion=add|rename|activate|deactivate|merge|accounts).
// Only for the accounts in `management_accounts` (this only hides the pages; the Verwaltung form protects
// itself: it is restricted to specific people). The page runs the checks of Verwaltung.gs (core/manage.js)
// and then opens the Verwaltung form pre-filled in the browser, where the last tap („Senden“) happens: a form
// that requires sign-in can't be sent from the app. Back in the app, the app reads management_log and says
// what happened (app/after-entry.js). In demo mode the demo does the action itself.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { ACTIONS, canManage, formReady } from '../app/forms.js';
import { manageDb, checkManage, askText, reasonText, splitAccounts } from '../core/manage.js';
import { openSheet } from '../ui/sheet.js';
import { viewHead, linkTo } from './common.js';
import { mergeEffect, mergeText } from './enter-logic.js';

const drafts = new Map();   // action → fields

export default {
  id: 'verwalten',
  title: 'Spieler verwalten',
  mount(el, ctx) {
    let key = null;
    const update = c => {
      // the form part is built once per action and data state, so typing is never interrupted
      const k = [c.params.aktion || '', c.baseModel.dataset.hash, c.state.auth.email].join('|');
      if (k === key) return;
      key = k;
      render(el, page(c));
    };
    update(ctx);
    return { update, unmount() {} };
  },
};

const LOG_WORD = { add: 'hinzugefügt', rename: 'umbenannt', activate: 'aktiviert', deactivate: 'deaktiviert', merge: 'zusammengeführt', accounts: 'Google-Konto', turnier: 'Turnier' };

function page(ctx) {
  const ds = ctx.baseModel.dataset, cfg = ds.config;
  const action = ACTIONS[ctx.params.aktion] && !ACTIONS[ctx.params.aktion].hidden ? ctx.params.aktion : null;
  if (!canManage(cfg, ctx.state.auth.email)) {
    return [viewHead('Spieler verwalten', null, { back: true }),
      h('p', {}, 'Diese Seiten sind nur für die Verwaltung der Spieler. Wer einen Spieler hinzufügen oder umbenennen lassen möchte, meldet das bitte über „Problem melden“.')];
  }
  if (!formReady(cfg, 'management', ['action'])) {
    return [viewHead('Spieler verwalten', null, { back: !!action }),
      h('p', {}, 'Die Verwaltung in der App ist noch nicht eingerichtet: die Fragen-IDs fehlen im Tab „config“ (Funktion writeFormIds im Verwaltungs-Skript).'),
      cfg.form_management_url ? h('p', {}, h('a', { class: 'button-link', href: cfg.form_management_url, target: '_blank', rel: 'noopener', 'data-form': 'verwaltung' }, 'Zum Verwaltungs-Formular')) : null];
  }
  return action ? actionPage(ctx, action) : hub(ctx);
}

function hub(ctx) {
  const ds = ctx.baseModel.dataset;
  const rows = (ds.log || []).slice(-8).reverse();
  return [
    viewHead('Spieler verwalten', null, { info: [
      'Wähle, was du ändern möchtest. Die App prüft die Angaben wie das Verwaltungs-Skript und öffnet dann das Verwaltungs-Formular ausgefüllt im Browser. Dort „Weiter“ und „Senden“ tippen.',
      'Zurück in der App siehst du, ob die Änderung angekommen ist, und bei einer Ablehnung den Grund.'] }),
    h('ul', { class: 'menu-links manage-list' }, Object.entries(ACTIONS).filter(([, a]) => !a.hidden).map(([id, a]) =>
      h('li', {}, h('a', { class: 'tap', ...linkTo(ctx, 'verwalten', { aktion: id }) }, a.title)))),
    rows.length ? [h('h3', {}, 'Zuletzt'),
      h('ul', { class: 'log-list small' }, rows.map(r => h('li', { class: /^ok$/i.test(r.status) ? null : 'refused' },
        h('span', { class: 'muted' }, r.t != null ? `${fmt.date(r.t)}, ${fmt.time(r.t)} Uhr · ` : ''),
        `${LOG_WORD[r.action] || r.action}: ${[r.old, r.new].filter(Boolean).join(' → ')}`,
        /^ok$/i.test(r.status) ? null : h('span', { class: 'down' }, ` · nicht geändert: ${reasonText(r.status)}`))))] : null,
  ];
}

function actionPage(ctx, action) {
  const ds = ctx.baseModel.dataset;
  const a = ACTIONS[action];
  const players = [...ds.players.values()].sort((x, y) => x.name.localeCompare(y.name, 'de'));
  const lists = {
    old_name: players, merge_from: players, merge_into: players, account_player: players,
    inactive_player: players.filter(p => !p.active), active_player: players.filter(p => p.active),
  };
  if (!drafts.has(action)) drafts.set(action, {});
  const f = drafts.get(action);
  const error = h('p', { class: 'error', role: 'alert', hidden: true });

  const LABELS = {
    new_player: 'Neuer Spieler', new_account: 'Google-Konto (optional)', old_name: 'Spieler', new_name: 'Neuer Name',
    inactive_player: 'Inaktiver Spieler', active_player: 'Aktiver Spieler', merge_from: 'Doppelter Eintrag (verschwindet)',
    merge_into: 'Zusammenführen mit (bleibt)', account_player: 'Spieler', account: 'Google-Konto',
  };
  const HELP = {
    new_account: 'E-Mail-Adresse des Google-Kontos, mit dem sich der Spieler in der App anmeldet. Mehrere durch Kommas trennen.',
    account: 'Leer lassen, um die Zuordnung zu entfernen. Mehrere durch Kommas trennen.',
  };
  const inputs = {};
  const fieldEl = key => {
    const id = 'm-' + key;
    let input;
    if (lists[key]) {
      const list = lists[key];
      if (f[key] && !list.some(p => p.name === f[key])) f[key] = '';
      input = h('select', { id, onchange: e => {
        f[key] = e.target.value;
        if (key === 'account_player' && inputs.account) {   // show the current address(es) to edit
          const p = players.find(x => x.name === f[key]);
          f.account = p ? p.accounts.join(', ') : '';
          inputs.account.value = f.account;
        }
      } }, h('option', { value: '' }, list.length ? 'Spieler wählen …' : '– keiner –'),
        list.map(p => h('option', { value: p.name, selected: p.name === f[key] ? true : null }, p.name)));
    } else {
      input = h('input', { id, type: key.includes('account') ? 'email' : 'text', value: f[key] || '',
        ...(key.includes('account') ? { inputmode: 'email', autocapitalize: 'off', multiple: true } : { autocapitalize: 'words' }),
        oninput: e => { f[key] = e.target.value; } });
    }
    inputs[key] = input;
    return h('div', { class: 'form-field' }, h('label', { for: id }, LABELS[key]), input, HELP[key] ? h('p', { class: 'muted small' }, HELP[key]) : null);
  };

  const go = () => {
    const fields = Object.fromEntries(a.fields.map(k => [k, (f[k] || '').trim()]));
    if (action === 'accounts' || action === 'add') {
      const k = action === 'add' ? 'new_account' : 'account';
      fields[k] = splitAccounts(fields[k]).join(', ');
    }
    const reason = checkManage(manageDb(ds), action, fields);
    error.hidden = !reason;
    if (reason) { error.textContent = reason; return; }
    confirmManage(ctx, action, fields, () => drafts.delete(action));
  };

  return [
    viewHead(a.title, null, { back: true }),
    a.fields.map(fieldEl),
    error,
    h('div', { class: 'menu-actions enter-actions' }, h('button', { type: 'button', onclick: go }, 'Weiter …')),
  ];
}

/** The summary, and the link that opens the pre-filled form (a merge needs a second confirmation first). */
function confirmManage(ctx, action, fields, onDone) {
  const ds = ctx.baseModel.dataset;
  const demo = !!ctx.state.auth.demo;
  const send = demo
    ? { label: 'Ausführen (Demo)', primary: true, onclick: () => { ctx.actions.managementDemo(action, fields); onDone(); ctx.navigate('verwalten', {}); } }
    : { label: 'Formular öffnen', primary: true, href: ctx.actions.managementUrl(action, fields), attrs: { 'data-form': 'verwaltung' },
      onclick: () => { ctx.actions.managementOpened(action, fields); onDone(); ctx.navigate('verwalten', {}); } };
  const howTo = demo
    ? h('p', { class: 'muted small' }, 'In der Demo führt die App die Änderung selbst aus.')
    : h('p', { class: 'muted small' }, 'Das Verwaltungs-Formular öffnet sich ausgefüllt im Browser. Dort „Weiter“ und „Senden“ tippen und zurück in die App wechseln. Die App zeigt dann, ob die Änderung angekommen ist.');
  const title = askText(action, fields);
  if (action !== 'merge') {
    openSheet({ title, body: howTo, actions: [{ label: 'Abbrechen' }, send] });
    return;
  }
  const byName = n => [...ds.players.values()].find(p => p.name === n);
  const from = byName(fields.merge_from), into = byName(fields.merge_into);
  const effect = mergeText(from.name, into.name, mergeEffect(ds, from.id, into.id));
  const sheet = openSheet({
    title,
    body: [h('p', {}, effect), from.accounts.length ? h('p', { class: 'small' }, `Das Google-Konto von ${from.name} geht an ${into.name}.`) : null],
    actions: [{ label: 'Abbrechen' }, { label: 'Zusammenführen', primary: true, onclick: () => {
      sheet.set({ title: 'Wirklich zusammenführen?', body: [h('p', {}, effect),
        h('p', { class: 'hint' }, 'Das lässt sich nicht mit einem Tipp rückgängig machen, nur von Hand in den Tabs „players“ und „aliases“.'), howTo],
        actions: [{ label: 'Abbrechen' }, send] });
      return false;
    } }],
  });
}
