// Turnier (Phase 18), pure: the tabs turniere · turnier_teilnehmer · turnier_ergebnisse → every tournament with its
// draw, groups and live tables, knockout bracket, results, winner and the games that count for Elo. No DOM, no
// network; runs in the loader (so every view and the cache see the same tournament).
//
//   parseTournamentTabs(raw, idByName, report) → { list: [settings + participants], results: [result rows] }
//   buildTournament(T, results, { ratings, startRating }) → state (see the end of the file)
//   validateSets(sets, bestOf, points) → { ok, winner: 'a'|'b', setsA, setsB, reason }
//   tournamentGames(state) → [{ t, ref, row, winners, losers, tournament }]   member against member only
//   suggestions(state, count) → open matches to play next        timeLeft(state, fallbackMinutes) → minutes
//   seedRatings(games, players, config, until) → Map id → Elo-Wert just before `until`
//
// Decisions (13 Nov 2026, plan doc Phase 18): snake seeding, uneven groups, advancing per group, tie-breaks wins →
// head-to-head → set difference → point difference → lot, Spiel um Platz 3, group games in any order, knockout
// games open once both sides are known, members seeded by Elo at `setzstichtag`, guests by `setzplatz` or lot,
// games between two members count for Elo, guests never, a later entry for a match replaces an earlier one.
import { readTable, cell, clean, norm, toNumber, parseTime, formatRef, roundSerial, fnv1a } from './normalize.js';
import { winProbability } from './elo.js';

export const TOURNAMENT_COLUMNS = {
  turniere: { id: ['id'], name: ['name'], datum: ['datum', 'date'], status: ['status'], art: ['art'], gruppen: ['gruppen'],
    gruppengroessen: ['gruppengroessen', 'gruppengrößen'], weiter: ['weiter_pro_gruppe'], saetze: ['saetze', 'sätze'],
    punkte: ['punkte_pro_satz'], platz3: ['spiel_um_platz_3'], tische: ['tische'], stichtag: ['setzstichtag'], los: ['los'],
    siegerfoto: ['siegerfoto'] },
  teilnehmer: { turnier: ['turnier_id'], name: ['name'], setzplatz: ['setzplatz'], gruppe: ['gruppe'], name2: ['name_2'] },
  ergebnisse: { zeit: ['zeitstempel', 'timestamp'], turnier: ['turnier'], nr: ['spiel-nr.', 'spiel-nr', 'spiel nr'],
    begegnung: ['begegnung'], s1: ['satz 1'], s2: ['satz 2'], s3: ['satz 3'], s4: ['satz 4'], s5: ['satz 5'], s6: ['satz 6'], s7: ['satz 7'] },
};
const OPTIONAL = {
  turniere: ['datum', 'art', 'gruppengroessen', 'weiter', 'saetze', 'punkte', 'platz3', 'tische', 'stichtag', 'los', 'siegerfoto'],
  teilnehmer: ['setzplatz', 'gruppe', 'name2'],
  ergebnisse: ['begegnung', 's2', 's3', 's4', 's5', 's6', 's7'],
};
export const STATUSES = ['entwurf', 'test', 'aktiv', 'beendet'];
const LETTERS = 'ABCDEFGHIJKLMNOP';

// ───────── reading the tabs ─────────

const list = v => String(v ?? '').split(/[,;]/).map(s => clean(s)).filter(Boolean);
const int = (v, def) => { const n = Math.round(toNumber(v)); return Number.isFinite(n) && n > 0 ? n : def; };
const yes = v => { const s = norm(v); return s === '' ? null : ['ja', 'true', 'wahr', '1', 'x', 'yes'].includes(s); };

/** „Gruppe 3, Viertelfinale 5, Finale 7“ → { gruppe: 3, viertelfinale: 5, finale: 7 } (keys lowercase). */
export function parseBestOf(v) {
  const out = {};
  for (const part of list(v)) {
    const m = /^(.*?)\s*(\d+)$/.exec(part);
    if (m) out[norm(m[1]) || 'gruppe'] = Number(m[2]);
  }
  return out;
}

/** „11:7“, „11 : 7“, „11-7“ → [11, 7], empty → null, anything else → 'bad'. */
export function parseSet(v) {
  const s = clean(v);
  if (!s) return null;
  const m = /^(\d{1,2})\s*[:\-–]\s*(\d{1,2})$/.exec(s);
  return m ? [Number(m[1]), Number(m[2])] : 'bad';
}

