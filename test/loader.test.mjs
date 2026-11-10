// Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../js/core/loader.js';
import { CONFIG_DEFAULTS } from '../js/config.js';
import {
  parseTime, formatRef, serialFromParts, serialToParts, nowSerial, clean, norm, readTable,
} from '../js/core/normalize.js';

const S = (y, mo, d, h = 0, mi = 0, s = 0) => serialFromParts(y, mo, d, h, mi, s);

function baseRaw() {
  return {
    config: [
      ['key', 'value', 'note'],
      ['responses_valid_from', S(2026, 11, 1)],
      ['k_single', 40], ['k_double', '20'], ['start_rating', 1400],
      ['asymptotic_init', false], ['unknown_key', 'x'],
    ],
    players: [
      ['id', 'display_name', 'active'],
      ['p001', 'Anna', true], ['p002', 'Bernd', true], ['p003', 'Clara', false], ['p004', 'Dieter', ''],
    ],
    aliases: [
      ['name', 'player_id'],
      ['Anna', 'p001'], ['Bernd', 'p002'], ['Bernie', 'p002'], ['Clara', 'p003'], ['Dieter', 'p004'],
    ],
    legacy: [
      ['timestamp', 'winner1', 'winner2', 'loser1', 'loser2', 'source_row'],
      [S(2024, 3, 4, 12), 'Anna', '', 'Bernie', '', 2],
      [S(2024, 3, 4, 13), 'Anna', 'Clara', 'Bernd', 'Dieter', 3],
    ],
    spiele: [
      ['Zeitstempel', 'Sieger 1', 'Sieger 2', 'Verlierer 1', 'Verlierer 2'],
      [S(2026, 10, 20, 9), 'Anna', '', 'Bernd'],                // test data, before cutoff
      [S(2026, 11, 3, 10, 0, 5), ' bernd ', '', 'ANNA', ''],     // normalised names
      [S(2026, 11, 3, 10, 0, 0), 'Clara', '', 'Dieter'],         // earlier, listed later → sort
    ],
    corrections: [['game_ref', 'action', 'note']],
  };
}

test('normalize: names', () => {
  assert.equal(clean('  a   b '), 'a b');
  assert.equal(norm(' Anna  Maria '), 'anna maria');
});

test('normalize: time round trip and parsing', () => {
  const s = S(2026, 11, 10, 11, 14, 7);
  assert.equal(formatRef(s), '2026-11-10 11:14:07');
  assert.equal(parseTime('2026-11-10 11:14:07'), s);
  assert.equal(parseTime('10.11.2026 11:14:07'), s);
  assert.equal(parseTime('2026-11-10'), S(2026, 11, 10));
  assert.equal(parseTime('31.02.2026'), null);
  assert.equal(parseTime('hello'), null);
  assert.equal(parseTime(''), null);
  assert.equal(serialToParts(S(2026, 11, 9)).weekday, 1);     // Monday
  // Known anchor: serial 45000 = 2023-03-15
  assert.equal(formatRef(45000), '2023-03-15 00:00:00');
  // float noise from the API rounds to the right second
  assert.equal(formatRef(s + 1e-9), '2026-11-10 11:14:07');
});

test('normalize: nowSerial uses wall-clock of the zone (CET = UTC+1 in November)', () => {
  const now = new Date(Date.UTC(2026, 10, 10, 10, 0, 0));
  assert.equal(formatRef(nowSerial('Europe/Vienna', now)), '2026-11-10 11:00:00');
  const summer = new Date(Date.UTC(2026, 6, 1, 10, 0, 0));
  assert.equal(formatRef(nowSerial('Europe/Vienna', summer)), '2026-07-01 12:00:00');
});

test('normalize: readTable finds columns by header, any order, case-insensitive', () => {
  const t = readTable([['B', ' a '], [1, 2], [], ['', ''], [3]], { a: ['A'], b: ['b'], c: ['c'] }, ['c']);
  assert.deepEqual(t.col, { a: 1, b: 0, c: -1 });
  assert.deepEqual(t.missing, []);
  assert.deepEqual(t.rows.map(r => r.row), [2, 5]);
});

test('loader: happy path', () => {
  const d = load(baseRaw());
  assert.equal(d.config.k_double, 20);
  assert.equal(d.config.responses_valid_from, S(2026, 11, 1));
  assert.equal(d.players.get('p004').active, true);           // empty active → true
  assert.equal(d.players.get('p003').active, false);

  assert.equal(d.counts.beforeCutoff, 1);
  assert.equal(d.games.length, 4);
  assert.deepEqual(d.games.map(g => g.ref), [
    '2024-03-04 12:00:00', '2024-03-04 13:00:00', '2026-11-03 10:00:00', '2026-11-03 10:00:05',
  ]);
  assert.deepEqual(d.games.map(g => g.g), [0, 1, 2, 3]);
  const [g0, g1, g2, g3] = d.games;
  assert.deepEqual([g0.winners, g0.losers], [['p001'], ['p002']]);    // old alias "Bernie"
  assert.equal(g0.approxTime, true);
  assert.equal(g0.sourceRow, 2);
  assert.equal(g1.double, true);
  assert.deepEqual([g1.winners, g1.losers], [['p001', 'p003'], ['p002', 'p004']]);
  assert.equal(g2.source, 'spiele');
  assert.equal(g2.row, 4);
  assert.deepEqual([g3.winners, g3.losers], [['p002'], ['p001']]);
  assert.equal(d.issues.filter(i => i.level === 'error').length, 0, JSON.stringify(d.issues));
});

