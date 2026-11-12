// Demo mode (open the app with ?demo): made-up players and games in the exact sheet format,
// so the app can be tried without Google sign-in. Nothing here is real data.

import { CONFIG_DEFAULTS } from '../config.js';
import { nowSerial } from '../core/normalize.js';

const ALL_NAMES = ['Anna', 'Bernd', 'Clara', 'David', 'Elif', 'Felix', 'Greta', 'Hannes', 'Ida', 'Jonas', 'Kira', 'Lukas', 'Mira', 'Noah', 'Olga'];

/**
 * Deterministic fake RawSheets, legacy + Spiele.
 * size 'klein' (default): 12 players, ~370 games over 16 weeks.
 * size 'gross': 15 players, ~2000 games over two years (the real league's size, for performance checks).
 */
export function demoRaw(timeZone, size = 'klein') {
  const big = size === 'gross';
  const NAMES = ALL_NAMES.slice(0, big ? 15 : 12);
  let s = 20261110;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const skill = NAMES.map(() => rnd() * 400);
  const now = Math.floor(nowSerial(timeZone));
  const cutoff = now - 21 + 8 / 24;                       // last 3 weeks come from the "form"
  const games = [];
  const days = big ? 730 : 112, perDay = big ? 8 : 9;
  for (let day = now - days; day <= now; day++) {
    const wd = ((day - 2) % 7 + 7) % 7;                   // 0 = Monday
    if (wd > 4) continue;
    const n = Math.floor(rnd() * perDay);
    for (let i = 0; i < n; i++) {
      const t = day + (8 + rnd() * 9) / 24;
      const pool = NAMES.filter((_, k) => k < 9 || day > now - (big ? 300 : 50));   // late joiners
      const dbl = rnd() < 0.3;
      const pick = new Set();
      while (pick.size < (dbl ? 4 : 2)) pick.add(pool[Math.floor(rnd() * pool.length)]);
      const q = [...pick], A = q.slice(0, q.length / 2), B = q.slice(q.length / 2);
      const sk = xs => xs.reduce((a, x) => a + skill[NAMES.indexOf(x)], 0) / xs.length;
      const pA = 1 / (1 + 10 ** ((sk(B) - sk(A)) / 400));
      games.push(rnd() < pA ? [t, A, B] : [t, B, A]);
    }
  }
  games.sort((a, b) => a[0] - b[0]);
  const legacy = [['timestamp', 'winner1', 'winner2', 'loser1', 'loser2', 'source_row']];
  const spiele = [['Zeitstempel', 'Sieger 1', 'Sieger 2', 'Verlierer 1', 'Verlierer 2']];
  games.forEach(([t, w, l], i) => {
    if (t < cutoff) legacy.push([t, w[0], w[1] || '', l[0], l[1] || '', i + 2]);
    else spiele.push([t, w[0], w[1] || '', l[0], l[1] || '']);
  });
  spiele.splice(1, 0, [cutoff - 2, 'Anna', '', 'Bernd', '']);   // a test row before the cutoff

  const demoValue = { responses_valid_from: cutoff, form_result_url: DEMO_FORM, form_support_url: DEMO_FORM, form_management_url: DEMO_FORM };
  const config = [['key', 'value', 'note'], ...Object.entries(CONFIG_DEFAULTS)
    .map(([k, d]) => [k, k in demoValue ? demoValue[k] : d.value, 'Demo'])];
  // the demo account is mapped to the third player, so „Ich“ works without asking
  const players = [['id', 'display_name', 'active', 'google_accounts'],
    ...NAMES.map((n, k) => [`p${String(k + 1).padStart(3, '0')}`, n, true, k === 2 ? DEMO_EMAIL : ''])];
  const aliases = [['name', 'player_id'], ...NAMES.map((n, k) => [n, `p${String(k + 1).padStart(3, '0')}`])];
  return { config, legacy, spiele, players, aliases, corrections: [['game_ref', 'action', 'note']] };
}

/** Stand-in for io/auth.js: always signed in. */
export const DEMO_EMAIL = 'demo@beispiel.at';
const DEMO_FORM = 'https://example.org/demo-formular';
export function demoAuth() {
  return {
    init: async () => {}, ready: () => true, getToken: () => 'demo', signIn: async () => 'demo',
    signOut() {}, expire() {}, onChange: () => () => {},
    state: () => ({ ready: true, signedIn: true, email: DEMO_EMAIL, expiresAt: Infinity, demo: true }),
  };
}

