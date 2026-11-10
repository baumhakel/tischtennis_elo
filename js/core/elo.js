// Elo engine: one replay of all games → ratings, histories and pairwise matrices. Pure.
//
// Port of calculate_elo_once (elo_functions.R), with the known-bug fixes:
//   #1 no rounding of the win probability inside the update (round only for display)
//   #2 a player has no rating before their first game (no 1400 placeholder in histories)
//
//   e_W = 1 / (1 + 10^((R_L − R_W)/400)),  Δ = K (1 − e_W)
//   singles: K = k_single, R = player ratings
//   doubles: K = k_double, R = mean of the two players; each winner +Δ, each loser −Δ
//
// Pairwise bookkeeping as in R: a doubles game counts as half a matchup, half a win and
// half the transfer for each of the 2×2 winner–loser pairs, so every row of `matchups`
// sums to the player's number of games.

/** @typedef {import('../types.js').Dataset} Dataset */
/** @typedef {import('../types.js').EloResult} EloResult */

/** Win probability of a side rated a against a side rated b. */
export function winProbability(a, b) {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

/**
 * @param {Dataset} dataset
 * @param {Object} [opts]
 * @param {number} [opts.roundP]  ONLY for validation against the R script: round e_W to this many
 *                                decimals inside the update, as R does (bug #1). Never in the app.
 * @returns {EloResult}
 */
export function compute(dataset, opts = {}) {
  const { games, config } = dataset;
  const settings = {
    k_single: config.k_single,
    k_double: config.k_double,
    start_rating: config.start_rating,
    asymptotic_init: !!config.asymptotic_init,
    asymptotic_init_rounds: config.asymptotic_init ? config.asymptotic_init_rounds : 0,
  };

  // Players who played at least once, in ID order. k = row/column in every matrix.
  const seen = new Set();
  for (const g of games) for (const id of [...g.winners, ...g.losers]) seen.add(id);
  const ids = [...seen].sort();
  const index = new Map(ids.map((id, k) => [id, k]));
  const n = ids.length, N = games.length;

  // Games as index tuples, built once: [w1, w2, l1, l2], -1 for empty doubles slots.
  const slots = new Int32Array(4 * N).fill(-1);
  games.forEach((g, i) => {
    slots[4 * i] = index.get(g.winners[0]);
    slots[4 * i + 2] = index.get(g.losers[0]);
    if (g.double) {
      slots[4 * i + 1] = index.get(g.winners[1]);
      slots[4 * i + 3] = index.get(g.losers[1]);
    }
  });

  const pOf = opts.roundP == null
    ? winProbability
    : (a, b) => { const f = 10 ** opts.roundP; return Math.round(winProbability(a, b) * f) / f; };

  // Start ratings: start_rating, or the final ratings after n silent replays (asymptotic init).
  let start = new Float64Array(n).fill(settings.start_rating);
  for (let round = 0; round < settings.asymptotic_init_rounds; round++) {
    start = replay(start, slots, N, settings, pOf, null);
  }

  const rec = makeRecorder(n, N);
  const final = replay(start, slots, N, settings, pOf, rec);

  return {
    settings,
    ids, index,
    slots,
    start,
    final,
    perGame: { rW: rec.rW, rL: rec.rL, eW: rec.eW, delta: rec.delta, before: rec.before },
    history: rec.finishHistory(),
    played: rec.played, wins: rec.wins, losses: rec.losses,
    singles: rec.singles, doubles: rec.doubles,
    firstG: rec.firstG, lastG: rec.lastG,
    pair: { matchups: rec.matchups, wins: rec.pairWins, transfer: rec.transfer, expected: rec.expected },
    partner: { games: rec.partnerGames, wins: rec.partnerWins, expected: rec.partnerExpected },
  };
}

/**
 * Replays all games from `start`. Returns the final ratings. With a recorder, writes every
 * per-game and per-player quantity; without one (asymptotic init) it only updates ratings.
 */
function replay(start, slots, N, settings, pOf, rec) {
  const r = Float64Array.from(start);
  for (let i = 0; i < N; i++) {
    const w1 = slots[4 * i], w2 = slots[4 * i + 1], l1 = slots[4 * i + 2], l2 = slots[4 * i + 3];
    const dbl = w2 !== -1;
    const rW = dbl ? (r[w1] + r[w2]) / 2 : r[w1];
    const rL = dbl ? (r[l1] + r[l2]) / 2 : r[l1];
    const eW = pOf(rW, rL);
    const delta = (dbl ? settings.k_double : settings.k_single) * (1 - eW);

    if (rec) rec.onBefore(i, r, w1, w2, l1, l2, rW, rL, eW, delta);
    r[w1] += delta; r[l1] -= delta;
    if (dbl) { r[w2] += delta; r[l2] -= delta; }
    if (rec) rec.onAfter(i, r, w1, w2, l1, l2, eW, delta);
  }
  return r;
}

function makeRecorder(n, N) {
  const sq = () => new Float64Array(n * n);
  const hg = Array.from({ length: n }, () => []);   // per player: global game indices
  const hr = Array.from({ length: n }, () => []);   // per player: rating after that game

  const rec = {
    rW: new Float64Array(N), rL: new Float64Array(N), eW: new Float64Array(N), delta: new Float64Array(N),
    before: new Float64Array(4 * N).fill(NaN),   // each slot's own rating before the game
    played: new Int32Array(n), wins: new Int32Array(n), losses: new Int32Array(n),
    singles: new Int32Array(n), doubles: new Int32Array(n),
    firstG: new Int32Array(n).fill(-1), lastG: new Int32Array(n).fill(-1),
    matchups: sq(), pairWins: sq(), transfer: sq(), expected: sq(),
    partnerGames: sq(), partnerWins: sq(), partnerExpected: sq(),

    onBefore(i, r, w1, w2, l1, l2, rW, rL, eW, delta) {
      rec.rW[i] = rW; rec.rL[i] = rL; rec.eW[i] = eW; rec.delta[i] = delta;
      rec.before[4 * i] = r[w1]; rec.before[4 * i + 2] = r[l1];
      if (w2 !== -1) { rec.before[4 * i + 1] = r[w2]; rec.before[4 * i + 3] = r[l2]; }
    },

    onAfter(i, r, w1, w2, l1, l2, eW, delta) {
      const dbl = w2 !== -1;
      const W = dbl ? [w1, w2] : [w1], L = dbl ? [l1, l2] : [l1];
      const share = dbl ? 0.5 : 1;
      for (const k of W) rec.wins[k]++;
      for (const k of L) rec.losses[k]++;
      for (const k of W.concat(L)) {
        rec.played[k]++;
        (dbl ? rec.doubles : rec.singles)[k]++;
        if (rec.firstG[k] === -1) rec.firstG[k] = i;
        rec.lastG[k] = i;
        hg[k].push(i); hr[k].push(r[k]);
      }
      for (const w of W) for (const l of L) {
        const wl = w * n + l, lw = l * n + w;
        rec.matchups[wl] += share; rec.matchups[lw] += share;
        rec.pairWins[wl] += share;
        rec.transfer[wl] += share * delta; rec.transfer[lw] -= share * delta;
        rec.expected[wl] += share * eW; rec.expected[lw] += share * (1 - eW);
      }
      if (dbl) { partner(w1, w2, 1, eW); partner(l1, l2, 0, 1 - eW); }
    },

    finishHistory() {
      return hg.map((g, k) => ({ g: Int32Array.from(g), r: Float64Array.from(hr[k]) }));
    },
  };

  function partner(a, b, won, e) {
    for (const [x, y] of [[a, b], [b, a]]) {
      rec.partnerGames[x * n + y] += 1;
      rec.partnerWins[x * n + y] += won;
      rec.partnerExpected[x * n + y] += e;
    }
  }
  return rec;
}

// ───────── Lookups on an EloResult (pure helpers for stats and views) ─────────

/** Matrix cell (row i, column j) of an n×n Float64Array. */
export function at(elo, M, i, j) {
  return M[i * elo.ids.length + j];
}

/**
 * Rating of player k right after global game g (or after their last game before g).
 * NaN before the player's first game.
 */
export function ratingAfter(elo, k, g) {
  const h = elo.history[k];
  let lo = 0, hi = h.g.length - 1, pos = -1;
  while (lo <= hi) {                       // last own game index ≤ g
    const mid = (lo + hi) >> 1;
    if (h.g[mid] <= g) { pos = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return pos === -1 ? NaN : h.r[pos];
}

/** Everyone's rating right after global game g (NaN = not yet played). */
export function ratingsAfter(elo, g) {
  return Float64Array.from(elo.ids, (_, k) => ratingAfter(elo, k, g));
}
