// Static app constants. No side effects: safe to import from core/ (browser, worker, Node).

export const APP_VERSION = '2.0.0-dev.7';   // bump to invalidate the browser cache

// >>> FILL IN: OAuth client ID (ends in .apps.googleusercontent.com)
export const CLIENT_ID = '975581090195-pgfv9ptq40fkp728151hqpru116pg732.apps.googleusercontent.com';

// Same sheet as in Verwaltung.gs. Public is fine: reading needs sign-in + sharing.
export const SPREADSHEET_ID = '1zdOvoRee2icshaSQLdiTZmFX8YebBgEtNUZ7wPRa5do';

// Time zone of the spreadsheet (File → Settings). Serial date-times are wall-clock in this zone.
export const SHEET_TIMEZONE = 'Europe/Vienna';

export const TABS = {
  config: 'config',
  legacy: 'legacy',
  spiele: 'Spiele',
  players: 'players',
  aliases: 'aliases',
  corrections: 'corrections',
};

// Column headers per tab, matched case-insensitively (trimmed, spaces collapsed).
// Each entry lists accepted header spellings; the first one is canonical.
export const COLUMNS = {
  config:      { key: ['key'], value: ['value'] },
  legacy:      { timestamp: ['timestamp'], w1: ['winner1'], w2: ['winner2'],
                 l1: ['loser1'], l2: ['loser2'], source_row: ['source_row'] },
  spiele:      { timestamp: ['Zeitstempel', 'Timestamp'], w1: ['Sieger 1'], w2: ['Sieger 2'],
                 l1: ['Verlierer 1'], l2: ['Verlierer 2'] },
  players:     { id: ['id'], display_name: ['display_name'], active: ['active'], google_accounts: ['google_accounts'] },
  aliases:     { name: ['name'], player_id: ['player_id'] },
  corrections: { game_ref: ['game_ref'], action: ['action'], note: ['note'] },
};

// Optional columns: missing ones are not an error.
export const OPTIONAL_COLUMNS = {
  legacy: ['source_row'],
  corrections: ['note'],
  players: ['google_accounts'],
};

