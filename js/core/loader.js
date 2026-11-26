// Loader: raw cell grids from the sheet → Dataset. Pure: no DOM, no network.
//
// Steps (base prompt "Loading and merging", with corrections applied before name mapping):
//   1. config → typed values with defaults
//   2. players + aliases → ID lookup by normalised name
//   3. legacy + Spiele rows → one schema; Spiele rows before responses_valid_from dropped
//   4. corrections (void / swap / move / replace) matched by game_ref; move sets the time to played_at, the ref
//      stays; replace puts right_player in place of wrong_player
//   5. names → IDs, shape check (1v1 or 2v2), no player twice in one game
//   6. sort by time, legacy first on ties, then sheet row; assign g; hash
// Bad data never throws: it becomes an Issue and the affected row is skipped.

import { COLUMNS, OPTIONAL_COLUMNS, CONFIG_DEFAULTS, TABS } from '../config.js';
import {
  clean, norm, toBool, toNumber, parseTime, hasTimeOfDay, roundSerial, formatRef, serialToParts, readTable, cell, fnv1a,
} from './normalize.js';
import { parsePhotos } from './photos.js';
import { parseTournamentTabs, buildTournament, tournamentGames, seedRatings } from './tournament.js';

/** @typedef {import('../types.js').RawSheets} RawSheets */
/** @typedef {import('../types.js').Dataset} Dataset */
/** @typedef {import('../types.js').Issue} Issue */

const SOURCE_ORDER = { legacy: 0, spiele: 1, turnier: 2 };
const MAX_REFS_IN_ISSUE = 5;

/**
 * @param {RawSheets} raw
 * @returns {Dataset}
 */