export function parseTournamentTabs(raw, idByName, report = () => {}) {
  const out = { list: [], results: [] };
  if (!raw.turniere?.length) return out;
  const T = readTable(raw.turniere, TOURNAMENT_COLUMNS.turniere, OPTIONAL.turniere);
  if (T.missing.length) {
    report('warning', 'missing_column', `Tab „turniere“: Spalte(n) ${T.missing.join(', ')} fehlen. Turniere werden nicht angezeigt.`, { tab: 'turniere' });
    return out;
  }
  const P = raw.turnier_teilnehmer?.length ? readTable(raw.turnier_teilnehmer, TOURNAMENT_COLUMNS.teilnehmer, OPTIONAL.teilnehmer) : null;
  const seen = new Set();
  for (const { cells, row } of T.rows) {
    const id = clean(cell(cells, T.col.id));
    if (!id) continue;
    if (seen.has(id)) { report('warning', 'tournament', `Tab „turniere“, Zeile ${row}: die ID „${id}“ gibt es zweimal. Die zweite Zeile wird übersprungen.`, { tab: 'turniere', row }); continue; }
    seen.add(id);
    const status = norm(cell(cells, T.col.status)) || 'entwurf';
    const datum = parseTime(cell(cells, T.col.datum));
    const bestOf = parseBestOf(cell(cells, T.col.saetze));
    const t = {
      id, row, name: clean(cell(cells, T.col.name)) || id,
      date: datum, status: STATUSES.includes(status) ? status : 'entwurf',
      art: norm(cell(cells, T.col.art)) || 'einzel',
      groups: int(cell(cells, T.col.gruppen), 1),
      groupSizes: list(cell(cells, T.col.gruppengroessen)).map(Number).filter(n => n > 0),
      advance: list(cell(cells, T.col.weiter)).map(Number).filter(n => n >= 0),
      bestOf: { gruppe: 3, ...bestOf },
      points: int(cell(cells, T.col.punkte), 11),
      third: yes(cell(cells, T.col.platz3)) ?? true,
      tables: int(cell(cells, T.col.tische), 1),
      seedAt: parseTime(cell(cells, T.col.stichtag)) ?? (datum != null ? Math.floor(datum) : null),
      lot: clean(cell(cells, T.col.los)) || '1',
      winnerPhoto: clean(cell(cells, T.col.siegerfoto)) || null,
      participants: [],
    };
    if (!STATUSES.includes(status)) report('warning', 'tournament', `Turnier „${id}“: unbekannter Status „${status}“ (erlaubt: ${STATUSES.join(', ')}). Es wird wie „entwurf“ behandelt.`, { tab: 'turniere', row });
    if (!t.advance.length) t.advance = [Math.min(2, Math.max(1, Math.floor(16 / t.groups)))];
    out.list.push(t);
  }
  if (P && !P.missing.length) {
    const byId = new Map(out.list.map(t => [t.id, t]));
    for (const { cells, row } of P.rows) {
      const t = byId.get(clean(cell(cells, P.col.turnier)));
      const name = clean(cell(cells, P.col.name));
      if (!t || !name) continue;
      const id = idByName.get(norm(name)) || null;
      const key = id ? `m:${id}` : `g:${norm(name)}`;
      if (t.participants.some(p => p.key === key)) {
        report('warning', 'tournament', `Turnier „${t.id}“: „${name}“ steht zweimal im Tab „turnier_teilnehmer“ (Zeile ${row}).`, { tab: 'turnier_teilnehmer', row });
        continue;
      }
      const g = clean(cell(cells, P.col.gruppe)).toUpperCase();
      t.participants.push({ key, id, name, guest: !id, row,
        seed: int(cell(cells, P.col.setzplatz), null), pin: g ? (LETTERS.indexOf(g) >= 0 ? LETTERS.indexOf(g) : int(g, 0) - 1) : null,
        name2: clean(cell(cells, P.col.name2)) || null });
    }
  }
  const R = raw.turnier_ergebnisse?.length ? readTable(raw.turnier_ergebnisse, TOURNAMENT_COLUMNS.ergebnisse, OPTIONAL.ergebnisse) : null;
  if (R && R.missing.length) report('warning', 'missing_column', `Tab „turnier_ergebnisse“: Spalte(n) ${R.missing.join(', ')} fehlen. Turnierergebnisse werden nicht gelesen.`, { tab: 'turnier_ergebnisse' });
  else if (R) {
    for (const { cells, row } of R.rows) {
      const raw = parseTime(cell(cells, R.col.zeit));
      if (raw == null) continue;
      const t = roundSerial(raw);   // whole seconds, as for every other game (refs match corrections)
      const sets = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'].map(k => parseSet(cell(cells, R.col[k])));
      out.results.push({ row, t, ref: formatRef(t), tournament: clean(cell(cells, R.col.turnier)),
        nr: int(cell(cells, R.col.nr), null), pairing: clean(cell(cells, R.col.begegnung)), sets });
    }
  }
  return out;
}

