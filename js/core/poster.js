// Aushang (Phase 19): the facts of one calendar month for the wall newspaper. Pure, no DOM; numbers stay raw
// (views/poster-text.js turns them into German sentences with ui/format.js).
//
//   posterData(model, A, { year, month, now, tournaments }) → {
//     year, month, from, to, running, issue,
//     numbers { games, days, maxDay { n, t }, eloMoved, active, newcomers },
//     players [{ id, place, placeStart, provisional, rating, ratingStart, delta, games, wins, losses, spark, line, new }],
//     stories [{ kind, … }] (headline first, then teasers), records { … }, allTime [ … ],
//     network { nodes [{ id, games, delta }], edges [{ a, b, n }], busiest, unmet },
//     bump { days [serial], series [{ id, places [place|null], slot|null }] },
//     badges [{ id, badge, level, t }], hall [{ from, riser, leader }], riddle { id, facts [ … ] } | null,
//     tournament { … } | null }
//   model = the pooled model { dataset, elo } (Wertung „Alle“), A = computeAchievements result.
//
// Platz: the badge rule (achievement_rank_min_games games by then and a game within achievement_rank_active_days),
// so the poster agrees with the Ruhmeshalle („Platz 1 am Monatsende“). Every rule here is unit-tested.
import { serialFromParts, serialToParts, fnv1a } from './normalize.js';

const DAY = 1;
export const FIRST_ISSUE = { year: 2026, month: 11 };          // „Ausgabe 1“

/** First index with games[i].t ≥ t. */
function lowerBound(G, t) {
  let lo = 0, hi = G.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (G[m].t < t) lo = m + 1; else hi = m; }
  return lo;
}

export function monthBounds(year, month) {
  const from = serialFromParts(year, month, 1);
  const to = month === 12 ? serialFromParts(year + 1, 1, 1) : serialFromParts(year, month + 1, 1);
  return { from, to };
}

/** The last completed month before `now` → { year, month }. */
export function lastMonth(now) {
  const p = serialToParts(now);
  return p.mo === 1 ? { year: p.y - 1, month: 12 } : { year: p.y, month: p.mo - 1 };
}

export const issueNumber = (year, month) => (year - FIRST_ISSUE.year) * 12 + month - FIRST_ISSUE.month + 1;
export const weekday = t => (Math.floor(t) + 6) % 7;            // 0 = Sunday (serial 0 = Saturday 30.12.1899)

/**
 * Places at time t by the badge rule: every player with ≥ minGames games before t and a game within activeDays.
 * → Map id → { place, rating, total, lastT } for ranked players, plus `all` (every player with a game before t).
 */
export function placesAt(model, t, cfg) {
  const { elo, dataset } = model, G = dataset.games;
  const a = lowerBound(G, t);
  const all = new Map();
  elo.ids.forEach((id, k) => {
    const hg = elo.history[k].g;
    let lo = 0, hi = hg.length - 1, pos = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (hg[m] < a) { pos = m; lo = m + 1; } else hi = m - 1; }
    if (pos < 0) return;
    all.set(id, { id, rating: elo.history[k].r[pos], total: pos + 1, lastT: G[hg[pos]].t });
  });
  const ranked = [...all.values()].filter(x => x.total >= cfg.achievement_rank_min_games && x.lastT >= t - cfg.achievement_rank_active_days)
    .sort((x, y) => y.rating - x.rating || x.id.localeCompare(y.id));
  const places = new Map();
  ranked.forEach((x, i) => places.set(x.id, { ...x, place: i + 1 }));
  places.all = all;
  return places;
}