export function load(raw) {
  /** @type {Issue[]} */
  const issues = [];
  const report = (level, kind, message, extra = {}) => issues.push({ level, kind, message, ...extra });
  const counts = { legacyRows: 0, spieleRows: 0, beforeCutoff: 0, voided: 0, swapped: 0, moved: 0, replaced: 0, skipped: 0, games: 0 };

  const config = parseConfig(raw.config, report);
  const { players, idByName } = parsePlayers(raw.players, raw.aliases, report);

  // 3. game rows from both sources
  const legacy = parseGameRows('legacy', raw.legacy, report, counts);
  const spiele = parseGameRows('spiele', raw.spiele, report, counts);
  counts.legacyRows = legacy.total;
  counts.spieleRows = spiele.total;

  const cutoff = config.responses_valid_from;
  let rows;
  if (cutoff == null) {
    // Safety net only: the key is set in the config tab. If it ever goes missing, show
    // everything rather than nothing, and say so loudly.
    report('error', 'missing_cutoff',
      '„responses_valid_from“ fehlt im Tab „config“ oder ist ungültig. Deshalb werden alle Formulareinträge gewertet, auch Testeinträge.',
      { tab: TABS.config });
    rows = [...legacy.rows, ...spiele.rows];
  } else {
    const kept = spiele.rows.filter(r => r.t >= cutoff);
    counts.beforeCutoff = spiele.rows.length - kept.length;
    const late = legacy.rows.filter(r => r.t >= cutoff);
    if (late.length) {
      report('warning', 'legacy_after_cutoff',
        `${late.length} ${late.length === 1 ? 'Spiel aus den Altdaten liegt' : 'Spiele aus den Altdaten liegen'} nicht vor „responses_valid_from“ (${formatRef(cutoff)}).`,
        { tab: TABS.legacy, count: late.length, ref: late[0].ref, row: late[0].row });
    }
    rows = [...legacy.rows, ...kept];
  }

  // tournaments (Phase 18): read first, so corrections can void a tournament result by its Zeitstempel
  const tour = parseTournamentTabs(raw, idByName, report);
  for (const r of tour.results) r.tournamentResult = true;

  // 4. corrections
  applyCorrections(raw.corrections, rows, report, counts, idByName, tour.results);

  // 5. map names → IDs, validate
  const unknown = new Map();   // norm(name) → { name, count, refs[] }
  const games = [];
  for (const r of rows) {
    if (r.voided) continue;
    const game = toGame(r, idByName, unknown, report);
    if (game) games.push(game);
    else counts.skipped++;
  }
  for (const u of unknown.values()) {
    report('error', 'unknown_name',
      `Unbekannter Name „${u.name}“ (${u.count} ${u.count === 1 ? 'Spiel' : 'Spiele'}): steht nicht im Tab „aliases“. ${u.count === 1 ? 'Dieses Spiel wird' : 'Diese Spiele werden'} nicht gewertet.`,
      { name: u.name, count: u.count, ref: u.refs.join(', ') });
  }

  // tournaments: draw with the Elo-Werte at setzstichtag, then member-vs-member matches become games
  const order = (a, b) => a.t - b.t || SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || a.row - b.row;
  games.sort(order);
  const results = tour.results.filter(r => !r.voided);
  const tournaments = [];
  for (const T of tour.list.slice().sort((a, b) => (a.date ?? Infinity) - (b.date ?? Infinity))) {
    if (T.status === 'entwurf') continue;
    const ratings = seedRatings(games, config, T.seedAt, T.seedLeague);   // Phase 18c: setzwertung (alle · einzel · doppel)
    const state = buildTournament(T, results, { ratings, startRating: config.start_rating });
    for (const i of state.issues) {
      report('warning', 'tournament_result', `Turnier „${T.name}“, Tab „turnier_ergebnisse“: ${i.text}`, { tab: TABS.turnier_ergebnisse, row: i.row });
    }
    if (!state.ok && state.problem) report('info', 'tournament', `Turnier „${T.name}“: ${state.problem}`, { tab: TABS.turniere, row: T.row });
    for (const tg of tournamentGames(state)) {
      games.push({ g: -1, t: tg.t, ref: tg.ref, source: 'turnier', row: tg.row, winners: tg.winners, losers: tg.losers,
        double: tg.double, approxTime: false, tournament: tg.tournament });
      counts.tournamentGames = (counts.tournamentGames || 0) + 1;
    }
    games.sort(order);
    tournaments.push(state);
  }

  // 6. index, hash
  games.sort(order);
  games.forEach((g, i) => { g.g = i; });
  counts.games = games.length;
  flagDuplicates(games, config.duplicate_window_minutes, report);

  const log = parseLog(raw.management_log);
  const photos = parsePhotos(raw.fotos, players);   // Phase 18b
  // every name ever used (aliases + display names, normalised): a new name must not be one of them (core/manage.js)
  const takenNames = [...idByName.keys()];
  // every setting and participant of every tournament (Phase 18c: a changed setting must show at once)
  const tourHash = fnv1a(JSON.stringify([tour.list, results.map(r => [r.row, r.t, r.tournament, r.nr, r.sets])]));
  return { config, players, games, issues, counts, takenNames, log, photos, tournaments,
    hash: datasetHash(config, players, games, log, photos, tourHash) };
}

// ───────── management_log (Phase 18a) ─────────

/** The Verwaltung script's log, oldest first: [{ t, action, player, old, new, status }]. A missing tab = []. */
function parseLog(grid) {
  if (!grid || !grid.length) return [];
  const t = readTable(grid, COLUMNS.management_log);
  if (t.missing.length) return [];
  return t.rows.map(({ cells, row }) => ({
    row, t: parseTime(cell(cells, t.col.timestamp)), action: clean(cell(cells, t.col.action)), player: clean(cell(cells, t.col.player_id)),
    old: clean(cell(cells, t.col.old_value)), new: clean(cell(cells, t.col.new_value)), status: clean(cell(cells, t.col.status)),
  }));
}

// ───────── 1. config ─────────

