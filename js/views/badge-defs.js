// Abzeichen: names, conditions and pictures (the logic is in core/achievements.js).
// Every text says what counts (scope) so the rules are transparent. Thresholds come from config.
import * as fmt from '../ui/format.js';
import { BADGES } from '../core/achievements.js';

export const CATEGORIES = ['Meilensteine', 'Serien', 'Riesentöter', 'Rang und Elo', 'Duelle', 'Doppel', 'Zeit', 'Kurios'];
export const SCOPE = {
  beide: 'Einzel und Doppel',
  einzel: 'nur Einzel',
  doppel: 'nur Doppel',
  formular: 'Einzel und Doppel, nur Formulareinträge',
};

const pl = (n, one, many) => `${fmt.int(n)} ${n === 1 ? one : many}`;

/**
 * id → { name, cat, scope, motif, cond(cfg, threshold) → text for one level, unit(v) → progress text,
 *        note?: extra rule shown in the (i), period?: awarded at the end of a period }
 */
export const DEFS = {
  games:        { name: 'Stammgast', cat: 'Meilensteine', scope: 'beide', motif: 'ball',
    cond: (c, L) => `${pl(L, 'Spiel', 'Spiele')} gespielt`, unit: v => pl(v, 'Spiel', 'Spiele') },
  days:         { name: 'Spieltage', cat: 'Meilensteine', scope: 'beide', motif: 'calendar',
    cond: (c, L) => `an ${pl(L, 'Tag', 'Tagen')} gespielt`, unit: v => pl(v, 'Tag', 'Tage') },
  weeks:        { name: 'Treue', cat: 'Meilensteine', scope: 'beide', motif: 'chain',
    cond: (c, L) => `${pl(L, 'Kalenderwoche', 'Kalenderwochen')} in Folge mit mindestens einem Spiel`, unit: v => `längste Folge: ${pl(v, 'Woche', 'Wochen')}` },
  opponents:    { name: 'Gegnerjäger', cat: 'Meilensteine', scope: 'beide', motif: 'target',
    cond: (c, L) => `${pl(L, 'verschiedenen Gegner', 'verschiedene Gegner')} besiegt`, unit: v => pl(v, 'Gegner', 'Gegner') + ' besiegt',
    note: 'Ein Doppelsieg zählt gegen beide Gegner.' },
  all_beaten:   { name: 'Alle besiegt', cat: 'Meilensteine', scope: 'beide', motif: 'globe',
    cond: c => `jeden besiegt, gegen den du je gespielt hast (mindestens ${c.achievement_all_beaten_min} Gegner)`,
    unit: (v, x) => `${fmt.int(v)} von ${fmt.int(x.all_beaten_of || 0)} Gegnern besiegt`, note: 'Ein Doppelsieg zählt gegen beide Gegner.' },
  each_five:    { name: 'Jeden fünfmal', cat: 'Meilensteine', scope: 'einzel', motif: 'stack',
    cond: c => `gegen jeden Gegner mit mindestens ${c.achievement_each_min_games} Einzeln mindestens ${c.achievement_each_wins} Siege (mindestens ${c.achievement_all_beaten_min} solche Gegner)`,
    unit: (v, x) => `${fmt.int(v)} von ${fmt.int(x.each_five_of || 0)} Gegnern geschafft` },
  win_streak:   { name: 'Siegesserie', cat: 'Serien', scope: 'beide', motif: 'flame',
    cond: (c, L) => `${L} Siege in Folge`, unit: v => `beste Serie: ${v}` },
  comeback:     { name: 'Comeback', cat: 'Serien', scope: 'beide', motif: 'arrowup',
    cond: c => `Sieg direkt nach mindestens ${c.achievement_comeback_losses} Niederlagen in Folge` },
  subscription: { name: 'Abo', cat: 'Serien', scope: 'einzel', motif: 'repeat',
    cond: c => `${c.achievement_subscription_wins} Siege in Folge gegen denselben Gegner`, unit: v => `beste Folge: ${v}` },
  perfect_week: { name: 'Perfekte Woche', cat: 'Serien', scope: 'beide', motif: 'star',
    cond: c => `${c.achievement_perfect_week_wins} Siege in einer Kalenderwoche, ohne Niederlage bis dahin`, unit: v => `bisher bestes: ${pl(v, 'Sieg', 'Siege')} ohne Niederlage`,
    note: 'Zählt mit dem entscheidenden Sieg. Eine spätere Niederlage in derselben Woche ändert nichts mehr.' },
  beat_leader:  { name: 'Platz 1 besiegt', cat: 'Riesentöter', scope: 'beide', motif: 'crownx',
    cond: () => 'Sieg gegen den, der in diesem Moment auf Platz 1 stand', note: 'Im Doppel reicht es, wenn Platz 1 im gegnerischen Team war.' },
  regicide:     { name: 'Königsmord', cat: 'Riesentöter', scope: 'beide', motif: 'crown',
    cond: () => 'Platz 1 besiegt und mit diesem Spiel selbst Platz 1 geworden' },
  giant:        { name: 'Riesentöter', cat: 'Riesentöter', scope: 'beide', motif: 'target',
    cond: (c, L) => `Sieg mit einer Siegchance von höchstens ${fmt.pct(L)}`, unit: v => `bester Sieg: ${fmt.dec1(100 * v)}\u00a0% Siegchance`,
    note: 'Im Doppel zählt die Siegchance des Teams.' },
  underdog:     { name: 'Außenseiter-Serie', cat: 'Riesentöter', scope: 'beide', motif: 'bolt',
    cond: c => `${c.achievement_underdog_streak} Siege in Folge, jeweils als Außenseiter (Siegchance unter 50 %)`, unit: v => `beste Folge: ${v}` },
  unlucky:      { name: 'Pechvogel', cat: 'Riesentöter', scope: 'beide', motif: 'rain',
    cond: c => `ein Spiel mit einer Siegchance von mindestens ${fmt.pct(c.achievement_unlucky_chance)} verloren`, note: 'Augenzwinkernd: Auch das gehört dazu.' },
  podium:       { name: 'Aufs Podest', cat: 'Rang und Elo', scope: 'beide', motif: 'podium',
    cond: c => `erstmals unter den besten ${c.achievement_podium_rank}`, unit: v => `bester Platz: ${v}` },
  leader:       { name: 'Spitzenreiter', cat: 'Rang und Elo', scope: 'beide', motif: 'crown',
    cond: () => 'erstmals Platz 1', unit: v => `bester Platz: ${v}`, note: 'Zählt auch, wenn man ohne eigenes Spiel nach oben rückt.' },
  throne:       { name: 'Thron', cat: 'Rang und Elo', scope: 'beide', motif: 'throne',
    cond: (c, L) => `${pl(L, 'Tag', 'Tage')} am Stück auf Platz 1`, unit: v => `längste Zeit: ${pl(Math.floor(v), 'Tag', 'Tage')}`,
    note: 'Zählt auch an Tagen ohne Spiel. Wer länger nicht spielt, verliert Platz 1 nach der Inaktivitätsfrist.' },
  elo:          { name: 'Elo-Meilenstein', cat: 'Rang und Elo', scope: 'beide', motif: 'mountain',
    cond: (c, L) => `Elo-Wert ${fmt.elo(L)} erreicht`, unit: v => `höchster Wert: ${fmt.elo(v)}` },
  rocket:       { name: 'Rakete', cat: 'Rang und Elo', scope: 'beide', motif: 'rocket',
    cond: c => `+${fmt.int(c.achievement_rocket_points)} Elo-Punkte innerhalb einer Kalenderwoche`, unit: v => `beste Woche: ${fmt.signed(v)}`,
    note: 'Zählt in dem Moment, in dem der Zuwachs seit Montag erreicht ist, als hätte man danach aufgehört. Spätere Verluste ändern nichts.' },
  rising_star:  { name: 'Aufsteiger der Woche', cat: 'Rang und Elo', scope: 'beide', motif: 'arrowup', period: true,
    cond: (c, L) => `${L === 1 ? 'einmal' : `${L}-mal`} Aufsteiger einer Kalenderwoche`, unit: v => `${v}-mal`,
    note: c => `Wird erst vergeben, wenn die Woche vorbei ist (Montag 0 Uhr): meiste Elo-Punkte von Montag bis Sonntag, mit mindestens ${c.rising_star_min_games} Spielen in dieser Woche und mindestens ${c.achievement_rank_min_games} Spielen insgesamt. Alle Gewinner stehen in der Ruhmeshalle.` },
  nemesis:      { name: 'Angstgegner bezwungen', cat: 'Duelle', scope: 'einzel', motif: 'shield',
    cond: () => 'im Einzel gegen den gewonnen, der in diesem Moment dein Angstgegner war', note: 'Der Angstgegner ergibt sich wie im Profil aus allen Begegnungen.' },
  revenge:      { name: 'Revanche', cat: 'Duelle', scope: 'einzel', motif: 'swords',
    cond: () => 'im Einzel gewonnen gegen den, gegen den du zuletzt verloren hattest' },
  balanced:     { name: 'Ausgeglichen', cat: 'Duelle', scope: 'einzel', motif: 'scale',
    cond: (c, L) => `positive Einzelbilanz gegen ${pl(L, 'Gegner', 'Gegner')} (je mindestens ${c.h2h_min_games} Einzel)`, unit: v => pl(v, 'Gegner', 'Gegner') },
  duel:         { name: 'Ewiges Duell', cat: 'Duelle', scope: 'einzel', motif: 'infinity',
    cond: (c, L) => `${L} Einzel gegen denselben Gegner`, unit: v => `meiste: ${v}` },
  team_player:  { name: 'Teamplayer', cat: 'Doppel', scope: 'doppel', motif: 'bats2',
    cond: (c, L) => `Doppelsiege mit ${pl(L, 'Partner', 'verschiedenen Partnern')}`, unit: v => pl(v, 'Partner', 'Partner') },
  dream_team:   { name: 'Traumpaar', cat: 'Doppel', scope: 'doppel', motif: 'heart',
    cond: c => `${c.achievement_dream_team_wins} Doppelsiege mit demselben Partner`, unit: v => `meiste: ${v}` },
  king_single:  { name: 'Einzelkönig', cat: 'Doppel', scope: 'einzel', motif: 'crown',
    cond: () => 'Platz 1 in der Wertung „Einzel“' },
  king_double:  { name: 'Doppelkönig', cat: 'Doppel', scope: 'doppel', motif: 'crown',
    cond: () => 'Platz 1 in der Wertung „Doppel“' },
  early:        { name: 'Frühaufsteher', cat: 'Zeit', scope: 'formular', motif: 'sun',
    cond: c => `ein Spiel vor ${c.achievement_early_hour} Uhr` },
  late:         { name: 'Feierabend', cat: 'Zeit', scope: 'formular', motif: 'moon',
    cond: c => `ein Spiel nach ${c.achievement_late_hour} Uhr` },
  marathon:     { name: 'Marathon', cat: 'Zeit', scope: 'formular', motif: 'clock',
    cond: c => `${c.achievement_marathon_games} Spiele in einer Session (Pausen höchstens ${c.session_gap_minutes} Minuten)`, unit: v => `längste Session: ${pl(v, 'Spiel', 'Spiele')}` },
  busy_day:     { name: 'Dauerbrenner', cat: 'Zeit', scope: 'formular', motif: 'flame',
    cond: c => `${c.achievement_busy_day_games} Spiele an einem Tag`, unit: v => `meiste an einem Tag: ${v}` },
  all_weekdays: { name: 'Ganze Woche', cat: 'Zeit', scope: 'formular', motif: 'calendar',
    cond: () => 'an allen fünf Wochentagen gespielt (irgendwann)', unit: v => `${v} von 5 Wochentagen` },
  lucky:        { name: 'Schnapszahl', cat: 'Kurios', scope: 'beide', motif: 'dice',
    cond: c => `Elo-Wert landet gerundet auf ${c.achievement_lucky_numbers.map(fmt.elo).join(', ')}` },
  even:         { name: 'Gleichstand', cat: 'Kurios', scope: 'beide', motif: 'scale',
    cond: c => `genau so viele Siege wie Niederlagen, nach mindestens ${c.achievement_balance_min_games} Spielen` },
  jubilee:      { name: 'Jubiläum', cat: 'Kurios', scope: 'beide', motif: 'trophy',
    cond: c => `das ${c.achievement_jubilee_games}. Spiel gewonnen`, unit: (v, x, c) => (v < c.achievement_jubilee_games ? `${fmt.int(v)} von ${c.achievement_jubilee_games} Spielen` : 'verpasst') },
};