// ───────── seeding ratings ─────────

/** Elo-Werte (pooled) after all games before `until` (a light replay: ratings only, the engine's formula). */
export function seedRatings(games, config, until) {
  const r = new Map();
  const get = id => r.get(id) ?? config.start_rating;
  for (const g of games) {
    if (until != null && g.t >= until) break;
    const wr = g.winners.reduce((s, id) => s + get(id), 0) / g.winners.length;
    const lr = g.losers.reduce((s, id) => s + get(id), 0) / g.losers.length;
    const d = (g.double ? config.k_double : config.k_single) * (1 - winProbability(wr, lr));
    for (const id of g.winners) r.set(id, get(id) + d);
    for (const id of g.losers) r.set(id, get(id) - d);
  }
  return r;
}

// ───────── draw ─────────

/** Small seeded random generator (mulberry32). */
export function rng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : parseInt(fnv1a(String(seed)), 16);
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * Seed order: members by Elo-Wert (highest first), then guests in lot order; then everyone with a `setzplatz`
 * is moved to that place. Returns participants in seed order.
 */
export function seedOrder(participants, ratings, startRating, lot) {
  const rand = rng(lot);
  const members = participants.filter(p => !p.guest)
    .sort((a, b) => (ratings.get(b.id) ?? startRating) - (ratings.get(a.id) ?? startRating) || a.name.localeCompare(b.name, 'de'));
  const guests = shuffle(participants.filter(p => p.guest).sort((a, b) => a.name.localeCompare(b.name, 'de')), rand);
  const order = [...members, ...guests].filter(p => p.seed == null);
  const fixed = participants.filter(p => p.seed != null).sort((a, b) => a.seed - b.seed);
  for (const p of fixed) order.splice(Math.min(order.length, p.seed - 1), 0, p);
  return order;
}

/** Group sizes: given by hand, else as even as possible (differ by at most one). */
export function groupSizes(n, groups, given = []) {
  if (given.length === groups && given.reduce((a, b) => a + b, 0) === n) return given.slice();
  const base = Math.floor(n / groups), extra = n % groups;
  return Array.from({ length: groups }, (_, g) => base + (g < extra ? 1 : 0));
}

/** Snake seeding into groups (A B C C B A A B C …), skipping full groups; pinned players go to their group first. */
export function drawGroups(seeded, groups, sizes) {
  const out = Array.from({ length: groups }, () => []);
  for (const p of seeded) if (p.pin != null && p.pin >= 0 && p.pin < groups) out[p.pin].push(p);
  const rest = seeded.filter(p => !(p.pin != null && p.pin >= 0 && p.pin < groups));
  let i = 0, dir = 1, g = 0;
  for (const p of rest) {
    let guard = 0;
    while (out[g].length >= sizes[g] && guard++ < groups * 4) { [g, dir] = step(g, dir, groups); }
    out[g].push(p);
    [g, dir] = step(g, dir, groups);
    i++;
  }
  return out;
}
function step(g, dir, n) {
  if (n === 1) return [0, 1];
  const next = g + dir;
  if (next < 0 || next >= n) return [g, -dir];   // snake: the end group takes two in a row
  return [next, dir];
}

