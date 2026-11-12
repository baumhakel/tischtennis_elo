// Zeitraum (Phase 13): a window onto the continuous rating, not a fresh start. Pure.
//
//   windowRange('monat', now)      → { spec, from, to, label } (serials, to exclusive) or null for „Gesamt“
//   sliceModel(model, from, to)    → a model of the games in [from, to): same ratings as the full
//                                    replay, counts and matrices of the window only (see sliceElo)
//
// spec: gesamt | monat | vormonat | jahr | 2026-10-01..2026-10-31 (both days included)
import { serialFromParts, serialToParts } from './normalize.js';
import { sliceElo } from './elo.js';
import { createStats } from './stats/index.js';

export const MONTHS = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const RANGE_SPECS = ['gesamt', 'monat', 'vormonat', 'jahr'];
const CUSTOM = /^(\d{4})-(\d{2})-(\d{2})\.\.(\d{4})-(\d{2})-(\d{2})$/;

export const monthLabel = (y, m) => `${MONTHS[m - 1]} ${y}`;
const dayLabel = s => { const p = serialToParts(s); return `${p.d}.${p.mo}.${p.y}`; };

/** Is `spec` a valid Zeitraum? (custom ranges: real days, from ≤ to) */
export function validRange(spec) {
  if (RANGE_SPECS.includes(spec)) return true;
  const m = CUSTOM.exec(String(spec || ''));
  if (!m) return false;
  const a = serialFromParts(+m[1], +m[2], +m[3]), b = serialFromParts(+m[4], +m[5], +m[6]);
  const pa = serialToParts(a), pb = serialToParts(b);
  return pa.mo === +m[2] && pa.d === +m[3] && pb.mo === +m[5] && pb.d === +m[6] && a <= b;
}

export function windowRange(spec, now) {
  if (!spec || spec === 'gesamt' || !validRange(spec)) return null;
  const p = serialToParts(now);
  if (spec === 'monat' || spec === 'vormonat') {
    let y = p.y, m = p.mo;
    if (spec === 'vormonat') { m--; if (m < 1) { m = 12; y--; } }
    const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
    return { spec, from: serialFromParts(y, m, 1), to: serialFromParts(ny, nm, 1), label: monthLabel(y, m) };
  }
  if (spec === 'jahr') return { spec, from: serialFromParts(p.y, 1, 1), to: serialFromParts(p.y + 1, 1, 1), label: String(p.y) };
  const m = CUSTOM.exec(spec);
  const from = serialFromParts(+m[1], +m[2], +m[3]), last = serialFromParts(+m[4], +m[5], +m[6]);
  return { spec, from, to: last + 1, label: from === last ? dayLabel(from) : `${dayLabel(from)} bis ${dayLabel(last)}` };
}

/** First index with games[i].t ≥ t (games sorted by time). */
function lowerBound(games, t) {
  let lo = 0, hi = games.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (games[mid].t < t) lo = mid + 1; else hi = mid; }
  return lo;
}

export function sliceModel(model, from, to) {
  const G = model.dataset.games;
  const a = lowerBound(G, from), b = lowerBound(G, to);
  const games = G.slice(a, b).map((x, i) => ({ ...x, g: i }));
  const dataset = { ...model.dataset, games, hash: `${model.dataset.hash}|${from}-${to}` };
  const elo = sliceElo(model.elo, a, b);
  const now = Math.min(model.stats.now, to);
  return { dataset, elo, stats: createStats(dataset, elo, { now }), mode: model.mode, window: { from, to, a, b } };
}