export const ORDER = Object.keys(DEFS);

/** Tier name of level l (1-based): from config, „Stufe n“ beyond the list. */
export const tierName = (cfg, l) => cfg.achievement_tier_names?.[l - 1] ?? `Stufe ${l}`;

/** Label of an earned level, e.g. „Stammgast · Bundesliga“ (badges without levels: just the name). */
export function badgeLabel(cfg, badge, level) {
  return badgeHasLevels(badge) ? `${DEFS[badge].name} · ${tierName(cfg, level)}` : DEFS[badge].name;
}
export const badgeHasLevels = b => !!BADGES[b]?.levels;

/**
 * Progress of one player towards the next level of a badge.
 * @returns {{ level, next: number|null, ratio: number, text: string }}  ratio in [0, 1] (1 = all levels done)
 */
export function progressOf(cfg, levels, badge, p) {   // levels = result.levels
  const level = p.level[badge] || 0;
  const L = levels[badge];
  const v = p.value[badge];
  const def = DEFS[badge];
  const lower = badge === 'giant';
  if (level >= L.length && (badgeHasLevels(badge) || level >= 1)) return { level, next: null, ratio: 1, text: '' };
  const next = badgeHasLevels(badge) ? L[level] : null;
  let ratio = 0;
  if (v != null && next != null) ratio = lower ? Math.min(1, (1 - v) / (1 - next)) : Math.min(1, v / next);
  else if (v != null) {
    const target = { all_beaten: p.value.all_beaten_of, each_five: p.value.each_five_of, subscription: cfg.achievement_subscription_wins,
      perfect_week: cfg.achievement_perfect_week_wins, underdog: cfg.achievement_underdog_streak, dream_team: cfg.achievement_dream_team_wins,
      marathon: cfg.achievement_marathon_games, busy_day: cfg.achievement_busy_day_games, all_weekdays: 5, jubilee: cfg.achievement_jubilee_games,
      rocket: cfg.achievement_rocket_points }[badge];
    const rankTarget = { podium: cfg.achievement_podium_rank, leader: 1 }[badge];
    if (rankTarget) ratio = Math.min(1, rankTarget / v);
    else if (target) ratio = Math.max(0, Math.min(1, v / target));
    if (badge === 'jubilee' && v >= cfg.achievement_jubilee_games) ratio = 0;
  }
  const text = def.unit && v != null ? def.unit(v, p.value, cfg) : '';
  return { level, next, ratio, text };
}