test('loader: ties sorted legacy first, then row', () => {
  const raw = baseRaw();
  raw.config[1][1] = S(2024, 1, 1);                          // cutoff early so tie is possible
  raw.spiele = [raw.spiele[0], [S(2024, 3, 4, 12), 'Clara', '', 'Dieter']];
  const d = load(raw);
  const tie = d.games.filter(g => g.ref === '2024-03-04 12:00:00');
  assert.deepEqual(tie.map(g => g.source), ['legacy', 'spiele']);
  assert.ok(d.issues.some(i => i.kind === 'legacy_after_cutoff'));
});

test('loader: corrections void and swap, by date cell or text, both formats', () => {
  const raw = baseRaw();
  raw.corrections.push(
    [S(2026, 11, 3, 10, 0, 5), 'swap', 'falsch eingetragen'],
    ['04.03.2024 13:00:00', 'void', ''],
    ['2025-01-01 00:00:00', 'void', 'gibt es nicht'],
    ['2024-03-04 12:00:00', 'delete', ''],
  );
  const d = load(raw);
  assert.equal(d.counts.voided, 1);
  assert.equal(d.counts.swapped, 1);
  assert.equal(d.games.length, 3);
  const last = d.games.at(-1);
  assert.deepEqual([last.winners, last.losers], [['p001'], ['p002']]);
  assert.ok(d.issues.some(i => i.kind === 'unmatched_correction'));
  assert.ok(d.issues.some(i => i.kind === 'bad_correction'));
});

test('loader: void suppresses issues of the voided game', () => {
  const raw = baseRaw();
  raw.spiele.push([S(2026, 11, 4, 9), 'Zoe', '', 'Anna']);
  raw.corrections.push(['2026-11-04 09:00:00', 'void']);
  const d = load(raw);
  assert.ok(!d.issues.some(i => i.kind === 'unknown_name'));
});

test('loader: unknown names, bad shapes, duplicates, bad timestamps', () => {
  const raw = baseRaw();
  raw.spiele.push(
    [S(2026, 11, 5, 9), 'Zoe', '', 'Anna'],
    [S(2026, 11, 5, 10), 'zoe', '', 'Bernd'],
    [S(2026, 11, 5, 11), 'Anna', 'Clara', 'Bernd'],           // 2 v 1
    [S(2026, 11, 5, 12), 'Bernd', 'Bernie', 'Anna', 'Clara'], // same person twice
    ['gestern', 'Anna', '', 'Bernd'],
  );
  const d = load(raw);
  const unk = d.issues.filter(i => i.kind === 'unknown_name');
  assert.equal(unk.length, 1);
  assert.equal(unk[0].count, 2);
  assert.equal(unk[0].level, 'error');
  assert.ok(d.issues.some(i => i.kind === 'invalid_game'));
  assert.ok(d.issues.some(i => i.kind === 'duplicate_player'));
  assert.ok(d.issues.some(i => i.kind === 'bad_timestamp'));
  assert.equal(d.counts.skipped, 5);
  assert.equal(d.games.length, 4);
});

test('loader: config defaults, invalid values, missing cutoff', () => {
  const raw = baseRaw();
  raw.config = [['key', 'value'], ['k_single', 'viel'], ['asymptotic_init', 'ja'], ['asymptotic_init_rounds', '3']];
  const d = load(raw);
  assert.equal(d.config.k_single, 40);
  assert.equal(d.config.asymptotic_init, true);
  assert.equal(d.config.asymptotic_init_rounds, 3);
  assert.equal(d.config.responses_valid_from, null);
  assert.ok(d.issues.some(i => i.kind === 'bad_config'));
  assert.ok(d.issues.some(i => i.kind === 'missing_cutoff'));
  assert.equal(d.counts.beforeCutoff, 0);
  assert.equal(d.games.length, 5);                            // test row kept
});

