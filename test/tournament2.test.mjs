// Phase 18c: status and the fixed draw, w. o., doubles, pots, the modified Swiss system.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTournamentTabs, parseSet, validateSets, buildTournament, tournamentGames, suggestions, timeLeft, drawPots, pairPool,
  swissRound1, drawText, parseDrawText, seedRatings, eloMatch,
} from '../js/core/tournament.js';

const P = (name, id = null, extra = {}) => ({ key: id ? `m:${id}` : `g:${name.toLowerCase()}`, id, name, guest: !id, seed: null, pin: null, row: 0, ...extra });
const names = n => Array.from({ length: n }, (_, i) => `S${i + 1}`);
const players = n => names(n).map((x, i) => P(x, `p${i + 1}`, { row: i + 2 }));
const ratingsOf = n => new Map(names(n).map((_, i) => [`p${i + 1}`, 1800 - i * 20]));
const T0 = (extra = {}) => ({ id: 'x', name: 'X', status: 'aktiv', art: 'einzel', groups: 2, groupSizes: [], advance: [2],
  bestOf: { gruppe: 3, finale: 3 }, points: 11, third: true, lot: '1', participants: players(8), mode: 'gruppen', draw: 'schlange', ...extra });

let clock = 46400;
const win = (m, aWins = true) => ({ tournament: 'x', nr: m.nr, t: clock += 0.01, ref: `r${clock}`, row: Math.round(clock * 100),
  sets: Array.from({ length: Math.floor((m.bestOf || 3) / 2) + 1 }, () => (aWins ? [11, 5] : [5, 11])) });

test('w. o.: the side that didn\'t show up loses, without sets and points; never Elo', () => {
  assert.deepEqual(parseSet('wo:a'), { wo: 'a' });
  assert.deepEqual(parseSet('W.O.: b'), { wo: 'b' });
  const v = validateSets([{ wo: 'a' }, null], 3, 11);
  assert.deepEqual([v.ok, v.winner, v.setsA, v.setsB, v.pointsA], [true, 'b', 0, 0, 0]);
  const T = T0();
  const s0 = buildTournament(T, [], { ratings: ratingsOf(8) });
  const m = s0.matches[0];
  const s = buildTournament(T, [{ tournament: 'x', nr: m.nr, t: 46400, ref: 'w', row: 2, sets: [{ wo: 'a' }, null] }], { ratings: ratingsOf(8) });
  assert.equal(s.matches[0].result.winner, 'b');
  assert.equal(s.tables[s.matches[0].group].rows.find(r => r.key === m.b.key).wins, 1);
  assert.equal(tournamentGames(s).length, 0);
});

test('status: angekündigt ignores results; after the start the written draw counts and earlier results don\'t', () => {
  const ratings = ratingsOf(8);
  const live = buildTournament(T0({ status: 'angekündigt' }), [{ tournament: 'x', nr: 1, t: 1, ref: 'a', row: 2, sets: [[11, 5], [11, 5], null] }], { ratings });
  assert.equal(live.played, 0);
  assert.ok(live.issues.some(i => /noch nicht begonnen/.test(i.text)));
  // fix the draw the way Verwaltung.gs does: write setzplatz and gruppe, set gestartet
  const rows = parseDrawText(drawText(live));
  assert.equal(rows.length, 8);
  const byRow = new Map(rows.map(r => [r.row, r]));
  const fixed = T0({ started: 10, participants: players(8).map(p => ({ ...p, seed: byRow.get(p.row).seed, pin: 'AB'.indexOf(byRow.get(p.row).group) })) });
  // the Elo-Werte changed meanwhile: the fixed draw does not move
  const flipped = new Map([...ratings].map(([k, v]) => [k, 3000 - v]));
  const a = buildTournament(fixed, [], { ratings: flipped });
  assert.deepEqual(a.draw.rows, live.draw.rows);
  assert.equal(a.draw.hash, live.draw.hash);
  // results before the start don't count
  const res = [{ tournament: 'x', nr: 1, t: 5, ref: 'a', row: 2, sets: [[11, 5], [11, 5], null] }, { tournament: 'x', nr: 2, t: 11, ref: 'b', row: 3, sets: [[11, 5], [11, 5], null] }];
  const b = buildTournament(fixed, res, { ratings: flipped });
  assert.equal(b.played, 1);
  assert.ok(b.issues.some(i => /vor dem Start/.test(i.text)));
  // a row added after the start plays no part
  const more = { ...fixed, participants: [...fixed.participants, P('Neu', 'p99', { row: 30 })] };
  const c = buildTournament(more, [], { ratings });
  assert.equal(c.participants.length, 8);
  assert.ok(c.issues.some(i => /nach dem Start dazu/.test(i.text)));
});

