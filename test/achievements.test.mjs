// Run: node --test test/*.test.mjs — Phase 12: Abzeichen (core/achievements.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_DEFAULTS } from '../js/config.js';
import { load } from '../js/core/loader.js';
import { compute } from '../js/core/elo.js';
import { serialFromParts } from '../js/core/normalize.js';
import { computeAchievements, levelFor, levelsOf } from '../js/core/achievements.js';
import { demoRaw } from '../js/io/demo.js';
import { modeDataset } from '../js/app/modes.js';

const NAMES = ['A', 'B', 'C', 'D', 'E', 'F'];
const MON = serialFromParts(2026, 11, 16);          // Monday 16 Nov 2026
const at = (day, hour = 12) => MON + day + hour / 24;

/** games: [t, [winners], [losers]] as form entries (exact times). */
function run(games, cfg = {}, now = at(60)) {
  const config = [['key', 'value'], ...Object.entries({ ...Object.fromEntries(Object.entries(CONFIG_DEFAULTS).map(([k, d]) => [k, d.value])),
    responses_valid_from: MON - 30, achievement_rank_min_games: 1, achievement_rank_active_days: 30, rising_star_min_games: 1, ...cfg })];
  const raw = {
    config, legacy: [['timestamp', 'winner1', 'winner2', 'loser1', 'loser2', 'source_row']],
    spiele: [['Zeitstempel', 'Sieger 1', 'Sieger 2', 'Verlierer 1', 'Verlierer 2'],
      ...games.map(([t, w, l]) => [t, w[0], w[1] || '', l[0], l[1] || ''])],
    players: [['id', 'display_name', 'active'], ...NAMES.map((n, i) => [`p${i + 1}`, n, true])],
    aliases: [['name', 'player_id'], ...NAMES.map((n, i) => [n, `p${i + 1}`])],
    corrections: [['game_ref', 'action', 'note']],
  };
  const d = load(raw), elo = compute(d);
  assert.deepEqual(d.issues.filter(i => i.level === 'error'), []);
  const sub = mode => { const ds = modeDataset(d, mode); return { dataset: ds, elo: compute(ds) }; };
  const A = computeAchievements({ dataset: d, elo }, { einzel: sub('einzel'), doppel: sub('doppel') }, now);
  const id = name => `p${NAMES.indexOf(name) + 1}`;
  return { A, d, elo, has: (name, badge, lvl = 1) => (A.players.get(id(name))?.level[badge] || 0) >= lvl,
    when: (name, badge, lvl = 1) => A.players.get(id(name))?.earned.find(e => e.badge === badge && e.level === lvl) };
}

test('config lists drive the levels; more numbers = more levels', () => {
  const games = Array.from({ length: 6 }, (_, i) => [at(0, 8 + i * 0.5), ['A'], ['B']]);
  let r = run(games, { achievement_games_levels: [2, 4] });
  assert.equal(r.A.players.get('p1').level.games, 2);
  r = run(games, { achievement_games_levels: '2, 4, 6' });
  assert.equal(r.A.players.get('p1').level.games, 3);
  r = run(games, { achievement_giant_chance_levels: '0,3; 0,2' });
  assert.deepEqual(r.A.levels.giant, [0.3, 0.2]);
  assert.equal(levelFor(r.d.config, 'giant', 0.25), 1);
  assert.deepEqual(levelsOf(r.d.config, 'comeback'), [1]);
});

test('Rakete counts as if they had stopped at that moment', () => {
  // A wins 3 then loses 3 in the same week; the gain after the third win reaches the threshold
  const g = [[at(0, 9), ['A'], ['B']], [at(0, 10), ['A'], ['B']], [at(0, 11), ['A'], ['B']],
             [at(1, 9), ['B'], ['A']], [at(1, 10), ['B'], ['A']], [at(1, 11), ['B'], ['A']]];
  const r = run(g, { achievement_rocket_points: 50 });
  const e = r.when('A', 'rocket');
  assert.ok(e, 'earned despite the later losses');
  assert.equal(e.t, at(0, 11));
});

test('Perfekte Woche with the fifth win; a later loss changes nothing', () => {
  const g = [...Array.from({ length: 5 }, (_, i) => [at(i % 5, 9 + i), ['A'], ['B']]), [at(4, 16), ['B'], ['A']]];
  const r = run(g);
  assert.equal(r.when('A', 'perfect_week').t, at(4, 13));
  // a loss before the fifth win: no badge
  const r2 = run([[at(0, 8), ['B'], ['A']], ...g.slice(0, 5)]);
  assert.ok(!r2.has('A', 'perfect_week'));
});

