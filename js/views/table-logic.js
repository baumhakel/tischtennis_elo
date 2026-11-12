// Pure helpers for the Tisch page (no DOM): previews of a game that hasn't happened yet,
// the doubles split, who sits out, hypothetical games, „Wo hole ich meine Punkte?“, suggestions.
//
// Everything uses the engine's formula exactly (base prompt, Computation):
//   e_W = 1 / (1 + 10^((R_L − R_W)/400)),  Δ = K (1 − e_W),  team rating = mean of the two,
//   K = k_single for singles, k_double for doubles, every winner +Δ, every loser −Δ.
// Players without games in a model start at start_rating.
import { winProbability } from '../core/elo.js';

/** Current Elo-Wert of player id in model (start_rating if the player has no games there). */
export function ratingOf(model, id, ratings = null) {
  if (ratings?.has(id)) return ratings.get(id);
  const k = model.elo.index.get(id);
  return k === undefined ? model.dataset.config.start_rating : model.elo.final[k];
}

/** Win chance of side W over side L and the Δ at stake, from current (or given) ratings. */
export function previewGame(model, winners, losers, ratings = null) {
  const cfg = model.dataset.config;
  const mean = ids => ids.reduce((s, id) => s + ratingOf(model, id, ratings), 0) / ids.length;
  const rW = mean(winners), rL = mean(losers);
  const eW = winProbability(rW, rL);
  const K = winners.length > 1 ? cfg.k_double : cfg.k_single;
  return { rW, rL, eW, delta: K * (1 - eW) };
}

/**
 * Apply hypothetical games in order to the current ratings.
 * @param {{winners: string[], losers: string[]}[]} games
 * @returns {{ ratings: Map<string, number>, extra: Map<string, number> }}  ratings of everyone touched, extra games per player
 */
export function applyGames(model, games, start = null) {
  const ratings = new Map(start?.ratings || []), extra = new Map(start?.extra || []);
  for (const g of games) {
    const { delta } = previewGame(model, g.winners, g.losers, ratings);
    for (const id of g.winners) ratings.set(id, ratingOf(model, id, ratings) + delta);
    for (const id of g.losers) ratings.set(id, ratingOf(model, id, ratings) - delta);
    for (const id of [...g.winners, ...g.losers]) extra.set(id, (extra.get(id) || 0) + 1);
  }
  return { ratings, extra };
}

/**
 * Platz of every ranked player: listed (not inactive) players plus anyone in `extra` (they just
 * played), ranked if they have ≥ minGames games; ties share the better Platz.
 * @returns {Map<string, number>} id → Platz (provisional players are missing)
 */
export function standings(model, vis, minGames, { ratings = null, extra = null } = {}) {
  const { elo } = model;
  const ids = new Set(vis.listed.map(k => elo.ids[k]));
  for (const id of extra?.keys() || []) ids.add(id);
  const played = id => (elo.index.has(id) ? elo.played[elo.index.get(id)] : 0) + (extra?.get(id) || 0);
  const ranked = [...ids].filter(id => played(id) >= minGames)
    .map(id => ({ id, r: ratingOf(model, id, ratings) }))
    .sort((a, b) => b.r - a.r);
  const out = new Map();
  ranked.forEach((x, i) => out.set(x.id, i > 0 && x.r === ranked[i - 1].r ? out.get(ranked[i - 1].id) : i + 1));
  return out;
}

/**
 * What a result would do: per player Elo before → after and Platz before → after.
 * @returns {{ eW, delta, players: {id, side, before, after, delta, rankBefore, rankAfter}[] }}
 */
export function outcome(model, vis, minGames, winners, losers) {
  const p = previewGame(model, winners, losers);
  const after = applyGames(model, [{ winners, losers }]);
  const r0 = standings(model, vis, minGames), r1 = standings(model, vis, minGames, after);
  const row = (id, side) => ({
    id, side, before: ratingOf(model, id), after: after.ratings.get(id),
    delta: side === 'w' ? p.delta : -p.delta, rankBefore: r0.get(id) ?? null, rankAfter: r1.get(id) ?? null,
  });
  return { ...p, players: [...winners.map(id => row(id, 'w')), ...losers.map(id => row(id, 'l'))] };
}

/** The three ways to split four players into two teams, most balanced first. */
export function splits(model, four) {
  const [a, b, c, d] = four;
  return [[[a, b], [c, d]], [[a, c], [b, d]], [[a, d], [b, c]]]
    .map(([A, B]) => ({ A, B, eA: previewGame(model, A, B).eW }))
    .sort((x, y) => Math.abs(x.eA - 0.5) - Math.abs(y.eA - 0.5));
}

/** Monday 00:00 (sheet serial) of the week containing serial t. Serial 0 = Sat 30 Dec 1899. */
export const weekStart = t => Math.floor(t) - ((Math.floor(t) + 5) % 7);

/** Games per player today and this week (all games, any Wertung). */
export function gamesTodayWeek(dataset, now) {
  const day = Math.floor(now), week = weekStart(now);
  const today = new Map(), thisWeek = new Map();
  for (let i = dataset.games.length - 1; i >= 0; i--) {
    const x = dataset.games[i];
    if (x.t < week) break;
    for (const id of [...x.winners, ...x.losers]) {
      thisWeek.set(id, (thisWeek.get(id) || 0) + 1);
      if (x.t >= day) today.set(id, (today.get(id) || 0) + 1);
    }
  }
  return { today, thisWeek };
}