/** Round robin pairs of n players by the circle method: rounds of [i, j] (indices into the group). */
export function roundRobin(n) {
  const ids = Array.from({ length: n % 2 ? n + 1 : n }, (_, i) => i);
  const m = ids.length, rounds = [];
  for (let r = 0; r < m - 1; r++) {
    const pairs = [];
    for (let k = 0; k < m / 2; k++) {
      const a = ids[k], b = ids[m - 1 - k];
      if (a < n && b < n) pairs.push(a < b ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    ids.splice(1, 0, ids.pop());
  }
  return rounds;
}

// ───────── results ─────────

/** Sets [[a, b] | null | 'bad', …] for best of `bestOf`, to `points` with two clear: who won, or why not valid. */
export function validateSets(sets, bestOf, points) {
  const need = Math.floor(bestOf / 2) + 1;
  let a = 0, b = 0, ended = false;
  const played = [];
  for (let i = 0; i < sets.length; i++) {
    const s = sets[i];
    if (s == null) { if (sets.slice(i + 1).some(x => x != null)) return { ok: false, reason: `Satz ${i + 1} fehlt, aber ein späterer Satz ist eingetragen.` }; break; }
    if (s === 'bad') return { ok: false, reason: `Satz ${i + 1} ist nicht lesbar (Form 11:7).` };
    if (ended) return { ok: false, reason: `Satz ${i + 1} ist zu viel: das Spiel war schon entschieden.` };
    const [x, y] = s, hi = Math.max(x, y), lo = Math.min(x, y);
    const fine = hi === points ? lo <= points - 2 : hi > points && hi - lo === 2;
    if (!fine) return { ok: false, reason: `Satz ${i + 1} (${x}:${y}) ist kein gültiger Satz bis ${points} mit zwei Punkten Vorsprung.` };
    if (x > y) a++; else b++;
    played.push(s);
    if (a === need || b === need) ended = true;
  }
  if (!ended) return { ok: false, reason: `Noch nicht entschieden: ${a}:${b} Sätze bei „Best of ${bestOf}“.` };
  return { ok: true, winner: a > b ? 'a' : 'b', setsA: a, setsB: b, sets: played,
    pointsA: played.reduce((s, x) => s + x[0], 0), pointsB: played.reduce((s, x) => s + x[1], 0) };
}

// ───────── group tables ─────────

/** Table of one group from its played matches. Ranking: wins → head-to-head → set diff → point diff → lot. */
export function groupTable(members, matches, lotRand) {
  const rows = members.map((p, i) => ({ i, key: p.key, played: 0, wins: 0, losses: 0, setsW: 0, setsL: 0, ptsW: 0, ptsL: 0 }));
  const by = new Map(rows.map(r => [r.key, r]));
  for (const m of matches) {
    if (!m.result) continue;
    const A = by.get(m.a.key), B = by.get(m.b.key), r = m.result;
    A.played++; B.played++;
    if (r.winner === 'a') { A.wins++; B.losses++; } else { B.wins++; A.losses++; }
    A.setsW += r.setsA; A.setsL += r.setsB; B.setsW += r.setsB; B.setsL += r.setsA;
    A.ptsW += r.pointsA; A.ptsL += r.pointsB; B.ptsW += r.pointsB; B.ptsL += r.pointsA;
  }
  const lot = new Map(shuffle(rows.map(r => r.key), lotRand).map((k, i) => [k, i]));
  const order = rankRows(rows, matches, lot);
  order.forEach((r, i) => { r.place = i + 1; });
  return order;
}

function rankRows(rows, matches, lot) {
  const byWins = groupBy(rows, r => r.wins).sort((a, b) => b[0].wins - a[0].wins);
  const out = [];
  for (const tied of byWins) {
    if (tied.length === 1) { out.push(tied[0]); continue; }
    const keys = new Set(tied.map(r => r.key));
    const h2h = new Map(tied.map(r => [r.key, 0]));
    for (const m of matches) {
      if (!m.result || !keys.has(m.a.key) || !keys.has(m.b.key)) continue;
      const w = m.result.winner === 'a' ? m.a.key : m.b.key;
      h2h.set(w, h2h.get(w) + 1);
    }
    out.push(...tied.slice().sort((x, y) => h2h.get(y.key) - h2h.get(x.key)
      || (y.setsW - y.setsL) - (x.setsW - x.setsL) || (y.ptsW - y.ptsL) - (x.ptsW - x.ptsL) || lot.get(x.key) - lot.get(y.key)));
  }
  return out;
}

function groupBy(arr, f) {
  const m = new Map();
  for (const x of arr) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return [...m.values()];
}

/**
 * Which places of a group are already certain („steht fest“): every way the open matches can still end (win or loss)
 * must put the same player on that place by wins and head-to-head alone. A tie that only sets or points could break
 * counts as uncertain while games are open. Returns Map place → key (only the certain places).
 */
export function fixedPlaces(members, matches) {
  const open = matches.filter(m => !m.result);
  const keys = members.map(p => p.key);
  if (!open.length) return null;                       // all played: the table itself is final
  if (open.length > 12) return new Map();               // too many outcomes to check: nothing certain yet
  let agree = null;
  for (let mask = 0; mask < 1 << open.length; mask++) {
    const wins = new Map(keys.map(k => [k, 0])), beat = [];
    for (const m of matches) {
      if (!m.result) continue;
      const w = m.result.winner === 'a' ? m.a.key : m.b.key, l = w === m.a.key ? m.b.key : m.a.key;
      wins.set(w, wins.get(w) + 1); beat.push([w, l]);
    }
    open.forEach((m, j) => {
      const w = mask >> j & 1 ? m.a.key : m.b.key, l = w === m.a.key ? m.b.key : m.a.key;
      wins.set(w, wins.get(w) + 1); beat.push([w, l]);
    });
    const places = new Map();
    let pos = 1;
    for (const tied of groupBy(keys, k => wins.get(k)).sort((a, b) => wins.get(b[0]) - wins.get(a[0]))) {
      if (tied.length === 1) { places.set(pos, tied[0]); pos++; continue; }
      const set = new Set(tied), h = new Map(tied.map(k => [k, 0]));
      for (const [w, l] of beat) if (set.has(w) && set.has(l)) h.set(w, h.get(w) + 1);
      for (const sub of groupBy(tied, k => h.get(k)).sort((a, b) => h.get(b[0]) - h.get(a[0]))) {
        if (sub.length === 1) places.set(pos, sub[0]);   // else: needs sets / points → uncertain
        pos += sub.length;
      }
    }
    if (!agree) agree = places;
    else for (const [p, k] of [...agree]) if (places.get(p) !== k) agree.delete(p);
    if (!agree.size) break;
  }
  return agree;
}

// ───────── knockout ─────────

/** Bracket slot order for size P: [1, P, …] so that seed 1 and 2 can only meet in the final. Returns seed numbers. */
export function bracketOrder(P) {
  let order = [1];
  while (order.length < P) {
    const n = order.length * 2;
    order = order.flatMap(s => [s, n + 1 - s]);
  }
  return order;
}

export const roundName = sides => ({ 2: 'Finale', 4: 'Halbfinale', 8: 'Viertelfinale', 16: 'Achtelfinale' })[sides] || `Runde der letzten ${sides}`;

/** Round (1 = first) in which bracket positions i and j (0-based) can meet. */
const meetRound = (i, j) => { let r = 1; while ((i >> r) !== (j >> r)) r++; return r; };

/**
 * Seed slots in bracket order: place tiers (all group winners, then all second-placed …), groups in letter order
 * within a tier; within each lower tier the order is chosen so that players from the same group meet as late as
 * possible. Returns { size, slots: [{ group, place } | null (bye)] } in bracket position order.
 */
export function knockoutSlots(advance) {
  const tiers = [];
  const maxPlace = Math.max(0, ...advance);
  for (let place = 1; place <= maxPlace; place++) tiers.push(advance.map((n, g) => (n >= place ? { group: g, place } : null)).filter(Boolean));
  const seeds = tiers.flat();
  const Q = seeds.length;
  if (Q < 2) return { size: Q, slots: seeds };
  let P = 1; while (P < Q) P *= 2;
  const order = bracketOrder(P);
  const rounds = Math.log2(P);
  const place = s => s.map((x, k) => [x, order.indexOf(k + 1)]);   // seed k+1 → position
  const cost = list => {
    let c = 0;
    const pos = place(list);
    for (let a = 0; a < pos.length; a++) for (let b = a + 1; b < pos.length; b++) {
      if (pos[a][0].group === pos[b][0].group) c += 2 ** (rounds - meetRound(pos[a][1], pos[b][1]));
    }
    return c;
  };
  // try permutations of each lower tier (one tier at a time, keeping earlier choices)
  let best = seeds.slice();
  let start = tiers[0].length;
  for (let t = 1; t < tiers.length; t++) {
    const tier = tiers[t];
    let bestCost = Infinity, bestPerm = tier;
    const perms = tier.length <= 7 ? permutations(tier) : [tier];
    for (const perm of perms) {
      const trial = [...best.slice(0, start), ...perm, ...best.slice(start + tier.length)];
      const c = cost(trial);
      if (c < bestCost) { bestCost = c; bestPerm = perm; }
    }
    best = [...best.slice(0, start), ...bestPerm, ...best.slice(start + tier.length)];
    start += tier.length;
  }
  const slots = order.map(s => (s <= Q ? best[s - 1] : null));
  return { size: P, slots };
}

function permutations(a) {
  if (a.length <= 1) return [a];
  return a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p]));
}

