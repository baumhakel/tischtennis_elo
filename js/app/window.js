// Models for a Zeitraum, memoised per (mode model, window). No DOM.
import { sliceModel } from '../core/window.js';

const cache = new WeakMap();   // mode model → Map(from-to → windowed model)

export function windowModel(model, range) {
  let m = cache.get(model);
  if (!m) cache.set(model, (m = new Map()));
  const key = `${range.from}-${range.to}`;
  if (!m.has(key)) m.set(key, sliceModel(model, range.from, range.to));
  return m.get(key);
}