test('loader: the real config tab (as date/boolean cells and as text)', () => {
  const tab = (rvf, bool) => [
    ['key', 'value', 'note'],
    ['responses_valid_from', rvf, 'rows in Spiele before this are ignored'],
    ['k_single', 40], ['k_double', 20], ['start_rating', 1400],
    ['asymptotic_init', bool],
    ['default_min_games', 20, 'open question in the base prompt'],
    ['default_inactivity_days', 30, 'open question in the base prompt'],
    ['asymptotic_init_rounds', 5, 'n for asymptotic_init'],
  ];
  const fallbacks = Object.fromEntries(Object.entries(CONFIG_DEFAULTS).map(([k, d]) => [k, d.value]));
  const expected = {
    ...fallbacks,
    responses_valid_from: S(2026, 11, 17, 8), k_single: 40, k_double: 20, start_rating: 1400,
    asymptotic_init: false, asymptotic_init_rounds: 5, default_min_games: 20, default_inactivity_days: 30,
  };
  for (const [rvf, bool] of [[S(2026, 11, 17, 8), false], ['2026-11-17 08:00:00', 'FALSE'], ['17.11.2026 08:00:00', 'FALSE']]) {
    const raw = baseRaw();
    raw.config = tab(rvf, bool);
    const d = load(raw);
    assert.deepEqual(d.config, expected);
    const cfgIssues = d.issues.filter(i => i.tab === 'config');
    assert.ok(cfgIssues.every(i => i.kind === 'missing_config'), JSON.stringify(cfgIssues));
    assert.ok(cfgIssues.some(i => i.name === 'rising_star_days'));   // new keys not yet in the sheet
  }
});

test('loader: complete config tab raises no issues; range checks', () => {
  const raw = baseRaw();
  raw.config = [['key', 'value'], ...Object.entries(CONFIG_DEFAULTS).map(([k, d]) => [k, d.value ?? S(2026, 11, 1)])];
  assert.deepEqual(load(raw).issues.filter(i => i.tab === 'config'), []);
  raw.config.push(['movement_calm_percentile', 150], ['form_games', 0], ['smooth_sd_days', '7,5']);
  const d = load(raw);
  assert.equal(d.issues.filter(i => i.kind === 'bad_config').length, 2);
  assert.equal(d.config.movement_calm_percentile, 25);
  assert.equal(d.config.form_games, 10);
  assert.equal(d.config.smooth_sd_days, 7.5);
  const swapped = baseRaw();
  swapped.config.push(['movement_calm_percentile', 80], ['movement_turbulent_percentile', 20]);
  assert.equal(load(swapped).config.movement_calm_percentile, 25);
});

test('loader: both timestamp display formats in game tabs (if cells are text)', () => {
  const raw = baseRaw();
  raw.legacy = [raw.legacy[0], ['2025-11-19 15:13:38', 'Anna', '', 'Bernd', '', 2]];
  raw.spiele = [raw.spiele[0], ['09.11.2026 15:25:00', 'Anna', '', 'Bernd']];
  raw.config[1][1] = '2026-11-01 00:00:00';
  const d = load(raw);
  assert.deepEqual(d.games.map(g => g.ref), ['2025-11-19 15:13:38', '2026-11-09 15:25:00']);
});

test('loader: missing tabs and columns never throw', () => {
  const d = load({});
  assert.equal(d.games.length, 0);
  assert.equal(d.config.k_single, 40);
  assert.ok(d.issues.some(i => i.kind === 'missing_column' && i.level === 'error'));
  const raw = baseRaw();
  raw.spiele = [['Zeit', 'Sieger 1']];
  const d2 = load(raw);
  assert.ok(d2.issues.some(i => i.tab === 'Spiele' && i.kind === 'missing_column'));
  assert.equal(d2.games.length, 2);                           // legacy still loads
});

test('loader: alias pointing to unknown player and conflicting aliases', () => {
  const raw = baseRaw();
  raw.aliases.push(['Ghost', 'p099'], ['anna', 'p002']);
  const d = load(raw);
  assert.equal(d.issues.filter(i => i.kind === 'bad_alias').length, 2);
  assert.deepEqual(d.games[0].winners, ['p001']);
});

test('loader: hash is stable and reacts to merges, config and corrections', () => {
  const h = load(baseRaw()).hash;
  assert.equal(load(baseRaw()).hash, h);
  const merged = baseRaw();
  merged.aliases = merged.aliases.map(r => (r[1] === 'p004' ? [r[0], 'p003'] : r));
  merged.players = merged.players.filter(r => r[0] !== 'p004');
  assert.notEqual(load(merged).hash, h);
  const k = baseRaw(); k.config[2][1] = 32;
  assert.notEqual(load(k).hash, h);
  const c = baseRaw(); c.corrections.push(['2024-03-04 12:00:00', 'void']);
  assert.notEqual(load(c).hash, h);
});

test('loader: 2000 games load fast', () => {
  const raw = baseRaw();
  const names = ['Anna', 'Bernd', 'Clara', 'Dieter'];
  for (let i = 0; i < 2000; i++) {
    const a = names[i % 4], b = names[(i + 1) % 4];
    raw.spiele.push([S(2026, 11, 2) + i / 1440, a, '', b, '']);
  }
  const t0 = performance.now();
  const d = load(raw);
  const ms = performance.now() - t0;
  assert.equal(d.games.length, 2004);
  assert.ok(ms < 200, `took ${ms} ms`);
});