function parseConfig(grid, report) {
  const config = Object.fromEntries(Object.entries(CONFIG_DEFAULTS).map(([k, d]) => [k, d.value]));
  if (!grid || !grid.length) return config;   // no config tab → all defaults

  const t = readTable(grid, COLUMNS.config);
  if (t.missing.length) {
    report('error', 'missing_column',
      `Im Tab „${TABS.config}“ fehlt die Spalte ${t.missing.join(', ')}. Es werden die Standardwerte verwendet.`,
      { tab: TABS.config });
    return config;
  }
  const set = new Set();
  for (const { cells, row } of t.rows) {
    const key = norm(cell(cells, t.col.key));
    const def = CONFIG_DEFAULTS[key];
    if (!def) continue;                         // unknown keys are ignored
    const v = cell(cells, t.col.value);
    if (clean(v) === '') continue;              // empty → default (reported below)
    const parsed = parseConfigValue(def, v);
    if (parsed === undefined) {
      report('warning', 'bad_config',
        `Der Wert „${clean(v)}“ für „${key}“ ist ungültig${range(def)}. Es wird der Standardwert ${def.value ?? '(leer)'} verwendet.`,
        { tab: TABS.config, row, name: key });
    } else {
      config[key] = parsed;
      set.add(key);
    }
  }
  if (config.movement_calm_percentile > config.movement_turbulent_percentile) {
    report('warning', 'bad_config',
      '„movement_calm_percentile“ ist größer als „movement_turbulent_percentile“. Es werden die Standardwerte verwendet.',
      { tab: TABS.config });
    config.movement_calm_percentile = CONFIG_DEFAULTS.movement_calm_percentile.value;
    config.movement_turbulent_percentile = CONFIG_DEFAULTS.movement_turbulent_percentile.value;
  }
  const missing = Object.keys(CONFIG_DEFAULTS)
    .filter(k => !set.has(k) && k !== 'responses_valid_from')   // the cutoff has its own error issue
    .filter(k => !CONFIG_DEFAULTS[k].optional)                   // optional keys: empty = feature off
    .filter(k => !t.rows.some(({ cells }) => norm(cell(cells, t.col.key)) === k && clean(cell(cells, t.col.value)) !== ''));
  for (const key of missing) {
    report('warning', 'missing_config',
      `„${key}“ fehlt im Tab „config“. Bitte die Zeile ergänzen; bis dahin gilt der Standardwert ${CONFIG_DEFAULTS[key].value}.`,
      { tab: TABS.config, name: key });
  }
  return config;
}

const range = def => def.options ? ` (erlaubt: ${def.options.join(', ')})`
  : (def.min != null || def.max != null) ? ` (erlaubt: ${def.min ?? '−∞'} bis ${def.max ?? '∞'})` : '';

/** Returns the typed value, or undefined if invalid or out of [min, max]. */
function parseConfigValue(def, v) {
  const inRange = n => (def.min == null || n >= def.min) && (def.max == null || n <= def.max);
  switch (def.type) {
    case 'number': {
      const n = toNumber(v);
      return n != null && inRange(n) ? n : undefined;
    }
    case 'integer': {
      const n = toNumber(v);
      return n != null && Number.isInteger(n) && inRange(n) ? n : undefined;
    }
    case 'boolean': {
      if (v === true || v === false) return v;
      const s = norm(v);
      if (['true', 'wahr', 'ja', '1', 'x'].includes(s)) return true;
      if (['false', 'falsch', 'nein', '0'].includes(s)) return false;
      return undefined;
    }
    case 'datetime': {
      const t = parseTime(v);
      return t == null ? undefined : roundSerial(t);
    }
    case 'enum': {
      const s = norm(v);
      return def.options.includes(s) ? s : undefined;
    }
    case 'string':
      return clean(v);
    case 'list': {   // numbers separated by commas (or by semicolons, then decimal commas work: „0,3; 0,2“); every value within [min, max]
      const str = String(v);
      const parts = Array.isArray(v) ? v : typeof v === 'number' ? [v] : str.split(str.includes(';') ? ';' : ',');
      const nums = parts.map(x => (typeof x === 'number' ? x : toNumber(String(x).trim().replace(',', '.')))).filter(x => x != null);
      return nums.length && nums.length === parts.filter(x => String(x).trim() !== '').length && nums.every(inRange) ? nums : undefined;
    }
    case 'names': {  // text list, comma separated
      const parts = (Array.isArray(v) ? v : String(v).split(',')).map(x => clean(x)).filter(Boolean);
      return parts.length ? parts : undefined;
    }
    case 'monthday': {  // a day of the year: "12-01" or "01.12." as text, or a date cell (the year is ignored)
      if (typeof v === 'number' && Number.isFinite(v)) { const p = serialToParts(v); return [p.mo, p.d]; }
      const s = Array.isArray(v) ? v.map(x => String(x).padStart(2, '0')).join('-') : String(v).trim();
      let m = /^(\d{1,2})-(\d{1,2})$/.exec(s), mo, d;
      if (m) { mo = +m[1]; d = +m[2]; } else if ((m = /^(\d{1,2})\.(\d{1,2})\.?$/.exec(s))) { d = +m[1]; mo = +m[2]; } else return undefined;
      return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? [mo, d] : undefined;
    }
    case 'url': {
      const s = String(v).trim();
      return /^https:\/\/[^\s]+$/.test(s) ? s : undefined;
    }
    default:
      return undefined;
  }
}

