// A small sheet from the bottom (Phase 18a): „Anna schlägt Bernd · eintragen?“ with two buttons.
// Same look as the share sheet. Escape, the backdrop and „Abbrechen“ close it.
//
//   openSheet({ title, body, actions: [{ label, primary?, onclick?, href?, attrs? }] }) → { close(), set(o) }
//   An action with href is a link (opens in a new tab: a form in the browser); its onclick runs too.
//   onclick returning false keeps the sheet open. set(o) replaces the content (a second step).
import { h, render } from './dom.js';

export function openSheet(o) {
  const panel = h('div', { class: 'share-panel sheet-panel', role: 'dialog', 'aria-modal': 'true' });
  const root = h('div', { class: 'share-sheet' }, h('div', { class: 'share-backdrop', onclick: () => close() }), panel);
  const prev = document.activeElement;
  const onKey = e => { if (e.key === 'Escape') close(); };

  function close() {
    root.remove();
    document.removeEventListener('keydown', onKey);
    prev?.focus?.({ preventScroll: true });
  }

  function set({ title, body = null, actions = [] }) {
    const titleId = 'sheet-title';
    panel.setAttribute('aria-labelledby', titleId);
    const btn = a => {
      const run = e => { if (a.onclick?.(e) !== false) close(); };
      return a.href
        ? h('a', { class: 'btn' + (a.primary ? ' primary' : ''), href: a.href, target: '_blank', rel: 'noopener', ...(a.attrs || {}), onclick: run }, a.label)
        : h('button', { type: 'button', class: 'btn' + (a.primary ? ' primary' : ''), onclick: run }, a.label);
    };
    render(panel,
      h('div', { class: 'share-top' }, h('h2', { id: titleId }, title),
        h('button', { type: 'button', class: 'share-close', 'aria-label': 'Schließen', onclick: () => close() }, '×')),
      body,
      h('div', { class: 'share-actions' }, actions.map(btn)));
    (panel.querySelector('.btn.primary') || panel.querySelector('.btn'))?.focus({ preventScroll: true });
  }

  document.body.append(root);
  document.addEventListener('keydown', onKey);
  set(o);
  return { close, set };
}