export function posterData(model, A, { year, month, now = Infinity, tournaments = [] } = {}) {
  const { dataset, elo } = model, cfg = dataset.config, G = dataset.games;
  const { from, to } = monthBounds(year, month);
  const end = Math.min(to, now);
  const a = lowerBound(G, from), b = lowerBound(G, to);
  const gap = cfg.session_gap_minutes / 1440;
  const kOf = id => elo.index.get(id);
  const sides = g => {
    const s = elo.slots.subarray(4 * g, 4 * g + 4);
    return { W: [s[0], s[1]].filter(k => k >= 0), L: [s[2], s[3]].filter(k => k >= 0) };
  };
  const startP = placesAt(model, from, cfg), endP = placesAt(model, end, cfg);

  // ── per player, the month ──
  const P = new Map();
  const per = k => {
    const id = elo.ids[k];
    if (!P.has(id)) {
      const before = startP.all.get(id);
      P.set(id, { id, k, games: 0, wins: 0, losses: 0, ratingStart: before ? before.rating : elo.start[k], rating: before ? before.rating : elo.start[k],
        spark: [before ? before.rating : elo.start[k]], days: new Set(), bestWin: null, streak: 0, maxStreak: 0, maxGain: 0, opp: new Map(),
        cracked: null, isNew: !before, firstT: null, formTimes: [], doubles: 0, oppStreak: new Map(), maxOppStreak: 0, weekdays: new Array(7).fill(0) });
    }
    return P.get(id);
  };
  // pair results before and in the month (singles), for „Angstgegner geknackt“
  const pairW = new Map(), pairKey = (x, y) => `${x}|${y}`;
  const addWin = (x, y) => pairW.set(pairKey(x, y), (pairW.get(pairKey(x, y)) || 0) + 1);
  for (let g = 0; g < a; g++) { const { W, L } = sides(g); if (W.length === 1) addWin(W[0], L[0]); }

  const pairs = new Map();                  // month Begegnungen (doubles count half)
  const singles = new Map();                // month singles meetings with results
  const dayCount = new Map();               // form-entry games per day
  const dayGain = new Map();                // `${k}|${day}` → Elo change that day
  let eloMoved = 0;
  const lastOwnT = new Map(), session = new Map();
  let marathon = null;
  for (let g = a; g < b; g++) {
    const game = G[g], { W, L } = sides(g), d = elo.perGame.delta[g], eW = elo.perGame.eW[g];
    const day = Math.floor(game.t);
    eloMoved += d * W.length;
    if (!game.approxTime && !game.moved) dayCount.set(day, (dayCount.get(day) || 0) + 1);
    for (const k of [...W, ...L]) {
      const s = per(k), won = W.includes(k);
      s.games++; if (won) s.wins++; else s.losses++;
      s.rating += won ? d : -d; s.spark.push(s.rating);
      s.days.add(day);
      if (s.firstT == null) s.firstT = game.t;
      if (game.double) s.doubles++;
      s.weekdays[weekday(game.t)]++;
      if (!game.approxTime && !game.moved) s.formTimes.push(game.t);
      if (won) { s.streak++; s.maxStreak = Math.max(s.maxStreak, s.streak); if (d > s.maxGain) s.maxGain = d; } else s.streak = 0;
      const key = `${k}|${day}`;
      dayGain.set(key, (dayGain.get(key) || 0) + (won ? d : -d));
      // sessions (Marathon): own games with gaps ≤ session_gap_minutes
      const lt = lastOwnT.get(k);
      const n = lt != null && game.t - lt <= gap ? session.get(k) + 1 : 1;
      session.set(k, n); lastOwnT.set(k, game.t);
      if (!marathon || n > marathon.n) marathon = { id: elo.ids[k], n, t: game.t };
      for (const o of won ? L : W) {
        const ok = elo.ids[o];
        s.opp.set(ok, (s.opp.get(ok) || 0) + (game.double ? 0.5 : 1));
      }
    }
    for (const w of W) for (const l of L) {
      const key = w < l ? pairKey(w, l) : pairKey(l, w);
      pairs.set(key, (pairs.get(key) || 0) + (game.double ? 0.5 : 1));
    }
    if (W.length === 1) {
      const [w, l] = [W[0], L[0]];
      const sw = P.get(elo.ids[w]);
      if (!sw.bestWin || eW < sw.bestWin.chance) sw.bestWin = { opp: elo.ids[l], chance: eW, g, t: game.t };
      // first ever win against someone after ≥ 3 losses
      const lostBefore = pairW.get(pairKey(l, w)) || 0, wonBefore = pairW.get(pairKey(w, l)) || 0;
      if (!wonBefore && lostBefore >= 3 && (!sw.cracked || lostBefore > sw.cracked.losses)) sw.cracked = { opp: elo.ids[l], losses: lostBefore, t: game.t };
      addWin(w, l);
      const key = w < l ? pairKey(w, l) : pairKey(l, w);
      const rec = singles.get(key) || { a: elo.ids[Math.min(w, l)], b: elo.ids[Math.max(w, l)], n: 0, wa: 0, wb: 0 };
      rec.n++; if (w < l) rec.wa++; else rec.wb++;
      singles.set(key, rec);
      // wins in a row against the same person (riddle)
      const ow = P.get(elo.ids[w]), ol = P.get(elo.ids[l]);
      const sk = elo.ids[l];
      ow.oppStreak.set(sk, (ow.oppStreak.get(sk) || 0) + 1);
      ow.maxOppStreak = Math.max(ow.maxOppStreak, ow.oppStreak.get(sk));
      ol.oppStreak.set(elo.ids[w], 0);
    }
  }

  // ── cards: everyone with a game in the month, and everyone ranked at its end ──
  const ids = new Set([...P.keys(), ...endP.keys()]);
  const players = [...ids].map(id => {
    const s = P.get(id), e = endP.get(id), st = startP.get(id);
    const all = endP.all.get(id);
    return {
      id, place: e?.place ?? null, placeStart: st?.place ?? null, provisional: !e,
      rating: s ? s.rating : all?.rating, ratingStart: s ? s.ratingStart : all?.rating,
      delta: s ? s.rating - s.ratingStart : 0, games: s?.games || 0, wins: s?.wins || 0, losses: s?.losses || 0,
      spark: s ? s.spark : [], days: s ? s.days.size : 0, new: !!s?.isNew, total: all?.total ?? 0,
    };
  }).filter(p => p.rating != null)
    .sort((x, y) => (x.place ?? 1e9) - (y.place ?? 1e9) || y.games - x.games || x.id.localeCompare(y.id));

  // ── numbers ──
  const days = new Set(); for (let g = a; g < b; g++) days.add(Math.floor(G[g].t));
  let maxDay = null; for (const [t, n] of dayCount) if (!maxDay || n > maxDay.n) maxDay = { n, t };
  const numbers = { games: b - a, days: days.size, maxDay, eloMoved, active: P.size, newcomers: [...P.values()].filter(s => s.isNew).length };

  // ── badges earned in the month ──
  const badges = [];
  if (A) for (const [id, p] of A.players) for (const e of p.earned) if (e.t >= from && e.t < to) badges.push({ id, badge: e.badge, level: e.level, t: e.t });
  badges.sort((x, y) => x.t - y.t);

  // ── records of the month and all-time records that fell ──
  const winsIn = [];
  for (let g = a; g < b; g++) winsIn.push(g);
  const upset = winsIn.length ? winsIn.reduce((best, g) => (elo.perGame.eW[g] < elo.perGame.eW[best] ? g : best), winsIn[0]) : null;
  const gain = winsIn.length ? winsIn.reduce((best, g) => (elo.perGame.delta[g] > elo.perGame.delta[best] ? g : best), winsIn[0]) : null;
  const sideIds = (g, w) => sides(g)[w ? 'W' : 'L'].map(k => elo.ids[k]);
  const streakTop = [...P.values()].sort((x, y) => y.maxStreak - x.maxStreak)[0];
  let bestDay = null;
  for (const [key, v] of dayGain) if (!bestDay || v > bestDay.gain) { const [k, d] = key.split('|'); bestDay = { id: elo.ids[+k], t: +d, gain: v }; }
  const duel = [...singles.values()].sort((x, y) => y.n - x.n)[0] || null;
  const records = {
    upset: upset != null ? { winners: sideIds(upset, true), losers: sideIds(upset, false), chance: elo.perGame.eW[upset], t: G[upset].t, ref: G[upset].ref } : null,
    streak: streakTop && streakTop.maxStreak >= 2 ? { id: streakTop.id, n: streakTop.maxStreak } : null,
    gain: gain != null ? { winners: sideIds(gain, true), losers: sideIds(gain, false), delta: elo.perGame.delta[gain], t: G[gain].t, ref: G[gain].ref } : null,
    bestDay: bestDay && bestDay.gain > 0 ? bestDay : null,
    marathon: marathon && marathon.n >= 3 ? marathon : null,
    duel: duel && duel.n >= 2 ? duel : null,
  };
  const allTime = [];
  if (b > a) {
    let prevGain = 0, prevUpset = 1;
    for (let g = 0; g < a; g++) { prevGain = Math.max(prevGain, elo.perGame.delta[g]); prevUpset = Math.min(prevUpset, elo.perGame.eW[g]); }
    if (a > 0 && records.gain && records.gain.delta > prevGain) allTime.push({ kind: 'gain', old: prevGain, now: records.gain.delta, who: records.gain.winners });
    if (a > 0 && records.upset && records.upset.chance < prevUpset) allTime.push({ kind: 'upset', old: prevUpset, now: records.upset.chance, who: records.upset.winners });
    // win streaks counted over all games (a streak that started before the month counts in full)
    let prevBest = 0, monthBest = null;
    const cur = new Int32Array(elo.ids.length);
    for (let g = 0; g < b; g++) {
      const { W, L } = sides(g);
      for (const k of W) { cur[k]++; if (g < a) prevBest = Math.max(prevBest, cur[k]); else if (!monthBest || cur[k] > monthBest.n) monthBest = { id: elo.ids[k], n: cur[k] }; }
      for (const k of L) cur[k] = 0;
    }
    if (a > 0 && monthBest && monthBest.n > prevBest) allTime.push({ kind: 'streak', old: prevBest, now: monthBest.n, who: [monthBest.id] });
  }

  // ── network: Begegnungen of the month ──
  const nodes = players.map(p => ({ id: p.id, games: p.games, delta: p.delta }));
  const edges = [...pairs].map(([key, n]) => { const [x, y] = key.split('|').map(Number); return { a: elo.ids[x], b: elo.ids[y], n }; })
    .sort((x, y) => y.n - x.n);
  const top5 = players.filter(p => p.place != null).slice(0, 5).map(p => p.id);
  let unmet = null;
  for (let i = 0; i < top5.length && !unmet; i++) for (let j = i + 1; j < top5.length && !unmet; j++) {
    const ki = kOf(top5[i]), kj = kOf(top5[j]);
    if (!elo.pair.matchups[ki * elo.ids.length + kj]) unmet = { a: top5[i], b: top5[j], ever: true };
  }
  if (!unmet) for (let i = 0; i < top5.length && !unmet; i++) for (let j = i + 1; j < top5.length && !unmet; j++) {
    if (!edges.some(e => (e.a === top5[i] && e.b === top5[j]) || (e.a === top5[j] && e.b === top5[i]))) unmet = { a: top5[i], b: top5[j], ever: false };
  }
  const network = { nodes, edges, busiest: edges[0] || null, unmet };

  // ── bump chart: Platz at the end of every day of the month ──
  const dayList = [];
  for (let d = from; d < Math.min(to, Math.ceil(end)); d += DAY) dayList.push(d);
  const snaps = dayList.map(d => placesAt(model, Math.min(d + 1, end), cfg));
  const movers = players.filter(p => p.place != null && p.placeStart != null && p.games)
    .map(p => ({ id: p.id, move: p.placeStart - p.place })).filter(x => x.move !== 0)
    .sort((x, y) => Math.abs(y.move) - Math.abs(x.move) || x.id.localeCompare(y.id)).slice(0, 5);
  const leaderEnd = players.find(p => p.place === 1)?.id ?? null;
  const highlight = [...new Set([leaderEnd, ...movers.map(m => m.id)].filter(Boolean))].slice(0, 5);
  const bump = { days: dayList, series: players.filter(p => snaps.some(s => s.has(p.id))).map(p => ({
    id: p.id, places: snaps.map(s => s.get(p.id)?.place ?? null), slot: highlight.includes(p.id) ? highlight.indexOf(p.id) : null })),
    size: Math.max(0, ...snaps.map(s => s.size)) };

  // ── Ruhmeshalle strip: the year's months so far ──
  const hall = (A?.monthly || []).filter(m => serialToParts(m.from).y === year && m.from <= from)
    .sort((x, y) => x.from - y.from).map(m => ({ from: m.from, riser: m.riser ? { id: m.riser.id ?? elo.ids[m.riser.k], gain: m.riser.gain } : null, leader: m.leader }));
  const monthWin = (A?.monthly || []).find(m => m.from === from) || null;

  // ── stories (headline first) ──
  const stories = [];
  const lStart = [...startP.values()].find(x => x.place === 1)?.id ?? null;
  if (leaderEnd && leaderEnd !== lStart) stories.push({ kind: 'leader', id: leaderEnd, old: lStart, rating: endP.get(leaderEnd).rating });
  for (const r of allTime) stories.push({ kind: 'record', record: r });
  if (records.streak && records.streak.n >= 8) stories.push({ kind: 'streak', id: records.streak.id, n: records.streak.n });
  if (monthWin?.riser) stories.push({ kind: 'riser', id: monthWin.riser.id ?? elo.ids[monthWin.riser.k], gain: monthWin.riser.gain, games: monthWin.riser.games });
  if (records.upset && records.upset.chance <= 0.3) stories.push({ kind: 'upset', ...records.upset });
  if (leaderEnd && leaderEnd === lStart) stories.push({ kind: 'defended', id: leaderEnd });
  if (records.duel) stories.push({ kind: 'duel', ...records.duel });
  const tour = monthTournament(tournaments, from, to);
  if (tour) stories.splice(Math.min(1, stories.length), 0, { kind: 'tournament', name: tour.name, winner: tour.winner });
  if (!stories.length) stories.push({ kind: 'quiet', games: numbers.games });

  // ── a personal line for every card ──
  const spieltage = numbers.days, used = new Map();
  for (const p of players) {
    const s = P.get(p.id);
    p.line = personalLine(p, s, { leaderEnd, lStart, badges: badges.filter(x => x.id === p.id), spieltage, endPlace: p.place }, used);
  }

  return {
    year, month, from, to, running: now < to, issue: issueNumber(year, month), numbers, players, stories, records, allTime,
    network, bump, badges, hall, riddle: riddleFor(P, year, month), tournament: tour,
  };
}