// ───────── 2. players + aliases ─────────

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** "A@x.com; b@y.com" → ['a@x.com', 'b@y.com'] (lowercase, unique); anything that isn't an address is dropped. */
export function parseAccounts(v) {
  return [...new Set(String(v ?? '').split(/[,;\s]+/).map(x => x.toLowerCase()).filter(x => EMAIL_RE.test(x)))];
}

function parsePlayers(playersGrid, aliasesGrid, report) {
  /** @type {Map<string, import('../types.js').Player>} */
  const players = new Map();
  /** norm(name) → player id */
  const idByName = new Map();

  const p = readTable(playersGrid, COLUMNS.players, OPTIONAL_COLUMNS.players || []);
  if (p.missing.length) {
    report('error', 'missing_column',
      `Tab ${TABS.players}: Spalte(n) ${p.missing.join(', ')} fehlen.`, { tab: TABS.players });
  } else {
    for (const { cells, row } of p.rows) {
      const id = clean(cell(cells, p.col.id));
      const name = clean(cell(cells, p.col.display_name));
      if (!id || !name) {
        report('warning', 'bad_alias', `Tab ${TABS.players}, Zeile ${row}: id oder display_name fehlt – syncAll ausführen.`,
          { tab: TABS.players, row });
        continue;
      }
      if (players.has(id)) {
        report('error', 'bad_alias', `Tab ${TABS.players}: ID ${id} kommt mehrfach vor (Zeile ${row}).`,
          { tab: TABS.players, row });
        continue;
      }
      const active = toBool(cell(cells, p.col.active));
      players.set(id, { id, name, active: active === null ? true : active, accounts: parseAccounts(cell(cells, p.col.google_accounts)) });
    }
    // An address on two players is ignored (the Verwaltung script refuses this; hand edits can still do it).
    const owners = new Map();
    for (const pl of players.values()) for (const a of pl.accounts) owners.set(a, [...(owners.get(a) || []), pl.id]);
    for (const [a, ids] of owners) {
      if (ids.length < 2) continue;
      report('warning', 'bad_account', `Das Google-Konto ${a} ist mehreren Spielern zugeordnet (${ids.join(', ')}) und wird ignoriert. Bitte im Tab ${TABS.players} korrigieren.`,
        { tab: TABS.players });
      for (const id of ids) players.get(id).accounts = players.get(id).accounts.filter(x => x !== a);
    }
  }

  const a = readTable(aliasesGrid, COLUMNS.aliases);
  if (a.missing.length) {
    report('error', 'missing_column',
      `Tab ${TABS.aliases}: Spalte(n) ${a.missing.join(', ')} fehlen.`, { tab: TABS.aliases });
  } else {
    for (const { cells, row } of a.rows) {
      const name = clean(cell(cells, a.col.name));
      const id = clean(cell(cells, a.col.player_id));
      if (!name) continue;
      if (!players.has(id)) {
        report('warning', 'bad_alias', `Alias „${name}“ zeigt auf unbekannte ID „${id}“ – ignoriert.`,
          { tab: TABS.aliases, row, name });
        continue;
      }
      const key = norm(name);
      const owner = idByName.get(key);
      if (owner && owner !== id) {
        report('error', 'bad_alias', `Alias „${name}“ gehört zu ${owner} und ${id} – ${owner} wird verwendet.`,
          { tab: TABS.aliases, row, name });
        continue;
      }
      idByName.set(key, id);
    }
  }

  // Like syncAll's repair: a display_name always maps to its own player.
  for (const pl of players.values()) {
    const key = norm(pl.name);
    const owner = idByName.get(key);
    if (!owner) idByName.set(key, pl.id);
    else if (owner !== pl.id) {
      report('warning', 'bad_alias', `display_name „${pl.name}“ von ${pl.id} ist ein Alias von ${owner}.`,
        { tab: TABS.players, name: pl.name });
    }
  }
  return { players, idByName };
}

// ───────── 3. game rows ─────────