// Keys of the `config` tab in the sheet. RULE: every tunable constant of the app is a key here
// and a row in the config tab. The LIVE values always come from that tab; `value` is only a
// fallback for a key that is missing, empty or invalid there (the loader then raises an issue).
// `type` drives parsing; `min`/`max` bound valid numbers (inclusive).
export const CONFIG_DEFAULTS = {
  // data + Elo
  responses_valid_from:          { type: 'datetime', value: null },  // set in the sheet: 2026-11-17 08:00:00
  k_single:                      { type: 'number',  value: 40,   min: 0.001 },
  k_double:                      { type: 'number',  value: 20,   min: 0.001 },
  start_rating:                  { type: 'number',  value: 1400, min: 0.001 },
  asymptotic_init:               { type: 'boolean', value: false },
  asymptotic_init_rounds:        { type: 'integer', value: 5,    min: 1 },
  // filters
  default_min_games:             { type: 'integer', value: 20,   min: 0 },
  default_min_games_single:      { type: 'integer', value: 15,   min: 0 },   // min-games default in the Einzel mode
  default_min_games_double:      { type: 'integer', value: 10,   min: 0 },   // … in the Doppel mode
  default_inactivity_days:       { type: 'integer', value: 30,   min: 0 },   // 0 = filter off
  // dashboard
  dashboard_days:                { type: 'integer', value: 7,    min: 1 },   // curves, Δ in leaderboard, recent upset
  dashboard_games:               { type: 'integer', value: 50,   min: 1 },   // curves: last N games if that covers more
  leaderboard_form_results:      { type: 'integer', value: 5,    min: 1 },   // last results shown per player
  rising_star_days:              { type: 'integer', value: 7,    min: 1 },
  rising_star_min_games:         { type: 'integer', value: 3,    min: 1 },   // own games within those days
  // statistics
  form_games:                    { type: 'integer', value: 10,   min: 1 },
  best_run_max_games:            { type: 'integer', value: 50,   min: 1 },
  smooth_sd_games:               { type: 'number',  value: 20,   min: 0.001 }, // Gaussian SD on game axes
  smooth_sd_days:                { type: 'number',  value: 14,   min: 0.001 }, // Gaussian SD on the date axis
  movement_window:               { type: 'integer', value: 50,   min: 1 },
  movement_calm_percentile:      { type: 'number',  value: 25,   min: 0, max: 100 },
  movement_turbulent_percentile: { type: 'number',  value: 75,   min: 0, max: 100 },
  h2h_min_games:                 { type: 'integer', value: 5,    min: 1 },
  team_min_games:                { type: 'integer', value: 5,    min: 1 },   // doubles together before a team is ranked
  calibration_bins:              { type: 'integer', value: 10,   min: 1 },
  upsets_list_length:            { type: 'integer', value: 20,   min: 1 },   // rows in the Überraschungen view
  recent_games:                  { type: 'integer', value: 3,    min: 1 },   // Letzte Spiele (Übersicht, profile)
  recent_games_expanded:         { type: 'integer', value: 10,   min: 1 },   // … after „Mehr anzeigen“
  games_page_size:               { type: 'integer', value: 50,   min: 1 },   // Alle Spiele: rows per „Weitere laden“
  focus_default_count:           { type: 'integer', value: 3,    min: 0, max: 8 }, // players highlighted when none chosen
  // app shell
  default_x_axis:                { type: 'enum',    value: 'game', options: ['date', 'game', 'own'] },
  auto_refresh_seconds:          { type: 'integer', value: 60,   min: 0 },   // reload on return to the app if older; 0 = off
  // form links (Phase 10): only in the sheet, never in this public code. optional: empty = no link, no issue
  form_result_url:               { type: 'url',     value: '', optional: true },   // Ergebnis form
  form_support_url:              { type: 'url',     value: '', optional: true },   // Support form
  form_management_url:           { type: 'url',     value: '', optional: true },   // Verwaltung form
  // Tisch (Phase 11): question IDs of the Ergebnis form for pre-filled result links (optional, only in the sheet)
  form_result_entry_winner1:     { type: 'string',  value: '', optional: true },
  form_result_entry_winner2:     { type: 'string',  value: '', optional: true },
  form_result_entry_loser1:      { type: 'string',  value: '', optional: true },
  form_result_entry_loser2:      { type: 'string',  value: '', optional: true },
  suggestions_count:             { type: 'integer', value: 5,    min: 1 },   // Tisch: „Wer sollte als Nächstes spielen?“
  suggestions_recent_days:       { type: 'integer', value: 28,   min: 1 },   // … pairs that rarely met in these days get a bonus
  // Abzeichen (Phase 12). Lists: comma-separated; a longer list = more levels, no code change needed.
  achievement_tier_names:        { type: 'names',   value: ['Gebietsliga', 'Landesliga', 'Bundesliga', 'Champions League', 'Universumsliga', 'Götterliga'] },
  achievement_rank_min_games:    { type: 'integer', value: 20,   min: 0 },   // Platz for badges: min games by then …
  achievement_rank_active_days:  { type: 'integer', value: 30,   min: 1 },   // … and a game within these days
  achievement_games_levels:      { type: 'list',    value: [50, 250, 500, 1000], min: 1 },
  achievement_days_levels:       { type: 'list',    value: [10, 50, 100, 200], min: 1 },
  achievement_weeks_levels:      { type: 'list',    value: [4, 12, 26], min: 1 },
  achievement_opponents_levels:  { type: 'list',    value: [5, 10, 15], min: 1 },
  achievement_all_beaten_min:    { type: 'integer', value: 8,    min: 1 },   // Alle besiegt / Jeden fünfmal: at least this many opponents
  achievement_each_wins:         { type: 'integer', value: 5,    min: 1 },   // Jeden fünfmal: wins against each …
  achievement_each_min_games:    { type: 'integer', value: 10,   min: 1 },   // … opponent with at least this many singles
  achievement_win_streak_levels: { type: 'list',    value: [5, 8, 12], min: 1 },
  achievement_comeback_losses:   { type: 'integer', value: 4,    min: 1 },
  achievement_subscription_wins: { type: 'integer', value: 5,    min: 1 },   // Abo
  achievement_perfect_week_wins: { type: 'integer', value: 5,    min: 1 },
  achievement_giant_chance_levels: { type: 'list',  value: [0.3, 0.2, 0.1], min: 0, max: 1 },
  achievement_underdog_streak:   { type: 'integer', value: 3,    min: 1 },
  achievement_unlucky_chance:    { type: 'number',  value: 0.9,  min: 0.5, max: 1 },
  achievement_podium_rank:       { type: 'integer', value: 3,    min: 1 },   // Aufs Podest
  achievement_leader_days_levels: { type: 'list',   value: [7, 30, 90], min: 1 },
  achievement_elo_levels:        { type: 'list',    value: [1500, 1550, 1600, 1650], min: 0 },
  achievement_rocket_points:     { type: 'number',  value: 50,   min: 1 },
  achievement_rising_star_levels: { type: 'list',   value: [1, 3, 10], min: 1 },
  achievement_balanced_levels:   { type: 'list',    value: [5, 10], min: 1 },
  achievement_duel_levels:       { type: 'list',    value: [50, 100], min: 1 },
  achievement_partner_levels:    { type: 'list',    value: [3, 6, 10], min: 1 },
  achievement_dream_team_wins:   { type: 'integer', value: 20,   min: 1 },
  achievement_early_hour:        { type: 'number',  value: 8,    min: 0, max: 24 },
  achievement_late_hour:         { type: 'number',  value: 17,   min: 0, max: 24 },
  achievement_marathon_games:    { type: 'integer', value: 6,    min: 2 },
  achievement_busy_day_games:    { type: 'integer', value: 10,   min: 2 },
  achievement_lucky_numbers:     { type: 'list',    value: [1444, 1555, 1666], min: 0 },
  achievement_balance_min_games: { type: 'integer', value: 50,   min: 2 },
  achievement_jubilee_games:     { type: 'integer', value: 100,  min: 1 },
  session_gap_minutes:           { type: 'integer', value: 20,   min: 1 },   // Abzeichen (Marathon), later the Labor
};

// ───────── Technical constants (not in the config tab) ─────────
// These are needed before the config tab can be read (sign-in, the request that reads it)
// or are storage names, so they cannot live in the sheet.
export const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
export const TOKEN_MARGIN_SECONDS = 60;   // treat the access token as expired this much earlier
export const FETCH_TIMEOUT_MS = 20000;    // give up on the Sheets request after this
export const STORAGE_PREFIX = 'tt-elo';   // localStorage keys and IndexedDB name