test('doubles: teams, seeding by the mean Elo-Wert, the stronger player first, Elo as a doubles game', () => {
  const raw = {
    turniere: [['id', 'name', 'status', 'art', 'gruppen', 'weiter_pro_gruppe'], ['d', 'Doppel', 'aktiv', 'doppel', 1, '2']],
    turnier_teilnehmer: [['turnier_id', 'name', 'name_2'], ['d', 'Anna', 'Bernd'], ['d', 'Clara', 'David'], ['d', 'Elif', 'Gast Max'], ['d', 'Anna', 'Felix'], ['d', 'Greta', 'Hannes']],
  };
  const ids = new Map(['anna', 'bernd', 'clara', 'david', 'elif', 'felix', 'greta', 'hannes'].map((n, i) => [n, `p${i + 1}`]));
  const issues = [];
  const out = parseTournamentTabs(raw, ids, (l, k, m) => issues.push(m));
  const T = out.list[0];
  assert.equal(T.seedLeague, 'doppel');
  assert.equal(T.participants.length, 4);                               // Anna's second team is skipped
  assert.ok(issues.some(m => /schon in einem anderen Team/.test(m)));
  const ratings = new Map([['p1', 1400], ['p2', 1600], ['p3', 1550], ['p4', 1550], ['p7', 1300], ['p8', 1300]]);
  const s = buildTournament(T, [], { ratings, startRating: 1400 });
  assert.equal(s.ok, true);
  assert.deepEqual(s.participants.map(p => p.name), ['Clara / David', 'Bernd / Anna', 'Greta / Hannes', 'Elif / Gast Max']);
  assert.equal(s.participants[3].guest, true);
  const m = s.matches.find(x => !x.a.guest && !x.b.guest);
  assert.ok(eloMatch(m));
  const done = buildTournament(T, [{ tournament: 'd', nr: m.nr, t: 1, ref: 'z', row: 2, sets: [[11, 3], [11, 3], null] }], { ratings });
  const g = tournamentGames(done);
  assert.equal(g.length, 1);
  assert.equal(g[0].double, true);
  assert.equal(g[0].winners.length, 2);
  // the team's people are kept apart in the suggestions
  assert.ok(suggestions(done, 3).every(x => x.a.people.length === 2));
  // seeding league: doubles only
  const games = [{ t: 1, winners: ['a'], losers: ['b'], double: false }, { t: 2, winners: ['b', 'c'], losers: ['a', 'd'], double: true }];
  const r = seedRatings(games, { start_rating: 1400, k_single: 40, k_double: 20 }, 5, 'doppel');
  assert.equal(r.get('b'), 1410);
});

test('pots: one per group from each pot, pins take their pot\'s place, reproducible', () => {
  const seeded = players(12);
  const d = drawPots(seeded, 3, [4, 4, 4], () => 0.3);
  assert.deepEqual(d.groups.map(g => g.length), [4, 4, 4]);
  for (let k = 0; k < 4; k++) {
    const pot = seeded.slice(k * 3, k * 3 + 3).map(p => p.key);
    assert.deepEqual(new Set(d.groups.map(g => g.find(p => pot.includes(p.key))?.key)), new Set(pot));
  }
  assert.equal(d.pots.length, 4);
  seeded[4].pin = 0;                                                    // pot 2, pinned to group A
  const e = drawPots(seeded, 3, [4, 4, 4], () => 0.7);
  assert.ok(e.groups[0].includes(seeded[4]));
  assert.equal(e.groups[0].filter(p => seeded.slice(3, 6).includes(p)).length, 1);
  const s = buildTournament(T0({ draw: 'toepfe', groups: 3, participants: players(13) }), [], { ratings: ratingsOf(13) });
  assert.deepEqual(s.tables.map(t => t.rows.length).sort(), [4, 4, 5]);
  assert.equal(s.pots.length, 5);
});

