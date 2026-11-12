// Jahresrückblick: the facts of one calendar year, for one player or the whole league (PURE, no DOM).
// Always on all games (pooled ratings), like the Abzeichen: the story of a year shouldn't depend on the Wertung switch.
// Week- and day-based facts from Altdaten are approximate (their times are interpolated): `approx` says so.
//
//   reviewYears(dataset)                       → years with games, newest first
//   reviewSeason(cfg, now)                     → { inSeason, year } (year the season looks back on)
//   playerYear(model, A, year, id, now)        → facts or null (no games that year)
//   leagueYear(model, A, year, now)            → facts or null
import { serialFromParts, serialToParts } from '../core/normalize.js';
import { weekStart } from '../core/stats/activity.js';


export function yearWindow(year) {
  return { from: serialFromParts(year, 1, 1), to: serialFromParts(year + 1, 1, 1) };
}

export function reviewYears(dataset) {
  const ys = new Set(dataset.games.map(g => serialToParts(g.t).y));
  return [...ys].sort((a, b) => b - a);
}

/** Month and day from a `monthday` config value ([m, d]). The season may wrap the new year (12-01 … 01-31). */
export function reviewSeason(cfg, now) {
  const p = serialToParts(now);
  const md = p.mo * 100 + p.d;
  const [fm, fd] = cfg.year_review_from, [um, ud] = cfg.year_review_until;
  const from = fm * 100 + fd, until = um * 100 + ud;
  const wraps = from > until;
  const inSeason = wraps ? md >= from || md <= until : md >= from && md <= until;
  const year = inSeason && wraps && md <= until ? p.y - 1 : p.y;
  return { inSeason, year };
}

/** Indices of global games inside [from, to). Games are sorted by time. */
function gameRange(dataset, from, to) {
  const G = dataset.games;
  let a = 0;
  while (a < G.length && G[a].t < from) a++;
  let b = a;
  while (b < G.length && G[b].t < to) b++;
  return [a, b];
}

const isWin = (elo, k, g) => elo.slots[4 * g] === k || elo.slots[4 * g + 1] === k;
const sides = (elo, g) => {
  const s = elo.slots.subarray(4 * g, 4 * g + 4);
  return { W: [s[0], s[1]].filter(x => x >= 0), L: [s[2], s[3]].filter(x => x >= 0) };
};

/** Rating of every player at time `t` (after all games before t); NaN for players without a game yet. */
function ratingsAt(elo, gEnd) {
  const r = new Float64Array(elo.ids.length).fill(NaN);
  elo.history.forEach((h, k) => {
    let lo = 0, hi = h.g.length;                      // last own game with index < gEnd
    while (lo < hi) { const m = (lo + hi) >> 1; if (h.g[m] < gEnd) lo = m + 1; else hi = m; }
    if (lo > 0) r[k] = h.r[lo - 1];
  });
  return r;
}

/** Platz at the end of the window, by the default filters (min games, inactivity). */
function placesAt(dataset, elo, gEnd, tEnd) {
  const cfg = dataset.config;
  const r = ratingsAt(elo, gEnd);
  const ok = [];
  elo.ids.forEach((_, k) => {
    const h = elo.history[k];
    let n = 0, last = -1;
    for (let i = 0; i < h.g.length && h.g[i] < gEnd; i++) { n++; last = h.g[i]; }
    if (n < cfg.default_min_games || last < 0) return;
    if (cfg.default_inactivity_days > 0 && dataset.games[last].t < tEnd - cfg.default_inactivity_days) return;
    ok.push(k);
  });
  ok.sort((a, b) => r[b] - r[a]);
  return { order: ok, ratings: r };
}

