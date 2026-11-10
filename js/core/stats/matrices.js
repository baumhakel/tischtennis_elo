// Matrix explorer metrics and partner chemistry. Pure. All matrices n×n, row-major, k order of elo.ids.
// Convention: M[i, j] is "i against j" (row player's view). NaN = undefined (no games / diagonal).
import { winProbability } from '../elo.js';
import { nanMatrix } from './util.js';

/**
 * matrices:
 *   matchups          n_ij (doubles count ½ per pair)                         undirected
 *   matchupsNormed    n_ij / √(row_i · col_j)                                undirected
 *   deviation         Pearson residual (O − E)/√E against the independence model (fixes R bug #5)
 *   expectedMatchups  E_ij of that model
 *   wins              wins of i over j                                        directed
 *   winRatio          wins_ij / n_ij
 *   transfer          Elo i won from j (net, antisymmetric)
 *   avgTransfer       transfer_ij / n_ij
 *   winProb           P(i beats j) from the current ratings (singles formula)
 *   actualVsExpected  wins_ij − Σ pre-game expected scores of i vs j ("arbitrage", fixes R bug #3)
 *   actualVsExpectedPerGame  the same divided by n_ij
 *
 * Independence model (as in calculate_elo.R): with T = Σ_{i<j} n_ij and p_i = row_i / 2T, a game
 * picks player i with prob. p_i and an opponent among the others ∝ p_j, so
 * E_ij = T · p_i p_j · (1/(1 − p_i) + 1/(1 − p_j)).
 */
export const matrices = {
  name: 'matrices',
  defaults: () => ({}),
  compute({ elo }) {
    const n = elo.ids.length;
    const { matchups, wins, transfer, expected } = elo.pair;
    const row = new Float64Array(n);
    let T2 = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) row[i] += matchups[i * n + j];
      T2 += row[i];
    }
    const T = T2 / 2;
    const p = Float64Array.from(row, v => (T2 ? v / T2 : 0));

    const matchupsNormed = nanMatrix(n), deviation = nanMatrix(n), expectedMatchups = nanMatrix(n);
    const winRatio = nanMatrix(n), avgTransfer = nanMatrix(n), winProb = nanMatrix(n);
    const actualVsExpected = nanMatrix(n), actualVsExpectedPerGame = nanMatrix(n);

    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const c = i * n + j, m = matchups[c];
      winProb[c] = winProbability(elo.final[i], elo.final[j]);
      if (row[i] && row[j]) matchupsNormed[c] = m / Math.sqrt(row[i] * row[j]);
      if (T && p[i] < 1 && p[j] < 1) {
        const E = T * p[i] * p[j] * (1 / (1 - p[i]) + 1 / (1 - p[j]));
        expectedMatchups[c] = E;
        if (E > 0) deviation[c] = (m - E) / Math.sqrt(E);
      }
      if (m > 0) {
        winRatio[c] = wins[c] / m;
        avgTransfer[c] = transfer[c] / m;
        actualVsExpected[c] = wins[c] - expected[c];
        actualVsExpectedPerGame[c] = (wins[c] - expected[c]) / m;
      }
    }
    return {
      matchups, matchupsNormed, deviation, expectedMatchups,
      wins, winRatio, transfer, avgTransfer, winProb, actualVsExpected, actualVsExpectedPerGame,
    };
  },
};

/**
 * partners (doubles): games and wins together, win ratio, and team chemistry =
 * wins − Σ the team's pre-game expected scores (total and per game). Symmetric.
 */
export const partners = {
  name: 'partners',
  defaults: () => ({}),
  compute({ elo }) {
    const n = elo.ids.length;
    const { games, wins, expected } = elo.partner;
    const winRatio = nanMatrix(n), chemistry = nanMatrix(n), chemistryPerGame = nanMatrix(n);
    for (let c = 0; c < n * n; c++) {
      if (!games[c]) continue;
      winRatio[c] = wins[c] / games[c];
      chemistry[c] = wins[c] - expected[c];
      chemistryPerGame[c] = chemistry[c] / games[c];
    }
    return { games, wins, winRatio, chemistry, chemistryPerGame };
  },
};
