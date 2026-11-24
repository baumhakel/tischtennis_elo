// Entering in the app (Phase 18a): results and support reports are sent as form responses (io/forms.js),
// Verwaltung actions open the pre-filled form (it requires sign-in, which the app can't send along).
// No DOM. Views call these through ctx.actions; main.js builds it with the real or the demo transport.
//
//   result(winners, losers) → 'sent' | 'offline' | 'unavailable'     then app/after-entry.js checks arrival
//   recentResult(winners, losers) → ms of the same result sent from this device within duplicate_window_minutes, or null
//   support(answers)        → 'sent' | 'offline' | 'unavailable'     („Gesendet“: the app can't read the Support tab)
//   managementUrl(action, fields) → the Verwaltung form, pre-filled (null if not set up)
//   managementOpened(action, fields)  the link was tapped: check the log on return
//   managementDemo(action, fields)    demo only: the demo transport does it like Verwaltung.gs
//
// Nothing is kept when there is no connection (decided 24 Nov 2026: no queue on the phone).
import { clean } from '../core/normalize.js';
import { doneText } from '../core/manage.js';
import { formBody, prefilledUrl, sendForm } from '../io/forms.js';
import { FORMS, formReady, entriesFor, resultAnswers, managementAnswers, managementPages, resultKey, recentSame } from './forms.js';

const SENT_KEY = 'tt-elo-sent';
/** usage counting (app/usage.js listens for this event in main.js) */
const count = what => { if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('tt-usage', { detail: what })); };
const KEEP_MS = 24 * 3600 * 1000;

/** The real transport: one form response over the network. */
export const formTransport = (send = sendForm) => ({
  async send(form, cfg, answers, { pageHistory = null } = {}) {
    await send(cfg[FORMS[form].url], formBody(entriesFor(cfg, form, answers), { pageHistory }));
  },
});

/** Demo transport (io/demo.js demoForms): nothing over the network. */
export const demoTransport = demo => ({ send: (form, cfg, answers) => demo.submit(form, answers) });

/**
 * @param {{ store, afterEntry, transport: { send(form, cfg, answers, o?) }, storage?: Storage, clock?: () => number, later?: (fn, ms) => any }} o
 */
export function createSubmit({ store, afterEntry, transport, storage = null, clock = Date.now, later = setTimeout }) {
  const model = () => store.get().data.model;
  const cfg = () => model()?.dataset.config;
  const nameOf = id => clean(model()?.dataset.players.get(id)?.name ?? id);
  const readLog = () => { try { return JSON.parse(storage?.getItem(SENT_KEY)) || []; } catch { return []; } };
  const writeLog = log => { try { storage?.setItem(SENT_KEY, JSON.stringify(log)); } catch { /* storage blocked: no hint then */ } };
  const offline = () => store.set({ notice: { kind: 'offline' } });

  return {
    recentResult(winners, losers) {
      const hit = recentSame(readLog(), resultKey(winners, losers), clock(), cfg()?.duplicate_window_minutes);
      return hit ? hit.at : null;
    },

    async result(winners, losers) {
      const c = cfg();
      if (!formReady(c, 'result', ['winner1', 'loser1', ...(winners.length > 1 ? ['winner2', 'loser2'] : [])])) return 'unavailable';
      afterEntry.sending();
      try {
        await transport.send('result', c, resultAnswers(winners, losers, nameOf));
      } catch {
        afterEntry.failed();
        offline();
        return 'offline';
      }
      const now = clock();
      writeLog([...readLog().filter(x => now - x.at < KEEP_MS), { key: resultKey(winners, losers), at: now }].slice(-50));
      count('eintragen-ergebnis');
      afterEntry.sent();
      return 'sent';
    },

    async support(answers) {
      const c = cfg();
      if (!formReady(c, 'support', ['topic', 'description'])) return 'unavailable';
      try {
        await transport.send('support', c, answers);
      } catch {
        offline();
        return 'offline';
      }
      const notice = { kind: 'sent', text: 'Gesendet. Danke!' };
      store.set({ notice });
      later(() => { if (store.get().notice === notice) store.set({ notice: null }); }, 8000);
      count('eintragen-support');
      return 'sent';
    },

    managementUrl(action, fields) {
      const c = cfg();
      if (!formReady(c, 'management', ['action'])) return null;
      return prefilledUrl(c.form_management_url, entriesFor(c, 'management', managementAnswers(action, fields)));
    },

    managementOpened(action, fields) {
      afterEntry.manage({ action, done: doneText(action, fields) }, 'opened');
    },

    async managementDemo(action, fields) {
      afterEntry.manage({ action, done: doneText(action, fields) }, 'sent');
      await transport.send('management', cfg(), { action, fields }, { pageHistory: managementPages(cfg(), action) });
    },
  };
}
