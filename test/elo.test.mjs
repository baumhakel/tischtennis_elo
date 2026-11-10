// Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { compute, winProbability, at, ratingAfter, ratingsAfter } from '../js/core/elo.js';

const CFG = { k_single: 40, k_double: 20, start_rating: 1400, asymptotic_init: false, asymptotic_init_rounds: 5 };

/** Minimal Dataset from [[winners], [losers]] pairs. */
function ds(list, config = {}) {
  return {
    config: { ...CFG, ...config },
    games: list.map(([w, l], g) => ({ g, t: g, winners: w, losers: l, double: w.length === 2 })),
  };
}

const close = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) < eps, msg || `${a} ≉ ${b}`);

/** Direct transcription of calculate_elo / calculate_elo_once from elo_functions.R. */
function rReference(list, { K_single, K_double, elo_start, initLoops = 0, round = true }) {
  const names = [...new Set(list.flatMap(([w, l]) => [...w, ...l]))];
  let elo = Object.fromEntries(names.map(n => [n, elo_start]));
  const p = (a, b) => { const x = 1 / (1 + 10 ** ((b - a) / 400)); return round ? Math.round(x * 100) / 100 : x; };
  const once = start => {
    const e = { ...start };
    for (const [[w1, w2], [l1, l2]] of list) {
      if (!w2) { const x = p(e[w1], e[l1]); const d = K_single * (1 - x); e[w1] += d; e[l1] -= d; }
      else {
        const x = p((e[w1] + e[w2]) / 2, (e[l1] + e[l2]) / 2); const d = K_double * (1 - x);
        e[w1] += d; e[w2] += d; e[l1] -= d; e[l2] -= d;
      }
    }
    return e;
  };
  for (let i = 0; i < initLoops; i++) elo = once(elo);
  return once(elo);
}

/** Pseudo-random league: 12 players, mixed singles and doubles. */
function league(nGames, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const P = Array.from({ length: 12 }, (_, i) => 'p' + String(i + 1).padStart(3, '0'));
  const skill = P.map((_, i) => i * 40);
  const list = [];
  for (let i = 0; i < nGames; i++) {
    const pick = new Set();
    const k = rnd() < 0.3 ? 4 : 2;
    while (pick.size < k) pick.add(P[Math.floor(rnd() * P.length)]);
    const q = [...pick];
    const A = q.slice(0, k / 2), B = q.slice(k / 2);
    const sa = A.reduce((x, p) => x + skill[P.indexOf(p)], 0), sb = B.reduce((x, p) => x + skill[P.indexOf(p)], 0);
    list.push(rnd() < winProbability(sa / A.length, sb / B.length) ? [A, B] : [B, A]);
  }
  return list;
}

test('winProbability', () => {
  close(winProbability(1400, 1400), 0.5);
  close(winProbability(1800, 1400), 1 / 1.1);
  close(winProbability(1400, 1800) + winProbability(1800, 1400), 1);
});

test('single game: hand calculation', () => {
  const e = compute(ds([[['p001'], ['p002']]]));
  assert.deepEqual(e.ids, ['p001', 'p002']);
  close(e.final[0], 1420); close(e.final[1], 1380);
  close(e.perGame.eW[0], 0.5); close(e.perGame.delta[0], 20);
  close(e.perGame.before[0], 1400); assert.ok(Number.isNaN(e.perGame.before[1]));
});

test('doubles: team mean, each player ±Δ, half-shares in matrices', () => {
  // p001 1420 after game 0; doubles p001+p003 (1420+1400)/2 = 1410 vs p002+p004 (1380+1400)/2 = 1390
  const e = compute(ds([[['p001'], ['p002']], [['p001', 'p003'], ['p002', 'p004']]]));
  const eW = winProbability(1410, 1390), d = 20 * (1 - eW);
  close(e.perGame.rW[1], 1410); close(e.perGame.rL[1], 1390); close(e.perGame.delta[1], d);
  close(e.final[e.index.get('p003')], 1400 + d);
  close(e.final[e.index.get('p004')], 1400 - d);
  const [a, b, c] = ['p001', 'p002', 'p003'].map(id => e.index.get(id));
  close(at(e, e.pair.matchups, a, b), 1.5);
  close(at(e, e.pair.wins, a, b), 1.5);
  close(at(e, e.pair.matchups, c, b), 0.5);
  close(at(e, e.partner.games, a, c), 1); close(at(e, e.partner.wins, a, c), 1);
  close(at(e, e.partner.expected, a, c), eW);
  assert.equal(e.doubles[a], 1); assert.equal(e.singles[a], 1); assert.equal(e.played[a], 2);
});

