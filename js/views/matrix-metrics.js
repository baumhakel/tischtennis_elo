// Matrix explorer metrics: how each is read, scaled and drawn. Pure (no DOM).
// kind: 'seq' magnitude (0 … max), 'div' signed around `mid`.
// graph: 'undirected' (weight = value), 'directed' (arrow i→j where the antisymmetric part
//        a_ij = value_ij − value_ji > 0, i.e. i comes out ahead), 'signed' (two colours).

const r1 = v => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ','));
const r2 = v => v.toFixed(2).replace('.', ',');
const pct = v => `${Math.round(100 * v)}`;
const sgn = (v, f) => {                         // sign after rounding, so no "−0,0"
  const s = f(Math.abs(v));
  return (/^[0,.]+$/.test(s) ? '' : v > 0 ? '+' : v < 0 ? '−' : '') + s;
};

export const METRICS = [
  { id: 'matchups',         stat: 'matchups',               label: 'Begegnungen',                       kind: 'seq', graph: 'undirected', fmt: r1,
    lead: 'Wie oft zwei Spieler gegeneinander gespielt haben. Ein Doppel zählt pro Gegnerpaar halb.' },
  { id: 'normiert',         stat: 'matchupsNormed',         label: 'Begegnungen (relativ)',             kind: 'seq', graph: 'undirected', fmt: r2,
    lead: 'Begegnungen im Verhältnis dazu, wie viel beide insgesamt spielen. So werden Viel- und Wenigspieler vergleichbar.' },
  { id: 'abweichung',       stat: 'deviation',              label: 'Abweichung vom Zufall',             kind: 'div', mid: 0, graph: 'signed', fmt: v => sgn(v, r1),
    lead: 'Spielen zwei öfter (blau) oder seltener (rot) gegeneinander, als bei zufälliger Paarung zu erwarten wäre? Angegeben als Pearson-Residuum.' },
  { id: 'siege',            stat: 'wins',                   label: 'Siege',                             kind: 'seq', graph: 'directed', fmt: r1,
    lead: 'Wie oft der Spieler in der Zeile gegen den Spieler in der Spalte gewonnen hat.' },
  { id: 'quote',            stat: 'winRatio',               label: 'Siegquote (%)',                     kind: 'div', mid: 0.5, graph: 'directed', fmt: pct,
    lead: 'Anteil der Begegnungen, die der Spieler in der Zeile gewonnen hat.' },
  { id: 'transfer',         stat: 'transfer',               label: 'Elo-Bilanz',                        kind: 'div', mid: 0, graph: 'directed', fmt: v => sgn(v, x => String(Math.round(x))),
    lead: 'Wie viele Elo-Punkte der Spieler in der Zeile insgesamt vom Spieler in der Spalte gewonnen hat (netto).' },
  { id: 'transfer-schnitt', stat: 'avgTransfer',            label: 'Elo-Bilanz pro Begegnung',          kind: 'div', mid: 0, graph: 'directed', fmt: v => sgn(v, r1),
    lead: 'Die Elo-Bilanz geteilt durch die Zahl der Begegnungen.' },
  { id: 'chance',           stat: 'winProb',                label: 'Siegchance heute (%)',              kind: 'div', mid: 0.5, graph: 'directed', fmt: pct,
    lead: 'Siegchance des Spielers in der Zeile in einem Einzel, berechnet aus den aktuellen Elo-Werten.' },
  { id: 'arbitrage',        stat: 'actualVsExpected',       label: 'Siege über Erwartung',              kind: 'div', mid: 0, graph: 'directed', fmt: v => sgn(v, r1),
    lead: 'Tatsächliche minus erwartete Siege (aus den Elo-Werten vor jedem Spiel). Positiv heißt: schlägt diesen Gegner öfter, als die Wertung vorhersagt.' },
];

export const metricById = id => METRICS.find(m => m.id === id) || METRICS[0];

/**
 * Sub-matrix for players ks (in display order): values, colour position t and the scale.
 * t ∈ [0, 1] for seq, [−1, 1] for div (symmetric around mid). NaN = no value.
 */
export function cells(M, n, ks, metric) {
  const vals = ks.map(i => ks.map(j => (i === j ? NaN : M[i * n + j])));
  let maxAbs = 0, max = 0;
  for (const row of vals) for (const v of row) {
    if (!Number.isFinite(v)) continue;
    max = Math.max(max, v);
    maxAbs = Math.max(maxAbs, Math.abs(v - (metric.mid ?? 0)));
  }
  const t = vals.map(row => row.map(v => {
    if (!Number.isFinite(v)) return NaN;
    if (metric.kind === 'seq') return max > 0 ? v / max : 0;
    return maxAbs > 0 ? (v - metric.mid) / maxAbs : 0;
  }));
  return { vals, t, max, maxAbs };
}

/**
 * Display order: by current Elo, by name, or by cluster (average-linkage agglomeration on
 * 1 − normed matchups; leaves in merge order, so players who often meet sit next to each other).
 */
export function order(ks, how, { elo, normed, names }) {
  const n = elo.ids.length;
  if (how === 'name') return ks.slice().sort((a, b) => names(a).localeCompare(names(b), 'de'));
  if (how !== 'cluster' || ks.length < 3) return ks.slice().sort((a, b) => elo.final[b] - elo.final[a]);
  let clusters = ks.map(k => [k]);
  const dist = (A, B) => {
    let s = 0;
    for (const a of A) for (const b of B) s += 1 - (normed[a * n + b] || 0);
    return s / (A.length * B.length);
  };
  while (clusters.length > 1) {
    let best = [0, 1], bd = Infinity;
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
      const d = dist(clusters[i], clusters[j]);
      if (d < bd) { bd = d; best = [i, j]; }
    }
    const [i, j] = best;
    const merged = clusters[i].concat(clusters[j]);
    clusters = clusters.filter((_, x) => x !== i && x !== j);
    clusters.splice(i, 0, merged);
  }
  return clusters[0];
}

/**
 * Graph edges for the chosen metric among ks.
 * @returns {{ i, j, w, sign }[]}  w ∈ (0, 1] relative weight; directed edges point i → j.
 */
export function edges(M, n, ks, metric) {
  const out = [];
  let max = 0;
  for (let a = 0; a < ks.length; a++) for (let b = a + 1; b < ks.length; b++) {
    const i = ks[a], j = ks[b];
    const vij = M[i * n + j], vji = M[j * n + i];
    if (!Number.isFinite(vij)) continue;
    if (metric.graph === 'undirected' || metric.graph === 'signed') {
      if (vij === 0) continue;
      out.push({ i, j, w: Math.abs(vij), sign: Math.sign(vij) });
    } else {
      const mid = metric.mid ?? 0;
      const aij = metric.kind === 'seq' ? vij - vji : (vij - mid);   // antisymmetric part
      if (!Number.isFinite(aij) || aij === 0) continue;
      out.push(aij > 0 ? { i, j, w: aij, sign: 1 } : { i: j, j: i, w: -aij, sign: 1 });
    }
  }
  for (const e of out) max = Math.max(max, e.w);
  for (const e of out) e.w = max > 0 ? e.w / max : 0;
  return out;
}