test('Comeback, Siegesserie, Pechvogel, Gleichstand, Jubiläum', () => {
  const g = [[at(0, 9), ['B'], ['A']], [at(0, 10), ['B'], ['A']], [at(0, 11), ['B'], ['A']], [at(0, 12), ['B'], ['A']], [at(0, 13), ['A'], ['B']]];
  const r = run(g, { achievement_comeback_losses: 4, achievement_balance_min_games: 2, achievement_jubilee_games: 5, achievement_win_streak_levels: [4] });
  assert.ok(r.has('A', 'comeback'));
  assert.ok(r.has('B', 'win_streak'));
  assert.ok(!r.has('A', 'jubilee') === false, 'A won its 5th game');
  assert.ok(!r.has('B', 'jubilee'), 'B lost its 5th game');
  const r2 = run([[at(0, 9), ['A'], ['B']], [at(0, 10), ['B'], ['A']]], { achievement_balance_min_games: 2 });
  assert.ok(r2.has('A', 'even') && r2.has('B', 'even'));
  // Pechvogel: a big favourite loses
  const many = Array.from({ length: 12 }, (_, i) => [at(0, 7 + i * 0.5), ['A'], ['B']]);
  const r3 = run([...many, [at(1, 9), ['B'], ['A']]], { achievement_unlucky_chance: 0.75 });
  assert.ok(r3.has('A', 'unlucky'));
  assert.ok(r3.has('B', 'giant'));
});

test('Platz 1 besiegt, Königsmord, Spitzenreiter for whoever becomes Platz 1', () => {
  // A leads; C beats A twice and takes over Platz 1
  const g = [[at(0, 9), ['A'], ['B']], [at(0, 10), ['A'], ['B']], [at(0, 11), ['C'], ['A']], [at(0, 12), ['C'], ['A']]];
  const r = run(g);
  assert.ok(r.has('C', 'beat_leader'));
  assert.ok(r.has('A', 'leader'));
  // B becomes Platz 1 without playing: A (leader) loses to C, B sits above C? construct: B ahead of C
  const g2 = [[at(0, 9), ['A'], ['C']], [at(0, 10), ['B'], ['C']], [at(0, 11), ['C'], ['A']]];
  const r2 = run(g2);
  const top = r2.A.reigns.at(0).id;
  assert.ok(r2.A.players.get(top).level.leader === 1);
  const k = r2.A.reigns.find(x => x.id === 'p2');
  if (k) assert.ok(r2.has('B', 'leader'), 'B earned Spitzenreiter without playing');
});

test('Aufsteiger der Woche only for completed calendar weeks', () => {
  const g = [[at(0, 9), ['A'], ['B']], [at(1, 9), ['A'], ['C']], [at(2, 9), ['B'], ['C']]];
  const during = run(g, {}, at(5));
  assert.equal(during.A.weekly.length, 0);
  assert.ok(!during.has('A', 'rising_star'));
  const afterWeek = run(g, {}, at(8));
  assert.equal(afterWeek.A.weekly.length, 1);
  assert.equal(afterWeek.A.weekly[0].id, 'p1');
  assert.equal(afterWeek.when('A', 'rising_star').t, MON + 7);
});

test('Thron: Platz 1 for n days, also while not playing; reigns end with inactivity', () => {
  const g = [[at(0, 9), ['A'], ['B']]];
  const r = run(g, { achievement_leader_days_levels: [7, 30], achievement_rank_active_days: 20 }, at(40));
  const reign = r.A.reigns.find(x => x.id === 'p1');
  assert.ok(Math.abs(reign.days - 20) < 1e-6, 'ends 20 days after the last game');
  assert.ok(r.has('A', 'throne', 1) && !r.has('A', 'throne', 2));
  assert.equal(r.when('A', 'throne').t, at(0, 9) + 7);
});

test('Angstgegner bezwungen, Revanche, Abo (singles only)', () => {
  const lose = Array.from({ length: 5 }, (_, i) => [at(0, 8 + i * 0.25), ['B'], ['A']]);
  const r = run([...lose, [at(1, 9), ['A'], ['B']]], { h2h_min_games: 5 });
  assert.ok(r.has('A', 'nemesis'));
  assert.ok(r.has('A', 'revenge'));
  const wins = Array.from({ length: 5 }, (_, i) => [at(2, 8 + i * 0.25), ['A'], ['B']]);
  assert.ok(run([...lose, ...wins], { achievement_subscription_wins: 5 }).has('A', 'subscription'));
  // a doubles win doesn't count for Revanche
  const r2 = run([[at(0, 9), ['B'], ['A']], [at(0, 10), ['A', 'C'], ['B', 'D']]]);
  assert.ok(!r2.has('A', 'revenge'));
});

test('time-of-day badges only from form entries; sessions and days', () => {
  const g = [[at(0, 7.5), ['A'], ['B']], [at(0, 7.7), ['A'], ['B']], [at(0, 7.9), ['A'], ['B']], [at(0, 17.5), ['A'], ['B']]];
  const r = run(g, { achievement_marathon_games: 3, achievement_busy_day_games: 4 });
  assert.ok(r.has('A', 'early') && r.has('A', 'late') && r.has('A', 'marathon') && r.has('A', 'busy_day'));
  const days = [0, 1, 2, 3, 4].map(d => [at(d, 12), ['C'], ['D']]);
  assert.ok(run(days).has('C', 'all_weekdays'));
});