test('matches the R transcription exactly with R rounding, approximately without', () => {
  const list = league(2000);
  const opts = { K_single: 40, K_double: 20, elo_start: 1400 };
  const R = rReference(list, opts);
  const js = compute(ds(list), { roundP: 2 });
  js.ids.forEach((id, k) => close(js.final[k], R[id], 1e-6, `${id}: ${js.final[k]} vs ${R[id]}`));

  const exact = compute(ds(list));
  const diffs = exact.ids.map((id, k) => Math.abs(exact.final[k] - R[id]));
  assert.ok(Math.max(...diffs) < 40, `bug-#1 effect too large: ${Math.max(...diffs)}`);
  const Rexact = rReference(list, { ...opts, round: false });
  exact.ids.forEach((id, k) => close(exact.final[k], Rexact[id], 1e-6));
});

test('asymptotic init matches R (initLoops)', () => {
  const list = league(300, 3);
  const R = rReference(list, { K_single: 40, K_double: 20, elo_start: 1400, initLoops: 5, round: false });
  const e = compute(ds(list, { asymptotic_init: true, asymptotic_init_rounds: 5 }));
  e.ids.forEach((id, k) => close(e.final[k], R[id], 1e-6));
  assert.equal(e.settings.asymptotic_init_rounds, 5);
  // rounds are ignored while asymptotic_init is FALSE
  assert.equal(compute(ds(list, { asymptotic_init_rounds: 9 })).settings.asymptotic_init_rounds, 0);
});

test('invariants on a 2000-game league', () => {
  const list = league(2000, 11);
  const e = compute(ds(list));
  const n = e.ids.length;
  let sum = 0;
  for (let k = 0; k < n; k++) sum += e.final[k];
  close(sum, n * 1400, 1e-6, 'zero-sum');

  for (let i = 0; i < n; i++) {
    let mRow = 0, tRow = 0, pRow = 0;
    for (let j = 0; j < n; j++) {
      const m = at(e, e.pair.matchups, i, j);
      close(m, at(e, e.pair.matchups, j, i));
      close(at(e, e.pair.wins, i, j) + at(e, e.pair.wins, j, i), m);
      close(at(e, e.pair.expected, i, j) + at(e, e.pair.expected, j, i), m);
      close(at(e, e.pair.transfer, i, j), -at(e, e.pair.transfer, j, i));
      close(at(e, e.partner.games, i, j), at(e, e.partner.games, j, i));
      mRow += m; tRow += at(e, e.pair.transfer, i, j); pRow += at(e, e.partner.games, i, j);
    }
    close(mRow, e.played[i]);
    close(tRow, e.final[i] - e.start[i], 1e-6);
    close(pRow, e.doubles[i]);
    assert.equal(e.wins[i] + e.losses[i], e.played[i]);
    assert.equal(e.singles[i] + e.doubles[i], e.played[i]);
    assert.equal(e.history[i].g.length, e.played[i]);
    close(e.history[i].r.at(-1), e.final[i]);
    assert.equal(e.history[i].g[0], e.firstG[i]);
  }
});

test('players are absent before their first game (bug #2)', () => {
  const e = compute(ds([[['p001'], ['p002']], [['p001'], ['p002']], [['p003'], ['p001']]]));
  const c = e.index.get('p003');
  assert.ok(Number.isNaN(ratingAfter(e, c, 0)));
  assert.ok(Number.isNaN(ratingAfter(e, c, 1)));
  close(ratingAfter(e, c, 2), e.final[c]);
  const r1 = ratingsAfter(e, 1);
  assert.ok(Number.isNaN(r1[c]));
  close(r1[e.index.get('p001')], e.history[e.index.get('p001')].r[1]);
  close(ratingAfter(e, e.index.get('p002'), 2), e.history[e.index.get('p002')].r[1]);  // carried forward
});

test('settings come from config', () => {
  const e = compute(ds([[['p001'], ['p002']]], { k_single: 32, start_rating: 1500 }));
  close(e.final[0], 1516);
});

test('empty dataset', () => {
  const e = compute(ds([]));
  assert.equal(e.ids.length, 0);
  assert.equal(e.perGame.eW.length, 0);
});

test('2000 games compute fast', () => {
  const d = ds(league(2000, 5));
  const t0 = performance.now();
  compute(d);
  const ms = performance.now() - t0;
  assert.ok(ms < 100, `took ${ms} ms`);
});
