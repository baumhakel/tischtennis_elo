// Phase 18: the tournament core (draw, groups, tables, knockout, results, Elo games, suggestions).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTournamentTabs, parseBestOf, parseSet, validateSets, seedOrder, groupSizes, drawGroups, roundRobin, groupTable,
  fixedPlaces, bracketOrder, knockoutSlots, buildTournament, tournamentGames, suggestions, timeLeft, seedRatings,
} from '../js/core/tournament.js';

const P = (name, id = null, extra = {}) => ({ key: id ? `m:${id}` : `g:${name.toLowerCase()}`, id, name, guest: !id, seed: null, pin: null, ...extra });

test('settings: best of per round, sets', () => {
  assert.deepEqual(parseBestOf('Gruppe 3, Viertelfinale 5, Halbfinale 5, Spiel um Platz 3 5, Finale 7'),
    { gruppe: 3, viertelfinale: 5, halbfinale: 5, 'spiel um platz 3': 5, finale: 7 });
  assert.deepEqual(parseSet(' 11 : 7 '), [11, 7]);
  assert.equal(parseSet(''), null);
  assert.equal(parseSet('elf'), 'bad');
});

test('sets: to 11 with two clear, match ends at the majority, no extra sets', () => {
  assert.deepEqual(validateSets([[11, 7], [9, 11], [11, 5], null], 3, 11).winner, 'a');
  assert.equal(validateSets([[11, 7], [12, 10], null], 3, 11).setsA, 2);
  assert.equal(validateSets([[11, 10]], 3, 11).ok, false);              // no two-point lead
  assert.equal(validateSets([[13, 10]], 3, 11).ok, false);              // past 11 needs exactly two
  assert.equal(validateSets([[11, 7], [11, 7], [11, 7]], 3, 11).ok, false);   // one set too many
  assert.equal(validateSets([[11, 7], null, [11, 7]], 3, 11).ok, false);     // gap
  assert.match(validateSets([[11, 7]], 3, 11).reason, /Noch nicht entschieden/);
  assert.equal(validateSets([[5, 11], [5, 11], [5, 11]], 5, 11).winner, 'b');
});

test('seeding: members by Elo, guests after them by lot, setzplatz moves someone', () => {
  const ps = [P('Anna', 'p1'), P('Bernd', 'p2'), P('Gast1'), P('Clara', 'p3', { seed: 1 }), P('Gast2')];
  const r = new Map([['p1', 1500], ['p2', 1600], ['p3', 1300]]);
  const order = seedOrder(ps, r, 1400, 'x');
  assert.deepEqual(order.slice(0, 3).map(p => p.name), ['Clara', 'Bernd', 'Anna']);
  assert.deepEqual(new Set(order.slice(3).map(p => p.name)), new Set(['Gast1', 'Gast2']));
  assert.deepEqual(seedOrder(ps, r, 1400, 'x').map(p => p.name), order.map(p => p.name));   // reproducible
});

test('groups: even sizes, snake seeding, pins', () => {
  assert.deepEqual(groupSizes(13, 3), [5, 4, 4]);
  assert.deepEqual(groupSizes(12, 3, [5, 4, 3]), [5, 4, 3]);
  const seeded = Array.from({ length: 12 }, (_, i) => P(`S${i + 1}`, `p${i + 1}`));
  const g = drawGroups(seeded, 3, [4, 4, 4]);
  assert.deepEqual(g.map(x => x.map(p => p.name)), [['S1', 'S6', 'S7', 'S12'], ['S2', 'S5', 'S8', 'S11'], ['S3', 'S4', 'S9', 'S10']]);
  seeded[0].pin = 2;
  const h = drawGroups(seeded, 3, [4, 4, 4]);
  assert.ok(h[2].some(p => p.name === 'S1'));
  assert.deepEqual(h.map(x => x.length), [4, 4, 4]);
});

test('round robin: everyone meets everyone once', () => {
  for (const n of [3, 4, 5]) {
    const pairs = roundRobin(n).flat().map(([a, b]) => `${a}-${b}`);
    assert.equal(new Set(pairs).size, n * (n - 1) / 2);
  }
});

const M = (nr, a, b, winner, sets = winner === 'a' ? [2, 0] : [0, 2], pts = [22, 10]) => ({ nr, a: { key: a }, b: { key: b },
  result: winner ? { winner, setsA: sets[0], setsB: sets[1], pointsA: winner === 'a' ? pts[0] : pts[1], pointsB: winner === 'a' ? pts[1] : pts[0] } : null });