test('Doppel: Teamplayer, Traumpaar; Einzelkönig / Doppelkönig from the modes', () => {
  const g = [[at(0, 9), ['A', 'B'], ['C', 'D']], [at(0, 10), ['A', 'C'], ['B', 'D']], [at(0, 11), ['A', 'D'], ['B', 'C']],
             [at(0, 12), ['E'], ['F']]];
  const r = run(g, { achievement_partner_levels: [3], achievement_dream_team_wins: 1 });
  assert.ok(r.has('A', 'team_player'));
  assert.ok(r.has('A', 'dream_team'));
  assert.ok(r.has('A', 'king_double'));
  assert.ok(r.has('E', 'king_single'));
  assert.ok(r.A.byGame.get(3).some(x => x.id === 'p5' && x.badge === 'king_single'));
});

test('earned badges are never lost by later games (monotone)', () => {
  const raw = demoRaw('Europe/Vienna');
  const d = load(raw), elo = compute(d);
  const now = d.games.at(-1).t + 1;
  const full = computeAchievements({ dataset: d, elo }, {}, now);
  // with the last 30 games removed, everything earned before must still be there with the same time
  const cut = { ...d, games: d.games.slice(0, -30) };
  const part = computeAchievements({ dataset: cut, elo: compute(cut) }, {}, cut.games.at(-1).t);
  const tLimit = cut.games.at(-1).t;
  for (const [id, p] of part.players) {
    for (const e of p.earned.filter(x => x.t <= tLimit && x.badge !== 'rising_star' && x.badge !== 'throne')) {
      assert.ok(full.players.get(id).earned.some(f => f.badge === e.badge && f.level === e.level && f.t === e.t), `${id} ${e.badge} ${e.level}`);
    }
  }
});

test('performance: ~1900 games well under 100 ms', () => {
  const d = load(demoRaw('Europe/Vienna', 'gross')), elo = compute(d);
  const sub = mode => { const ds = modeDataset(d, mode); return { dataset: ds, elo: compute(ds) }; };
  const modes = { einzel: sub('einzel'), doppel: sub('doppel') };
  const t0 = performance.now();
  const A = computeAchievements({ dataset: d, elo }, modes, d.games.at(-1).t + 1);
  const ms = performance.now() - t0;
  console.log(`achievements: ${d.games.length} games, ${ms.toFixed(1)} ms, ${[...A.players.values()].reduce((s, p) => s + p.earned.length, 0)} earned`);
  assert.ok(ms < 100);
});

// ── „Was fehlt“ (views/badge-hints.js) ──
import { hintsFor } from '../js/views/badge-hints.js';
const env = r => ({
  nameOf: id => r.d.players.get(id).name,
  ratingOf: id => r.elo.final[r.elo.index.get(id)],
  isActive: () => true,
  activeIds: r.elo.ids.slice(),
});
const hint = (r, badge, name) => hintsFor(r.d.config, r.A, badge, `p${NAMES.indexOf(name) + 1}`, env(r));

test('Was fehlt: Gegnerjäger lists not beaten and never played', () => {
  const r = run([[at(0, 9), ['A'], ['B']], [at(0, 10), ['C'], ['A']], [at(0, 11), ['D'], ['E']]]);
  const g = Object.fromEntries(hint(r, 'opponents', 'A').groups.map(x => [x.title, x.rows.map(y => y.id)]));
  assert.deepEqual(g['Noch nicht besiegt'], ['p3']);
  assert.deepEqual(g['Noch nie gegeneinander gespielt'], ['p4', 'p5']);   // F never played: not listed
  assert.deepEqual(g['Schon besiegt'], ['p2']);
});

test('Was fehlt: Ausgeglichen counts wins in a row incl. the minimum number of singles', () => {
  const r = run([[at(0, 9), ['A'], ['B']], [at(0, 10), ['B'], ['A']], [at(0, 11), ['B'], ['A']]], { h2h_min_games: 5 });
  const row = hint(r, 'balanced', 'A').groups[0].rows.find(x => x.id === 'p2');
  assert.match(row.text, /1 : 2 · 2 Siege fehlen/);    // 3 : 2 after two more wins, then 5 singles
});

test('Was fehlt: Abo, Revanche, Jeden fünfmal follow the results', () => {
  const r = run([[at(0, 9), ['A'], ['B']], [at(0, 10), ['A'], ['B']], [at(0, 11), ['C'], ['A']]]);
  const abo = hint(r, 'subscription', 'A');
  assert.equal(abo.groups[0].rows[0].id, 'p2'); assert.match(abo.groups[0].rows[0].text, /^2 von/);
  assert.deepEqual(hint(r, 'revenge', 'A').groups[0].rows.map(x => x.id), ['p3']);
  const each = hint(r, 'each_five', 'A').groups.find(x => x.title.startsWith('Zählen noch nicht'));
  assert.deepEqual(each.rows.map(x => x.id), ['p2', 'p3']);
});

test('Was fehlt: nothing for pure counts or finished badges', () => {
  const r = run([[at(0, 9), ['A'], ['B']]], { achievement_games_levels: [1] });
  assert.equal(hint(r, 'games', 'A'), null);
  assert.equal(hint(r, 'days', 'B'), null);
});