test('Swiss helpers: round 1 modes, pairing without rematches', () => {
  const k = ['1', '2', '3', '4', '5', '6'];
  assert.deepEqual(swissRound1(k, 'nachbarn'), [['1', '2'], ['3', '4'], ['5', '6']]);
  assert.deepEqual(swissRound1(k, 'versetzt'), [['1', '4'], ['2', '5'], ['3', '6']]);
  const z = swissRound1(k, 'zufall', () => 0.42);
  assert.equal(new Set(z.flat()).size, 6);
  assert.ok(z.every(([a, b]) => Number(a) < Number(b)));
  assert.deepEqual(pairPool(['a', 'b', 'c', 'd'], new Set()), [['a', 'd'], ['b', 'c']]);
  assert.deepEqual(pairPool(['a', 'b', 'c', 'd'], new Set(['a|d'])), [['a', 'c'], ['b', 'd']]);
});

/** Plays a Swiss tournament to the end: the better seed wins with probability p (deterministic). */
function playSwiss(n, extra = {}, pick = (m, i) => (i * 7 + m.nr * 3) % 10 < 7) {
  const T = T0({ mode: 'schweizer', participants: players(n), bestOf: { gruppe: 3, schweizer: 1, entscheidung: 3, finale: 3 }, ...extra });
  const results = [];
  let s, i = 0;
  for (let guard = 0; guard < 80; guard++) {
    s = buildTournament(T, results, { ratings: ratingsOf(n) });
    const open = s.matches.filter(m => m.status === 'offen');
    if (!open.length) break;
    for (const m of open) results.push(win(m, pick(m, i++)));
  }
  return { T, s, results };
}

test('Swiss: everyone ends with 3 wins or 3 losses, nobody loses without playing, no rematches, then a knockout', () => {
  for (const n of [8, 11, 12, 16]) {
    const { s } = playSwiss(n);
    const W = 3, L = 3;
    assert.equal(s.swiss.done, true, `n=${n}: Swiss finished`);
    for (const r of s.swiss.standings) {
      assert.ok(r.wins === W || r.losses === L, `n=${n}: ${r.key} ${r.wins}–${r.losses}`);
      assert.equal(r.losses, r.played - (r.wins - r.byes), `n=${n}: every loss was played`);
      assert.ok(r.byes <= 1);
    }
    const pairs = s.matches.filter(m => m.stage === 'schweizer').map(m => [m.a.key, m.b.key].sort().join('|'));
    // no rematch, except where a pool of two who already met is all that is left (small fields)
    assert.ok(pairs.length - new Set(pairs).size <= (n <= 8 ? 1 : 0), `n=${n}: no rematch in the Swiss stage`);
    assert.ok(s.bracket.length >= 1, `n=${n}: knockout`);
    assert.ok(s.winner, `n=${n}: a winner`);
    assert.equal(s.done, true);
    // numbering: Swiss first, then the knockout
    const firstKo = s.matches.find(m => m.stage === 'ko').nr;
    assert.ok(s.matches.filter(m => m.stage === 'schweizer').every(m => m.nr < firstKo));
    // a decisive match (winner qualifies or loser is out) is best of 3, the others best of 1
    assert.ok(s.matches.filter(m => m.stage === 'schweizer').every(m => m.bestOf === (m.decisive ? 3 : 1)));
  }
  // knockout seeding: 3–0 first
  const { s } = playSwiss(16);
  const q = s.swiss.qualified.map(k => s.swiss.standings.find(r => r.key === k));
  for (let i = 1; i < q.length; i++) assert.ok(q[i - 1].losses <= q[i].losses);
  assert.equal(s.matches.find(m => m.stage === 'ko' && m.round === 1).a.key, s.swiss.qualified[0]);
});

test('Swiss: ko_teilnehmer limits the knockout; the time estimate counts the matches still possible', () => {
  const { s } = playSwiss(12, { koN: 4 });
  assert.equal(s.swiss.qualified.length, 4);
  assert.equal(s.bracket[0].name, 'Halbfinale');
  const start = buildTournament(T0({ mode: 'schweizer', participants: players(12) }), [], { ratings: ratingsOf(12) });
  assert.equal(start.matches.length, 6);                                 // only round 1 exists
  assert.ok(start.maxLeft > 20);
  assert.equal(timeLeft(start, 12).left, start.maxLeft);
});