function parseGameRows(source, grid, report, counts) {
  const tab = TABS[source];
  if (!grid || !grid.length) {
    report('warning', 'missing_column', `Tab ${tab} ist leer oder fehlt.`, { tab });
    return { rows: [], total: 0 };
  }
  const t = readTable(grid, COLUMNS[source], OPTIONAL_COLUMNS[source] || []);
  if (t.missing.length) {
    report('error', 'missing_column', `Tab ${tab}: Spalte(n) ${t.missing.join(', ')} fehlen.`, { tab });
    return { rows: [], total: t.rows.length };
  }
  const rows = [];
  for (const { cells, row } of t.rows) {
    const time = parseTime(cell(cells, t.col.timestamp));
    if (time == null) {
      report('warning', 'bad_timestamp',
        `Tab „${tab}“, Zeile ${row}: Der Zeitstempel „${clean(cell(cells, t.col.timestamp))}“ ist nicht lesbar. Die Zeile wird nicht gewertet.`,
        { tab, row });
      counts.skipped++;
      continue;
    }
    const ts = roundSerial(time);
    const r = {
      source, row, t: ts, ref: formatRef(ts),
      w: [cell(cells, t.col.w1), cell(cells, t.col.w2)].map(clean).filter(Boolean),
      l: [cell(cells, t.col.l1), cell(cells, t.col.l2)].map(clean).filter(Boolean),
      voided: false,
    };
    if (source === 'legacy' && t.col.source_row >= 0) {
      const sr = toNumber(cell(cells, t.col.source_row));
      if (sr != null) r.sourceRow = sr;
    }
    rows.push(r);
  }
  return { rows, total: t.rows.length };
}

// ───────── 4. corrections ─────────

