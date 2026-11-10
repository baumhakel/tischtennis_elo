// Static app constants. No side effects: safe to import from core/ (browser, worker, Node).

export const APP_VERSION = '2.0.0-dev.1';   // bump to invalidate the browser cache

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
  players:     { id: ['id'], display_name: ['display_name'], active: ['active'] },
  aliases:     { name: ['name'], player_id: ['player_id'] },
  corrections: { game_ref: ['game_ref'], action: ['action'], note: ['note'] },
};

// Optional columns: missing ones are not an error.
export const OPTIONAL_COLUMNS = {
  legacy: ['source_row'],
  corrections: ['note'],
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
  focus_default_count:           { type: 'integer', value: 3,    min: 0, max: 8 }, // players highlighted when none chosen
  // app shell
  default_x_axis:                { type: 'enum',    value: 'game', options: ['date', 'game', 'own'] },
  auto_refresh_seconds:          { type: 'integer', value: 60,   min: 0 },   // reload on return to the app if older; 0 = off
};

// ───────── Technical constants (not in the config tab) ─────────
// These are needed before the config tab can be read (sign-in, the request that reads it)
// or are storage names, so they cannot live in the sheet.
export const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
export const TOKEN_MARGIN_SECONDS = 60;   // treat the access token as expired this much earlier
export const FETCH_TIMEOUT_MS = 20000;    // give up on the Sheets request after this
export const STORAGE_PREFIX = 'tt-elo';   // localStorage keys and IndexedDB name
