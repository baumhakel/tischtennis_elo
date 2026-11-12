// Prognose: what the views show of the result (app/forecast.js). Pure, no DOM, tested in Node.
import * as fmt from '../ui/format.js';
import { MONTHS } from '../core/window.js';
import { serialToParts } from '../core/normalize.js';

/** Probability for people: never „0 %“ or „100 %“ unless it is certain. */
export function chance(p) {
  if (!(p > 0)) return '–';
  if (p >= 1) return '100 %';
  if (p < 0.005) return '< 1 %';
  if (p > 0.995) return '> 99 %';
  return fmt.pct(p);
}

/** „Ende November“ for the month that ends at `end`. */
export function monthEndLabel(end) {
  const p = serialToParts(end - 0.5);
  return `Ende ${MONTHS[p.mo - 1]}`;
}

/** Rows to show: everyone with a real chance at something, by Platz-1 chance, then ⌀ Platz. */
export function forecastRows(F) {
  const I = F.input, R = F.res;
  const rows = [];
  for (let k = 0; k < I.ids.length; k++) {
    if (!(R.eligible[k] > 0)) continue;
    rows.push({ k, id: I.ids[k], p1: R.p1[k], top3: R.top3[k], place: R.place[k], eligible: R.eligible[k], riser: R.riser[k],
      rating: I.rating[k], gain: I.mGames[k] ? I.rating[k] - I.mBase[k] : 0, monthGames: I.mGames[k] });
  }
  rows.sort((a, b) => b.p1 - a.p1 || b.top3 - a.top3 || a.place - b.place);
  return rows;
}

/** The Übersicht tile: the favourite, or null when there is nothing to forecast. */
export function forecastTeaser(F) {
  if (!F || !F.res || !(F.input.lambda > 0)) return null;
  const rows = forecastRows(F);
  if (rows.length < 2 || !(rows[0].p1 > 0) || rows[0].p1 >= 1) return null;
  return { id: rows[0].id, p1: rows[0].p1, label: monthEndLabel(F.end) };
}

