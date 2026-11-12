// Run: node --test test/*.test.mjs — Phase 16: Labor (core/lab.js), Doppelspezialist
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../js/core/loader.js';
import { compute } from '../js/core/elo.js';
import { createStats } from '../js/core/stats/index.js';
import { labSchedule, measure, nullRuns, summarize, timedGroups, diversity } from '../js/core/lab.js';
import { modelFor } from '../js/app/modes.js';
import { specialists } from '../js/views/duels.js';
import { demoRaw } from '../js/io/demo.js';

const d = load(demoRaw('Europe/Vienna', 'klein'));
const elo = compute(d);
const model = { dataset: d, elo, stats: createStats(d, elo, {}) };
const L = 3;
const S = labSchedule(model, { streak: L, minH: d.config.h2h_min_games });
const obs = measure(S, new Uint8Array(S.N).fill(1), S.eW, { lists: true });
const mean = a => a.sum / a.n;

test('hot hand: counts and sums match a brute-force pass over each player', () => {
  let n = 0, sum = 0;
  for (let k = 0; k < elo.ids.length; k++) {
    const gs = elo.history[k].g;
    let run = 0;
    for (const g of gs) {
      const won = d.games[g].winners.includes(elo.ids[k]);
      const e = won ? elo.perGame.eW[g] : 1 - elo.perGame.eW[g];
      if (run >= L) { n++; sum += (won ? 1 : 0) - e; }
      run = won ? (run > 0 ? run + 1 : 1) : (run < 0 ? run - 1 : -1);
    }
  }
  assert.equal(obs.hot.n, n);
  assert.ok(Math.abs(obs.hot.sum - sum) < 1e-9);
});

test('the null replays the real engine: with certain outcomes it reproduces the real history', () => {
  const sure = { ...S, eW: new Float64Array(S.N).fill(1) };
  const nul = nullRuns(sure, 2, 1);
  assert.ok(Math.abs(nul.hot[0] - mean(obs.hot)) < 1e-9);
  assert.ok(Math.abs(nul.revenge[1] - mean(obs.revenge)) < 1e-9);
  assert.equal(nul.cycles[0], obs.cycles);
});

test('summary: effects, intervals and p-values from the null', () => {
  const nul = nullRuns(S, 120, 7);
  assert.deepEqual(nullRuns(S, 120, 7).hot, nul.hot);   // seeded
  const s = summarize(obs, nul, 30);
  for (const key of ['hot', 'cold', 'revenge']) {
    const e = s[key];
    assert.ok(e.lo <= e.hi);
    assert.ok(e.p >= 0 && e.p <= 1);
    assert.ok(Math.abs(e.effect - (e.observed - e.nullMean)) < 1e-12);
  }
  assert.ok(s.cycles.p >= 0 && s.cycles.p <= 1);
  assert.equal(s.cycles.list.length, s.cycles.observed);
  assert.ok(s.hotPlayers.rows.every(r => r.lo <= r.est && r.est <= r.hi));
  // without the null yet: only the observed part
  const early = summarize(obs, null, 30);
  assert.equal(early.ready, false);
  assert.equal(early.hot.effect, undefined);
});

test('form-entry analyses: only Spiele rows, groups add up', () => {
  const T = timedGroups(model, { gapMinutes: d.config.session_gap_minutes, minSamples: 5 });
  const formGames = d.games.filter(x => x.source === 'spiele');
  const slots = formGames.reduce((s, x) => s + x.winners.length + x.losers.length, 0);
  const pos = T.find(a => a.key === 'position');
  assert.equal(pos.groups.reduce((s, g) => s + g.n, 0), slots);
  const hour = T.find(a => a.key === 'hour').cells;
  assert.ok(hour.rows.every(r => r.n >= 5));
});

test('Gegnervielfalt and Doppelspezialist', () => {
  const rows = diversity(model, elo.ids.map((_, k) => k));
  for (const r of rows) assert.ok(r.effective >= 1 - 1e-9 && r.effective <= r.opponents + 1e-9);
  const E = modelFor(model, 'einzel'), D = modelFor(model, 'doppel');
  const sp = specialists(E, D, 5, 5);
  assert.ok(sp.length >= 3);
  const m = key => sp.reduce((s, r) => s + r[key], 0) / sp.length;
  assert.ok(Math.abs(m('zsingle')) < 1e-9 && Math.abs(m('zdouble')) < 1e-9);
  for (let i = 1; i < sp.length; i++) assert.ok(sp[i - 1].score >= sp[i].score);
});