function applyCorrections(grid, rows, report, counts, idByName, tournamentResults = []) {
  if (!grid || !grid.length) return;
  const tab = TABS.corrections;
  const t = readTable(grid, COLUMNS.corrections, OPTIONAL_COLUMNS.corrections || []);
  if (t.missing.length) {
    report('error', 'missing_column',
      `Tab ${tab}: Spalte(n) ${t.missing.join(', ')} fehlen – Korrekturen werden nicht angewendet.`, { tab });
    return;
  }
  const byRef = new Map();
  for (const r of [...rows, ...tournamentResults]) {
    if (!byRef.has(r.ref)) byRef.set(r.ref, []);
    byRef.get(r.ref).push(r);
  }
  const moves = new Map();   // ref → { row, value, hits }: the last move row per game counts
  for (const { cells, row } of t.rows) {
    const rawRef = cell(cells, t.col.game_ref);
    const time = parseTime(rawRef);
    const action = norm(cell(cells, t.col.action));
    if (time == null || !['void', 'swap', 'move', 'replace'].includes(action)) {
      report('warning', 'bad_correction',
        `Tab ${tab}, Zeile ${row}: ` + (time == null
          ? `game_ref „${clean(rawRef)}“ nicht lesbar (Format yyyy-mm-dd hh:mm:ss).`
          : `Aktion „${clean(cell(cells, t.col.action))}“ unbekannt (erlaubt: void, swap, move, replace).`),
        { tab, row });
      continue;
    }
    const ref = formatRef(roundSerial(time));
    const hits = byRef.get(ref) || [];
    if (!hits.length) {
      report('warning', 'unmatched_correction',
        `Tab „${tab}“, Zeile ${row}: Es gibt kein Spiel mit dem Zeitstempel ${ref} (vielleicht ein Testeintrag vor „responses_valid_from“).`,
        { tab, row, ref });
      continue;
    }
    if (hits.length > 1) {
      report('warning', 'ambiguous_correction',
        `Tab „${tab}“, Zeile ${row}: ${hits.length} Spiele haben den Zeitstempel ${ref}. Die Korrektur gilt für alle.`,
        { tab, row, ref, count: hits.length });
    }
    const tourHits = hits.filter(r => r.tournamentResult);
    if (tourHits.length) {
      if (action === 'void') {
        for (const r of tourHits) if (!r.voided) { r.voided = true; counts.voided++; }
      } else report('warning', 'bad_correction',
        `Tab „${tab}“, Zeile ${row}: ${ref} ist ein Turnierergebnis. Dafür geht nur „void“; ein falsches Ergebnis wird in der App einfach neu eingetragen.`,
        { tab, row, ref });
      if (tourHits.length === hits.length) continue;
      hits.splice(0, hits.length, ...hits.filter(r => !r.tournamentResult));
    }
    if (action === 'move') {
      const prev = moves.get(ref);
      if (prev) {
        report('warning', 'duplicate_move',
          `Tab „${tab}“, Zeile ${row}: Für das Spiel ${ref} gibt es schon eine move-Zeile (Zeile ${prev.row}). Es gilt die spätere Zeile ${row}.`,
          { tab, row, ref });
      }
      moves.set(ref, { row, value: cell(cells, t.col.played_at), hits });
      continue;
    }
    if (action === 'replace') {
      replacePlayer(hits, row, ref, clean(cell(cells, t.col.wrong_player)), clean(cell(cells, t.col.right_player)));
      continue;
    }
    for (const r of hits) {
      if (r.voided) continue;
      if (action === 'void') { r.voided = true; counts.voided++; }
      else { [r.w, r.l] = [r.l, r.w]; r.corrected = !r.corrected; counts.swapped++; }
    }
  }

  // replace: one player swapped for another, wherever they stand (winner or loser). Several rows per game
  // apply in row order. Players are compared through `aliases`, so any of a player's names works.
  function replacePlayer(hits, row, ref, wrong, right) {
    const fail = text => report('warning', 'bad_replace',
      `Tab „${tab}“, Zeile ${row}: ${text}. Das Spiel ${ref} bleibt unverändert.`, { tab, row, ref });
    if (t.col.wrong_player < 0 || t.col.right_player < 0) return fail('Die Spalten „wrong_player“ und „right_player“ fehlen');
    if (!wrong || !right) return fail(`„${wrong ? 'right_player' : 'wrong_player'}“ ist leer`);
    const id = name => idByName.get(norm(name));
    const rightId = id(right);
    if (!rightId) return fail(`„${right}“ (right_player) steht nicht im Tab „aliases“`);
    const same = name => norm(name) === norm(wrong) || (id(wrong) != null && id(name) === id(wrong));
    for (const r of hits) {
      if (r.voided) continue;
      const names = [...r.w, ...r.l];
      if (!names.some(same)) { fail(`„${wrong}“ (wrong_player) spielt in diesem Spiel nicht mit`); continue; }
      if (names.some(n => id(n) === rightId && !same(n))) { fail(`„${right}“ spielt in diesem Spiel schon mit`); continue; }
      const swapIn = n => (same(n) ? right : n);
      r.w = r.w.map(swapIn); r.l = r.l.map(swapIn);
      if (!r.replaced) counts.replaced++;   // games, not rows
      (r.replaced ||= []).push({ from: wrong, to: right });
    }
  }

  // move: after all rows, so a void anywhere in the tab wins and the last move row counts
  for (const [ref, m] of moves) {
    const live = m.hits.filter(r => !r.voided);
    if (!live.length) continue;
    const v = m.value, shown = typeof v === 'number' ? formatRef(roundSerial(v)) : clean(v);
    const at = parseTime(v);
    const ts = at == null ? null : roundSerial(at);
    const problem = t.col.played_at < 0 ? 'Die Spalte „played_at“ fehlt'
      : shown === '' ? '„played_at“ ist leer'
      : ts == null ? `„played_at“ („${shown}“) ist nicht lesbar (Format dd.mm.yyyy hh:mm oder yyyy-mm-dd hh:mm)`
      : !hasTimeOfDay(v) ? `„played_at“ („${shown}“) hat keine Uhrzeit`
      : live.some(r => ts > r.t) ? `„played_at“ (${formatRef(ts)}) liegt nach dem Eintrag`
      : null;
    if (problem) {
      report('warning', 'bad_move',
        `Tab „${tab}“, Zeile ${m.row}: ${problem}. Das Spiel ${ref} bleibt beim Zeitpunkt des Eintrags.`,
        { tab, row: m.row, ref });
      continue;
    }
    for (const r of live) { r.entered = r.t; r.t = ts; r.moved = true; counts.moved++; }
  }
}

// ───────── 5. names → IDs, validation ─────────

