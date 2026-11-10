// State ↔ URL hash, so views can be shared and the back button works. No DOM.
//
//   #/matrix?min=10&inaktiv=30&x=date&metric=wins
//   min, inaktiv, x = global filters (absent = config default); everything else = view params.
//   fokus = highlighted players in colour-slot order, '-' = empty slot (so others keep their colour):
//   #/history?fokus=p003,-,p007  → p003 has colour 1, p007 colour 3.

const FILTER_KEYS = { min: 'minGames', inaktiv: 'inactivityDays', x: 'xAxis', fokus: 'focus' };
const X_AXES = ['date', 'game', 'own'];

/** @param {string} hash  location.hash, e.g. "#/matrix?min=10" */
export function parseHash(hash) {
  const [path, query = ''] = String(hash || '').replace(/^#\/?/, '').split('?');
  const view = decodeURIComponent(path || '') || 'dashboard';
  const filters = { minGames: null, inactivityDays: null, xAxis: null, focus: null };
  const params = {};
  for (const [k, v] of new URLSearchParams(query)) {
    if (k in FILTER_KEYS) {
      if (k === 'x') { if (X_AXES.includes(v)) filters.xAxis = v; }
      else if (k === 'fokus') filters.focus = v.split(',').slice(0, 8).map(id => (id === '-' || !id ? null : id));
      else if (/^\d+$/.test(v)) filters[FILTER_KEYS[k]] = Number(v);
    } else {
      params[k] = v;
    }
  }
  return { view, params, filters };
}

/** @returns {string} hash starting with "#/" */
export function formatHash({ view, params = {}, filters = {} }) {
  const q = new URLSearchParams();
  for (const [k, key] of Object.entries(FILTER_KEYS)) {
    if (filters[key] == null) continue;
    q.set(k, key === 'focus' ? filters.focus.map(id => id || '-').join(',') : String(filters[key]));
  }
  for (const k of Object.keys(params).sort()) if (params[k] != null && params[k] !== '') q.set(k, String(params[k]));
  const qs = q.toString();
  return `#/${encodeURIComponent(view || 'dashboard')}${qs ? '?' + qs : ''}`;
}