// ───────── the whole tournament ─────────

/**
 * @param T   one tournament from parseTournamentTabs
 * @param results  all result rows of the tab (others are ignored), voided ones already removed
 * @returns {{ id, name, date, status, art, ok, problem, participants, groups, matches, tables, fixed, bracket,
 *             winner, second, third, done, played, total, issues }}
 */
export function buildTournament(T, results, { ratings = new Map(), startRating = 1400 } = {}) {
  const issues = [];
  const base = { id: T.id, name: T.name, date: T.date, status: T.status, art: T.art, winnerPhoto: T.winnerPhoto, points: T.points, tische: T.tables || 1, issues };
  if (T.art !== 'einzel') return { ...base, ok: false, problem: 'Doppel-Turniere kommen später: die App kann bisher nur Einzel-Turniere.' };
  const people = T.participants;
  if (people.length < 2) return { ...base, ok: false, problem: 'Es sind noch keine (oder zu wenige) Teilnehmer eingetragen.' };
  const groupsN = Math.max(1, Math.min(T.groups, Math.floor(people.length / 2)));
  const lotKey = `${T.id}|${T.lot}`;
  const seeded = seedOrder(people, ratings, startRating, lotKey);
  const sizes = groupSizes(people.length, groupsN, T.groupSizes);
  const groupMembers = drawGroups(seeded, groupsN, sizes);
  const participants = seeded.map((p, i) => ({ key: p.key, id: p.id, name: p.name, guest: p.guest, seed: i + 1,
    rating: p.id ? Math.round(ratings.get(p.id) ?? startRating) : null, group: groupMembers.findIndex(g => g.includes(p)) }));
  const byKey = new Map(participants.map(p => [p.key, p]));
  const advance = Array.from({ length: groupsN }, (_, g) => Math.min(T.advance[g] ?? T.advance[0], groupMembers[g].length));

  // group matches: rounds of every group, interleaved, numbered from 1
  const matches = [];
  const perGroup = groupMembers.map(m => roundRobin(m.length));
  const maxRounds = Math.max(...perGroup.map(r => r.length));
  for (let r = 0; r < maxRounds; r++) {
    perGroup.forEach((rounds, g) => {
      for (const [i, j] of rounds[r] || []) {
        matches.push({ nr: matches.length + 1, stage: 'gruppe', group: g, round: r + 1, label: `Gruppe ${LETTERS[g]}`,
          bestOf: T.bestOf.gruppe, a: side(byKey.get(groupMembers[g][i].key)), b: side(byKey.get(groupMembers[g][j].key)) });
      }
    });
  }

  // results: the latest valid entry per match counts
  const mine = results.filter(r => r.tournament === T.id).sort((x, y) => x.t - y.t || x.row - y.row);
  base.entries = mine.map(r => ({ nr: r.nr, row: r.row, ref: r.ref }));
  const byNr = new Map();
  for (const r of mine) {
    if (r.nr == null) { issues.push({ row: r.row, text: `Ergebnis in Zeile ${r.row}: die Spiel-Nr. fehlt.` }); continue; }
    byNr.set(r.nr, r);
  }

  const applyResult = m => {
    const r = byNr.get(m.nr);
    if (!r) return;
    if (!m.a.key || !m.b.key) { issues.push({ row: r.row, nr: m.nr, text: `Spiel ${m.nr}: Ergebnis eingetragen, aber die Gegner stehen noch nicht fest.` }); return; }
    const v = validateSets(r.sets, m.bestOf, T.points);
    if (!v.ok) { issues.push({ row: r.row, nr: m.nr, text: `Spiel ${m.nr}: ${v.reason}` }); return; }
    m.result = { ...v, t: r.t, ref: r.ref, row: r.row };
  };
  matches.forEach(applyResult);

  // group tables and certain places
  const lotRand = () => rng(lotKey + '|table');
  const tables = groupMembers.map((members, g) => {
    const ms = matches.filter(m => m.stage === 'gruppe' && m.group === g);
    const keys = members.map(p => ({ key: p.key }));
    const table = groupTable(keys, ms, lotRand());
    const fixed = fixedPlaces(keys, ms);
    // certain places: from the finished table, or from fixedPlaces while games are open (may differ from today's order)
    const certain = fixed == null ? new Map(table.map(r => [r.place, r.key])) : fixed;
    const finalOf = new Map([...certain].map(([pl, k]) => [k, pl]));
    table.forEach(row => { row.fixed = finalOf.has(row.key); row.finalPlace = finalOf.get(row.key) ?? null; });
    return { group: g, letter: LETTERS[g], rows: table, done: fixed == null, advance: advance[g], certain };
  });
  const placeKey = (g, place) => tables[g].certain.get(place) ?? null;

  // knockout
  const { size, slots } = knockoutSlots(advance);
  const bracket = [];
  if (size >= 2) {
    let sides = slots.map(s => (s ? { from: 'group', group: s.group, place: s.place } : { bye: true }));
    let round = 0;
    let semis = null;
    while (sides.length > 1) {
      round++;
      const name = roundName(sides.length);
      const next = [], roundMatches = [];
      for (let i = 0; i < sides.length; i += 2) {
        const [x, y] = [sides[i], sides[i + 1]];
        if (x.bye || y.bye) { next.push(x.bye ? y : x); continue; }
        const m = { nr: matches.length + 1, stage: 'ko', round, label: name, bestOf: T.bestOf[norm(name)] ?? T.bestOf.gruppe, src: [x, y] };
        matches.push(m); roundMatches.push(m);
        next.push({ from: 'winner', nr: m.nr });
      }
      bracket.push({ name, matches: roundMatches.map(m => m.nr) });
      if (sides.length === 4) semis = roundMatches;
      sides = next;
    }
    if (T.third && semis?.length === 2) {
      const m = { nr: matches.length + 1, stage: 'ko', round: round, label: 'Spiel um Platz 3', bestOf: T.bestOf['spiel um platz 3'] ?? T.bestOf.finale ?? T.bestOf.gruppe,
        src: semis.map(s => ({ from: 'loser', nr: s.nr })), third: true };
      matches.push(m);
      bracket.at(-1).third = m.nr;
    }
    // resolve the knockout in order (a side is known once its source is decided)
    const byNrM = new Map(matches.map(m => [m.nr, m]));
    const resolve = s => {
      if (s.from === 'group') return placeKey(s.group, s.place);
      const m = byNrM.get(s.nr);
      if (!m?.result) return null;
      const w = m.result.winner === 'a' ? m.a.key : m.b.key;
      return s.from === 'winner' ? w : (w === m.a.key ? m.b.key : m.a.key);
    };
    const describe = s => (s.from === 'group' ? `${s.place === 1 ? 'Sieger' : `${s.place}.`} Gruppe ${LETTERS[s.group]}`
      : s.from === 'winner' ? `Sieger Spiel ${s.nr}` : `Verlierer Spiel ${s.nr}`);
    for (const m of matches.filter(x => x.stage === 'ko')) {
      const [ka, kb] = m.src.map(resolve);
      m.a = side(ka ? byKey.get(ka) : null, describe(m.src[0]));
      m.b = side(kb ? byKey.get(kb) : null, describe(m.src[1]));
      applyResult(m);
    }
  }
  // results for match numbers that don't exist
  for (const nr of byNr.keys()) if (!matches.some(m => m.nr === nr)) issues.push({ row: byNr.get(nr).row, nr, text: `Ergebnis für Spiel ${nr}: dieses Spiel gibt es im Turnier nicht.` });

  for (const m of matches) m.status = m.result ? 'gespielt' : m.a.key && m.b.key ? 'offen' : 'wartet';

  // podium
  const final = matches.find(m => m.label === 'Finale');
  const third = matches.find(m => m.third);
  const keyOf = (m, w) => (m?.result ? (m.result.winner === (w ? 'a' : 'b') ? m.a.key : m.b.key) : null);
  let winner = null, second = null, thirdPlace = [];
  if (final) { winner = keyOf(final, true); second = keyOf(final, false); }
  else if (size < 2 && tables.length === 1) { winner = placeKey(0, 1); second = placeKey(0, 2); }
  if (third) thirdPlace = [keyOf(third, true)].filter(Boolean);
  else if (final) {
    const semis = matches.filter(m => m.label === 'Halbfinale' && m.result);
    if (semis.length === 2) thirdPlace = semis.map(m => keyOf(m, false));
  }
  const played = matches.filter(m => m.result).length;
  return {
    ...base, ok: true, participants, groups: groupMembers.map((g, i) => ({ letter: LETTERS[i], keys: g.map(p => p.key) })),
    matches, tables, bracket, winner, second, third: thirdPlace, done: !!winner && played === matches.length,
    played, total: matches.length,
  };
}

