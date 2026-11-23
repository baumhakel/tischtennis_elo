// Nachgetragene Spiele: the `move` correction (Phase 17, item 9).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../js/core/loader.js';
import { compute } from '../js/core/elo.js';
import { createStats } from '../js/core/stats/index.js';
import { serialFromParts, formatRef, hasTimeOfDay } from '../js/core/normalize.js';
import { findGame, parseFilter, queryGames, timeRef } from '../js/views/game-query.js';

const S = (y, mo, d, h = 0, mi = 0, s = 0) => serialFromParts(y, mo, d, h, mi, s);
const CUTOFF = S(2026, 11, 1);

// Five form games. The last one (entered 3 Dec 13:31) was really played on 27 Nov, i.e. in the
// previous week and month, before the 30 Nov and 2 Dec games.
function raw() {
  return {
    config: [['key', 'value'], ['responses_valid_from', CUTOFF], ['k_single', 40], ['k_double', 20], ['start_rating', 1400]],
    players: [['id', 'display_name', 'active'], ['p001', 'Anna', true], ['p002', 'Bernd', true], ['p003', 'Clara', true], ['p004', 'Dieter', true]],
    aliases: [['name', 'player_id'], ['Anna', 'p001'], ['Bernd', 'p002'], ['Clara', 'p003'], ['Dieter', 'p004']],
    legacy: [['timestamp', 'winner1', 'winner2', 'loser1', 'loser2', 'source_row'], [S(2026, 10, 30, 12), 'Bernd', '', 'Anna', '', 2]],
    spiele: [
      ['Zeitstempel', 'Sieger 1', 'Sieger 2', 'Verlierer 1', 'Verlierer 2'],
      [S(2026, 11, 26, 9), 'Anna', '', 'Bernd', ''],
      [S(2026, 11, 30, 10), 'Clara', '', 'Anna', ''],
      [S(2026, 12, 2, 11), 'Anna', 'Clara', 'Bernd', 'Dieter'],
      [S(2026, 12, 3, 13, 31), 'Dieter', '', 'Anna', ''],
    ],
    corrections: [['game_ref', 'action', 'note', 'played_at']],
  };
}
const LATE = '2026-12-03 13:31:00';
const refs = d => d.games.map(g => g.ref);
const issues = (d, kind) => d.issues.filter(i => i.kind === kind);

test('hasTimeOfDay: text needs hh:mm, a cell needs a non-zero time', () => {
  assert.ok(hasTimeOfDay('27.11.2026 12:10'));
  assert.ok(hasTimeOfDay('2026-11-27 12:10:00'));
  assert.ok(!hasTimeOfDay('27.11.2026'));
  assert.ok(hasTimeOfDay(S(2026, 11, 27, 12, 10)));
  assert.ok(!hasTimeOfDay(S(2026, 11, 27)));
});

test('move: the game takes played_at, keeps its ref, and sorts at the real time (across week and month)', () => {
  const r = raw();
  r.corrections.push([LATE, 'move', 'vergessen', '27.11.2026 12:10']);
  const d = load(r);
  assert.deepEqual(issues(d, 'bad_move'), []);
  assert.equal(d.counts.moved, 1);
  const g = findGame(d, LATE);
  const x = d.games[g];
  assert.equal(g, 2, 'after the 26 Nov game, before the 30 Nov game');
  assert.equal(x.ref, LATE);
  assert.equal(formatRef(x.t), '2026-11-27 12:10:00');
  assert.equal(formatRef(x.enteredT), LATE);
  assert.ok(x.moved);
  assert.equal(timeRef(x), '2026-11-27 12:10:00');
  assert.deepEqual(refs(d).slice(1), ['2026-11-26 09:00:00', LATE, '2026-11-30 10:00:00', '2026-12-02 11:00:00']);
});

test('move: Elo equals a replay of the data with the game entered at its real time', () => {
  const moved = raw();
  moved.corrections.push([LATE, 'move', '', S(2026, 11, 27, 12, 10)]);   // as a date-time cell
  const replay = raw();
  const row = replay.spiele.pop();
  row[0] = S(2026, 11, 27, 12, 10);
  replay.spiele.splice(2, 0, row);
  const a = compute(load(moved)), b = compute(load(replay));
  assert.deepEqual([...a.perGame.delta], [...b.perGame.delta]);
  assert.deepEqual(a.ids, b.ids);
  for (const id of a.ids) assert.equal(a.history[a.index.get(id)].r.at(-1), b.history[b.index.get(id)].r.at(-1));
});

test('move: the hash changes, so the cache recomputes', () => {
  const r = raw();
  const before = load(r).hash;
  r.corrections.push([LATE, 'move', '', '27.11.2026 12:10']);
  assert.notEqual(load(r).hash, before);
});

