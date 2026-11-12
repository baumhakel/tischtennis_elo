// Abzeichen (Phase 12). PURE: one pass over all games, no DOM.
//
// Rule for every badge: it is earned with the game (or at the moment) in which its condition is
// met for the first time, and kept. A condition only looks at what happened up to that moment.
// Badges for a completed period (Aufsteiger der Woche) are awarded when the period has ended.
//
// „Platz“ for badges: rank in the pooled league among players with ≥ achievement_rank_min_games
// games by then who played within achievement_rank_active_days days before that moment. Today's
// UI filters and the Wertung switch never matter.
//
// Output (computeAchievements):
//   players: Map id → { earned: [{badge, level, t, g}] by time, level: {badge: n}, value: {badge: v} }
//   byGame:  Map g → [{ id, badge, level }]       (g = index in the pooled games)
//   weekly:  [{ from, to, id|null, gain, games }]  completed calendar weeks, newest first
//   running: the same for the current week (leader so far, not awarded) or null
//   detail(id): the state now for „Was fehlt“ (opponents, partners, streaks, this week, Platz)
//   ranking: [{id, rating}] Platz by the badge rules now · modeRanks: the same for king_single / king_double
//   reigns:  [{ id, from, to, days, current }]     Platz 1 over time, newest first
//   levels:  badge → thresholds (from config)

/** Badge ids → where their thresholds come from, and whether higher or lower values are better. */
export const BADGES = {
  games:       { levels: 'achievement_games_levels' },
  days:        { levels: 'achievement_days_levels' },
  weeks:       { levels: 'achievement_weeks_levels' },
  opponents:   { levels: 'achievement_opponents_levels' },
  all_beaten:  { single: true },
  each_five:   { single: true },
  win_streak:  { levels: 'achievement_win_streak_levels' },
  comeback:    { single: true },
  subscription:{ single: true },
  perfect_week:{ single: true },
  beat_leader: { single: true },
  regicide:    { single: true },
  giant:       { levels: 'achievement_giant_chance_levels', lower: true },
  underdog:    { single: true },
  unlucky:     { single: true },
  podium:      { single: true },
  leader:      { single: true },
  throne:      { levels: 'achievement_leader_days_levels' },
  elo:         { levels: 'achievement_elo_levels' },
  rocket:      { single: true },
  rising_star: { levels: 'achievement_rising_star_levels' },
  nemesis:     { single: true },
  revenge:     { single: true },
  balanced:    { levels: 'achievement_balanced_levels' },
  duel:        { levels: 'achievement_duel_levels' },
  team_player: { levels: 'achievement_partner_levels' },
  dream_team:  { single: true },
  king_single: { single: true },
  king_double: { single: true },
  early:       { single: true },
  late:        { single: true },
  marathon:    { single: true },
  busy_day:    { single: true },
  all_weekdays:{ single: true },
  lucky:       { single: true },
  even:        { single: true },
  jubilee:     { single: true },
};

const DAY = 1, WEEKDAY0 = 5;                     // serial 0 = Saturday; (d + 5) % 7 → Monday = 0
const weekOf = t => Math.floor(t) - ((Math.floor(t) + WEEKDAY0) % 7);

/** Thresholds of a badge from config (sorted: ascending, or descending for lower-is-better). */
export function levelsOf(cfg, badge) {
  const b = BADGES[badge];
  if (!b?.levels) return [1];
  const v = (cfg[b.levels] || []).slice();
  return b.lower ? v.sort((x, y) => y - x) : v.sort((x, y) => x - y);
}

/** How many levels a value reaches. */
export function levelFor(cfg, badge, value) {
  const L = levelsOf(cfg, badge);
  if (!BADGES[badge]?.levels) return value ? 1 : 0;
  return BADGES[badge].lower ? L.filter(x => value <= x).length : L.filter(x => value >= x).length;
}