/** ISO calendar week of a serial (Monday-based), e.g. { week: 47, year: 2026 }. */
export function isoWeek(serial) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  const day = (d.getUTCDay() + 6) % 7;                 // Monday = 0
  d.setUTCDate(d.getUTCDate() - day + 3);              // Thursday of this week decides the year
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return { week, year: d.getUTCFullYear() };
}

/** Everything the pages show about one badge across players (pure). */
export function badgeStats(A, badge) {
  const holders = [];
  for (const [id, p] of A.players) {
    const lv = p.level[badge] || 0;
    if (lv > 0) {
      const first = p.earned.find(e => e.badge === badge);
      const top = p.earned.filter(e => e.badge === badge).at(-1);
      holders.push({ id, level: lv, first: first.t, top: top.t, g: first.g, topG: top.g });
    }
  }
  holders.sort((a, b) => b.level - a.level || a.top - b.top);
  const perLevel = A.levels[badge].map((_, i) => holders.filter(x => x.level > i).length);
  return { holders, perLevel };
}

/** Number of earned levels (the Sammler count). */
export const earnedCount = p => p?.earned.length || 0;
/** Number of levels there are in total. */
export const totalLevels = A => ORDER.reduce((s, b) => s + (A.levels[b]?.length || 1), 0);

/** The extra rule of a badge as text (some depend on config). */
export const noteOf = (cfg, b) => (typeof DEFS[b].note === 'function' ? DEFS[b].note(cfg) : DEFS[b].note || null);
