// Usage counting (Phase 17): which views are opened how often, plus a few actions (share, Tisch preview,
// form opened, install), counted on the device and sent once per device and day to a hidden Google Form
// („Nutzung“). Anonymous: a random device number, the date, the app version and the counts. No names, no
// accounts, no player IDs, no URL parameters. Off when the form isn't set in `config`, and switchable off
// per device in the menu (Über). Completed days are sent when the app is next opened; a day that fails to
// send is tried again next time; days older than KEEP_DAYS are dropped.
//
//   state.usage = { configured, off }   for the line in the menu

export const KEEP_DAYS = 14;
const ENTRY_KEYS = ['form_usage_entry_device', 'form_usage_entry_date', 'form_usage_entry_version', 'form_usage_entry_counts'];

/** Is the Nutzung form fully set in config? */
export const usageConfigured = cfg => !!(cfg && cfg.form_usage_url && ENTRY_KEYS.every(k => cfg[k]));

/** The form's respondent link (…/viewform) → the address that takes a response (…/formResponse). */
export function formResponseUrl(url) {
  const u = new URL(url);
  u.pathname = u.pathname.replace(/\/(viewform|formResponse)?\/?$/, '') + '/formResponse';
  u.search = '';
  return u.href;
}

const entry = v => 'entry.' + String(v).replace(/^entry\./, '');

/** One day as form fields. */
export function rowFields(cfg, st, day) {
  const d = st.days[day];
  return new URLSearchParams({
    [entry(cfg.form_usage_entry_device)]: st.device,
    [entry(cfg.form_usage_entry_date)]: day,
    [entry(cfg.form_usage_entry_version)]: d.v,
    [entry(cfg.form_usage_entry_counts)]: JSON.stringify(d.c),
  });
}

export const dayOf = (ms = Date.now()) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Days before today that are counted and not sent yet, oldest first. */
export const dueDays = (st, today) => Object.keys(st.days).filter(d => d < today && !st.sent.includes(d)).sort();

/** Drop what is older than KEEP_DAYS. */
export function prune(st, today) {
  const cut = dayOf(new Date(today + 'T12:00:00').getTime() - KEEP_DAYS * 864e5);
  for (const d of Object.keys(st.days)) if (d < cut) delete st.days[d];
  st.sent = st.sent.filter(d => d >= cut && d in st.days);
}

/**
 * @param {{ storage: Storage, version: string, fetchImpl?: typeof fetch, clock?: () => number, onChange?: (state) => void, randomId?: () => string }} o
 */
export function createUsage({ storage, version, fetchImpl = (...a) => fetch(...a), clock = Date.now, onChange = () => {},
  randomId = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)) }) {
  const KEY = 'tt-elo-usage', OFF = 'tt-elo-usage-off';
  let cfg = null, sending = false;
  const read = () => { try { return JSON.parse(storage.getItem(KEY)) || null; } catch { return null; } };
  const write = st => { try { storage.setItem(KEY, JSON.stringify(st)); } catch { /* storage full or blocked: skip */ } };
  const isOff = () => { try { return storage.getItem(OFF) === '1'; } catch { return false; } };
  const active = () => usageConfigured(cfg) && !isOff();
  const state = () => ({ configured: usageConfigured(cfg), off: isOff() });
  let pending = [];   // counts made before the config is known (the first view of a visit)

  function add(key) {
    const st = read() || { device: randomId(), days: {}, sent: [] };
    const day = dayOf(clock());
    const d = (st.days[day] ||= { v: version, c: {} });
    d.v = version;
    d.c[key] = (d.c[key] || 0) + 1;
    write(st);
  }

  return {
    state,
    /** Count one view or action. */
    count(key) {
      if (!cfg) { if (pending.length < 50) pending.push(key); return; }
      if (active()) add(key);
    },
    /** The config is known (or changed): count what waited, then send completed days. */
    async configure(config) {
      cfg = config;
      const keys = pending; pending = [];
      if (active()) keys.forEach(add);
      onChange(state());
      return this.flush();
    },
    async flush() {
      if (!active() || sending) return 0;
      const st = read();
      if (!st) return 0;
      const today = dayOf(clock());
      prune(st, today);
      write(st);
      sending = true;
      let n = 0;
      try {
        for (const day of dueDays(st, today)) {
          try {
            await fetchImpl(formResponseUrl(cfg.form_usage_url), { method: 'POST', mode: 'no-cors', body: rowFields(cfg, st, day) });
          } catch { break; }                        // offline: next time
          const now = read() || st;
          now.sent = [...new Set([...(now.sent || []), day])];
          write(now);
          n++;
        }
      } finally { sending = false; }
      return n;
    },
    /** Switch counting off on this device (and forget what was counted) or back on. */
    setOff(off) {
      try {
        if (off) { storage.setItem(OFF, '1'); storage.removeItem(KEY); } else storage.removeItem(OFF);
      } catch { /* blocked storage: nothing is counted anyway */ }
      onChange(state());
    },
  };
}
