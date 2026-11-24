// The confirmation before a result is sent (Ergebnis eintragen and Tisch, Phase 18a):
// „Anna schlägt Bernd · eintragen?“ with „Eintragen“ and „Abbrechen“, plus a hint when this phone sent the
// same result within duplicate_window_minutes („Schon um 12:03 eingetragen. Trotzdem noch einmal?“).
import { h } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { openSheet } from '../ui/sheet.js';
import { resultSentence } from './enter-logic.js';

export function confirmResult(ctx, W, L, name, onOk) {
  const at = ctx.actions.recentResult(W, L);
  const kind = W.length > 1 ? 'Doppel' : 'Einzel';
  openSheet({
    title: `${resultSentence(W, L, name)} · eintragen?`,
    body: [
      h('p', {}, `Wird als ${kind} mit der Uhrzeit von jetzt eingetragen und zählt gleich in der Wertung. Ein Fehler lässt sich danach nur über „Problem melden“ korrigieren.`),
      at != null ? h('p', { class: 'hint' }, `Schon um ${fmt.clock(at)} Uhr eingetragen. Trotzdem noch einmal?`) : null,
    ],
    actions: [
      { label: 'Abbrechen' },
      { label: at != null ? 'Noch einmal eintragen' : 'Eintragen', primary: true, onclick: () => { onOk(); } },
    ],
  });
}