/**
 * Candidate lines for one player's month, most notable first (never mocking: no losing streaks here).
 * posterData picks the first candidate whose kind isn't on two cards above already, so the cards differ.
 */
export function lineCandidates(p, s, { leaderEnd, lStart, badges = [], spieltage = 0, endPlace = null }) {
  if (!s || !s.games) return [{ kind: 'pause', place: endPlace, kept: p.placeStart != null && p.placeStart === p.place }];
  const out = [];
  if (p.id === leaderEnd && leaderEnd !== lStart) out.push({ kind: 'newLeader' });
  if (s.bestWin && s.bestWin.chance <= 0.3) out.push({ kind: 'upset', opp: s.bestWin.opp, chance: s.bestWin.chance });
  if (s.cracked) out.push({ kind: 'cracked', opp: s.cracked.opp, losses: s.cracked.losses });
  if (s.maxStreak >= 5) out.push({ kind: 'streak', n: s.maxStreak });
  if (p.placeStart != null && p.place != null && p.placeStart - p.place >= 3) out.push({ kind: 'climb', n: p.placeStart - p.place });
  if (p.id === leaderEnd) out.push({ kind: 'leader' });
  if (s.isNew) out.push({ kind: 'new', t: s.firstT });
  if (badges.length) { const last = badges[badges.length - 1]; out.push({ kind: 'badge', badge: last.badge, level: last.level, more: badges.length - 1 }); }
  if (s.maxGain >= 20) out.push({ kind: 'gain', delta: s.maxGain });
  if (spieltage >= 6 && s.days.size >= Math.max(5, spieltage * 0.6)) out.push({ kind: 'regular', days: s.days.size, of: spieltage });
  const opp = [...s.opp].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0];
  if (opp && opp[1] >= 3) out.push({ kind: 'rival', opp: opp[0], n: opp[1] });
  out.push({ kind: 'summary', games: s.games, wins: s.wins });
  return out;
}

