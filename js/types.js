// JSDoc typedefs only — the written-down interfaces between modules. Nothing runs here.

/**
 * Cell grids from one Sheets batchGet (UNFORMATTED_VALUE, SERIAL_NUMBER).
 * Row 0 = header row. Rows may be shorter than the header (trailing empties omitted).
 * A missing tab is undefined or [].
 * @typedef {Object} RawSheets
 * @property {any[][]} [config]
 * @property {any[][]} [legacy]
 * @property {any[][]} [spiele]
 * @property {any[][]} [players]
 * @property {any[][]} [aliases]
 * @property {any[][]} [corrections]
 */

/**
 * Typed values of the `config` tab, defaults filled in.
 * @typedef {Object} AppConfig
 * @property {number|null} responses_valid_from  sheet serial (days), null if unset
 * @property {number} k_single
 * @property {number} k_double
 * @property {number} start_rating
 * @property {boolean} asymptotic_init
 * @property {number} asymptotic_init_rounds
 * @property {number} default_min_games
 * @property {number} default_min_games_single
 * @property {number} default_min_games_double
 * @property {number} default_inactivity_days
 */

/**
 * @typedef {Object} Player
 * @property {string} id       e.g. "p007"
 * @property {string} name     current display_name
 * @property {boolean} active
 * @property {string[]} accounts  Google-account e-mail addresses (lowercase), from players.google_accounts
 */

/**
 * One valid game, after cutoff, corrections, ID mapping and validation.
 * @typedef {Object} Game
 * @property {number} g            global index in sorted order, 0-based
 * @property {number} t            sheet serial (days since 1899-12-30, sheet-local wall-clock)
 * @property {string} ref          "yyyy-mm-dd hh:mm:ss", matches corrections.game_ref
 * @property {'legacy'|'spiele'} source
 * @property {number} row          sheet row number in its source tab (header = row 1)
 * @property {string[]} winners    player IDs, length 1 (singles) or 2 (doubles)
 * @property {string[]} losers     player IDs, same length as winners
 * @property {boolean} double
 * @property {boolean} approxTime  true for legacy (interpolated timestamps)
 * @property {number} [sourceRow]  legacy only: row in legacy_raw
 * @property {boolean} [corrected] result swapped by a `corrections` row
 */

/**
 * @typedef {Object} Issue
 * @property {'error'|'warning'} level
 * @property {string} kind      missing_column | bad_config | missing_config | missing_cutoff | bad_timestamp |
 *                              unknown_name | invalid_game | duplicate_player | bad_correction |
 *                              unmatched_correction | ambiguous_correction | bad_alias |
 *                              legacy_after_cutoff
 * @property {string} message   German, for the UI
 * @property {string} [tab]
 * @property {number} [row]
 * @property {string} [ref]
 * @property {string} [name]
 * @property {number} [count]
 */

/**
 * @typedef {Object} LoadCounts
 * @property {number} legacyRows    non-empty data rows in `legacy`
 * @property {number} spieleRows    non-empty data rows in `Spiele`
 * @property {number} beforeCutoff  Spiele rows dropped as test data
 * @property {number} voided
 * @property {number} swapped
 * @property {number} skipped       rows dropped because of an issue
 * @property {number} games         valid games in Dataset.games
 */

/**
 * Output of core/loader.js.
 * @typedef {Object} Dataset
 * @property {AppConfig} config
 * @property {Map<string, Player>} players
 * @property {Game[]} games
 * @property {Issue[]} issues
 * @property {LoadCounts} counts
 * @property {string} hash     changes whenever games (IDs, times), players or config change
 */

/**
 * Output of core/elo.js. k = player index (position in ids). Matrices are n×n Float64Array,
 * row-major: M[i*n + j] (use `at(elo, M, i, j)`). Doubles count ½ per winner–loser pair.
 * @typedef {Object} EloResult
 * @property {{k_single:number,k_double:number,start_rating:number,asymptotic_init:boolean,asymptotic_init_rounds:number}} settings
 * @property {string[]} ids                 players with ≥ 1 game, sorted by ID
 * @property {Map<string, number>} index    id → k
 * @property {Int32Array} slots             per game [w1, w2, l1, l2] as k, −1 for empty (singles)
 * @property {Float64Array} start           start rating per player (start_rating or asymptotic init)
 * @property {Float64Array} final           rating after all games
 * @property {Object} perGame               per global game index g (length = games.length):
 * @property {Float64Array} perGame.rW      winning side rating before (team mean in doubles)
 * @property {Float64Array} perGame.rL      losing side rating before
 * @property {Float64Array} perGame.eW      pre-game expected score of the winning side (losers: 1 − eW)
 * @property {Float64Array} perGame.delta   Elo each winner gained = each loser lost
 * @property {Float64Array} perGame.before  per slot (4 per game, as `slots`): own rating before, NaN if empty
 * @property {{g: Int32Array, r: Float64Array}[]} history  per player: rating after each own game
 * @property {Int32Array} played
 * @property {Int32Array} wins
 * @property {Int32Array} losses
 * @property {Int32Array} singles           games played as singles
 * @property {Int32Array} doubles           games played as doubles
 * @property {Int32Array} firstG            global index of first game
 * @property {Int32Array} lastG             global index of last game
 * @property {{matchups: Float64Array, wins: Float64Array, transfer: Float64Array, expected: Float64Array}} pair
 *   matchups symmetric; wins[i,j] = wins of i over j; transfer[i,j] = Elo i won from j (antisymmetric);
 *   expected[i,j] = sum of i's pre-game expected scores against j (so wins − expected = actual vs expected)
 * @property {{games: Float64Array, wins: Float64Array, expected: Float64Array}} partner
 *   doubles only, symmetric: games and wins together, sum of the team's pre-game expected scores
 */

export {};
