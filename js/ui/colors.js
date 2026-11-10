// Colour tokens for charts. Values live in css/app.css (light + dark); canvas-based charts
// (uPlot, heatmap) need real colour strings, so they are read from the computed style.
//
// Categorical: 8 validated slots (dataviz reference palette, checked against this app's
// surfaces), used only for focused players — colour follows the player's focus slot.
// Sequential: one blue ramp (magnitude). Diverging: blue ↔ red with a neutral midpoint.

export const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const seriesVar = slot => `var(--series-${slot + 1})`;
export const seriesColor = slot => css(`--series-${slot + 1}`);

/** Current theme colours for chart chrome. */
export function chrome() {
  return {
    ink: css('--ink'), muted: css('--muted'), grid: css('--grid'), axis: css('--axis'),
    surface: css('--surface'), context: css('--context-line'), up: css('--up'), down: css('--down'),
    band: css('--band'),
  };
}

const hex = h => { const n = parseInt(h.replace('#', ''), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const toHex = rgb => '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));

/** Sequential colour for t in [0, 1] along the theme's ramp (7 steps, linear between them). */
export function sequential(t) {
  const steps = css('--seq').split(',').map(s => s.trim());
  if (!Number.isFinite(t)) return 'transparent';
  const x = Math.max(0, Math.min(1, t)) * (steps.length - 1);
  const i = Math.min(steps.length - 2, Math.floor(x));
  return mix(steps[i], steps[i + 1], x - i);
}

/** Diverging colour for t in [−1, 1]: negative → red arm, positive → blue arm, 0 → neutral. */
export function diverging(t) {
  if (!Number.isFinite(t)) return 'transparent';
  const c = Math.max(-1, Math.min(1, t));
  return mix(css('--div-mid'), css(c >= 0 ? '--div-pos' : '--div-neg'), Math.abs(c));
}

/** Readable text colour on a fill. */
export function textOn(fill) {
  if (!fill || fill === 'transparent') return css('--ink');
  const [r, g, b] = hex(fill).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#0b0b0b' : '#ffffff';
}

/** Re-run fn when the colour scheme flips (charts redraw with the other theme). */
export function onThemeChange(fn) {
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
}

/** #rrggbb + alpha → rgba() string (for band fills). */
export function withAlpha(color, a) {
  const [r, g, b] = hex(color);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