function toGame(r, idByName, unknown, report) {
  const where = { tab: TABS[r.source], row: r.row, ref: r.ref };
  const nW = r.w.length, nL = r.l.length;
  if (!((nW === 1 && nL === 1) || (nW === 2 && nL === 2))) {
    report('warning', 'invalid_game',
      `Tab „${where.tab}“, Zeile ${r.row} (${r.ref}): ${nW} Sieger gegen ${nL} Verlierer ist weder Einzel noch Doppel. Das Spiel wird nicht gewertet.`,
      where);
    return null;
  }
  let missing = false;
  const map = name => {
    const id = idByName.get(norm(name));
    if (id) return id;
    missing = true;
    const key = norm(name);
    const u = unknown.get(key) || unknown.set(key, { name, count: 0, refs: [] }).get(key);
    u.count++;
    if (u.refs.length < MAX_REFS_IN_ISSUE) u.refs.push(r.ref);
    return null;
  };
  const winners = r.w.map(map), losers = r.l.map(map);
  if (missing) return null;

  const all = [...winners, ...losers];
  if (new Set(all).size !== all.length) {
    report('warning', 'duplicate_player',
      `Tab „${where.tab}“, Zeile ${r.row} (${r.ref}): Dieselbe Person steht zweimal im Spiel (etwa nach dem Zusammenführen zweier Spieler). Das Spiel wird nicht gewertet; am besten im Tab „corrections“ als „void“ eintragen.`,
      where);
    return null;
  }
  const game = {
    g: -1, t: r.t, ref: r.ref, source: r.source, row: r.row,
    winners, losers, double: nW === 2, approxTime: r.source === 'legacy',
  };
  if (r.sourceRow != null) game.sourceRow = r.sourceRow;
  if (r.corrected) game.corrected = true;
  if (r.moved) { game.moved = true; game.enteredT = r.entered; }
  if (r.replaced) {
    game.replaced = r.replaced.map(x => ({ from: idByName.get(norm(x.from)) ?? null, fromName: x.from, to: idByName.get(norm(x.to)) }));
  }
  return game;
}

// ───────── 5b. possible duplicates ─────────

/** Two games with the same players on the same sides within `minutes` (by the played time) are probably one
 *  game entered twice. Flagged, never dropped: two quick games with the same result are possible. Pairs of
 *  Altdaten are skipped (their times are interpolated, so neighbours are always close). */
export function flagDuplicates(games, minutes, report) {
  if (!(minutes > 0)) return;
  const win = minutes / 1440 + 1e-9;
  const key = x => [x.winners.slice().sort().join('+'), x.losers.slice().sort().join('+')].join('>');
  for (let i = 0; i < games.length; i++) {
    const a = games[i], ka = key(a);
    for (let j = i + 1; j < games.length && games[j].t - a.t <= win; j++) {
      const b = games[j];
      if (a.source === 'legacy' && b.source === 'legacy') continue;
      if (key(b) !== ka) continue;
      (a.dupes ||= []).push(b.ref);
      (b.dupes ||= []).push(a.ref);
      const secs = Math.round((b.t - a.t) * 86400), gap = Math.round(secs / 60);
      report('warning', 'possible_duplicate',
        `Möglicherweise doppelt eingetragen: die Spiele ${a.ref} und ${b.ref} (gleiche Spieler, gleiches Ergebnis, ${secs < 60 ? 'weniger als eine Minute' : gap === 1 ? 'eine Minute' : `${gap} Minuten`} auseinander). War es nur ein Spiel, eines davon im Tab „corrections“ mit „void“ streichen.`,
        { ref: `${a.ref}, ${b.ref}` });
    }
  }
}

// ───────── 6. hash ─────────

function datasetHash(config, players, games, log = [], photos = null, tournaments = '') {
  const last = log.at(-1);
  const parts = [
    `turniere:${tournaments}`,
    `fotos:${photos?.rev || ''}`,
    `log:${log.length}:${last ? `${last.row}:${last.status}` : ''}`,
    JSON.stringify(Object.keys(config).sort().map(k => [k, config[k]])),
    [...players.values()].map(p => `${p.id}:${p.name}:${p.active ? 1 : 0}:${p.accounts.join(';')}`).sort().join(','),
    String(games.length),
  ];
  for (const g of games) {
    parts.push(`${Math.round(g.t * 86400)}${g.source[0]}${g.winners.join('+')}>${g.losers.join('+')}`);
  }
  return fnv1a(parts.join('\n'));
}
