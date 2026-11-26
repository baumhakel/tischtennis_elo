// Turnier (Phase 18, 18c), pure: the tabs turniere · turnier_teilnehmer · turnier_ergebnisse → every tournament with its
// draw, groups and live tables (or the Swiss stage), knockout bracket, results, winner and the games that count for
// Elo. No DOM, no network; runs in the loader (so every view and the cache see the same tournament).
//
//   parseTournamentTabs(raw, idByName, report) → { list: [settings + participants], results: [result rows] }
//   buildTournament(T, results, { ratings, startRating }) → state (see the end of buildTournament)
//   validateSets(sets, bestOf, points) → { ok, winner: 'a'|'b', setsA, setsB, reason, wo? }
//   tournamentGames(state) → [{ t, ref, row, winners, losers, double, tournament }]   members only, never w. o.
//   suggestions(state, count, busy) → open matches to play next   timeLeft(state, fallbackMinutes) → minutes
//   seedRatings(games, config, until, league) → Map id → Elo-Wert just before `until`
//   drawText(state) / parseDrawText(text)   the fixed draw as sent through the Verwaltung form („Turnier starten“)
//
// Decisions (13 Nov 2026, plan doc Phase 18): snake seeding, uneven groups, advancing per group, tie-breaks wins →
// head-to-head → set difference → point difference → lot, Spiel um Platz 3, group games in any order, knockout
// games open once both sides are known, members seeded by Elo at `setzstichtag`, guests by `setzplatz` or lot,
// games between two members count for Elo, guests never, a later entry for a match replaces an earlier one.
// Phase 18c (26 Nov 2026, plan doc „Turnier 2“): status `angekündigt` (draw live, no results), `gestartet` = the draw
// is fixed (the written setzplatz / gruppe are used, results before the start don't count), „w. o.“, doubles teams,
// pot draw, the modified Swiss system (3 wins / 3 losses) with frozen pairings, then a knockout.
import { readTable, cell, clean, norm, toNumber, parseTime, formatRef, roundSerial, fnv1a } from './normalize.js';
import { winProbability } from './elo.js';

export const TOURNAMENT_COLUMNS = {
  turniere: { id: ['id'], name: ['name'], datum: ['datum', 'date'], status: ['status'], art: ['art'], gruppen: ['gruppen'],
    gruppengroessen: ['gruppengroessen', 'gruppengrößen'], weiter: ['weiter_pro_gruppe'], saetze: ['saetze', 'sätze'],
    punkte: ['punkte_pro_satz'], platz3: ['spiel_um_platz_3'], tische: ['tische'], stichtag: ['setzstichtag'], los: ['los'],
    siegerfoto: ['siegerfoto'],
    // Phase 18c
    modus: ['modus'], auslosung: ['auslosung'], setzwertung: ['setzwertung'], swissW: ['swiss_siege'], swissL: ['swiss_niederlagen'],
    swiss1: ['swiss_runde1'], ko: ['ko_teilnehmer'], gestartet: ['gestartet'] },
  teilnehmer: { turnier: ['turnier_id'], name: ['name'], setzplatz: ['setzplatz'], gruppe: ['gruppe'], name2: ['name_2'] },
  ergebnisse: { zeit: ['zeitstempel', 'timestamp'], turnier: ['turnier'], nr: ['spiel-nr.', 'spiel-nr', 'spiel nr'],
    begegnung: ['begegnung'], s1: ['satz 1'], s2: ['satz 2'], s3: ['satz 3'], s4: ['satz 4'], s5: ['satz 5'], s6: ['satz 6'], s7: ['satz 7'] },
};
const OPTIONAL = {
  turniere: ['datum', 'art', 'gruppengroessen', 'weiter', 'saetze', 'punkte', 'platz3', 'tische', 'stichtag', 'los', 'siegerfoto',
    'modus', 'auslosung', 'setzwertung', 'swissW', 'swissL', 'swiss1', 'ko', 'gestartet'],
  teilnehmer: ['setzplatz', 'gruppe', 'name2'],
  ergebnisse: ['begegnung', 's2', 's3', 's4', 's5', 's6', 's7'],
};
export const STATUSES = ['entwurf', 'test', 'angekündigt', 'aktiv', 'beendet'];
const STATUS_ALIASES = { angekuendigt: 'angekündigt', angekundigt: 'angekündigt' };
export const SWISS_ROUND1 = ['zufall', 'nachbarn', 'versetzt'];
const LETTERS = 'ABCDEFGHIJKLMNOP';
const DASH = '–';

// ───────── reading the tabs ─────────

const list = v => String(v ?? '').split(/[,;]/).map(s => clean(s)).filter(Boolean);
const int = (v, def) => { const n = Math.round(toNumber(v)); return Number.isFinite(n) && n > 0 ? n : def; };
const yes = v => { const s = norm(v); return s === '' ? null : ['ja', 'true', 'wahr', '1', 'x', 'yes'].includes(s); };
const pick = (v, allowed, def) => { const s = norm(v).replace(/ö/g, 'oe'); return allowed.includes(s) ? s : def; };

/** „Gruppe 3, Viertelfinale 5, Finale 7“ → { gruppe: 3, viertelfinale: 5, finale: 7 } (keys lowercase). */
export function parseBestOf(v) {
  const out = {};
  for (const part of list(v)) {
    const m = /^(.*?)\s*(\d+)$/.exec(part);
    if (m) out[norm(m[1]) || 'gruppe'] = Number(m[2]);
  }
  return out;
}

