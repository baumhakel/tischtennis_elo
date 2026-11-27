// Souvenir print (Phase 18c, section 7): the highlights of a finished tournament day, from its played matches.
// Pure (no DOM): `souvenirFacts(T, { games, elo })`. Walkovers never count.
//
// - closestSet: the set with the longest deuce (highest losing score in a set won by two points beyond 11)
// - comeback: the biggest deficit in sets a winner turned around (at least one set)
// - upset: the members' match the winner had the smallest Siegchance in (Elo before the match, < 50 %)
// - longest: the match with the most points
// - mostPoints: the side (player or team) with the most points over the day
// - eloDay: Elo-Punkte per member over the tournament's matches, best first

/** Played, real matches (no w. o.), in order of play. */
export const playedMatches = T => T.matches.filter(m => m.result && !m.result.wo && m.result.sets?.length).sort((x, y) => x.result.t - y.result.t);

const pts = m => m.result.sets.reduce((s, [a, b]) => s + a + b, 0);

/** The winner's running deficit in sets: the largest number of sets they were behind at any point. */
export function deficit(r) {
  let a = 0, b = 0, worst = 0;
  for (const [x, y] of r.sets) {
    if (x > y) a++; else b++;
    worst = Math.max(worst, r.winner === 'a' ? b - a : a - b);
  }
  return worst;
}

export function souvenirFacts(T, { games = [], elo = null } = {}) {
  const ms = playedMatches(T);
  const out = { closestSet: null, comeback: null, upset: null, longest: null, mostPoints: null, eloDay: [] };
  for (const m of ms) {
    m.result.sets.forEach(([a, b], i) => {
      const lo = Math.min(a, b);
      if (Math.max(a, b) > (T.points || 11) && (!out.closestSet || lo > out.closestSet.lo)) out.closestSet = { m, set: i + 1, a, b, lo };
    });
    const d = deficit(m.result);
    if (d >= 1 && (!out.comeback || d > out.comeback.deficit)) out.comeback = { m, deficit: d };
    const p = pts(m);
    if (!out.longest || p > out.longest.points) out.longest = { m, points: p };
  }
  // points per side over the day
  const sum = new Map();
  for (const m of ms) m.result.sets.forEach(([a, b]) => {
    sum.set(m.a.key, (sum.get(m.a.key) || 0) + a);
    sum.set(m.b.key, (sum.get(m.b.key) || 0) + b);
  });
  for (const [key, points] of sum) if (!out.mostPoints || points > out.mostPoints.points) out.mostPoints = { key, points };
  // Elo: the tournament's games in the rating (members only)
  if (elo?.perGame) {
    const gain = new Map();
    games.forEach((g, i) => {
      if (g.tournament?.id !== T.id) return;
      const d = elo.perGame.delta[i], eW = elo.perGame.eW[i];
      if (!Number.isFinite(d)) return;
      for (const id of g.winners) gain.set(id, (gain.get(id) || 0) + d);
      for (const id of g.losers) gain.set(id, (gain.get(id) || 0) - d);
      const m = T.matches.find(x => x.nr === g.tournament.nr);
      if (m && Number.isFinite(eW) && eW < 0.5 && (!out.upset || eW < out.upset.chance)) out.upset = { m, chance: eW };
    });
    out.eloDay = [...gain].map(([id, delta]) => ({ id, delta })).sort((x, y) => y.delta - x.delta);
  }
  return out;
}