function side(p, label = null) {
  return p ? { key: p.key, id: p.id, name: p.name, guest: p.guest } : { key: null, id: null, name: null, guest: false, label };
}

// ───────── Elo, suggestions, time ─────────

/** Played matches between two members, as games for Elo (singles, normal K). Never for test tournaments. */
export function tournamentGames(state) {
  if (!state.ok || !['aktiv', 'beendet'].includes(state.status)) return [];
  return state.matches.filter(m => m.result && m.a.id && m.b.id).map(m => {
    const aWon = m.result.winner === 'a';
    return { t: m.result.t, ref: m.result.ref, row: m.result.row, winners: [aWon ? m.a.id : m.b.id], losers: [aWon ? m.b.id : m.a.id],
      tournament: { id: state.id, nr: m.nr } };
  });
}

/**
 * Open matches to suggest next: players who played least, then waited longest, nobody twice in a row where
 * possible, groups taking turns. A hint, never a rule.
 */
export function suggestions(state, count = 3) {
  if (!state.ok) return [];
  const playedAt = new Map(), playedN = new Map();
  const done = state.matches.filter(m => m.result).sort((a, b) => a.result.t - b.result.t);
  for (const m of done) for (const k of [m.a.key, m.b.key]) { playedAt.set(k, m.result.t); playedN.set(k, (playedN.get(k) || 0) + 1); }
  const last = done.at(-1);
  const lastKeys = new Set(last ? [last.a.key, last.b.key] : []);
  const open = state.matches.filter(m => m.status === 'offen');
  const score = m => {
    const ks = [m.a.key, m.b.key];
    return [
      ks.some(k => lastKeys.has(k)) ? 1 : 0,                                   // nobody twice in a row
      Math.max(...ks.map(k => playedN.get(k) || 0)),                           // fewest games first
      Math.max(...ks.map(k => playedAt.get(k) ?? -Infinity)),                  // waited longest
      last && m.stage === 'gruppe' && last.stage === 'gruppe' && m.group === last.group ? 1 : 0,   // groups take turns
      m.stage === 'ko' ? 1 : 0, m.nr,
    ];
  };
  // matches that can run at the same time: nobody in two suggestions (then fill up if there are too few)
  const ranked = open.map(m => [score(m), m]).sort((x, y) => cmp(x[0], y[0])).map(x => x[1]);
  const out = [], busy = new Set();
  for (const m of ranked) if (out.length < count && !busy.has(m.a.key) && !busy.has(m.b.key)) { out.push(m); busy.add(m.a.key); busy.add(m.b.key); }
  return out;
}
function cmp(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; }

/** Minutes until the end: matches left × the typical minutes per match so far (median gap), else the fallback. */
export function timeLeft(state, fallbackMinutes) {
  if (!state.ok) return null;
  const left = state.matches.filter(m => !m.result).length;
  const ts = state.matches.filter(m => m.result).map(m => m.result.t).sort((a, b) => a - b);
  const gaps = ts.slice(1).map((t, i) => (t - ts[i]) * 1440).filter(x => x > 1 && x < 90).sort((a, b) => a - b);
  // measured gaps already include tables played at the same time; the fallback is per table
  const per = gaps.length >= 3 ? gaps[Math.floor(gaps.length / 2)] : fallbackMinutes / Math.max(1, state.tische || 1);
  return { left, minutes: Math.round(left * per), per: Math.round(per), measured: gaps.length >= 3 };
}

export { LETTERS };
