// Pure helpers shared by the core modules. No DOM, no network.
//
// Time model: a game time is a sheet serial number = days since 1899-12-30, read as
// wall-clock time in the sheet's time zone (no UTC offset applied). All arithmetic on
// serials is done in UTC so DST never shifts anything.

const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86400000;

// ───────── Names (same rules as Verwaltung.gs) ─────────

/** Trim, collapse inner whitespace. null/undefined → ''. */
export function clean(s) {
  return String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
}

/** clean + lowercase: the comparison key for names and headers. */
export function norm(s) {
  return clean(s).toLowerCase();
}

/** TRUE/FALSE cell or text → boolean; empty → null; anything else → false (as in Verwaltung.gs). */
export function toBool(v) {
  if (v === true || v === false) return v;
  const s = norm(v);
  if (s === '') return null;
  return ['true', 'wahr', 'ja', '1', 'x'].includes(s);
}

/** Number cell or numeric text (comma or dot decimal) → number; else null. */
export function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = clean(v).replace(',', '.');
  if (s === '' || !/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return null;
  return Number(s);
}

// ───────── Time ─────────

/** Calendar parts (wall-clock) → serial. Month is 1-based. */
export function serialFromParts(y, mo, d, h = 0, mi = 0, s = 0) {
  return (Date.UTC(y, mo - 1, d, h, mi, s) - SERIAL_EPOCH_MS) / MS_PER_DAY;
}

/** Serial → wall-clock parts, rounded to whole seconds. weekday: 0 = Sunday. */
export function serialToParts(serial) {
  const ms = SERIAL_EPOCH_MS + Math.round(serial * 86400) * 1000;
  const d = new Date(ms);
  return {
    y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(),
    weekday: d.getUTCDay(),
  };
}

/** Serial rounded to whole seconds (the resolution of game_ref). */
export function roundSerial(serial) {
  return Math.round(serial * 86400) / 86400;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Serial → "yyyy-mm-dd hh:mm:ss" (the game_ref format). */
export function formatRef(serial) {
  const p = serialToParts(serial);
  return `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}

const RE_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const RE_DE  = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * A timestamp cell → serial, or null if it can't be read.
 * Accepts serial numbers (what the API returns for date cells) and text in
 * "yyyy-mm-dd[ hh:mm[:ss]]" or "dd.mm.yyyy[ hh:mm[:ss]]".
 */
export function parseTime(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  const s = clean(v);
  if (!s) return null;
  let m = RE_ISO.exec(s);
  let y, mo, d, h, mi, sec;
  if (m) [, y, mo, d, h, mi, sec] = m;
  else if ((m = RE_DE.exec(s))) [, d, mo, y, h, mi, sec] = m;
  else return null;
  [y, mo, d, h, mi, sec] = [y, mo, d, h || 0, mi || 0, sec || 0].map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return null;
  const serial = serialFromParts(y, mo, d, h, mi, sec);
  // reject 31.02. etc. (Date.UTC rolls over silently)
  const back = serialToParts(serial);
  if (back.y !== y || back.mo !== mo || back.d !== d) return null;
  return serial;
}

/** Current wall-clock time in `timeZone` as a serial (for "last 7 days" etc.). */
export function nowSerial(timeZone, now = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(now).map(x => [x.type, x.value]));
  return serialFromParts(+p.year, +p.month, +p.day, +p.hour, +p.minute, +p.second);
}

// ───────── Tables ─────────

/**
 * Locates columns by header name and returns the non-empty data rows.
 * @param {any[][]|undefined} grid   row 0 = headers
 * @param {Object<string,string[]>} spec  key → accepted header spellings
 * @param {string[]} [optional]      keys that may be missing
 * @returns {{ col: Object<string,number>, missing: string[], rows: {cells: any[], row: number}[] }}
 *   col[key] = column index or -1; missing = required keys not found (canonical header names);
 *   row = sheet row number (header = 1).
 */
export function readTable(grid, spec, optional = []) {
  const header = (grid && grid[0] || []).map(norm);
  const col = {}, missing = [];
  for (const [key, names] of Object.entries(spec)) {
    col[key] = names.map(norm).map(n => header.indexOf(n)).find(i => i !== -1) ?? -1;
    if (col[key] === -1 && !optional.includes(key)) missing.push(names[0]);
  }
  const rows = [];
  (grid || []).slice(1).forEach((cells, i) => {
    if (!cells || cells.every(c => c === '' || c == null)) return;
    rows.push({ cells, row: i + 2 });
  });
  return { col, missing, rows };
}

/** Cell value of a row by column index (-1 or out of range → ''). */
export function cell(cells, idx) {
  return idx >= 0 && idx < cells.length && cells[idx] != null ? cells[idx] : '';
}

// ───────── Hash ─────────

/** FNV-1a 32-bit over a string → 8 hex chars. Fast, not cryptographic; enough for cache keys. */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
