// Problem melden (Phase 18a, #/melden?spiel=<game_ref>): the four questions of the Support form, sent by the
// app (app/submit.js). From a game page the topic „Falsches Spielergebnis“ and the game (date, time, players,
// game_ref) are filled in, so the game can be fixed in `corrections` without searching.
// The app can't read the Support tab, so after sending it says „Gesendet“ (not „Angekommen“).
// The form is built once per game: typing is never interrupted by a refresh of the data.
import { h, render } from '../ui/dom.js';
import { formReady } from '../app/forms.js';
import { viewHead, goBack } from './common.js';
import { findGame } from './game-query.js';
import { gameText } from './enter-logic.js';

const drafts = new Map();   // game_ref ('' = none) → { topic, description, game, name }

export default {
  id: 'melden',
  title: 'Problem melden',
  mount(el, ctx) {
    let key = null;
    const update = c => {
      const k = `${c.params.spiel || ''}|${formReady(c.baseModel.dataset.config, 'support', ['topic', 'description'])}`;
      if (k === key) return;
      key = k;
      render(el, page(c));
    };
    update(ctx);
    return { update, unmount() {} };
  },
};

const isResultTopic = t => /spielergebnis/i.test(t);

function page(ctx) {
  const cfg = ctx.baseModel.dataset.config;
  const head = viewHead('Problem melden', null, { info: [
    'Ein Fehler in der App, ein falsch eingetragenes Spiel oder eine Idee: kurz beschreiben, die App schickt es ins Support-Formular.',
    'Bei einem falschen Ergebnis hilft der Zeitstempel des Spiels. Er steht schon drin, wenn du von der Seite des Spiels kommst.'] });
  if (!formReady(cfg, 'support', ['topic', 'description'])) {
    return [head, h('p', {}, 'Das Melden in der App ist noch nicht eingerichtet.'),
      cfg.form_support_url ? h('p', {}, h('a', { class: 'button-link', href: cfg.form_support_url, target: '_blank', rel: 'noopener', 'data-form': 'support' }, 'Zum Support-Formular')) : null];
  }
  const ref = ctx.params.spiel || '';
  const gi = ref ? findGame(ctx.baseModel.dataset, ref) : -1;
  const game = gi >= 0 ? ctx.baseModel.dataset.games[gi] : null;
  const name = id => ctx.names.get(id) ?? ctx.baseModel.dataset.players.get(id)?.name ?? id;
  const topics = cfg.form_support_topics || [];
  const meName = ctx.me.id ? name(ctx.me.id) : '';
  if (!drafts.has(ref)) {
    drafts.set(ref, { topic: game ? topics.find(isResultTopic) || '' : '', description: '', game: game ? gameText(game, name) : '', name: meName });
  }
  const d = drafts.get(ref);

  const error = h('p', { class: 'error', role: 'alert', hidden: true });
  const chips = h('div', { class: 'pick-chips', role: 'radiogroup', 'aria-label': "Worum geht's?" });
  const drawChips = () => render(chips, topics.map(t => h('button', {
    type: 'button', class: 'chip pick' + (d.topic === t ? ' on' : ''), role: 'radio', 'aria-checked': String(d.topic === t),
    onclick: () => { d.topic = t; drawChips(); },
  }, t)));
  drawChips();
  const field = (label, id, input, help = null) => h('div', { class: 'form-field' },
    h('label', { for: id }, label), input, help ? h('p', { class: 'muted small' }, help) : null);
  const desc = h('textarea', { id: 'r-desc', rows: '5', oninput: e => { d.description = e.target.value; } });
  desc.value = d.description;
  const gameIn = h('input', { id: 'r-game', type: 'text', value: d.game, oninput: e => { d.game = e.target.value; } });
  const nameIn = h('input', { id: 'r-name', type: 'text', value: d.name, autocomplete: 'name', oninput: e => { d.name = e.target.value; } });
  const send = h('button', { type: 'button', onclick: async () => {
    const missing = !d.topic ? 'Bitte wählen, worum es geht.' : !d.description.trim() ? 'Bitte kurz beschreiben, was los ist.' : null;
    error.hidden = !missing;
    if (missing) { error.textContent = missing; return; }
    send.disabled = true; send.textContent = 'Wird gesendet …';
    const r = await ctx.actions.sendSupport({ topic: d.topic, description: d.description.trim(), game: d.game.trim(), name: d.name.trim() });
    send.disabled = false; send.textContent = 'Senden';
    if (r === 'sent') { drafts.delete(ref); goBack(); }
  } }, 'Senden');

  return [
    head,
    h('div', { class: 'form-field' }, h('span', { class: 'label' }, "Worum geht's?"), chips),
    field('Beschreibung', 'r-desc', desc),
    field('Betroffenes Spiel', 'r-game', gameIn, 'Nur bei falschem Ergebnis: Datum, ungefähre Uhrzeit, Spieler'),
    field('Dein Name', 'r-name', nameIn, 'Optional, für Rückfragen'),
    error,
    h('div', { class: 'menu-actions enter-actions' }, send),
    h('p', { class: 'muted small' }, 'Lieber selbst ausfüllen? ',
      h('a', { class: 'inline-link', href: cfg.form_support_url, target: '_blank', rel: 'noopener', 'data-form': 'support' }, 'Zum Support-Formular')),
  ];
}
