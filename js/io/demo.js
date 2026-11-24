// Demo mode (open the app with ?demo): made-up players and games in the exact sheet format,
// so the app can be tried without Google sign-in. Nothing here is real data.

import { CONFIG_DEFAULTS } from '../config.js';
import { nowSerial, formatRef, roundSerial, norm } from '../core/normalize.js';
import { checkManage, applyManage } from '../core/manage.js';
import { load } from '../core/loader.js';

const ALL_NAMES = ['Anna', 'Bernd', 'Clara', 'David', 'Elif', 'Felix', 'Greta', 'Hannes', 'Ida', 'Jonas', 'Kira', 'Lukas', 'Mira', 'Noah', 'Olga'];

/**
 * Deterministic fake RawSheets, legacy + Spiele.
 * size 'klein' (default): 12 players, ~370 games over 16 weeks.
 * size 'gross': 15 players, ~2000 games over two years (the real league's size, for performance checks).
 * size 'turnier': like 'klein', plus a tournament going on today (about a third played), for trying Phase 18.
 * Every size has a finished tournament a month ago (Phase 18).
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

  const demoValue = { responses_valid_from: cutoff, form_result_url: DEMO_FORM, form_support_url: DEMO_FORM, form_management_url: DEMO_FORM, form_tournament_url: DEMO_FORM,
    management_accounts: DEMO_EMAIL, photos_url: 'https://example.org/demo-fotos', ...DEMO_IDS };
  const config = [['key', 'value', 'note'], ...Object.entries(CONFIG_DEFAULTS)
    .map(([k, d]) => [k, k in demoValue ? demoValue[k] : d.value, 'Demo'])];
  // the demo account is mapped to the third player, so „Ich“ works without asking
  const players = [['id', 'display_name', 'active', 'google_accounts'],
    ...NAMES.map((n, k) => [`p${String(k + 1).padStart(3, '0')}`, n, true, k === 2 ? DEMO_EMAIL : ''])];
  const aliases = [['name', 'player_id'], ...NAMES.map((n, k) => [n, `p${String(k + 1).padStart(3, '0')}`])];
  const management_log = [['timestamp', 'action', 'player_id', 'old_value', 'new_value', 'submitted_by', 'status'],
    ...NAMES.map((n, k) => [cutoff - 30, 'add', `p${String(k + 1).padStart(3, '0')}`, '', n, 'legacy migration', 'ok'])];
  // Phase 18b: made-up photos (drawn by io/demo-photos.js): profile pictures for most players (not Clara, so the
  // demo account can add one), and photos of a few recent games
  const fotos = [['id', 'kind', 'ref', 'file_id', 'thumb_id', 'width', 'height', 'caption', 'uploaded_by', 'uploaded_at', 'deleted_at', 'deleted_by']];
  let n = 0;
  const foto = (kind, ref, w, h, caption, at) => { n++; const id = `f${String(n).padStart(4, '0')}`; fotos.push([id, kind, ref, 'demo', 'demo', w, h, caption, DEMO_EMAIL, at, '', '']); return id; };
  NAMES.forEach((name, k) => { if (k !== 2 && k % 4 !== 3) foto('spieler', `p${String(k + 1).padStart(3, '0')}`, 512, 512, '', cutoff - 20 + k / 10); });
  const lastSpiele = spiele.filter(r => typeof r[0] === 'number' && r[0] >= cutoff);
  [[2, 'Matchball!'], [2, ''], [5, 'Revanche geglückt'], [11, ''], [24, 'Das war knapp']].forEach(([back, caption], i) => {
    const r = lastSpiele.at(-back);
    if (r) foto('spiel', ref(r[0]), i % 2 ? 900 : 1200, i % 2 ? 1200 : 900, caption, r[0] + 0.002);
  });
  const raw = { config, legacy, spiele, players, aliases, corrections, management_log, fotos };
  demoTournaments(raw, { now, rnd, skill: name => skill[NAMES.indexOf(name)] ?? 150, names: NAMES, live: size === 'turnier', foto });
  return raw;
}

// Phase 18: made-up tournaments. „herbst“: a month ago, finished (9 members and two guests, three uneven groups,
// two per group into the knockout, so with byes). „advent“ (?demo=turnier): today, a third of the matches played.
// Results are played out with the real core (load), so the match numbers are the ones the app shows.
function demoTournaments(raw, { now, rnd, skill, names, live, foto }) {
  const guests = { Paul: 120, Sophie: 260 };
  const strength = n => guests[n] ?? skill(n);
  raw.turniere = [['id', 'name', 'datum', 'status', 'art', 'gruppen', 'gruppengroessen', 'weiter_pro_gruppe', 'saetze', 'punkte_pro_satz', 'spiel_um_platz_3', 'tische', 'setzstichtag', 'los', 'siegerfoto']];
  raw.turnier_teilnehmer = [['turnier_id', 'name', 'setzplatz', 'gruppe', 'name_2']];
  raw.turnier_ergebnisse = [['Zeitstempel', 'Turnier', 'Spiel-Nr.', 'Begegnung', 'Satz 1', 'Satz 2', 'Satz 3', 'Satz 4', 'Satz 5', 'Satz 6', 'Satz 7']];
  let day = now - 30;
  while (((day - 2) % 7 + 7) % 7 > 4) day--;                          // a weekday
  const plan = [{ id: 'herbst', name: 'Herbstturnier', day, status: 'beendet', groups: 3, players: [...names.slice(0, 9), 'Paul', 'Sophie'], share: 1 }];
  if (live) plan.push({ id: 'advent', name: 'Adventturnier', day: now, status: 'aktiv', groups: 2, players: [...names.slice(0, 9), 'Paul'], share: 0.35 });
  for (const T of plan) {
    raw.turniere.push([T.id, T.name, T.day, T.status, 'einzel', T.groups, '', '2', 'Gruppe 3, Halbfinale 5, Spiel um Platz 3 5, Finale 5', 11, 'ja', 2, T.day, 1, '']);
    for (const n of T.players) raw.turnier_teilnehmer.push([T.id, n, '', '', '']);
  }
  for (const T of plan) {
    let t = T.day + 12 / 24, played = 0, state;
    for (let round = 0; round < 40; round++) {
      state = load(raw).tournaments.find(x => x.id === T.id);
      const open = state.matches.filter(m => m.status === 'offen');
      const goal = Math.round(state.total * T.share);
      if (!open.length || played >= goal) break;
      for (const m of open.slice(0, goal - played)) {
        const p = 1 / (1 + 10 ** ((strength(m.b.name) - strength(m.a.name)) / 400));
        raw.turnier_ergebnisse.push([t += (7 + rnd() * 8) / 1440, T.id, m.nr, `${m.a.name} gegen ${m.b.name}`, ...demoSets(m.bestOf, rnd() < p, rnd)]);
        played++;
      }
    }
    if (T.status === 'aktiv') {   // the results so far end a few minutes ago
      const rows = raw.turnier_ergebnisse.filter(r => r[1] === T.id), shift = rows.length ? rows.at(-1)[0] - (nowSerialOf(now) - 6 / 1440) : 0;
      for (const r of rows) r[0] -= shift;
    } else {
      foto('turnier', T.id, 1200, 900, 'Alle zusammen', T.day + 0.74);
      const winnerShot = foto('turnier', T.id, 900, 1200, 'Der Sieger mit Pokal', T.day + 0.75);
      raw.turniere.find(r => r[0] === T.id)[14] = winnerShot;
      const fin = state.matches.find(m => m.label === 'Finale');
      if (fin?.result) foto('turnier_spiel', `${T.id}#${fin.nr}`, 900, 1200, 'Der Matchball im Finale', fin.result.t + 0.001);
    }
  }
}
const nowSerialOf = day => day + 15.5 / 24;   // „now“ in the live demo tournament: mid-afternoon of today

/** Sets of one match, side a wins if aWins: [ '11:7', … , '' …] (seven cells). */
function demoSets(bestOf, aWins, rnd) {
  const need = Math.floor(bestOf / 2) + 1, out = [];
  let a = 0, b = 0;
  while (a < need && b < need) {
    const aSet = rnd() < (aWins ? 0.7 : 0.3);
    const lo = rnd() < 0.2 ? 10 + Math.floor(rnd() * 3) : Math.floor(rnd() * 10);
    const hi = lo >= 10 ? lo + 2 : 11;
    out.push(aSet ? `${hi}:${lo}` : `${lo}:${hi}`);
    if (aSet) a++; else b++;
    if (a === need - 1 && b === need - 1) continue;
  }
  // the winner must be the planned one: if not, swap every set
  if ((a > b) !== aWins) for (let i = 0; i < out.length; i++) out[i] = out[i].split(':').reverse().join(':');
  while (out.length < 7) out.push('');
  return out;
}