export function personalLine(p, s, o, used = new Map()) {
  const c = lineCandidates(p, s, o);
  const pick = c.find(x => (used.get(x.kind) || 0) < 2) || c[0];
  used.set(pick.kind, (used.get(pick.kind) || 0) + 1);
  return pick;
}

/** „Wer bin ich?“: three anonymous facts of one player with ≥ 10 games, chosen by the month (same month → same riddle). */
export function riddleFor(P, year, month) {
  const cands = [...P.values()].filter(s => s.games >= 10).sort((x, y) => x.id.localeCompare(y.id));
  if (!cands.length) return null;
  const s = cands[parseInt(fnv1a(`${year}-${month}`), 16) % cands.length];
  const facts = [{ kind: 'games', n: s.games }];
  if (s.formTimes.length >= 5) {
    const hours = s.formTimes.map(t => (t - Math.floor(t)) * 24);
    const lo = Math.floor(Math.min(...hours)), hi = Math.ceil(Math.max(...hours));
    if (lo >= 9) facts.push({ kind: 'notBefore', h: lo });
    else if (hi <= 16) facts.push({ kind: 'notAfter', h: hi });
  }
  if (s.maxOppStreak >= 3) facts.push({ kind: 'oppStreak', n: s.maxOppStreak });
  const wd = s.weekdays.indexOf(Math.max(...s.weekdays));
  if (s.weekdays[wd] >= s.games * 0.35) facts.push({ kind: 'weekday', d: wd });
  if (s.doubles >= s.games * 0.5) facts.push({ kind: 'doubles', share: s.doubles / s.games });
  facts.push({ kind: 'winShare', share: s.wins / s.games });
  return { id: s.id, facts: facts.slice(0, 3) };
}

/** A tournament finished in the month (December: the Christmas tournament) → winner, runner-up, final. */
function monthTournament(list, from, to) {
  const T = list.filter(x => x.ok && x.status === 'beendet' && x.winner && x.date != null && x.date >= from && x.date < to)
    .sort((x, y) => y.date - x.date)[0];
  if (!T) return null;
  const final = T.matches.find(m => m.label === 'Finale');
  const who = key => T.participants.find(p => p.key === key) || null;
  return { id: T.id, name: T.name, date: T.date, winner: who(T.winner), second: who(T.second), third: T.third.map(who).filter(Boolean),
    final: final?.result ? { a: final.a, b: final.b, result: final.result } : null, photo: T.winnerPhoto, participants: T.participants.length };
}
