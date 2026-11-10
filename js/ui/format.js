// Display formatting — the only place that rounds. German conventions.
import { serialToParts } from '../core/normalize.js';

const nf0 = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 0 });
const nfElo = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 0, useGrouping: false });
const nf1 = new Intl.NumberFormat('de-AT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const elo = x => (Number.isFinite(x) ? nfElo.format(x) : '–');   // 1536, not 1 536
export const int = x => (Number.isFinite(x) ? nf0.format(x) : '–');
export const dec1 = x => (Number.isFinite(x) ? nf1.format(x) : '–');

/** +12 / −7 / ±0 with a real minus sign. */
export function signed(x, digits = 0) {
  if (!Number.isFinite(x)) return '–';
  const r = Number(x.toFixed(digits));
  if (r === 0) return '±0';
  const s = (digits ? nf1 : nf0).format(Math.abs(r));
  return (r > 0 ? '+' : '−') + s;
}

/** 0.537 → "54 %" */
export const pct = x => (Number.isFinite(x) ? nf0.format(100 * x) + ' %' : '–');

const pad = n => String(n).padStart(2, '0');

/** Sheet serial → "09.11.2026" */
export function date(serial) {
  const p = serialToParts(serial);
  return `${pad(p.d)}.${pad(p.mo)}.${p.y}`;
}

/** Sheet serial → "15:25" */
export function time(serial) {
  const p = serialToParts(serial);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

/** ms since epoch → local "15:25" (for "Stand …"). */
export function clock(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ms since epoch → "12:41 Uhr" today, otherwise "9.11., 12:41 Uhr". */
export function stamp(ms) {
  const d = new Date(ms), now = new Date();
  const same = d.toDateString() === now.toDateString();
  return (same ? '' : `${d.getDate()}.${d.getMonth() + 1}., `) + `${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;
}

/** Days between a serial and now → "heute", "gestern", "vor 5 Tagen", "vor 3 Wochen". */
export function ago(serial, nowSerial) {
  const days = Math.floor(nowSerial) - Math.floor(serial);
  if (days <= 0) return 'heute';
  if (days === 1) return 'gestern';
  if (days < 14) return `vor ${days} Tagen`;
  if (days < 60) return `vor ${Math.round(days / 7)} Wochen`;
  return `vor ${Math.round(days / 30)} Monaten`;
}