/** Per-player counters inside the window (one pass). */
function tally(model, a, b) {
  const { elo, dataset } = model;
  const n = elo.ids.length;
  const P = Array.from({ length: n }, () => ({
    games: 0, wins: 0, singles: 0, doubles: 0, days: new Set(), weeks: new Map(),
    opp: new Map(), part: new Map(), firstG: -1, lastG: -1, bestUpset: null, streak: 0, streakFrom: -1, best: null,
  }));
  let legacy = 0;
  for (let g = a; g < b; g++) {
    const game = dataset.games[g];
    if (game.source === 'legacy') legacy++;
    const { W, L } = sides(elo, g);
    const dbl = W.length > 1, eW = elo.perGame.eW[g], d = elo.perGame.delta[g];
    for (const [team, other, win] of [[W, L, true], [L, W, false]]) {
      for (const k of team) {
        const p = P[k];
        p.games++; if (win) p.wins++; if (dbl) p.doubles++; else p.singles++;
        if (p.firstG < 0) p.firstG = g;
        p.lastG = g;
        p.days.add(Math.floor(game.t));
        const wk = weekStart(game.t), w = p.weeks.get(wk) || { gain: 0, games: 0, wins: 0 };
        w.gain += win ? d : -d; w.games++; if (win) w.wins++;
        p.weeks.set(wk, w);
        const share = dbl ? 0.5 : 1;
        for (const o of other) {
          const x = p.opp.get(o) || { meetings: 0, wins: 0 };
          x.meetings += share; if (win) x.wins += share;
          p.opp.set(o, x);
        }
        if (dbl) for (const m of team) if (m !== k) {
          const x = p.part.get(m) || { games: 0, wins: 0 };
          x.games++; if (win) x.wins++;
          p.part.set(m, x);
        }
        if (win && (!p.bestUpset || eW < p.bestUpset.chance)) p.bestUpset = { g, chance: eW };
        if (win) {
          if (p.streak === 0) p.streakFrom = g;
          p.streak++;
          if (!p.best || p.streak > p.best.len) p.best = { len: p.streak, fromG: p.streakFrom, toG: g };
        } else p.streak = 0;
      }
    }
  }
  return { P, legacy, total: b - a };
}

const pick = (map, score, minFn = () => true) => {
  let best = null;
  for (const [k, v] of map) if (minFn(v) && (!best || score(v) > score(best.v))) best = { k, v };
  return best;
};

export function playerYear(model, A, year, id, now) {
  const { elo, dataset } = model;
  const k = elo.index.get(id);
  if (k === undefined) return null;
  const cfg = dataset.config;
  const { from, to } = yearWindow(year);
  const [a, b] = gameRange(dataset, from, to);
  const { P, legacy, total } = tally(model, a, b);
  const p = P[k];
  if (!p.games) return null;
  const h = elo.history[k];
  const own = [];
  for (let i = 0; i < h.g.length; i++) if (h.g[i] >= a && h.g[i] < b) own.push(i);
  const i0 = own[0], i1 = own[own.length - 1];
  const eloStart = i0 > 0 ? h.r[i0 - 1] : elo.start[k];
  const spark = [eloStart, ...own.map(i => h.r[i])];
  const byGames = P.map((x, j) => ({ j, n: x.games })).filter(x => x.n > 0).sort((x, y) => y.n - x.n);
  const gamesRank = 1 + byGames.findIndex(x => x.n === p.games);   // ties share the better Platz
  const weeks = [...p.weeks.entries()].map(([wk, w]) => ({ from: wk, ...w }));
  const bestWeek = weeks.sort((x, y) => y.gain - x.gain)[0];
  const hMin = cfg.h2h_min_games;
  const oppMost = pick(p.opp, v => v.meetings);
  const partMost = pick(p.part, v => v.games);
  const qualified = [...p.opp.entries()].filter(([, v]) => v.meetings >= hMin).map(([o, v]) => ({ o, v, share: v.wins / v.meetings }));
  qualified.sort((x, y) => x.share - y.share || y.v.meetings - x.v.meetings);
  const nemesis = qualified.length ? qualified[0] : null;
  const favourite = qualified.length > 1 ? qualified[qualified.length - 1] : null;
  const end = Math.min(to, now);
  const places = placesAt(dataset, elo, b, end);
  const place = places.order.indexOf(k) + 1 || null;
  const earned = (A?.players.get(id)?.earned || []).filter(e => e.t >= from && e.t < to);
  const id_ = j => elo.ids[j];
  return {
    year, id, running: now < to, approx: legacy > 0,
    games: p.games, wins: p.wins, losses: p.games - p.wins, singles: p.singles, doubles: p.doubles,
    days: p.days.size, gamesRank, gamesOf: byGames.length,
    eloStart, eloEnd: h.r[i1], spark, newcomer: i0 === 0,   // newcomer: first game ever in this year (spark starts at the start rating)
    firstG: p.firstG, lastG: p.lastG,
    bestWeek: bestWeek && bestWeek.gain > 0 ? bestWeek : null,
    upset: p.bestUpset && p.bestUpset.chance < 0.5 ? p.bestUpset : null,
    streak: p.best && p.best.len >= 2 ? p.best : null,
    opponent: oppMost ? { id: id_(oppMost.k), ...oppMost.v } : null,
    partner: partMost ? { id: id_(partMost.k), ...partMost.v } : null,
    nemesis: nemesis && nemesis.share < 0.5 ? { id: id_(nemesis.o), ...nemesis.v } : null,
    favourite: favourite && favourite.share > 0.5 ? { id: id_(favourite.o), ...favourite.v } : null,
    place, placeOf: places.order.length,
    badges: earned,
    share: { total, legacy },
  };
}

