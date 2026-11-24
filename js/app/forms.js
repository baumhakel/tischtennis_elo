// Which config rows belong to which form, and the answers the app sends (Phase 18a). Pure: no DOM, no network.
// The question IDs are written into `config` by `writeFormIds` (Verwaltung.gs); the app never hard-codes them.
//
//   formReady(cfg, form)          every question ID of that form is set → the app can enter it itself
//   entriesFor(cfg, form, answers) → [[question ID, answer] …] for io/forms.js
//   resultAnswers(W, L, nameOf)   winners / losers → the Ergebnis form's answers (display names)
//   canManage(cfg, email)         the signed-in account is in management_accounts
//   ACTIONS                       the six actions of the Verwaltung form (choice text = Verwaltung.gs)

export const FORMS = {
  result: {
    url: 'form_result_url',
    entries: { winner1: 'form_result_entry_winner1', winner2: 'form_result_entry_winner2', loser1: 'form_result_entry_loser1', loser2: 'form_result_entry_loser2' },
  },
  support: {
    url: 'form_support_url',
    entries: { topic: 'form_support_entry_topic', description: 'form_support_entry_description', game: 'form_support_entry_game', name: 'form_support_entry_name' },
  },
  tournament: {   // Phase 18: Turnierergebnis (written by setupTurnier in Turnier.gs)
    url: 'form_tournament_url',
    entries: { tournament: 'form_tournament_entry_tournament', match: 'form_tournament_entry_match', pairing: 'form_tournament_entry_pairing',
      set1: 'form_tournament_entry_set1', set2: 'form_tournament_entry_set2', set3: 'form_tournament_entry_set3', set4: 'form_tournament_entry_set4',
      set5: 'form_tournament_entry_set5', set6: 'form_tournament_entry_set6', set7: 'form_tournament_entry_set7' },
  },
  management: {
    url: 'form_management_url',
    entries: {
      action: 'form_management_entry_action', new_player: 'form_management_entry_new_player', new_account: 'form_management_entry_new_account',
      old_name: 'form_management_entry_old_name', new_name: 'form_management_entry_new_name',
      inactive_player: 'form_management_entry_inactive_player', active_player: 'form_management_entry_active_player',
      merge_from: 'form_management_entry_merge_from', merge_into: 'form_management_entry_merge_into',
      account_player: 'form_management_entry_account_player', account: 'form_management_entry_account',
    },
  },
};

/**
 * The six actions. `label` = the choice of „Aktion“ (must match Verwaltung.gs CONFIG.AKTIONEN exactly),
 * `fields` = the questions of its section, `page` = config row with the section number (for pageHistory).
 */
export const ACTIONS = {
  add:        { label: 'Spieler hinzufügen',     title: 'Spieler hinzufügen',     fields: ['new_player', 'new_account'],     page: 'form_management_page_add' },
  rename:     { label: 'Spieler umbenennen',     title: 'Spieler umbenennen',     fields: ['old_name', 'new_name'],          page: 'form_management_page_rename' },
  activate:   { label: 'Spieler aktivieren',     title: 'Spieler aktivieren',     fields: ['inactive_player'],               page: 'form_management_page_activate' },
  deactivate: { label: 'Spieler deaktivieren',   title: 'Spieler deaktivieren',   fields: ['active_player'],                 page: 'form_management_page_deactivate' },
  merge:      { label: 'Spieler zusammenführen', title: 'Spieler zusammenführen', fields: ['merge_from', 'merge_into'],      page: 'form_management_page_merge' },
  accounts:   { label: 'Google-Konto ändern',    title: 'Google-Konto ändern',    fields: ['account_player', 'account'],     page: 'form_management_page_accounts' },
};

/** Are the form's link and the IDs of the questions needed set? (`fields` = only these questions) */
export function formReady(cfg, form, fields = null) {
  const def = FORMS[form];
  if (!cfg || !def || !cfg[def.url]) return false;
  return (fields || Object.keys(def.entries)).every(f => cfg[def.entries[f]]);
}

/** answers { question key: value } → [[question ID, value] …]; unknown keys and keys without an ID are dropped. */
export function entriesFor(cfg, form, answers) {
  const def = FORMS[form];
  return Object.entries(answers)
    .filter(([k]) => def.entries[k] && cfg[def.entries[k]])
    .map(([k, v]) => [cfg[def.entries[k]], v]);
}

/** Winners and losers (player IDs) → the Ergebnis form's answers, by display name (= the form's choices). */
export function resultAnswers(winners, losers, nameOf) {
  return { winner1: nameOf(winners[0]), winner2: winners[1] ? nameOf(winners[1]) : '', loser1: nameOf(losers[0]), loser2: losers[1] ? nameOf(losers[1]) : '' };
}

/** A tournament match result → the Turnierergebnis answers. sets = [[a, b] …] from the first-named side's view. */
export function tournamentAnswers(tournamentId, match, sets) {
  const out = { tournament: tournamentId, match: String(match.nr), pairing: `${match.a.name} gegen ${match.b.name}` };
  sets.forEach((s, i) => { out[`set${i + 1}`] = `${s[0]}:${s[1]}`; });
  return out;
}

/** The Verwaltung answers for one action: the „Aktion“ choice plus the questions of its section. */
export function managementAnswers(action, fields) {
  const a = ACTIONS[action];
  return { action: a.label, ...Object.fromEntries(a.fields.map(f => [f, fields[f] ?? ''])) };
}

/** Section numbers visited for this action (for pageHistory), or null if the config row is missing. */
export function managementPages(cfg, action) {
  const p = cfg?.[ACTIONS[action]?.page];
  return Number.isInteger(p) ? [0, p] : null;
}

/** Is this signed-in account allowed to see the management pages? (Only hides them: the form protects itself.) */
export function canManage(cfg, email) {
  const list = cfg?.management_accounts;
  if (!email || !Array.isArray(list)) return false;
  return list.some(x => x.toLowerCase() === String(email).toLowerCase());
}

/** Same result (same players on the same sides), whatever the order within a team. */
export const resultKey = (winners, losers) => [winners.slice().sort().join('+'), losers.slice().sort().join('+')].join('>');

/** The newest entry of `log` with this key within `minutes` before nowMs, or null. log = [{ key, at }]. */
export function recentSame(log, key, nowMs, minutes) {
  if (!(minutes > 0)) return null;
  const hit = (log || []).filter(x => x.key === key && nowMs - x.at <= minutes * 60000 && x.at <= nowMs).sort((a, b) => b.at - a.at)[0];
  return hit || null;
}