test('group table: wins, then head-to-head, then sets; certain places while games are open', () => {
  const members = ['a', 'b', 'c'].map(key => ({ key }));
  const ms = [M(1, 'a', 'b', 'a'), M(2, 'b', 'c', 'a'), M(3, 'c', 'a', 'a')];   // a beat b, b beat c, c beat a
  const t = groupTable(members, ms, () => 0.5);
  assert.deepEqual(t.map(r => r.wins), [1, 1, 1]);
  const open = [M(1, 'a', 'b', 'a'), M(2, 'b', 'c', 'a'), M(3, 'a', 'c', null)];
  assert.equal(fixedPlaces(members, open).size, 0);      // if c wins, all three are tied 1:1: nothing certain
  const clear = [M(1, 'a', 'b', 'a'), M(2, 'a', 'c', 'a'), M(3, 'b', 'c', null)];
  const f = fixedPlaces(members, clear);
  assert.equal(f.get(1), 'a');                           // two wins, nobody else can reach two
  assert.equal(f.has(2), false);
  assert.equal(fixedPlaces(members, ms), null);           // nothing open: the table is final
  const two = [M(1, 'a', 'b', 'a'), M(2, 'b', 'c', 'a'), M(3, 'a', 'c', 'a')];
  assert.deepEqual(groupTable(members, two, () => 0.5).map(r => r.key), ['a', 'b', 'c']);
});