/**
 * Who plays and who sits out when more people are at the table than a game needs: those with the
 * fewest games today play (rounds already played at the table this session count as games), then
 * whoever sat out more rounds, then fewest this week, then alphabetical (names) — deterministic,
 * so everyone sees the same suggestion.
 */
export function whoPlays(present, need, { today, thisWeek, rounds = new Map(), satOut = new Map(), names = new Map() }) {
  const order = present.slice().sort((a, b) =>
    ((today.get(a) || 0) + (rounds.get(a) || 0)) - ((today.get(b) || 0) + (rounds.get(b) || 0))
    || (satOut.get(b) || 0) - (satOut.get(a) || 0)
    || (thisWeek.get(a) || 0) - (thisWeek.get(b) || 0)
    || String(names.get(a) ?? a).localeCompare(String(names.get(b) ?? b), 'de'));
  return { play: order.slice(0, need), out: order.slice(need) };
}

/** Most balanced singles pairing among the given players. */
export function bestPair(model, ids) {
  let best = null;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const e = previewGame(model, [ids[i]], [ids[j]]).eW;
    if (!best || Math.abs(e - 0.5) < Math.abs(best.e - 0.5)) best = { a: ids[i], b: ids[j], e };
  }
  return best;
}

/**
 * Pre-filled link to the Ergebnis form (Google Forms pre-fill: ?usp=pp_url&entry.<id>=<answer>).
 * URL and question IDs come from the config tab only (never from the code). Without the IDs the
 * plain form URL is returned; without the URL null.
 */
export function prefillUrl(cfg, winners, losers, nameOf) {
  if (!cfg.form_result_url) return null;
  const keys = ['form_result_entry_winner1', 'form_result_entry_winner2', 'form_result_entry_loser1', 'form_result_entry_loser2'];
  const answers = [winners[0], winners[1], losers[0], losers[1]];
  const needed = keys.filter((_, i) => answers[i]);
  if (!needed.every(k => cfg[k])) return cfg.form_result_url;
  try {
    const url = new URL(cfg.form_result_url);
    url.searchParams.set('usp', 'pp_url');
    keys.forEach((k, i) => { if (answers[i]) url.searchParams.set(`entry.${String(cfg[k]).replace(/^entry\./, '')}`, nameOf(answers[i])); });
    return url.toString();
  } catch { return cfg.form_result_url; }
}

/**
 * Singles wins against `opp` that `me` would need to get above `target` (a rating, or the id of a
 * player whose rating moves too when it is the opponent). null if more than `max` would be needed.
 */
export function winsNeeded(model, me, opp, targetId, max = 30) {
  let ratings = new Map();
  for (let n = 1; n <= max; n++) {
    ratings = applyGames(model, [{ winners: [me], losers: [opp] }], { ratings }).ratings;
    if (ratingOf(model, me, ratings) > ratingOf(model, targetId, ratings)) return n;
  }
  return null;
}

/**
 * Head-to-head residuals, empirical-Bayes shrunk towards 0: per pair the mean of (wins − expected)
 * per Begegnung, r̄ = R / n, with sampling variance v ≈ 1/(4n) (the binomial maximum, so the
 * shrinkage is conservative); between-pair variance τ² = max(0, mean(r̄² − v)) over all pairs
 * (method of moments); shrunk value r̄ · τ² / (τ² + v).
 * @returns {{ tau2: number, at(i, j): number|null }} at(i, j) from i's view (k indices), null without games
 */
export function shrunkResiduals(model) {
  const M = model.stats.get('matrices');
  const n = model.elo.ids.length;
  let sum = 0, cnt = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const m = M.matchups[i * n + j];
    if (!(m > 0)) continue;
    const r = M.actualVsExpected[i * n + j] / m;
    sum += r * r - 1 / (4 * m); cnt++;
  }
  const tau2 = cnt ? Math.max(0, sum / cnt) : 0;
  return {
    tau2,
    at(i, j) {
      const m = M.matchups[i * n + j];
      if (!(m > 0)) return null;
      const v = 1 / (4 * m);
      return tau2 > 0 ? (M.actualVsExpected[i * n + j] / m) * tau2 / (tau2 + v) : 0;
    },
  };
}

/**
 * „Wer sollte als Nächstes spielen?“: singles pairs among shown players, ranked by information
 * value p(1 − p) (closest to 50 % says most about the ratings) × (1 + 1/(1 + recent meetings)).
 * @returns {{ a, b, p, recent, lastT }[]}  ids, win chance of a, meetings in the last `days` days, last meeting
 */
export function suggestions(model, vis, now, days, count) {
  const { elo, dataset } = model;
  const ks = vis.shown;
  const n = elo.ids.length;
  const recent = new Float64Array(n * n), last = new Float64Array(n * n).fill(-Infinity);
  const from = now - days;
  dataset.games.forEach((x, g) => {
    for (const w of x.winners) for (const l of x.losers) {
      const i = elo.index.get(w), j = elo.index.get(l);
      for (const c of [i * n + j, j * n + i]) {
        last[c] = Math.max(last[c], x.t);
        if (x.t >= from) recent[c] += x.double ? 0.5 : 1;
      }
    }
  });
  const out = [];
  for (let a = 0; a < ks.length; a++) for (let b = a + 1; b < ks.length; b++) {
    const i = ks[a], j = ks[b];
    const p = winProbability(elo.final[i], elo.final[j]);
    const r = recent[i * n + j];
    out.push({ a: elo.ids[i], b: elo.ids[j], p, recent: r, lastT: last[i * n + j], score: p * (1 - p) * (1 + 1 / (1 + r)) });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, count);
}