test('move plus swap: both apply; void wins over move', () => {
  const r = raw();
  r.corrections.push([LATE, 'swap', ''], [LATE, 'move', '', '27.11.2026 12:10']);
  let d = load(r);
  let x = d.games[findGame(d, LATE)];
  assert.ok(x.moved && x.corrected);
  assert.deepEqual([x.winners, x.losers], [['p001'], ['p004']]);

  const v = raw();
  v.corrections.push([LATE, 'move', '', '27.11.2026 12:10'], [LATE, 'void', '']);
  d = load(v);
  assert.equal(findGame(d, LATE), -1);
  assert.equal(d.counts.moved, 0);
  assert.equal(d.counts.voided, 1);
  assert.deepEqual(issues(d, 'bad_move'), []);
});

test('move: every problem leaves the game at its submission time with an issue', () => {
  const cases = [
    ['', '„played_at“ ist leer'],
    ['gestern', 'nicht lesbar'],
    ['27.11.2026', 'keine Uhrzeit'],
    [S(2026, 11, 27), 'keine Uhrzeit'],
    ['03.12.2026 14:00', 'liegt nach dem Eintrag'],
  ];
  for (const [value, text] of cases) {
    const r = raw();
    r.corrections.push([LATE, 'move', '', value]);
    const d = load(r);
    const x = d.games[findGame(d, LATE)];
    assert.ok(!x.moved, `${value}: not moved`);
    assert.equal(x.ref, formatRef(x.t));
    const [i] = issues(d, 'bad_move');
    assert.ok(i && i.message.includes(text), `${value}: ${i?.message}`);
    assert.equal(i.ref, LATE);
  }
});

test('move: without the played_at column → an issue, other corrections still work', () => {
  const r = raw();
  r.corrections = [['game_ref', 'action', 'note'], [LATE, 'move', ''], ['2026-11-26 09:00:00', 'void', '']];
  const d = load(r);
  assert.ok(issues(d, 'bad_move')[0].message.includes('Spalte „played_at“ fehlt'));
  assert.equal(d.counts.voided, 1);
});

test('move: two move rows → the later one counts, plus an issue', () => {
  const r = raw();
  r.corrections.push([LATE, 'move', '', '27.11.2026 12:10'], [LATE, 'move', '', '01.12.2026 08:00']);
  const d = load(r);
  assert.equal(issues(d, 'duplicate_move').length, 1);
  assert.equal(formatRef(d.games[findGame(d, LATE)].t), '2026-12-01 08:00:00');
});

test('move: the cutoff uses the submission time; played_at before the cutoff is allowed', () => {
  const r = raw();
  r.spiele.push([S(2026, 10, 20, 9), 'Anna', '', 'Dieter', '']);               // test entry before the cutoff
  r.corrections.push(['2026-10-20 09:00:00', 'move', '', '20.10.2026 08:00'], [LATE, 'move', '', '15.10.2026 12:00']);
  const d = load(r);
  assert.equal(d.counts.beforeCutoff, 1);
  assert.equal(findGame(d, '2026-10-20 09:00:00'), -1, 'a test entry stays dropped');
  assert.equal(findGame(d, LATE), 0, 'moved before the legacy game and the cutoff');
  assert.deepEqual(issues(d, 'bad_move'), []);
});

test('move on a legacy game works the same way', () => {
  const r = raw();
  r.corrections.push(['2026-10-30 12:00:00', 'move', 'Uhrzeit bekannt', '30.10.2026 08:15']);
  const d = load(r);
  const x = d.games[findGame(d, '2026-10-30 12:00:00')];
  assert.ok(x.moved);
  assert.equal(x.source, 'legacy');
  assert.equal(formatRef(x.t), '2026-10-30 08:15:00');
});

test('Alle Spiele: von / bis use the played time, korrigiert includes moved games', () => {
  const r = raw();
  r.corrections.push([LATE, 'move', '', '27.11.2026 12:10']);
  const d = load(r);
  const elo = compute(d);
  const model = { dataset: d, elo, stats: createStats(d, elo) };
  const q = p => queryGames(model, parseFilter(p, model)).map(g => d.games[g].ref);
  assert.deepEqual(q({ von: '2026-11-27', bis: '2026-11-27' }), [LATE]);
  assert.deepEqual(q({ von: '2026-12-03' }), []);
  assert.deepEqual(q({ korrigiert: '1' }), [LATE]);
  // a range starting at the moved game (as streak and Zeitraum links build it) includes it
  assert.ok(q({ von: timeRef(d.games[findGame(d, LATE)]) }).includes(LATE));
});

// ───────── replace: a wrong player fixed with one row ─────────