test('Swiss: a late correction of round 1 changes records, never the round-2 pairings', () => {
  const T = T0({ mode: 'schweizer', participants: players(8), bestOf: { gruppe: 1, schweizer: 1 } });
  const ratings = ratingsOf(8);
  const results = [];
  let s = buildTournament(T, results, { ratings });
  for (const m of s.matches) results.push(win(m, true));
  s = buildTournament(T, results, { ratings });
  const r2 = s.matches.filter(m => m.round === 2).map(m => `${m.nr}:${m.a.key}-${m.b.key}`);
  assert.equal(r2.length, 4);
  results.push(win(s.matches.find(m => m.round === 2)));                // first result of round 2
  results.push(win(s.matches[0], false));                               // then round 1, match 1 is corrected
  const after = buildTournament(T, results, { ratings });
  assert.deepEqual(after.matches.filter(m => m.round === 2).map(m => `${m.nr}:${m.a.key}-${m.b.key}`), r2);
  assert.equal(after.matches[0].result.winner, 'b');
  // without a round-2 result yet, a correction still re-pairs round 2
  const early = results.slice(0, 4).concat(win(s.matches[0], false));
  const re = buildTournament(T, early, { ratings });
  assert.notDeepEqual(re.matches.filter(m => m.round === 2).map(m => `${m.a.key}-${m.b.key}`), r2.map(x => x.split(':')[1]));
});

test('Swiss: odd number of players → one bye per round to someone who hasn\'t had one, counted as a win', () => {
  const { s } = playSwiss(9);
  const byes = s.swiss.rounds.flatMap(r => r.byes);
  assert.equal(new Set(byes).size, byes.length);
  assert.ok(s.swiss.rounds[0].byes.length === 1 && s.swiss.rounds[0].byes[0] === 'm:p9');
});

test('Swiss after the start: round 1 comes from the written pairs', () => {
  const live = buildTournament(T0({ mode: 'schweizer', status: 'angekündigt', participants: players(6), swissRound1: 'zufall' }), [], { ratings: ratingsOf(6) });
  const rows = new Map(parseDrawText(drawText(live)).map(r => [r.row, r]));
  const fixed = T0({ mode: 'schweizer', started: 1, swissRound1: 'nachbarn', participants: players(6).map(p => ({ ...p, seed: rows.get(p.row).seed, pin: Number(rows.get(p.row).group) - 1 })) });
  const s = buildTournament(fixed, [], { ratings: new Map() });
  assert.deepEqual(s.matches.map(m => [m.a.key, m.b.key]), live.matches.map(m => [m.a.key, m.b.key]));
});

// ── the app side: two tournaments at once, the Übersicht card, the Verwaltung action in the demo ──
import { load } from '../js/core/loader.js';
import { demoRaw, demoForms } from '../js/io/demo.js';
import { visibleTournaments, suggestionsFor, cardTournaments, pickTournament } from '../js/app/tournaments.js';
import { tournamentAnswers, tournamentSteps } from '../js/app/forms.js';

test('two tournaments at once: nobody is suggested for two matches; the hub; the card', () => {
  const ds = load(demoRaw('Europe/Vienna', 'turnier'));
  const v = visibleTournaments(ds);
  assert.equal(pickTournament(v, null), null);                        // two going on: the hub
  const [X, Y] = v.actives;
  const a = suggestionsFor(v, X, 3), b = suggestionsFor(v, Y, 3);
  const pa = new Set(a.flatMap(m => [...m.a.people, ...m.b.people]));
  const clashes = m => [...m.a.people, ...m.b.people].some(k => pa.has(k));
  const free = Y.matches.filter(m => m.status === 'offen' && !clashes(m));
  if (free.length) assert.equal(clashes(b[0]), false);                // matches without a busy player come first
  assert.ok(b.findIndex(clashes) === -1 || b.slice(b.findIndex(clashes)).every(clashes));
  const today = Math.floor(ds.tournaments.find(t => t.id === 'advent').date);
  assert.deepEqual(cardTournaments(v, today, 7).map(c => c.kind).sort(), ['aktiv', 'aktiv', 'angekündigt']);
  const herbst = ds.tournaments.find(t => t.id === 'herbst');
  assert.equal(cardTournaments(v, Math.floor(herbst.date) + 3, 7).some(c => c.T.id === 'herbst'), true);
  assert.equal(cardTournaments(v, Math.floor(herbst.date) + 9, 7).some(c => c.T.id === 'herbst'), false);
  assert.deepEqual(tournamentAnswers('x', { nr: 4, a: { name: 'A' }, b: { name: 'B' } }, { wo: 'b' }).set1, 'wo:b');
});