/**
 * @param {{dataset, elo}} pooled                     the pooled model (Wertung „Alle“)
 * @param {{einzel?: {dataset, elo}, doppel?: {dataset, elo}}} modes   for Einzel-/Doppelkönig
 * @param {number} now                                sheet serial
 */
export function computeAchievements(pooled, modes = {}, now = Infinity) {
  const { dataset, elo } = pooled;
  const cfg = dataset.config, games = dataset.games;
  const n = elo.ids.length;
  const minR = cfg.achievement_rank_min_games, active = cfg.achievement_rank_active_days;
  const h2hMin = cfg.h2h_min_games;
  const gap = cfg.session_gap_minutes / 1440;
  // thresholds read once (re-reading config per check dominated the run time)
  const LV = Object.fromEntries(Object.keys(BADGES).map(b => [b, levelsOf(cfg, b)]));
  const lvl = (b, v) => {
    const L = LV[b];
    if (!BADGES[b].levels) return v ? 1 : 0;
    let c = 0;
    if (BADGES[b].lower) { for (const x of L) if (v <= x) c++; } else { for (const x of L) if (v >= x) c++; }
    return c;
  };

  // ── per-player state ──
  const S = elo.ids.map(() => ({
    rating: cfg.start_rating, played: 0, wins: 0, losses: 0, last: -Infinity,
    winStreak: 0, lossStreak: 0, underdog: 0, days: new Set(), week: null, weekStreak: 0,
    weekStart: 0, weekWins: 0, weekLost: false,
    beaten: new Set(), faced: new Set(), notBeaten: 0, partners: new Set(),
    lastFormT: -Infinity, session: 0, formDay: null, formDayCount: 0, weekdays: new Set(),
  }));
  const V = elo.ids.map(() => ({}));                 // progress values
  const best = (k, b, v, lower = false) => {
    const cur = V[k][b];
    if (cur === undefined || (lower ? v < cur : v > cur)) V[k][b] = v;
  };
  const earned = elo.ids.map(() => []), level = elo.ids.map(() => ({}));
  const byGame = new Map();
  const award = (k, badge, lvl, t, g = null) => {
    const cur = level[k][badge] || 0;
    for (let l = cur + 1; l <= lvl; l++) {
      earned[k].push({ badge, level: l, t, g });
      if (g != null) {
        if (!byGame.has(g)) byGame.set(g, []);
        byGame.get(g).push({ id: elo.ids[k], badge, level: l });
      }
    }
    if (lvl > cur) level[k][badge] = lvl;
  };
  const awardValue = (k, badge, value, t, g) => {
    best(k, badge, value, BADGES[badge].lower);
    award(k, badge, lvl(badge, value), t, g);
  };

  // pair state: singles meetings / wins, all Begegnungen (doubles count half), abo streaks, last result
  const sm = new Int32Array(n * n), sw = new Int32Array(n * n), abo = new Int32Array(n * n), lastRes = new Int8Array(n * n);
  const am = new Float64Array(n * n), aw = new Float64Array(n * n), dw = new Int32Array(n * n);

  // ── Platz at time t (badge rules) ──
  const ranking = (state, t) => {
    const out = [];
    for (let k = 0; k < state.length; k++) {
      const s = state[k];
      if (s.played >= minR && s.last >= t - active) out.push(k);
    }
    return out.sort((a, b) => state[b].rating - state[a].rating || a - b);
  };

  // ── Platz-1 reigns (pooled) ──
  const reigns = [];
  let reign = null;   // { k, from }
  // whoever becomes Platz 1 earns „Spitzenreiter“ at that moment, also without playing (the old leader lost or went inactive)
  const setLeader = (k, t, g = null) => {
    if (reign && reign.k === k) return;
    if (reign) reigns.push({ k: reign.k, from: reign.from, to: t });
    reign = k == null ? null : { k, from: t };
    if (k != null) award(k, 'leader', 1, t, g);
  };
  const expireUntil = t => {   // the leader drops out after `active` days without a game
    while (reign) {
      const e = S[reign.k].last + active;
      if (e >= t) break;
      const next = ranking(S, e + 1e-9)[0];
      setLeader(next ?? null, e);
      if (next == null) break;
    }
  };

  // ── weekly gains (Aufsteiger der Woche, calendar weeks) ──
  const weeks = new Map();   // weekStart → Map k → { start, end, games }

  for (let g = 0; g < games.length; g++) {
    const x = games[g], t = x.t;
    const W = x.winners.map(id => elo.index.get(id)), L = x.losers.map(id => elo.index.get(id));
    const eW = elo.perGame.eW[g], delta = elo.perGame.delta[g];
    const form = x.source !== 'legacy';
    expireUntil(t);
    const before = ranking(S, t);
    const leaderBefore = before[0];

    // nemesis / revenge need the state before this game
    const flags = new Map();
    if (!x.double) {
      const [w, l] = [W[0], L[0]];
      let worst = null;
      for (let j = 0; j < n; j++) {
        const m = am[w * n + j];
        if (j === w || m < h2hMin) continue;
        const r = aw[w * n + j] / m;
        if (!worst || r < worst.r || (r === worst.r && m > worst.m)) worst = { j, r, m };
      }
      flags.set('nemesis', worst?.j === l);
      flags.set('revenge', lastRes[w * n + l] === -1);
    }

    // update ratings and counts
    const wk = weekOf(t);
    const touch = (k, won, ownChance) => {
      const s = S[k];
      if (s.week !== wk) {
        s.weekStreak = s.week !== null && wk - s.week === 7 ? s.weekStreak + 1 : 1;
        s.week = wk; s.weekStart = s.rating; s.weekWins = 0; s.weekLost = false;
      }
      if (!weeks.has(wk)) weeks.set(wk, new Map());
      const wr = weeks.get(wk);
      if (!wr.has(k)) wr.set(k, { start: s.rating, end: s.rating, games: 0, played: 0 });
      s.rating += won ? delta : -delta;
      s.played++; s.last = t; s.days.add(Math.floor(t));
      if (won) { s.wins++; s.weekWins++; } else { s.losses++; s.weekLost = true; }
      const rec = wr.get(k); rec.end = s.rating; rec.games++; rec.played = s.played;
      return { won, p: ownChance };
    };
    const info = new Map();
    for (const k of W) info.set(k, touch(k, true, eW));
    for (const k of L) info.set(k, touch(k, false, 1 - eW));

    // pairs
    for (const w of W) for (const l of L) {
      const half = x.double ? 0.5 : 1;
      am[w * n + l] += half; am[l * n + w] += half; aw[w * n + l] += half;
      // faced / beaten with a running count of faced-but-never-beaten opponents (Alle besiegt)
      if (!S[l].faced.has(w)) { S[l].faced.add(w); if (!S[l].beaten.has(w)) S[l].notBeaten++; }
      if (!S[w].faced.has(l)) { S[w].faced.add(l); if (!S[w].beaten.has(l)) S[w].notBeaten++; }
      if (!S[w].beaten.has(l)) { S[w].beaten.add(l); S[w].notBeaten--; }
    }
    if (!x.double) {
      const [w, l] = [W[0], L[0]];
      sm[w * n + l]++; sm[l * n + w]++; sw[w * n + l]++;
      abo[w * n + l]++; abo[l * n + w] = 0;
      lastRes[w * n + l] = 1; lastRes[l * n + w] = -1;
    } else {
      dw[W[0] * n + W[1]]++; dw[W[1] * n + W[0]]++;
      S[W[0]].partners.add(W[1]); S[W[1]].partners.add(W[0]);
    }

    const after = ranking(S, t);
    if (after.length) setLeader(after[0], t, g);
    // everyone on the podium after this game, players or not
    after.slice(0, cfg.achievement_podium_rank).forEach(k => award(k, 'podium', 1, t, g));
    after.forEach((k, i) => { best(k, 'podium', i + 1, true); best(k, 'leader', i + 1, true); });

    // ── evaluate badges for everyone in this game ──
    for (const [k, { won, p }] of info) {
      const s = S[k];
      awardValue(k, 'games', s.played, t, g);
      awardValue(k, 'days', s.days.size, t, g);
      best(k, 'weeks', s.weekStreak); award(k, 'weeks', lvl('weeks', s.weekStreak), t, g);
      awardValue(k, 'opponents', s.beaten.size, t, g);
      V[k].all_beaten = s.faced.size - s.notBeaten;
      V[k].all_beaten_of = s.faced.size;
      if (s.notBeaten === 0 && s.faced.size >= cfg.achievement_all_beaten_min) award(k, 'all_beaten', 1, t, g);

      if (won) {
        if (s.lossStreak >= cfg.achievement_comeback_losses) award(k, 'comeback', 1, t, g);
        s.winStreak++; s.lossStreak = 0;
        if (p < 0.5) s.underdog++; else s.underdog = 0;
        best(k, 'giant', p, true);
        award(k, 'giant', lvl('giant', p), t, g);
        if (s.weekWins >= cfg.achievement_perfect_week_wins && !s.weekLost) award(k, 'perfect_week', 1, t, g);
        if (!s.weekLost) best(k, 'perfect_week', s.weekWins);
        if (L.includes(leaderBefore)) {
          award(k, 'beat_leader', 1, t, g);
          if (after[0] === k) award(k, 'regicide', 1, t, g);
        }
      } else {
        s.lossStreak++; s.winStreak = 0; s.underdog = 0;
        if (p >= cfg.achievement_unlucky_chance) award(k, 'unlucky', 1, t, g);
      }
      best(k, 'win_streak', s.winStreak); award(k, 'win_streak', lvl('win_streak', s.winStreak), t, g);
      best(k, 'underdog', s.underdog);
      if (s.underdog >= cfg.achievement_underdog_streak) award(k, 'underdog', 1, t, g);

      awardValue(k, 'elo', s.rating, t, g);
      const gain = s.rating - s.weekStart;
      best(k, 'rocket', gain);
      if (gain >= cfg.achievement_rocket_points) award(k, 'rocket', 1, t, g);

      if (cfg.achievement_lucky_numbers.includes(Math.round(s.rating))) award(k, 'lucky', 1, t, g);
      if (s.played >= cfg.achievement_balance_min_games && s.wins === s.losses) award(k, 'even', 1, t, g);
      if (s.played === cfg.achievement_jubilee_games && won) award(k, 'jubilee', 1, t, g);
      V[k].jubilee = s.played;

      // singles-only badges
      if (!x.double) {
        const o = won ? L[0] : W[0];
        if (won && flags.get('nemesis')) award(k, 'nemesis', 1, t, g);
        if (won && flags.get('revenge')) award(k, 'revenge', 1, t, g);
        best(k, 'subscription', abo[k * n + o]);
        if (won && abo[k * n + o] >= cfg.achievement_subscription_wins) award(k, 'subscription', 1, t, g);
        let balanced = 0, maxDuel = 0, q = 0, qOk = 0;
        for (let j = 0; j < n; j++) {
          const m = sm[k * n + j];
          if (j === k || !m) continue;
          maxDuel = Math.max(maxDuel, m);
          if (m >= h2hMin && 2 * sw[k * n + j] > m) balanced++;
          if (m >= cfg.achievement_each_min_games) { q++; if (sw[k * n + j] >= cfg.achievement_each_wins) qOk++; }
        }
        awardValue(k, 'balanced', balanced, t, g);
        awardValue(k, 'duel', maxDuel, t, g);
        V[k].each_five = qOk; V[k].each_five_of = Math.max(q, cfg.achievement_all_beaten_min);
        if (q >= cfg.achievement_all_beaten_min && qOk === q) award(k, 'each_five', 1, t, g);
      } else if (won) {
        const partner = W[0] === k ? W[1] : W[0];
        awardValue(k, 'team_player', s.partners.size, t, g);
        best(k, 'dream_team', dw[k * n + partner]);
        if (dw[k * n + partner] >= cfg.achievement_dream_team_wins) award(k, 'dream_team', 1, t, g);
      }

      // time of day: form entries only (Altdaten times are estimated)
      if (form) {
        const hour = (t - Math.floor(t)) * 24;
        if (hour < cfg.achievement_early_hour) award(k, 'early', 1, t, g);
        if (hour >= cfg.achievement_late_hour) award(k, 'late', 1, t, g);
        s.session = t - s.lastFormT <= gap ? s.session + 1 : 1;
        s.lastFormT = t;
        best(k, 'marathon', s.session);
        if (s.session >= cfg.achievement_marathon_games) award(k, 'marathon', 1, t, g);
        const d = Math.floor(t);
        s.formDayCount = s.formDay === d ? s.formDayCount + 1 : 1; s.formDay = d;
        best(k, 'busy_day', s.formDayCount);
        if (s.formDayCount >= cfg.achievement_busy_day_games) award(k, 'busy_day', 1, t, g);
        const wd = (d + WEEKDAY0) % 7;
        if (wd < 5) s.weekdays.add(wd);
        V[k].all_weekdays = s.weekdays.size;
        if (s.weekdays.size === 5) award(k, 'all_weekdays', 1, t, g);
      }
    }
  }

  // ── reigns up to now; Thron ──
  expireUntil(now);
  if (reign) reigns.push({ k: reign.k, from: reign.from, to: Math.min(now, Infinity), current: true });
  for (const r of reigns) {
    const end = Number.isFinite(r.to) ? r.to : now;
    r.days = end - r.from;
    best(r.k, 'throne', r.days);
    LV.throne.forEach((L, i) => {
      if (r.days >= L && r.from + L <= now) award(r.k, 'throne', i + 1, r.from + L);
    });
  }

  // ── Aufsteiger der Woche: completed calendar weeks only ──
  const weekly = [];
  let running = null;      // the week that is not over yet: who leads so far (no badge yet)
  for (const [from, rec] of [...weeks.entries()].sort((a, b) => a[0] - b[0])) {
    const to = from + 7 * DAY;
    let win = null;
    for (const [k, r] of rec) {
      if (r.games < cfg.rising_star_min_games || r.played < minR) continue;
      const gain = r.end - r.start;
      if (gain <= 0) continue;
      if (!win || gain > win.gain || (gain === win.gain && r.games > win.games)) win = { k, gain, games: r.games };
    }
    if (to > now) {
      running = { from, to, id: win ? elo.ids[win.k] : null, gain: win?.gain ?? null, games: win?.games ?? null };
      continue;
    }
    weekly.push({ from, to, id: win ? elo.ids[win.k] : null, gain: win?.gain ?? null, games: win?.games ?? null });
    if (win) {
      const c = (V[win.k].rising_star || 0) + 1;
      V[win.k].rising_star = c;
      award(win.k, 'rising_star', lvl('rising_star', c), to);
    }
  }

  // ── Einzel- / Doppelkönig: Platz 1 in the Wertung Einzel / Doppel ──
  const modeRanks = {};    // badge rules' ranking now, per mode league (for „Was fehlt“)
  const refIdx = new Map(games.map((x, g) => [x.ref + '|' + x.winners.join() + '|' + x.losers.join(), g]));
  for (const [badge, m] of [['king_single', modes.einzel], ['king_double', modes.doppel]]) {
    if (!m) continue;
    const st = m.elo.ids.map(() => ({ rating: cfg.start_rating, played: 0, last: -Infinity }));
    m.dataset.games.forEach((x, g) => {
      const delta = m.elo.perGame.delta[g];
      for (const id of x.winners) { const s = st[m.elo.index.get(id)]; s.rating += delta; s.played++; s.last = x.t; }
      for (const id of x.losers) { const s = st[m.elo.index.get(id)]; s.rating -= delta; s.played++; s.last = x.t; }
      const top = ranking(st, x.t)[0];
      if (top === undefined) return;
      award(elo.index.get(m.elo.ids[top]), badge, 1, x.t, refIdx.get(x.ref + '|' + x.winners.join() + '|' + x.losers.join()) ?? null);
    });
    modeRanks[badge] = ranking(st, now).map(k => ({ id: m.elo.ids[k], rating: st[k].rating }));
  }

  // ── „Was fehlt“: the state now, per player (computed on demand; nothing here changes a badge) ──
  const rankNow = ranking(S, now).map(k => ({ id: elo.ids[k], rating: S[k].rating }));
  const nowWeek = Number.isFinite(now) ? weekOf(now) : null;
  const detail = id => {
    const k = elo.index.get(id);
    if (k === undefined) return null;
    const s = S[k];
    const opponents = [];
    for (let j = 0; j < n; j++) {
      if (j === k || !s.faced.has(j)) continue;
      opponents.push({
        id: elo.ids[j], beaten: s.beaten.has(j),
        singles: sm[k * n + j], singleWins: sw[k * n + j],       // Einzel against j
        meetings: am[k * n + j], meetingWins: aw[k * n + j],     // Begegnungen (Doppel count half)
        abo: abo[k * n + j], lostLast: lastRes[k * n + j] === -1, // current singles run, last singles result
      });
    }
    const partners = [];
    for (let j = 0; j < n; j++) if (j !== k && dw[k * n + j]) partners.push({ id: elo.ids[j], wins: dw[k * n + j] });
    // current Angstgegner by the badge's rule (lowest share of Begegnungen won, ≥ h2h_min_games)
    let worst = null;
    for (let j = 0; j < n; j++) {
      const m = am[k * n + j];
      if (j === k || m < h2hMin) continue;
      const r = aw[k * n + j] / m;
      if (!worst || r < worst.r || (r === worst.r && m > worst.m)) worst = { j, r, m };
    }
    const thisWeek = s.week !== null && s.week === nowWeek;
    return {
      rating: s.rating, played: s.played, wins: s.wins, losses: s.losses, last: s.last,
      winStreak: s.winStreak, lossStreak: s.lossStreak, underdog: s.underdog,
      weekStreak: s.week !== null && nowWeek !== null && nowWeek - s.week <= 7 ? s.weekStreak : 0,
      playedThisWeek: thisWeek,
      week: thisWeek ? { gain: s.rating - s.weekStart, wins: s.weekWins, lost: s.weekLost, games: weeks.get(nowWeek)?.get(k)?.games ?? 0 } : null,
      opponents, partners,
      nemesis: worst ? elo.ids[worst.j] : null,
      weekdays: [...s.weekdays].sort(),
      rank: rankNow.findIndex(r => r.id === id) + 1 || null,          // Platz by the badge rules, null = not ranked
      rankedGames: minR, rankedDays: active,
    };
  };

  const players = new Map();
  elo.ids.forEach((id, k) => {
    earned[k].sort((a, b) => a.t - b.t || (a.g ?? 0) - (b.g ?? 0));
    players.set(id, { earned: earned[k], level: level[k], value: V[k] });
  });
  const levels = LV;
  return {
    players, byGame, levels, detail, ranking: rankNow, modeRanks,
    weekly: weekly.reverse(), running,
    reigns: reigns.map(r => ({ id: elo.ids[r.k], from: r.from, to: r.to, days: r.days, current: !!r.current })).reverse(),
  };
}
