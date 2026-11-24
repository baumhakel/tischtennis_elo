// Demo mode (open the app with ?demo): made-up players and games in the exact sheet format,
// so the app can be tried without Google sign-in. Nothing here is real data.

import { CONFIG_DEFAULTS } from '../config.js';
import { nowSerial, formatRef, roundSerial, norm } from '../core/normalize.js';
import { checkManage, applyManage } from '../core/manage.js';

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
  // a little made-up team chemistry, so the Doppel pages have something to show
  const CHEM = { 'Anna+Bernd': 220, 'Clara+David': -200, 'Elif+Felix': 160, 'Greta+Hannes': -140 };
  const chem = xs => (xs.length > 1 ? CHEM[xs.slice().sort().join('+')] || 0 : 0);
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
      const sk = xs => xs.reduce((a, x) => a + skill[NAMES.indexOf(x)], 0) / xs.length + chem(xs);
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
  // a game entered late (Nachgetragen): submitted after the last game, really played about an hour before
  // the sixth-last one, fixed by a `move` row
  const late = spiele.at(-6), lateT = spiele.at(-1)[0] + 10 / 1440, playedT = late[0] - 1 / 24;
  spiele.push([lateT, late[3], late[4], late[1], late[2]]);
  const ref = t => formatRef(roundSerial(t));
  // one game entered twice, 40 seconds apart (shown as „Möglicherweise doppelt eingetragen“)
  const twice = spiele.at(-15);
  spiele.splice(spiele.indexOf(twice) + 1, 0, [twice[0] + 40 / 86400, ...twice.slice(1)]);
  // and one with the wrong opponent, fixed by a `replace` row
  const wrong = spiele.at(-10), right = NAMES.find(n => !wrong.slice(1).includes(n));
  const corrections = [['game_ref', 'action', 'note', 'played_at', 'wrong_player', 'right_player'],
    [ref(lateT), 'move', 'Demo: nachgetragen', ref(playedT), '', ''],
    [ref(wrong[0]), 'replace', 'Demo: falscher Gegner', '', wrong[3], right]];

  const demoValue = { responses_valid_from: cutoff, form_result_url: DEMO_FORM, form_support_url: DEMO_FORM, form_management_url: DEMO_FORM,
    management_accounts: DEMO_EMAIL, ...DEMO_IDS };
  const config = [['key', 'value', 'note'], ...Object.entries(CONFIG_DEFAULTS)
    .map(([k, d]) => [k, k in demoValue ? demoValue[k] : d.value, 'Demo'])];
  // the demo account is mapped to the third player, so „Ich“ works without asking
  const players = [['id', 'display_name', 'active', 'google_accounts'],
    ...NAMES.map((n, k) => [`p${String(k + 1).padStart(3, '0')}`, n, true, k === 2 ? DEMO_EMAIL : ''])];
  const aliases = [['name', 'player_id'], ...NAMES.map((n, k) => [n, `p${String(k + 1).padStart(3, '0')}`])];
  const management_log = [['timestamp', 'action', 'player_id', 'old_value', 'new_value', 'submitted_by', 'status'],
    ...NAMES.map((n, k) => [cutoff - 30, 'add', `p${String(k + 1).padStart(3, '0')}`, '', n, 'legacy migration', 'ok'])];
  return { config, legacy, spiele, players, aliases, corrections, management_log };
}

// Made-up question IDs, so the demo shows the pages that enter in the app (nothing is sent anywhere)
const DEMO_IDS = Object.fromEntries([
  'result_entry_winner1', 'result_entry_winner2', 'result_entry_loser1', 'result_entry_loser2',
  'support_entry_topic', 'support_entry_description', 'support_entry_game', 'support_entry_name',
  'management_entry_action', 'management_entry_new_player', 'management_entry_new_account', 'management_entry_old_name',
  'management_entry_new_name', 'management_entry_inactive_player', 'management_entry_active_player', 'management_entry_merge_from',
  'management_entry_merge_into', 'management_entry_account_player', 'management_entry_account',
].map((k, i) => ['form_' + k, String(1000 + i)]));

/**
 * Demo stand-in for sending forms (Phase 18a): nothing goes over the network. A result becomes a new row in
 * „Spiele“, a Verwaltung action is checked and done like Verwaltung.gs (with a row in management_log), the next
 * time the demo data is read. So the whole flow incl. „Angekommen“ works without Google.
 *   submit('result', { winner1, winner2, loser1, loser2 }) · submit('support', …) · submit('management', { action, fields })
 *   apply(raw) → raw with everything submitted so far
 */
export function demoForms(timeZone) {
  const ops = [];
  return {
    async submit(form, answers) { ops.push({ form, answers, t: nowSerial(timeZone) }); },
    apply(raw) {
      for (const op of ops) {
        if (op.form === 'result') {
          const a = op.answers;
          raw.spiele.push([op.t, a.winner1, a.winner2 || '', a.loser1, a.loser2 || '']);
        } else if (op.form === 'management') manageRaw(raw, op);
      }
      return raw;
    },
  };
}

function manageRaw(raw, { answers: { action, fields }, t }) {
  const rows = raw.players.slice(1);
  const taken = new Set([...raw.aliases.slice(1).map(r => norm(r[0])), ...rows.map(r => norm(r[1]))]);
  const db = { players: rows.map(r => ({ id: r[0], name: r[1], active: r[2] !== false, accounts: r[3] ? String(r[3]).split(/,\s*/) : [] })), taken };
  const reason = checkManage(db, action, fields);
  const [old, neu] = { add: ['', fields.new_player], rename: [fields.old_name, fields.new_name], activate: [fields.inactive_player, 'TRUE'],
    deactivate: [fields.active_player, 'FALSE'], merge: [fields.merge_from, fields.merge_into], accounts: [fields.account_player, fields.account] }[action] || ['', ''];
  const log = [t, action, '', old, neu, DEMO_EMAIL, reason ? `refused: ${reason}` : 'ok'];
  if (!reason) {
    const used = [...rows.map(r => r[0]), ...raw.aliases.slice(1).map(r => r[1]), ...raw.management_log.slice(1).map(r => r[2])];
    const max = Math.max(0, ...used.map(id => Number(/^p(\d+)$/.exec(id)?.[1] || 0)));
    const next = applyManage(db, action, fields, () => `p${String(max + 1).padStart(3, '0')}`);
    raw.players = [raw.players[0], ...next.players.map(p => [p.id, p.name, p.active, p.accounts.join(', ')])];
    for (const [from, into] of next.moves) for (const r of raw.aliases) if (r[1] === from) r[1] = into;
    raw.aliases.push(...next.aliases);
  }
  raw.management_log.push(log);
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