export function leagueYear(model, A, year, now) {
  const { elo, dataset } = model;
  const cfg = dataset.config;
  const { from, to } = yearWindow(year);
  const [a, b] = gameRange(dataset, from, to);
  if (b <= a) return null;
  const { P, legacy, total } = tally(model, a, b);
  let singles = 0;
  const weeks = new Map();
  let upset = null;
  for (let g = a; g < b; g++) {
    if (elo.slots[4 * g + 1] < 0) singles++;
    const wk = weekStart(dataset.games[g].t);
    weeks.set(wk, (weeks.get(wk) || 0) + 1);
    const eW = elo.perGame.eW[g];
    if (!upset || eW < upset.chance) upset = { g, chance: eW };
  }
  const busiest = [...weeks.entries()].sort((x, y) => y[1] - x[1])[0];
  const players = P.map((p, k) => ({ id: elo.ids[k], k, ...p })).filter(p => p.games > 0);
  const mostGames = players.slice().sort((x, y) => y.games - x.games).slice(0, 3).map(p => ({ id: p.id, games: p.games, days: p.days.size }));
  // Elo gained over the year, among players with enough games in it
  const before = ratingsAt(elo, a), after = ratingsAt(elo, b);
  const gainers = players.filter(p => p.games >= cfg.default_min_games).map(p => ({
    id: p.id, gain: after[p.k] - (Number.isFinite(before[p.k]) ? before[p.k] : elo.start[p.k]), games: p.games,
  })).sort((x, y) => y.gain - x.gain).slice(0, 3);
  // Aufsteiger der Woche (completed calendar weeks in this year) and reigns on Platz 1, clipped to the year
  const weekly = (A?.weekly || []).filter(w => w.id && w.from >= from && w.from < to);
  const wc = new Map();
  for (const w of weekly) wc.set(w.id, (wc.get(w.id) || 0) + 1);
  const risers = [...wc.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([id, n]) => ({ id, n }));
  const end = Math.min(to, now);
  const reigns = (A?.reigns || []).map(r => ({ id: r.id, from: Math.max(r.from, from), to: Math.min(r.current ? end : r.to, end) }))
    .filter(r => r.to > r.from).map(r => ({ ...r, days: r.to - r.from }));
  const throne = new Map();
  for (const r of reigns) throne.set(r.id, (throne.get(r.id) || 0) + r.days);
  const leaders = [...throne.entries()].sort((x, y) => y[1] - x[1]).map(([id, days]) => ({ id, days }));
  const longest = reigns.slice().sort((x, y) => y.days - x.days)[0] || null;
  const places = placesAt(dataset, elo, b, end);
  return {
    year, running: now < to, approx: legacy > 0,
    games: total, singles, doubles: total - singles, players: players.length,
    busiestWeek: busiest ? { from: busiest[0], games: busiest[1] } : null,
    upset, mostGames, gainers, risers, leaders, longest,
    top: places.order.slice(0, 3).map(k => ({ id: elo.ids[k], rating: places.ratings[k] })),
    share: { total, legacy },
  };
}
