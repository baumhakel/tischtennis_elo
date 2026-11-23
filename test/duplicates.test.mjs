// Phase 17, item 2: possible duplicates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../js/core/loader.js';
import { serialFromParts } from '../js/core/normalize.js';

const S = (y, mo, d, h = 0, mi = 0, s = 0) => serialFromParts(y, mo, d, h, mi, s);
const CUTOFF = S(2026, 11, 1);

function raw(spiele, extra = []) {
  return {
    config: [['key', 'value'], ['responses_valid_from', CUTOFF], ...extra],
    players: [['id', 'display_name', 'active'], ['p001', 'Anna', true], ['p002', 'Bernd', true], ['p003', 'Clara', true], ['p004', 'Dieter', true]],
    aliases: [['name', 'player_id'], ['Anna', 'p001'], ['Bernd', 'p002'], ['Clara', 'p003'], ['Dieter', 'p004']],
    legacy: [['timestamp', 'winner1', 'winner2', 'loser1', 'loser2', 'source_row'],
      [S(2026, 10, 30, 12, 0), 'Anna', '', 'Bernd', '', 2], [S(2026, 10, 30, 12, 2), 'Anna', '', 'Bernd', '', 3]],
    spiele: [['Zeitstempel', 'Sieger 1', 'Sieger 2', 'Verlierer 1', 'Verlierer 2'], ...spiele],
    corrections: [['game_ref', 'action', 'note', 'played_at']],
  };
}
const dupIssues = d => d.issues.filter(i => i.kind === 'possible_duplicate');
const byRef = (d, ref) => d.games.find(g => g.ref === ref);

test('same players and result within the window → flagged on both games, never dropped', () => {
  const d = load(raw([
    [S(2026, 11, 20, 12, 0, 10), 'Anna', 'Clara', 'Bernd', 'Dieter'],
    [S(2026, 11, 20, 12, 4, 0), 'Clara', 'Anna', 'Dieter', 'Bernd'],     // same teams in another order
    [S(2026, 11, 20, 12, 30), 'Anna', 'Clara', 'Bernd', 'Dieter'],       // outside 5 minutes
  ]));
  assert.equal(d.games.length, 5);
  const [i] = dupIssues(d);
  assert.equal(dupIssues(d).length, 1);
  assert.ok(i.message.includes('2026-11-20 12:00:10') && i.message.includes('2026-11-20 12:04:00') && i.message.includes('4 Minuten'));
  assert.deepEqual(byRef(d, '2026-11-20 12:00:10').dupes, ['2026-11-20 12:04:00']);
  assert.deepEqual(byRef(d, '2026-11-20 12:04:00').dupes, ['2026-11-20 12:00:10']);
  assert.equal(byRef(d, '2026-11-20 12:30:00').dupes, undefined);
});

test('a different result, other players or two Altdaten games are not duplicates', () => {
  const d = load(raw([
    [S(2026, 11, 20, 12, 0), 'Anna', '', 'Bernd', ''],
    [S(2026, 11, 20, 12, 1), 'Bernd', '', 'Anna', ''],
    [S(2026, 11, 20, 12, 2), 'Anna', '', 'Clara', ''],
  ]));
  assert.deepEqual(dupIssues(d), []);
});

test('voiding one removes the hint, the window comes from config (0 = off), moved games compare the played time', () => {
  const rows = [[S(2026, 11, 20, 12, 0), 'Anna', '', 'Bernd', ''], [S(2026, 11, 20, 12, 0, 40), 'Anna', '', 'Bernd', '']];
  const r = raw(rows);
  r.corrections.push(['2026-11-20 12:00:40', 'void', 'doppelt']);
  assert.deepEqual(dupIssues(load(r)), []);
  assert.deepEqual(dupIssues(load(raw(rows, [['duplicate_window_minutes', 0]]))), []);
  assert.ok(dupIssues(load(raw(rows)))[0].message.includes('weniger als eine Minute'));

  const late = raw([[S(2026, 11, 20, 12, 0), 'Anna', '', 'Bernd', ''], [S(2026, 11, 20, 15, 0), 'Anna', '', 'Bernd', '']]);
  assert.deepEqual(dupIssues(load(late)), []);
  late.corrections.push(['2026-11-20 15:00:00', 'move', 'nachgetragen', '20.11.2026 12:03']);
  assert.equal(dupIssues(load(late)).length, 1);
});