/** „11:7“, „11 : 7“, „11-7“ → [11, 7], „wo:a“ → { wo: 'a' } (side a didn't show up), empty → null, else 'bad'. */
export function parseSet(v) {
  const s = clean(v);
  if (!s) return null;
  const wo = /^w\.?\s*o\.?\s*:\s*([ab])$/i.exec(s);
  if (wo) return { wo: wo[1].toLowerCase() };
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
    const rawStatus = norm(cell(cells, T.col.status)) || 'entwurf';
    const status = STATUS_ALIASES[rawStatus] || rawStatus;
    const datum = parseTime(cell(cells, T.col.datum));
    const bestOf = parseBestOf(cell(cells, T.col.saetze));
    const art = norm(cell(cells, T.col.art)) || 'einzel';
    const koRaw = norm(cell(cells, T.col.ko));
    const t = {
      id, row, name: clean(cell(cells, T.col.name)) || id,
      date: datum, status: STATUSES.includes(status) ? status : 'entwurf',
      art,
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
      // Phase 18c
      mode: pick(cell(cells, T.col.modus), ['gruppen', 'schweizer'], 'gruppen'),
      draw: pick(cell(cells, T.col.auslosung), ['schlange', 'toepfe'], 'schlange'),
      seedLeague: pick(cell(cells, T.col.setzwertung), ['alle', 'einzel', 'doppel'], art === 'doppel' ? 'doppel' : 'alle'),
      swissWins: int(cell(cells, T.col.swissW), 3),
      swissLosses: int(cell(cells, T.col.swissL), 3),
      swissRound1: pick(cell(cells, T.col.swiss1), SWISS_ROUND1, 'versetzt'),
      koN: koRaw === '' || koRaw === 'alle' ? null : int(koRaw, null),
      started: parseTime(cell(cells, T.col.gestartet)),
      participants: [],
    };
    if (!STATUSES.includes(status)) report('warning', 'tournament', `Turnier „${id}“: unbekannter Status „${rawStatus}“ (erlaubt: ${STATUSES.join(', ')}). Es wird wie „entwurf“ behandelt.`, { tab: 'turniere', row });
    if (!t.advance.length) t.advance = [Math.min(2, Math.max(1, Math.floor(16 / t.groups)))];
    out.list.push(t);
  }
  if (P && !P.missing.length) {
    const byId = new Map(out.list.map(t => [t.id, t]));
    const people = new Map();   // tournament id → Set of person keys already in a team (doubles)
    const person = name => { const id = idByName.get(norm(name)) || null; return { key: id ? `m:${id}` : `g:${norm(name)}`, id, name, guest: !id }; };
    for (const { cells, row } of P.rows) {
      const t = byId.get(clean(cell(cells, P.col.turnier)));
      const name = clean(cell(cells, P.col.name));
      if (!t || !name) continue;
      const name2 = clean(cell(cells, P.col.name2)) || null;
      const g = clean(cell(cells, P.col.gruppe)).toUpperCase();
      const base = { row, seed: int(cell(cells, P.col.setzplatz), null),
        pin: g ? (/^\d+$/.test(g) ? int(g, 0) - 1 : LETTERS.indexOf(g)) : null, pinText: g || null, name2, sheetNames: t.art === 'doppel' ? [name, name2] : [name] };
      if (t.art === 'doppel') {
        if (!name2) { report('warning', 'tournament', `Turnier „${t.id}“, Zeile ${row}: im Doppel braucht ein Team zwei Namen (Spalte name_2). Die Zeile wird übersprungen.`, { tab: 'turnier_teilnehmer', row }); continue; }
        const a = person(name), b = person(name2);
        const used = people.get(t.id) || people.set(t.id, new Set()).get(t.id);
        const twice = [a, b].find(x => used.has(x.key)) || (a.key === b.key ? a : null);
        if (twice) {
          report('warning', 'tournament', `Turnier „${t.id}“: „${twice.name}“ ist schon in einem anderen Team (Zeile ${row}). Dieses Team wird übersprungen.`, { tab: 'turnier_teilnehmer', row });
          continue;
        }
        used.add(a.key); used.add(b.key);
        t.participants.push({ ...base, key: [a.key, b.key].sort().join('+'), id: null, name: `${name} / ${name2}`, guest: a.guest || b.guest, people: [a, b] });
        continue;
      }
      const p = person(name);
      if (t.participants.some(x => x.key === p.key)) {
        report('warning', 'tournament', `Turnier „${t.id}“: „${name}“ steht zweimal im Tab „turnier_teilnehmer“ (Zeile ${row}).`, { tab: 'turnier_teilnehmer', row });
        continue;
      }
      t.participants.push({ ...base, ...p, people: [p] });
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

/**
 * Elo-Werte after all games before `until` (a light replay: ratings only, the engine's formula). league: 'alle'
 * (every game, the pooled Wertung), 'einzel' (singles only) or 'doppel' (doubles only).
 */
export function seedRatings(games, config, until, league = 'alle') {
  const r = new Map();
  const get = id => r.get(id) ?? config.start_rating;
  for (const g of games) {
    if (until != null && g.t >= until) break;
    if ((league === 'einzel' && g.double) || (league === 'doppel' && !g.double)) continue;
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

/** Seeding value of a participant: the Elo-Wert (singles) or the mean of both players' Elo-Werte (a team). */
export function entrantRating(p, ratings, startRating) {
  const ids = p.people ? p.people.filter(x => x.id).map(x => x.id) : p.id ? [p.id] : [];
  if (!ids.length) return startRating;
  return ids.reduce((s, id) => s + (ratings.get(id) ?? startRating), 0) / ids.length;
}

/**
 * Seed order: members (member teams) by Elo-Wert (highest first), then guests in lot order; then everyone with a
 * `setzplatz` is moved to that place. Returns participants in seed order.
 */
export function seedOrder(participants, ratings, startRating, lot) {
  const rand = rng(lot);
  const rate = p => entrantRating(p, ratings, startRating);
  const members = participants.filter(p => !p.guest).sort((a, b) => rate(b) - rate(a) || a.name.localeCompare(b.name, 'de'));
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
  let dir = 1, g = 0;
  for (const p of rest) {
    let guard = 0;
    while (out[g].length >= sizes[g] && guard++ < groups * 4) { [g, dir] = step(g, dir, groups); }
    out[g].push(p);
    [g, dir] = step(g, dir, groups);
  }
  return out;
}
function step(g, dir, n) {
  if (n === 1) return [0, 1];
  const next = g + dir;
  if (next < 0 || next >= n) return [g, -dir];   // snake: the end group takes two in a row
  return [next, dir];
}

/**
 * Pot draw (World Cup style): pot 1 = the strongest G (one per group), pot 2 = the next G, … The lot puts each pot's
 * players into the groups that still have room (groups with more room first). A pinned player takes his pot's place
 * in his group. Returns { groups: [[participant]], pots: [[{ key, group }]] } (pots in seed order, each entry with
 * the group it was drawn into, in the order of the lot).
 */
export function drawPots(seeded, groups, sizes, rand) {
  const out = Array.from({ length: groups }, () => []);
  const pots = [];
  const pinned = p => p.pin != null && p.pin >= 0 && p.pin < groups;
  for (let k = 0; k * groups < seeded.length; k++) {
    const pot = seeded.slice(k * groups, (k + 1) * groups);
    const drawn = [], taken = new Set();
    for (const p of pot.filter(pinned)) { out[p.pin].push(p); taken.add(p.pin); drawn.push({ key: p.key, group: p.pin, pinned: true }); }
    const rest = shuffle(pot.filter(p => !pinned(p)), rand);
    for (const p of rest) {
      const room = g => sizes[g] - out[g].length;
      let free = shuffle(Array.from({ length: groups }, (_, g) => g).filter(g => !taken.has(g) && room(g) > 0), rand);
      if (!free.length) free = shuffle(Array.from({ length: groups }, (_, g) => g).filter(g => room(g) > 0), rand);
      if (!free.length) free = Array.from({ length: groups }, (_, g) => g);
      free.sort((a, b) => room(b) - room(a));
      const g = free[0];
      out[g].push(p); taken.add(g); drawn.push({ key: p.key, group: g });
    }
    pots.push(drawn);
  }
  // inside a group: seed order (the pot order)
  const seedOf = new Map(seeded.map((p, i) => [p.key, i]));
  for (const g of out) g.sort((a, b) => seedOf.get(a.key) - seedOf.get(b.key));
  return { groups: out, pots };
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

/**
 * Sets [[a, b] | null | 'bad' | { wo }, …] for best of `bestOf`, to `points` with two clear: who won, or why not
 * valid. „w. o.“ (walkover) in the first set: the side that didn't show up loses, without sets and points.
 */
export function validateSets(sets, bestOf, points) {
  if (sets[0] && sets[0].wo) {
    return { ok: true, wo: sets[0].wo, winner: sets[0].wo === 'a' ? 'b' : 'a', setsA: 0, setsB: 0, sets: [], pointsA: 0, pointsB: 0 };
  }
  const need = Math.floor(bestOf / 2) + 1;
  let a = 0, b = 0, ended = false;
  const played = [];
  for (let i = 0; i < sets.length; i++) {
    const s = sets[i];
    if (s == null) { if (sets.slice(i + 1).some(x => x != null)) return { ok: false, reason: `Satz ${i + 1} fehlt, aber ein späterer Satz ist eingetragen.` }; break; }
    if (s === 'bad' || s.wo) return { ok: false, reason: `Satz ${i + 1} ist nicht lesbar (Form 11:7).` };
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

/** Seed slots of a knockout of Q seeds (Swiss): { size, slots: [{ seed } | null (bye)] }, byes to the top seeds. */
export function seedSlots(Q) {
  if (Q < 2) return { size: Q, slots: Array.from({ length: Q }, (_, i) => ({ seed: i + 1 })) };
  let P = 1; while (P < Q) P *= 2;
  return { size: P, slots: bracketOrder(P).map(s => (s <= Q ? { seed: s } : null)) };
}

function permutations(a) {
  if (a.length <= 1) return [a];
  return a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p]));
}

/** Knockout matches from bracket sources (in position order), numbered after `matches`. Returns the rounds. */
function addKnockout(T, matches, sources) {
  const bracket = [];
  let sides = sources.map(s => s || { bye: true });
  let round = 0, semis = null;
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
    const m = { nr: matches.length + 1, stage: 'ko', round, label: 'Spiel um Platz 3', bestOf: T.bestOf['spiel um platz 3'] ?? T.bestOf.finale ?? T.bestOf.gruppe,
      src: semis.map(s => ({ from: 'loser', nr: s.nr })), third: true };
    matches.push(m);
    bracket.at(-1).third = m.nr;
  }
  return bracket;
}

// ───────── Swiss stage (Phase 18c) ─────────

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Pairs a pool (in rank order): highest against lowest, without rematches if any pairing of the pool allows it
 * (search, highest first, partner from the bottom up). Falls back to plain highest against lowest.
 */
export function pairPool(list, met, strict = false) {
  let budget = 20000;
  const rec = rem => {
    if (!rem.length) return [];
    if (--budget < 0) return null;
    const a = rem[0];
    for (let j = rem.length - 1; j >= 1; j--) {
      const b = rem[j];
      if (met.has(pairKey(a, b))) continue;
      const rest = rec(rem.filter((_, i) => i !== 0 && i !== j));
      if (rest) return [[a, b], ...rest];
    }
    return null;
  };
  const found = list.length % 2 === 0 ? rec(list) : null;
  if (found || strict) return found;
  const out = [];
  for (let i = 0; i < Math.floor(list.length / 2); i++) out.push([list[i], list[list.length - 1 - i]]);
  return out;
}

/** Round 1 pairs of the seed order (keys), as set by swiss_runde1. Returns [[a, b] …] with a the better seed. */
export function swissRound1(keys, mode, rand) {
  if (mode === 'zufall') {
    const s = shuffle(keys, rand), pos = new Map(keys.map((k, i) => [k, i]));
    const out = [];
    for (let i = 0; i + 1 < s.length; i += 2) out.push(pos.get(s[i]) < pos.get(s[i + 1]) ? [s[i], s[i + 1]] : [s[i + 1], s[i]]);
    return out.sort((x, y) => pos.get(x[0]) - pos.get(y[0]));
  }
  if (mode === 'nachbarn') {
    const out = [];
    for (let i = 0; i + 1 < keys.length; i += 2) out.push([keys[i], keys[i + 1]]);
    return out;
  }
  const half = keys.length / 2;                         // versetzt: 1 against n/2 + 1, …
  return keys.slice(0, half).map((k, i) => [k, keys[half + i]]);
}

/**
 * The Swiss stage: rounds generated one at a time. Each round's pairings come from the results of the round
 * before as they were when the first result of a later match came in (by time), so a late correction changes
 * records but never who already plays whom. Adds the matches to `matches`. Returns the stage's state.
 */
function swissStage(T, seeded, byKey, entries, resultOf, matches, issues, lotKey) {
  const W = T.swissWins || 3, L = T.swissLosses || 3;
  const keys = seeded.map(p => p.key);
  const seedOf = new Map(keys.map((k, i) => [k, i + 1]));
  const rounds = [];                                    // { r, nrs, byes, pools: [{ label, nrs, floatIn }], frozen }
  const sm = [];                                         // generated Swiss matches
  const met = new Set();
  const floated = new Set();
  const byesOf = new Map();
  const eps = 1e-9;

  const stateAt = tau => {
    const st = new Map(keys.map(k => [k, { key: k, seed: seedOf.get(k), wins: 0, losses: 0, byes: 0, opp: [], played: 0, setsW: 0, setsL: 0, ptsW: 0, ptsL: 0 }]));
    for (const rd of rounds) for (const k of rd.byes) { const s = st.get(k); s.wins++; s.byes++; }
    for (const m of sm) {
      const r = resultOf(m, tau);
      if (!r) continue;
      const A = st.get(m.a.key), B = st.get(m.b.key);
      A.played++; B.played++; A.opp.push(B.key); B.opp.push(A.key);
      if (r.winner === 'a') { A.wins++; B.losses++; } else { B.wins++; A.losses++; }
      A.setsW += r.setsA; A.setsL += r.setsB; B.setsW += r.setsB; B.setsL += r.setsA;
      A.ptsW += r.pointsA; A.ptsL += r.pointsB; B.ptsW += r.pointsB; B.ptsL += r.pointsA;
    }
    for (const s of st.values()) s.buchholz = s.opp.reduce((x, k) => x + st.get(k).wins, 0);
    return st;
  };
  const rank = st => (x, y) => { const a = st.get(x), b = st.get(y); return b.wins - a.wins || a.losses - b.losses || b.buchholz - a.buchholz || a.seed - b.seed; };
  const decisive = (s) => s.wins === W - 1 || s.losses === L - 1;
  const bestOfFor = (sa, sb) => (decisive(sa) || decisive(sb)
    ? T.bestOf.entscheidung ?? T.bestOf.schweizer ?? T.bestOf.gruppe
    : T.bestOf.schweizer ?? T.bestOf.gruppe);

  const addRound = (r, pools, byes, st, frozen) => {
    const rd = { r, nrs: [], byes, pools: [], frozen };
    for (const pool of pools) {
      const p = { label: pool.label, nrs: [], floatIn: pool.floatIn || [] };
      for (const [a, b] of pool.pairs) {
        const sa = st.get(a), sb = st.get(b);
        const m = { nr: matches.length + 1, stage: 'schweizer', round: r, pool: pool.label, label: `Runde ${r} (${pool.label})`,
          bestOf: bestOfFor(sa, sb), decisive: decisive(sa) || decisive(sb), a: side(byKey.get(a)), b: side(byKey.get(b)) };
        matches.push(m); sm.push(m); p.nrs.push(m.nr); rd.nrs.push(m.nr);
        met.add(pairKey(a, b));
      }
      rd.pools.push(p);
    }
    for (const k of byes) byesOf.set(k, (byesOf.get(k) || 0) + 1);
    rounds.push(rd);
    return rd;
  };

  // round 1: written pairs after the start, else as set by swiss_runde1; a bye for the lowest seed if odd
  {
    const st = stateAt(Infinity);
    let pairs = null, byes = [];
    if (T.started != null) {
      const by = groupBy(seeded.filter(p => p.pin != null && p.pin >= 0), p => p.pin);
      const ok = by.every(g => g.length === 2) && seeded.filter(p => p.pin == null || p.pin < 0).length <= 1;
      if (ok) {
        pairs = by.sort((x, y) => x[0].pin - y[0].pin).map(g => g.map(p => p.key).sort((a, b) => seedOf.get(a) - seedOf.get(b)));
        byes = seeded.filter(p => p.pin == null || p.pin < 0).map(p => p.key);
      } else issues.push({ text: 'Schweizer Runde 1: die gespeicherten Paarungen (Spalte gruppe) passen nicht zusammen. Runde 1 wird neu berechnet.' });
    }
    if (!pairs) {
      let list = keys.slice();
      if (list.length % 2) { byes = [list.at(-1)]; list = list.slice(0, -1); }
      pairs = swissRound1(list, T.swissRound1 || 'versetzt', rng(lotKey + '|runde1'));
    }
    addRound(1, [{ label: `0${DASH}0`, pairs }], byes, st, null);
  }

  const resultAtTau = (m, tau) => resultOf(m, tau);
  const complete = (rd, tau) => rd.nrs.every(nr => resultAtTau(matches[nr - 1], tau));
  const completion = rd => {   // earliest time from which every match of the round has a valid result
    if (!rd.nrs.length) return rounds.length > 1 ? (rounds.at(-2).completedAt ?? -Infinity) : -Infinity;
    const nrs = new Set(rd.nrs);
    const times = [...new Set(entries.filter(e => nrs.has(e.nr)).map(e => e.t))].sort((a, b) => a - b);
    for (const t of times) if (complete(rd, t + eps)) return t;
    return null;
  };

  let done = false, koSnap = null;
  for (let guard = 0; guard < 60; guard++) {
    const rd = rounds.at(-1);
    const C = completion(rd);
    rd.completedAt = C;
    if (C == null) break;                                // the round is still being played
    const nextStart = matches.length + 1;
    const later = entries.filter(e => e.nr != null && e.nr >= nextStart && e.t > C).map(e => e.t);
    const F = later.length ? Math.min(...later) : null;
    if (F == null && !complete(rd, Infinity)) break;    // a result was made invalid again: wait for it
    let tau = F ?? Infinity;
    if (!complete(rd, tau)) tau = C + eps;
    const st = stateAt(tau);
    const active = keys.filter(k => st.get(k).wins < W && st.get(k).losses < L);
    if (!active.length) { done = true; koSnap = tau; break; }
    // pools by record, best first; inside: Buchholz, then seed
    const pools = groupBy(active.slice().sort(rank(st)), k => `${st.get(k).wins}${DASH}${st.get(k).losses}`);
    // a bye only when the number still in is odd: lowest-ranked of the lowest pool who hasn't had one
    let bye = null;
    if (active.length % 2) {
      for (let i = pools.length - 1; i >= 0 && !bye; i--) bye = pools[i].slice().reverse().find(k => !byesOf.get(k)) || null;
      if (!bye) bye = pools.at(-1).at(-1);
      for (const p of pools) { const i = p.indexOf(bye); if (i >= 0) p.splice(i, 1); }
    }
    // pools top to bottom; an odd pool sends one player down (the lowest-ranked who hasn't floated yet). The
    // floater is chosen so that no pool needs a rematch, if any choice allows that (search over the choices);
    // otherwise the plain choice, and a rematch where it can't be helped.
    const live = pools.filter(p => p.length);
    const labelOf = pool => `${st.get(pool[0]).wins}${DASH}${st.get(pool[0]).losses}`;
    let tries = 0;
    const plan = (i, carry, strict) => {
      if (i === live.length) return carry.length ? null : [];
      if (strict && ++tries > 3000) return null;
      const listed = [...carry, ...live[i]];
      const floatIn = carry.slice();
      const last = i === live.length - 1;
      const options = [];
      if (listed.length % 2 && !last) {
        const rev = listed.slice().reverse().filter(k => !floatIn.includes(k));
        for (const k of [...rev.filter(k => !floated.has(k)), ...rev.filter(k => floated.has(k))]) options.push(k);
        if (!options.length) options.push(listed.at(-1));
      } else options.push(null);
      for (const f of options) {
        const rest = f ? listed.filter(k => k !== f) : listed;
        const pairs = pairPool(rest, met, strict);
        if (!pairs) continue;
        const tail = plan(i + 1, f ? [f] : [], strict);
        if (tail) return [{ label: labelOf(live[i]), pairs, floatIn, floater: f }, ...tail];
        if (!strict) break;
      }
      return null;
    };
    const out = plan(0, [], true) || plan(0, [], false) || [];
    for (const p of out) if (p.floater) floated.add(p.floater);
    addRound(rd.r + 1, out, bye ? [bye] : [], st, F);
  }

  // standings now (current results; pairings above used the frozen ones)
  const now = stateAt(Infinity);
  const statusOf = s => (s.wins >= W ? 'weiter' : s.losses >= L ? 'raus' : 'spielt');
  const standings = keys.slice().sort(rank(now)).map((k, i) => ({ ...now.get(k), place: i + 1, status: statusOf(now.get(k)) }));
  // who reached W wins or L losses in which round (current results, round by round)
  const reached = new Map();
  {
    const rec = new Map(keys.map(k => [k, { w: 0, l: 0 }]));
    for (const rd of rounds) {
      for (const k of rd.byes) rec.get(k).w++;
      for (const nr of rd.nrs) {
        const m = matches[nr - 1], r = resultOf(m, Infinity);
        if (!r) continue;
        const [w, l] = r.winner === 'a' ? [m.a.key, m.b.key] : [m.b.key, m.a.key];
        rec.get(w).w++; rec.get(l).l++;
      }
      for (const k of keys) if (!reached.has(k)) {
        const x = rec.get(k);
        if (x.w >= W) reached.set(k, { round: rd.r, status: 'weiter', record: `${x.w}${DASH}${x.l}` });
        else if (x.l >= L) reached.set(k, { round: rd.r, status: 'raus', record: `${x.w}${DASH}${x.l}` });
      }
    }
  }
  rounds.forEach(rd => { rd.weiter = [...reached].filter(([, v]) => v.round === rd.r && v.status === 'weiter').map(([k, v]) => ({ key: k, record: v.record }));
    rd.raus = [...reached].filter(([, v]) => v.round === rd.r && v.status === 'raus').map(([k, v]) => ({ key: k, record: v.record })); });

  // knockout seeds: by record (3–0, 3–1, 3–2), then Buchholz, then seed, frozen like the pairings
  let qualified = null;
  if (done) {
    const st = stateAt(koSnap);
    qualified = keys.filter(k => st.get(k).wins >= W).sort((x, y) => st.get(x).losses - st.get(y).losses || st.get(y).buchholz - st.get(x).buchholz || st.get(x).seed - st.get(y).seed);
    if (T.koN) qualified = qualified.slice(0, T.koN);
  }
  // most Swiss matches still possible (for the time estimate): every player still in plays at most
  // (W − wins) + (L − losses) − 1 more
  const open = keys.filter(k => now.get(k).wins < W && now.get(k).losses < L);
  const unplayed = sm.filter(m => !resultOf(m, Infinity)).length;
  const more = Math.ceil(open.reduce((s, k) => s + (W - now.get(k).wins) + (L - now.get(k).losses) - 1, 0) / 2);
  const maxLeft = done ? unplayed : Math.max(unplayed, more);
  // expected size of the knockout before it is known (for the print): ko_teilnehmer, else about half
  const expectedKo = qualified ? qualified.length : T.koN || Math.max(2, Math.floor(keys.length / 2));
  return { W, L, rounds, standings, done, qualified, maxLeft, expectedKo };
}

// ───────── the whole tournament ─────────

/**
 * @param T   one tournament from parseTournamentTabs
 * @param results  all result rows of the tab (others are ignored), voided ones already removed
 * @returns state — see the return at the end
 */
export function buildTournament(T, results, { ratings = new Map(), startRating = 1400 } = {}) {
  const issues = [];
  const mode = T.mode || 'gruppen';
  const started = T.started ?? null;
  const base = { id: T.id, name: T.name, date: T.date, status: T.status, art: T.art, mode, drawMode: T.draw || 'schlange',
    started, winnerPhoto: T.winnerPhoto, points: T.points, tische: T.tables || 1, issues, entries: [] };
  if (T.art !== 'einzel' && T.art !== 'doppel') return { ...base, ok: false, problem: `Unbekannte Art „${T.art}“: erlaubt sind einzel und doppel.` };
  let people = T.participants.map(p => (p.people ? p : { ...p, people: [{ key: p.key, id: p.id, name: p.name, guest: p.guest }] }));
  // after the start the written setzplatz / gruppe are the draw: new rows are not part of it
  if (started != null) {
    const late = people.filter(p => p.seed == null || (mode === 'gruppen' && p.pin == null));
    for (const p of late) issues.push({ row: p.row, text: `„${p.name}“ (Zeile ${p.row}) kam nach dem Start dazu und spielt nicht mit: die Auslosung steht fest.` });
    people = people.filter(p => !late.includes(p));
    const seeds = people.map(p => p.seed).sort((a, b) => a - b);
    if (seeds.some((s, i) => s !== i + 1)) issues.push({ text: 'Die Setzplätze nach dem Start haben eine Lücke oder einen doppelten Platz: wurde ein Teilnehmer entfernt oder geändert? Nach dem Start bitte nichts mehr ändern.' });
  }
  if (people.length < 2) return { ...base, ok: false, problem: 'Es sind noch keine (oder zu wenige) Teilnehmer eingetragen.' };
  const lotKey = `${T.id}|${T.lot}`;
  const rate = p => entrantRating(p, ratings, startRating);
  // doubles: the stronger player first in the team name
  if (T.art === 'doppel') {
    people = people.map(p => {
      const ms = p.people.slice().sort((x, y) => (x.id ? 0 : 1) - (y.id ? 0 : 1) || (ratings.get(y.id) ?? startRating) - (ratings.get(x.id) ?? startRating) || x.name.localeCompare(y.name, 'de'));
      return { ...p, people: ms, name: ms.map(x => x.name).join(' / ') };
    });
  }
  const seeded = started != null ? people.slice().sort((a, b) => a.seed - b.seed || a.row - b.row) : seedOrder(people, ratings, startRating, lotKey);
  const groupsN = mode === 'schweizer' ? 0 : Math.max(1, Math.min(T.groups, Math.floor(seeded.length / 2)));
  let groupMembers = [], pots = null;
  if (mode === 'gruppen') {
    const sizes = groupSizes(seeded.length, groupsN, T.groupSizes);
    if (started == null && T.draw === 'toepfe') {
      const d = drawPots(seeded, groupsN, sizes, rng(lotKey + '|toepfe'));
      groupMembers = d.groups; pots = d.pots;
    } else groupMembers = drawGroups(seeded, groupsN, sizes);
  }
  const participants = seeded.map((p, i) => ({ key: p.key, id: p.id ?? null, ids: p.people.filter(x => x.id).map(x => x.id), name: p.name, guest: p.guest,
    row: p.row, seed: i + 1, rating: p.guest ? null : Math.round(rate(p)), group: groupMembers.findIndex(g => g.includes(p)),
    members: T.art === 'doppel' ? p.people.map(x => ({ key: x.key, id: x.id, name: x.name, guest: x.guest })) : null,
    people: p.people.map(x => x.key), sheetNames: p.sheetNames || [p.name] }));
  const byKey = new Map(participants.map(p => [p.key, p]));

  // results: only after the start (and never while angekündigt); the latest entry per match counts
  const mine = results.filter(r => r.tournament === T.id).sort((x, y) => x.t - y.t || x.row - y.row);
  base.entries = mine.map(r => ({ nr: r.nr, row: r.row, ref: r.ref }));
  let counted = mine;
  if (T.status === 'angekündigt' || T.status === 'entwurf') {
    if (mine.length) issues.push({ text: `${mine.length === 1 ? 'Ein Ergebnis wird' : `${mine.length} Ergebnisse werden`} nicht gewertet: das Turnier hat noch nicht begonnen.` });
    counted = [];
  } else if (started != null) {
    const before = mine.filter(r => r.t < started);
    if (before.length) issues.push({ text: `${before.length === 1 ? 'Ein Ergebnis von vor dem Start zählt' : `${before.length} Ergebnisse von vor dem Start zählen`} nicht (Testeinträge?).` });
    counted = mine.filter(r => r.t >= started);
  }
  const byNr = new Map();
  for (const r of counted) {
    if (r.nr == null) { issues.push({ row: r.row, text: `Ergebnis in Zeile ${r.row}: die Spiel-Nr. fehlt.` }); continue; }
    if (!byNr.has(r.nr)) byNr.set(r.nr, []);
    byNr.get(r.nr).push(r);
  }
  const entries = counted.filter(r => r.nr != null);
  /** The result of match m as of time tau (entries before tau; the latest counts), validated; null if none. */
  const resultOf = (m, tau = Infinity) => {
    const list = byNr.get(m.nr);
    if (!list || !m.a?.key || !m.b?.key) return null;
    let r = null;
    for (const x of list) if (x.t < tau) r = x;
    if (!r) return null;
    const v = validateSets(r.sets, m.bestOf, T.points);
    return v.ok ? { ...v, t: r.t, ref: r.ref, row: r.row } : null;
  };
  const applyResult = m => {
    const list = byNr.get(m.nr);
    if (!list) return;
    const r = list.at(-1);
    if (!m.a.key || !m.b.key) { issues.push({ row: r.row, nr: m.nr, text: `Spiel ${m.nr}: Ergebnis eingetragen, aber die Gegner stehen noch nicht fest.` }); return; }
    const v = validateSets(r.sets, m.bestOf, T.points);
    if (!v.ok) { issues.push({ row: r.row, nr: m.nr, text: `Spiel ${m.nr}: ${v.reason}` }); return; }
    m.result = { ...v, t: r.t, ref: r.ref, row: r.row };
  };

  const matches = [];
  let tables = [], swiss = null, koSources = null, describeSeed = null, resolveSeed = () => null;
  if (mode === 'gruppen') {
    const advance = Array.from({ length: groupsN }, (_, g) => Math.min(T.advance[g] ?? T.advance[0], groupMembers[g].length));
    // group matches: rounds of every group, interleaved, numbered from 1
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
    matches.forEach(applyResult);
    const lotRand = () => rng(lotKey + '|table');
    tables = groupMembers.map((members, g) => {
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
    const ks = knockoutSlots(advance);
    if (ks.size >= 2) koSources = ks.slots.map(s => (s ? { from: 'group', group: s.group, place: s.place } : null));
  } else {
    swiss = swissStage(T, seeded, byKey, entries, resultOf, matches, issues, lotKey);
    matches.forEach(applyResult);
    const Q = swiss.qualified ? swiss.qualified.length : 0;
    if (swiss.done && Q >= 2) {
      koSources = seedSlots(Q).slots.map(s => (s ? { from: 'seed', seed: s.seed } : null));
      resolveSeed = k => swiss.qualified[k - 1] ?? null;
    }
    describeSeed = k => `${k}. Schweizer Seed`;
  }
  const placeKey = (g, place) => tables[g]?.certain.get(place) ?? null;

  // knockout
  let bracket = [];
  if (koSources) {
    bracket = addKnockout(T, matches, koSources);
    const byNrM = new Map(matches.map(m => [m.nr, m]));
    const resolve = s => {
      if (s.from === 'group') return placeKey(s.group, s.place);
      if (s.from === 'seed') return resolveSeed(s.seed);
      const m = byNrM.get(s.nr);
      if (!m?.result) return null;
      const w = m.result.winner === 'a' ? m.a.key : m.b.key;
      return s.from === 'winner' ? w : (w === m.a.key ? m.b.key : m.a.key);
    };
    const describe = s => (s.from === 'group' ? `${s.place === 1 ? 'Sieger' : `${s.place}.`} Gruppe ${LETTERS[s.group]}`
      : s.from === 'seed' ? describeSeed(s.seed)
        : s.from === 'winner' ? `Sieger Spiel ${s.nr}` : `Verlierer Spiel ${s.nr}`);
    for (const m of matches.filter(x => x.stage === 'ko')) {
      const [ka, kb] = m.src.map(resolve);
      m.a = side(ka ? byKey.get(ka) : null, describe(m.src[0]));
      m.b = side(kb ? byKey.get(kb) : null, describe(m.src[1]));
      applyResult(m);
    }
  }
  // results for match numbers that don't exist (yet)
  for (const nr of byNr.keys()) if (!matches.some(m => m.nr === nr)) issues.push({ row: byNr.get(nr).at(-1).row, nr, text: `Ergebnis für Spiel ${nr}: dieses Spiel gibt es im Turnier ${mode === 'schweizer' ? 'noch ' : ''}nicht.` });

  for (const m of matches) m.status = m.result ? 'gespielt' : m.a.key && m.b.key ? 'offen' : 'wartet';

  // podium
  const final = matches.find(m => m.label === 'Finale');
  const third = matches.find(m => m.third);
  const keyOf = (m, w) => (m?.result ? (m.result.winner === (w ? 'a' : 'b') ? m.a.key : m.b.key) : null);
  let winner = null, second = null, thirdPlace = [];
  if (final) { winner = keyOf(final, true); second = keyOf(final, false); }
  else if (mode === 'gruppen' && !koSources && tables.length === 1) { winner = placeKey(0, 1); second = placeKey(0, 2); }
  else if (mode === 'schweizer' && swiss.done && (swiss.qualified?.length || 0) === 1) winner = swiss.qualified[0];
  if (third) thirdPlace = [keyOf(third, true)].filter(Boolean);
  else if (final) {
    const semis = matches.filter(m => m.label === 'Halbfinale' && m.result);
    if (semis.length === 2) thirdPlace = semis.map(m => keyOf(m, false));
  }
  const played = matches.filter(m => m.result).length;
  // most matches still possible: everything not played, plus (Swiss) the rounds and the knockout not generated yet
  let maxLeft = matches.length - played;
  if (swiss && !swiss.done) {
    const ko = Math.max(0, swiss.expectedKo - 1) + (T.third && swiss.expectedKo >= 4 ? 1 : 0);
    maxLeft = swiss.maxLeft + ko;
  }
  const state = {
    ...base, ok: true, participants, groups: groupMembers.map((g, i) => ({ letter: LETTERS[i], keys: g.map(p => p.key) })),
    matches, tables, bracket, winner, second, third: thirdPlace, done: !!winner && played === matches.length,
    played, total: matches.length, maxLeft, maxTotal: played + maxLeft, swiss, pots,
    settings: { bestOf: T.bestOf, third: T.third, koN: T.koN ?? null, swissWins: T.swissWins || 3, swissLosses: T.swissLosses || 3,
      swissRound1: T.swissRound1 || 'versetzt', seedLeague: T.seedLeague || 'alle', advance: tables.map(t => t.advance) },
  };
  state.draw = drawOf(state);
  return state;
}

function side(p, label = null) {
  return p ? { key: p.key, id: p.id, ids: p.ids, name: p.name, guest: p.guest, people: p.people, members: p.members }
    : { key: null, id: null, ids: [], name: null, guest: false, label, people: [], members: null };
}

/** Does this match count for Elo once played (both sides known, no guest)? */
export const eloMatch = m => !!(m.a.key && m.b.key && !m.a.guest && !m.b.guest && m.a.ids.length && m.b.ids.length);

// ───────── the fixed draw („Turnier starten“) ─────────

/**
 * The draw as shown: one line per participant (sheet row, setzplatz, gruppe letter — in Swiss mode the number of
 * the round-1 match, empty for the bye — and the sheet names). `hash` identifies it (the app checks it again
 * right before the form opens, so nobody fixes a draw that changed meanwhile).
 */
function drawOf(state) {
  const groupOf = new Map();
  if (state.mode === 'gruppen') for (const p of state.participants) groupOf.set(p.key, LETTERS[p.group] ?? '');
  else {
    const r1 = state.swiss?.rounds[0];
    (r1?.nrs || []).forEach((nr, i) => { const m = state.matches[nr - 1]; groupOf.set(m.a.key, String(i + 1)); groupOf.set(m.b.key, String(i + 1)); });
  }
  const rows = state.participants.map(p => ({ row: p.row, seed: p.seed, group: groupOf.get(p.key) ?? '', names: p.sheetNames }))
    .sort((a, b) => a.row - b.row);
  return { rows, hash: fnv1a(JSON.stringify(rows.map(r => [r.row, r.seed, r.group, r.names]))) };
}

/** The draw as text for the Verwaltung form: „row|setzplatz|gruppe|name|name_2“, one line each. */
export const drawText = state => state.draw.rows.map(r => [r.row, r.seed, r.group, ...r.names.map(n => (n || '').replace(/[|\n]/g, ' '))].join('|')).join('\n');

/** The other way round (Verwaltung.gs does the same): [{ row, seed, group, names }] or null if malformed. */
export function parseDrawText(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
    const [row, seed, group, ...names] = line.split('|');
    if (!/^\d+$/.test(row) || !/^\d+$/.test(seed)) return null;
    out.push({ row: Number(row), seed: Number(seed), group: group.trim(), names: names.map(s => s.trim()) });
  }
  return out.length ? out : null;
}

// ───────── Elo, suggestions, time ─────────

/** Played matches without a guest, as games for Elo (singles or doubles K). Never w. o., never test tournaments. */
export function tournamentGames(state) {
  if (!state.ok || !['aktiv', 'beendet'].includes(state.status)) return [];
  return state.matches.filter(m => m.result && !m.result.wo && eloMatch(m)).map(m => {
    const aWon = m.result.winner === 'a';
    return { t: m.result.t, ref: m.result.ref, row: m.result.row, winners: (aWon ? m.a : m.b).ids.slice(), losers: (aWon ? m.b : m.a).ids.slice(),
      double: state.art === 'doppel', tournament: { id: state.id, nr: m.nr } };
  });
}

/**
 * Open matches to suggest next: players who played least, then waited longest, nobody twice in a row where
 * possible, groups taking turns. A hint, never a rule. `busy` = people (person keys) already called to a match of
 * another tournament: kept out where possible.
 */
export function suggestions(state, count = 3, busy = new Set()) {
  if (!state.ok) return [];
  const playedAt = new Map(), playedN = new Map();
  const done = state.matches.filter(m => m.result).sort((a, b) => a.result.t - b.result.t);
  for (const m of done) for (const k of [m.a.key, m.b.key]) { playedAt.set(k, m.result.t); playedN.set(k, (playedN.get(k) || 0) + 1); }
  const last = done.at(-1);
  const lastKeys = new Set(last ? [last.a.key, last.b.key] : []);
  const open = state.matches.filter(m => m.status === 'offen');
  const ppl = m => [...m.a.people, ...m.b.people];
  const score = m => {
    const ks = [m.a.key, m.b.key];
    return [
      ppl(m).some(k => busy.has(k)) ? 1 : 0,                                    // nobody in two tournaments at once
      ks.some(k => lastKeys.has(k)) ? 1 : 0,                                   // nobody twice in a row
      Math.max(...ks.map(k => playedN.get(k) || 0)),                           // fewest games first
      Math.max(...ks.map(k => playedAt.get(k) ?? -Infinity)),                  // waited longest
      last && m.stage === 'gruppe' && last.stage === 'gruppe' && m.group === last.group ? 1 : 0,   // groups take turns
      m.stage === 'ko' ? 1 : 0, m.nr,
    ];
  };
  // matches that can run at the same time: nobody in two suggestions
  const ranked = open.map(m => [score(m), m]).sort((x, y) => cmp(x[0], y[0])).map(x => x[1]);
  const out = [], taken = new Set();
  for (const m of ranked) if (out.length < count && !ppl(m).some(k => taken.has(k))) { out.push(m); ppl(m).forEach(k => taken.add(k)); }
  return out;
}
function cmp(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; }

/** Minutes until the end: matches still possible × the typical minutes per match so far (median gap), else the fallback. */
export function timeLeft(state, fallbackMinutes) {
  if (!state.ok) return null;
  const left = state.maxLeft ?? state.matches.filter(m => !m.result).length;
  const ts = state.matches.filter(m => m.result && !m.result.wo).map(m => m.result.t).sort((a, b) => a - b);
  const gaps = ts.slice(1).map((t, i) => (t - ts[i]) * 1440).filter(x => x > 1 && x < 90).sort((a, b) => a - b);
  // measured gaps already include tables played at the same time; the fallback is per table
  const per = gaps.length >= 3 ? gaps[Math.floor(gaps.length / 2)] : fallbackMinutes / Math.max(1, state.tische || 1);
  return { left, minutes: Math.round(left * per), per: Math.round(per), measured: gaps.length >= 3, upTo: state.mode === 'schweizer' };
}

export { LETTERS };