// Made-up question IDs, so the demo shows the pages that enter in the app (nothing is sent anywhere)
const DEMO_IDS = Object.fromEntries([
  'result_entry_winner1', 'result_entry_winner2', 'result_entry_loser1', 'result_entry_loser2',
  'support_entry_topic', 'support_entry_description', 'support_entry_game', 'support_entry_name',
  'management_entry_action', 'management_entry_new_player', 'management_entry_new_account', 'management_entry_old_name',
  'management_entry_new_name', 'management_entry_inactive_player', 'management_entry_active_player', 'management_entry_merge_from',
  'management_entry_merge_into', 'management_entry_account_player', 'management_entry_account',
  'tournament_entry_tournament', 'tournament_entry_match', 'tournament_entry_pairing', 'tournament_entry_set1', 'tournament_entry_set2',
  'tournament_entry_set3', 'tournament_entry_set4', 'tournament_entry_set5', 'tournament_entry_set6', 'tournament_entry_set7',
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
  const files = new Map();   // photo id → { image, thumb } uploaded in the demo
  return {
    async submit(form, answers) { ops.push({ form, answers, t: nowSerial(timeZone) }); },
    /** Phase 18b: a photo „uploaded“ in the demo; returns its ID (after the made-up ones). */
    addPhoto({ kind, ref, image, thumb, width, height, caption = '' }) {
      const id = `f${String(100 + files.size).padStart(4, '0')}`;
      files.set(id, { image, thumb });
      ops.push({ form: 'photo', answers: { id, kind, ref, width, height, caption }, t: nowSerial(timeZone) });
      return id;
    },
    removePhoto(id) { ops.push({ form: 'photo-delete', answers: { id }, t: nowSerial(timeZone) }); },
    setWinnerPhoto(id, tournament) { ops.push({ form: 'photo-winner', answers: { id, tournament }, t: nowSerial(timeZone) }); },
    photoFile: (id, size) => files.get(id)?.[size === 'full' ? 'image' : 'thumb'] || null,
    apply(raw) {
      for (const op of ops) {
        if (op.form === 'result') {
          const a = op.answers;
          raw.spiele.push([op.t, a.winner1, a.winner2 || '', a.loser1, a.loser2 || '']);
        } else if (op.form === 'management') manageRaw(raw, op);
        else if (op.form === 'tournament') {
          const a = op.answers;
          raw.turnier_ergebnisse ||= [['Zeitstempel', 'Turnier', 'Spiel-Nr.', 'Begegnung', 'Satz 1', 'Satz 2', 'Satz 3', 'Satz 4', 'Satz 5', 'Satz 6', 'Satz 7']];
          raw.turnier_ergebnisse.push([op.t, a.tournament, Number(a.match), a.pairing, ...[1, 2, 3, 4, 5, 6, 7].map(i => a[`set${i}`] || '')]);
        }
        else if (op.form === 'photo') {
          const a = op.answers;
          raw.fotos.push([a.id, a.kind, a.ref, 'demo', 'demo', a.width, a.height, a.caption, DEMO_EMAIL, op.t, '', '']);
        } else if (op.form === 'photo-winner') {
          const row = raw.turniere?.find(r => r[0] === op.answers.tournament);
          if (row) row[14] = op.answers.id;
        } else if (op.form === 'photo-delete') {
          const row = raw.fotos.find(r => r[0] === op.answers.id);
          if (row) { row[10] = op.t; row[11] = DEMO_EMAIL; }
        }
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