test('demo Verwaltung: ankündigen → starten fixes the draw → results count → zurück auf Entwurf restores', async () => {
  const box = demoForms('Europe/Vienna');
  const fresh = () => load(box.apply(demoRaw('Europe/Vienna', 'turnier')));
  let W = fresh().tournaments.find(t => t.id === 'weihnachten');
  assert.deepEqual(tournamentSteps(W), ['starten', 'entwurf']);
  const before = W.draw;
  await box.submit('management', { action: 'turnier', fields: { tournament: 'weihnachten', step: 'starten', draw: drawText(W) } });
  W = fresh().tournaments.find(t => t.id === 'weihnachten');
  assert.equal(W.status, 'aktiv');
  assert.ok(W.started != null);
  assert.deepEqual(W.draw.rows, before.rows);
  assert.equal(W.pots.length, 5);                                      // the pots after the start, from the fixed seeds
  const log = fresh().log.at(-1);
  assert.equal(log.status, 'ok');
  // a stale draw is refused
  await box.submit('management', { action: 'turnier', fields: { tournament: 'advent', step: 'starten', draw: '2|1|A|Niemand|' } });
  assert.match(fresh().log.at(-1).status, /^refused: cannot starten/);
  await box.submit('management', { action: 'turnier', fields: { tournament: 'weihnachten', step: 'entwurf', draw: '' } });
  const raw = box.apply(demoRaw('Europe/Vienna', 'turnier'));
  assert.ok(raw.turnier_teilnehmer.filter(r => r[0] === 'weihnachten').every(r => r[2] === '' && r[3] === ''));
  assert.equal(load(raw).tournaments.some(t => t.id === 'weihnachten'), false);
});

// ── QR encoder (decoded with OpenCV during development: 130 codes, all levels and masks, versions 1–10) ──
import { encodeQr, rsRemainder, formatBits, CAPACITY } from '../js/core/qr-encode.js';
import { posterGeometry, packBlocks } from '../js/views/print-tournament.js';

test('QR: Reed–Solomon and format bits match the standard, structure is right', () => {
  // the „HELLO WORLD“ 1-M example (ISO 18004 / thonky.com): data codewords → 10 EC codewords
  assert.deepEqual(rsRemainder([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  assert.equal(formatBits('L', 0).toString(2).padStart(15, '0'), '111011111000100');
  assert.equal(formatBits('M', 0).toString(2).padStart(15, '0'), '101010000010010');
  assert.equal(formatBits('Q', 0).toString(2).padStart(15, '0'), '011010101011111');
  assert.equal(formatBits('H', 0).toString(2).padStart(15, '0'), '001011010001001');
  assert.deepEqual(CAPACITY.H, [7, 14, 24, 34, 44, 58, 64, 84, 98, 119]);
  const q = encodeQr('https://baumhakel.github.io/tischtennis_elo/#/turnierspiel?id=weihnachten26&nr=12');
  assert.equal(q.size, 17 + 4 * q.version);
  const ring = [0, 1, 2, 3, 4, 5, 6].map(i => q.modules[0][i]);
  assert.deepEqual(ring, [true, true, true, true, true, true, true]);   // finder top edge
  assert.equal(q.modules[q.size - 8][8], true);                          // dark module
  assert.ok(q.isFinder(3, 3) && q.isFinder(3, q.size - 2) && !q.isFinder(10, 10));
  assert.throws(() => encodeQr('x'.repeat(200)));
});

test('Aushang: four A3 windows overlap by 8 mm; blocks never cross a seam', () => {
  const g = posterGeometry('hoch');
  assert.deepEqual([g.W, g.H], [562, 808]);
  for (const r of g.regions) {
    assert.ok(r.x + r.w <= g.sx || r.x >= g.ww, 'clear of the vertical seam band');
    assert.ok(r.y + r.h <= g.sy || r.y >= g.wh, 'clear of the horizontal seam band');
  }
  const p = packBlocks([{ h: 300, gap: 7 }, { h: 100, gap: 7 }, { h: 50, gap: 0, title: 10 }], g.regions);
  assert.deepEqual(p.map(x => x.region), [0, 1, 1]);
  assert.equal(packBlocks([{ h: 900, gap: 0 }], g.regions), null);
});