test('knockout: bracket order, byes to the top seeds, same group apart as long as possible', () => {
  assert.deepEqual(bracketOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  const k = knockoutSlots([2, 2, 2]);                       // 6 → bracket of 8, two byes
  assert.equal(k.size, 8);
  assert.equal(k.slots.filter(s => s === null).length, 2);
  for (let i = 0; i < 8; i += 2) {                         // no first-round match within one group
    const [x, y] = [k.slots[i], k.slots[i + 1]];
    if (x && y) assert.notEqual(x.group, y.group);
  }
  const q = knockoutSlots([2, 2]);                          // A1 B2 / B1 A2
  assert.deepEqual(q.slots.map(s => `${'AB'[s.group]}${s.place}`), ['A1', 'B2', 'B1', 'A2']);
});

function demoTournament(extra = {}) {
  const participants = ['Anna', 'Bernd', 'Clara', 'David', 'Elif', 'Fritz', 'Greta', 'Hans'].map((n, i) => P(n, i < 6 ? `p${i + 1}` : null));
  return { id: 'x', name: 'X', status: 'aktiv', art: 'einzel', groups: 2, groupSizes: [], advance: [2], bestOf: { gruppe: 3, finale: 3 },
    points: 11, third: true, lot: '1', participants, ...extra };
}
const ratings = new Map([['p1', 1600], ['p2', 1550], ['p3', 1500], ['p4', 1450], ['p5', 1400], ['p6', 1350]]);

/** Play every open match (side a wins 2:0) until nothing is open. */
function playAll(T, base = []) {
  const results = base.slice();
  let t = 46400, s;
  for (let i = 0; i < 40; i++) {
    s = buildTournament(T, results, { ratings });
    const open = s.matches.filter(m => m.status === 'offen');
    if (!open.length) break;
    for (const m of open) results.push({ tournament: 'x', nr: m.nr, t: t += 0.01, ref: `r${m.nr}`, row: results.length + 2, sets: [[11, 5], [11, 6], null] });
  }
  return { s, results };
}

test('a whole tournament: groups, knockout opens as places are certain, final, third place', () => {
  const T = demoTournament();
  let s = buildTournament(T, [], { ratings });
  assert.equal(s.ok, true);
  assert.equal(s.matches.filter(m => m.stage === 'gruppe').length, 12);   // 2 groups of 4
  const semis = s.matches.filter(m => m.label === 'Halbfinale');
  assert.equal(semis.length, 2);
  assert.equal(semis[0].status, 'wartet');
  assert.match(semis[0].a.label, /Sieger Gruppe A/);
  assert.ok(s.matches.some(m => m.third));
  const { s: end } = playAll(T);
  assert.equal(end.done, true);
  assert.ok(end.winner && end.second && end.third.length === 1);
  assert.equal(end.played, end.total);
  // Elo: only member against member
  const games = tournamentGames(end);
  assert.ok(games.length > 0);
  assert.ok(games.every(g => !g.winners[0].startsWith('g:') && g.winners[0] && g.losers[0]));
  const withGuest = end.matches.filter(m => m.result && (m.a.guest || m.b.guest)).length;
  assert.equal(games.length, end.played - withGuest);
  assert.deepEqual(tournamentGames({ ...end, status: 'test' }), []);
});

test('results: the later entry for a match counts; invalid and too-early ones are issues', () => {
  const T = demoTournament();
  const s0 = buildTournament(T, [], { ratings });
  const g1 = s0.matches[0];
  const results = [
    { tournament: 'x', nr: 1, t: 1, ref: 'a', row: 2, sets: [[11, 5], [11, 5], null] },
    { tournament: 'x', nr: 1, t: 2, ref: 'b', row: 3, sets: [[5, 11], [5, 11], null] },
    { tournament: 'x', nr: 2, t: 3, ref: 'c', row: 4, sets: [[11, 10], null] },
    { tournament: 'x', nr: 13, t: 4, ref: 'd', row: 5, sets: [[11, 5], [11, 5], null] },   // a semi-final, sides unknown
    { tournament: 'y', nr: 3, t: 5, ref: 'e', row: 6, sets: [[11, 5], [11, 5], null] },    // another tournament
    { tournament: 'x', nr: 99, t: 6, ref: 'f', row: 7, sets: [[11, 5], [11, 5], null] },
  ];
  const s = buildTournament(T, results, { ratings });
  assert.equal(s.matches[0].result.winner, 'b');
  assert.equal(s.matches[0].result.ref, 'b');
  assert.equal(s.matches[1].result, undefined);
  assert.equal(s.issues.length, 3);
  assert.ok(s.issues.some(i => i.nr === 13 && /stehen noch nicht fest/.test(i.text)));
  assert.ok(s.issues.some(i => i.nr === 99));
  assert.equal(g1.nr, 1);
});

test('suggestions: open matches, nobody twice in a row; time left', () => {
  const T = demoTournament();
  const r = [{ tournament: 'x', nr: 1, t: 1, ref: 'a', row: 2, sets: [[11, 5], [11, 5], null] }];
  const s = buildTournament(T, r, { ratings });
  const sug = suggestions(s, 3);
  assert.equal(sug.length, 3);
  const last = new Set([s.matches[0].a.key, s.matches[0].b.key]);
  assert.ok(![sug[0].a.key, sug[0].b.key].some(k => last.has(k)));
  const keys = sug.flatMap(m => [m.a.key, m.b.key]);
  assert.equal(new Set(keys).size, keys.length);          // can all be played at once
  const tl = timeLeft(s, 12);
  assert.equal(tl.left, s.total - 1);
  assert.equal(tl.minutes, tl.left * 12);
});

test('reading the tabs, unknown names are guests, Doppel not yet', () => {
  const raw = {
    turniere: [['id', 'name', 'datum', 'status', 'art', 'gruppen', 'weiter_pro_gruppe', 'saetze', 'punkte_pro_satz', 'setzstichtag', 'los'],
      ['w26', 'Weihnachtsturnier', 46377, 'aktiv', 'einzel', 2, '2', 'Gruppe 3, Finale 5', 11, 46376, 7],
      ['s27', 'Sommer', 46550, 'entwurf', 'doppel', 1, '', '', '', '', '']],
    turnier_teilnehmer: [['turnier_id', 'name', 'setzplatz', 'gruppe'], ['w26', 'Anna', '', ''], ['w26', 'Gast Max', '', 'B'], ['w26', 'anna', '', '']],
    turnier_ergebnisse: [['Zeitstempel', 'Turnier', 'Spiel-Nr.', 'Begegnung', 'Satz 1', 'Satz 2', 'Satz 3'], [46377.5, 'w26', 3, 'A gegen B', '11:7', '11:9', '']],
  };
  const issues = [];
  const out = parseTournamentTabs(raw, new Map([['anna', 'p1']]), (l, k, m) => issues.push(m));
  assert.equal(out.list.length, 2);
  const w = out.list[0];
  assert.deepEqual([w.status, w.groups, w.advance, w.bestOf.finale, w.points], ['aktiv', 2, [2], 5, 11]);
  assert.deepEqual(w.participants.map(p => [p.name, p.guest, p.pin]), [['Anna', false, null], ['Gast Max', true, 1]]);
  assert.ok(issues.some(m => /zweimal/.test(m)));
  assert.deepEqual(out.results[0].sets.slice(0, 3), [[11, 7], [11, 9], null]);
  assert.equal(buildTournament(out.list[1], []).ok, false);
});

test('seeding ratings: a replay of the games before the cut-off date', () => {
  const games = [{ t: 1, winners: ['a'], losers: ['b'], double: false }, { t: 5, winners: ['b'], losers: ['a'], double: false }];
  const r = seedRatings(games, { start_rating: 1400, k_single: 40, k_double: 20 }, 3);
  assert.equal(r.get('a'), 1420);
  assert.equal(r.get('b'), 1380);
});

// ── loader, corrections, arrival check ──
import { load } from '../js/core/loader.js';
import { demoRaw } from '../js/io/demo.js';
import { tournamentOutcome } from '../js/app/after-entry.js';
import { visibleTournaments } from '../js/app/tournaments.js';
import { tournamentAnswers } from '../js/app/forms.js';

test('loader: member games of a tournament count for Elo, a void correction drops a result', () => {
  const raw = demoRaw('Europe/Vienna', 'turnier');
  const ds = load(raw);
  const T = ds.tournaments.find(t => t.id === 'herbst');
  const tg = ds.games.filter(g => g.source === 'turnier' && g.tournament.id === 'herbst');
  assert.equal(tg.length, T.matches.filter(m => m.result && m.a.id && m.b.id).length);
  assert.ok(tg.every(g => g.tournament.id && !g.double));
  for (let i = 1; i < ds.games.length; i++) assert.ok(ds.games[i - 1].t <= ds.games[i].t);
  // void the result of the advent tournament's first played match
  const A = ds.tournaments.find(t => t.id === 'advent');
  const m = A.matches.find(x => x.result);
  raw.corrections.push([m.result.ref, 'void', 'test', '', '', '']);
  const ds2 = load(raw);
  const A2 = ds2.tournaments.find(t => t.id === 'advent');
  assert.equal(A2.matches.find(x => x.nr === m.nr).result, undefined);
  assert.ok(!ds2.issues.some(i => i.kind === 'unmatched_correction'));
  assert.notEqual(ds.hash, ds2.hash);
  // swap on a tournament result: refused with a hint
  raw.corrections.push([A.matches.filter(x => x.result)[1].result.ref, 'swap', 'test', '', '', '']);
  assert.ok(load(raw).issues.some(i => /Turnierergebnis/.test(i.message)));
});

test('visible tournaments, answers for the form, arrival check', () => {
  const ds = load(demoRaw('Europe/Vienna', 'turnier'));
  const v = visibleTournaments(ds);
  assert.deepEqual(v.actives.map(t => t.id).sort(), ['advent', 'adventdoppel']);     // two at once (Phase 18c)
  assert.deepEqual(v.announced.map(t => t.id), ['weihnachten']);
  assert.deepEqual(v.list.map(t => t.id).sort(), ['advent', 'adventdoppel', 'herbst', 'weihnachten']);
  const A = v.list.find(t => t.id === 'advent');
  assert.equal(visibleTournaments({ tournaments: [{ ...A, status: 'test' }] }).active, null);
  assert.equal(visibleTournaments({ tournaments: [{ ...A, status: 'test' }] }, true).active.id, 'advent');
  const m = A.matches.find(x => x.status === 'offen');
  const ans = tournamentAnswers('advent', m, [[11, 7], [11, 9]]);
  assert.deepEqual([ans.match, ans.set1, ans.set2, ans.set3], [String(m.nr), '11:7', '11:9', undefined]);
  const before = new Set(A.entries.map(e => e.row));
  assert.equal(tournamentOutcome({ tournament: 'advent', nr: m.nr }, ds, before), null);
  const fake = { tournaments: [{ ...A, entries: [...A.entries, { nr: m.nr, row: 999, ref: 'x' }],
    matches: A.matches.map(x => (x.nr === m.nr ? { ...x, result: { row: 999 } } : x)) }] };
  assert.equal(tournamentOutcome({ tournament: 'advent', nr: m.nr }, fake, before).ok, true);
  const bad = { tournaments: [{ ...A, entries: [...A.entries, { nr: m.nr, row: 999, ref: 'x' }], issues: [{ row: 999, nr: m.nr, text: `Spiel ${m.nr}: Satz 1 (11:10) ist kein gültiger Satz` }] }] };
  const out = tournamentOutcome({ tournament: 'advent', nr: m.nr }, bad, before);
  assert.equal(out.ok, false);
  assert.match(out.text, /^Angekommen, aber nicht gewertet: Satz 1/);
});