const repl = (ref, wrong, right) => [ref, 'replace', '', '', wrong, right];
function rawR() {
  const r = raw();
  r.corrections = [['game_ref', 'action', 'note', 'played_at', 'wrong_player', 'right_player']];
  r.players.push(['p005', 'Emil', true]);
  r.aliases.push(['Emil', 'p005']);
  return r;
}

test('replace: the right player takes the wrong one\'s place, as winner or loser, singles or doubles', () => {
  const r = rawR();
  r.corrections.push(repl(LATE, 'Anna', 'Bernd'),                       // loser
    repl('2026-11-30 10:00:00', 'clara', 'Dieter'),                      // winner, name case-insensitive
    repl('2026-12-02 11:00:00', 'Dieter', 'Emil'), repl('2026-12-02 11:00:00', 'Emil', 'Dieter'),   // rows apply in order
    repl('2026-12-02 11:00:00', 'Bernd', 'Emil'));
  const d = load(r);
  assert.deepEqual(issues(d, 'bad_replace'), []);
  const at = ref => d.games[findGame(d, ref)];
  assert.deepEqual([at(LATE).winners, at(LATE).losers], [['p004'], ['p002']]);
  assert.deepEqual([at('2026-11-30 10:00:00').winners, at('2026-11-30 10:00:00').losers], [['p004'], ['p001']]);
  const dbl = at('2026-12-02 11:00:00');
  assert.deepEqual([dbl.winners, dbl.losers], [['p001', 'p003'], ['p005', 'p004']]);
  assert.deepEqual(at(LATE).replaced, [{ from: 'p001', fromName: 'Anna', to: 'p002' }]);
  assert.equal(d.counts.replaced, 3, 'counted per game');
});

test('replace: Elo equals the data as if entered correctly, and the hash changes', () => {
  const r = rawR();
  const before = load(r).hash;
  r.corrections.push(repl(LATE, 'Anna', 'Bernd'));
  const right = raw();
  right.spiele[4][3] = 'Bernd';
  const a = load(r), b = load(right);
  assert.notEqual(a.hash, before);
  assert.deepEqual([...compute(a).perGame.delta], [...compute(b).perGame.delta]);
});

test('replace: fixes a misspelt name that is not in aliases', () => {
  const r = rawR();
  r.spiele.push([S(2026, 12, 4, 9), 'Anan', '', 'Bernd', '']);
  let d = load(r);
  assert.equal(issues(d, 'unknown_name').length, 1);
  r.corrections.push(repl('2026-12-04 09:00:00', 'Anan', 'Anna'));
  d = load(r);
  assert.deepEqual(issues(d, 'unknown_name'), []);
  const x = d.games[findGame(d, '2026-12-04 09:00:00')];
  assert.deepEqual(x.winners, ['p001']);
  assert.deepEqual(x.replaced, [{ from: null, fromName: 'Anan', to: 'p001' }]);
});

test('replace: problems leave the game unchanged with an issue; void wins; works with swap and move', () => {
  const cases = [
    [repl(LATE, 'Clara', 'Bernd'), 'spielt in diesem Spiel nicht mit'],
    [repl(LATE, 'Anna', 'Dieter'), 'spielt in diesem Spiel schon mit'],
    [repl(LATE, 'Anna', 'Erich'), 'steht nicht im Tab „aliases“'],
    [repl(LATE, '', 'Bernd'), '„wrong_player“ ist leer'],
    [repl(LATE, 'Anna', ''), '„right_player“ ist leer'],
  ];
  for (const [row, text] of cases) {
    const r = rawR();
    r.corrections.push(row);
    const d = load(r);
    const x = d.games[findGame(d, LATE)];
    assert.deepEqual([x.winners, x.losers, x.replaced], [['p004'], ['p001'], undefined]);
    const [i] = issues(d, 'bad_replace');
    assert.ok(i && i.message.includes(text), `${text}: ${i?.message}`);
  }
  const noCols = raw();
  noCols.corrections.push([LATE, 'replace', '']);
  assert.ok(issues(load(noCols), 'bad_replace')[0].message.includes('Spalten'));

  const v = rawR();
  v.corrections.push(repl(LATE, 'Anna', 'Bernd'), [LATE, 'void', '']);
  assert.equal(findGame(load(v), LATE), -1);

  const m = rawR();
  m.corrections.push(repl(LATE, 'Anna', 'Bernd'), [LATE, 'swap', ''], [LATE, 'move', '', '27.11.2026 12:10']);
  const d = load(m);
  const x = d.games[findGame(d, LATE)];
  assert.deepEqual([x.winners, x.losers, x.corrected, x.moved], [['p002'], ['p004'], true, true]);
  const model = { dataset: d, elo: compute(d) };
  model.stats = createStats(d, model.elo);
  assert.deepEqual(queryGames(model, parseFilter({ korrigiert: '1' }, model)).map(g => d.games[g].ref), [LATE]);
});
