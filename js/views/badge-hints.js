// „Was fehlt“: what a player can do next for one badge, from the state now (PURE, no DOM).
// Shown folded on the badge page. It explains, it never changes a badge: earned badges stay.
//
//   hintsFor(cfg, A, badge, id, { nameOf, ratingOf, isActive, activeIds }) →
//     null (nothing useful to add) or { lines: [text], groups: [{ title, rows: [{ id, text, done, link: 'h2h'|'team' }] }] }
import * as fmt from '../ui/format.js';
import { winProbability } from '../core/elo.js';
import { tierName } from './badge-defs.js';

const pl = (n, one, many) => `${fmt.int(n)} ${n === 1 ? one : many}`;
const half = x => (Number.isInteger(x) ? fmt.int(x) : fmt.dec1(x));   // Begegnungen: a doubles game counts half
const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];

export function hintsFor(cfg, A, b, id, env) {
  const p = A.players.get(id), d = A.detail(id);
  if (!p || !d) return null;
  const L = A.levels[b], lv = p.level[b] || 0;
  if (lv >= L.length) return null;                     // everything earned: nothing is missing
  const next = L[lv];                                  // threshold of the next level
  const target = L.length > 1 ? `${tierName(cfg, lv + 1)}` : null;
  const lines = [], groups = [];
  const { nameOf, ratingOf, isActive, activeIds } = env;
  const opp = d.opponents;
  const byName = (x, y) => nameOf(x.id).localeCompare(nameOf(y.id), 'de');
  const row = (o, text, done = false, link = 'h2h') => ({ id: o.id, text, done, link });
  const neverFaced = () => activeIds.filter(j => j !== id && !opp.some(o => o.id === j));
  const inactive = o => (isActive(o.id) ? '' : ' (inaktiv)');
  const ranked = d.rank != null;
  const rankLine = () => (ranked ? `Gerade Platz ${d.rank}.`
    : `Gerade nicht gewertet: Es braucht ${d.rankedGames} Spiele und ein Spiel in den letzten ${d.rankedDays} Tagen.`);
  const top = A.ranking[0];

  switch (b) {
    case 'weeks': {
      if (d.playedThisWeek) lines.push(`Folge gerade: ${pl(d.weekStreak, 'Woche', 'Wochen')}, diese Woche zählt schon.`);
      else if (d.weekStreak) lines.push(`Folge gerade: ${pl(d.weekStreak, 'Woche', 'Wochen')}. Ein Spiel bis Sonntag hält sie am Leben.`);
      else lines.push('Gerade läuft keine Folge. Ein Spiel diese Woche beginnt eine neue.');
      break;
    }
    case 'opponents': {
      lines.push(`Für ${target}: ${pl(next, 'Gegner', 'verschiedene Gegner')} besiegen, bisher ${opp.filter(o => o.beaten).length}.`);
      groups.push({ title: 'Noch nicht besiegt', rows: opp.filter(o => !o.beaten).sort(byName).map(o => row(o, `${half(o.meetings)} Begegnungen${inactive(o)}`)) });
      groups.push({ title: 'Noch nie gegeneinander gespielt', rows: neverFaced().map(j => ({ id: j, text: 'ein Sieg zählt sofort', done: false, link: 'h2h' })) });
      groups.push({ title: 'Schon besiegt', rows: opp.filter(o => o.beaten).sort(byName).map(o => row(o, '', true)) });
      break;
    }
    case 'all_beaten': {
      const faced = opp.length, min = cfg.achievement_all_beaten_min;
      if (faced < min) lines.push(`Es braucht mindestens ${pl(min, 'Gegner', 'Gegner')}, bisher ${faced}. Jeder neue Gegner zählt mit, sobald ihr gespielt habt.`);
      lines.push('Jeder bisherige Gegner muss einmal besiegt sein. Ein Doppelsieg zählt gegen beide.');
      groups.push({ title: 'Noch nicht besiegt', rows: opp.filter(o => !o.beaten).sort(byName).map(o => row(o, `${half(o.meetings)} Begegnungen${inactive(o)}`)) });
      break;
    }
    case 'each_five': {
      const need = cfg.achievement_each_wins, minG = cfg.achievement_each_min_games;
      const counted = opp.filter(o => o.singles >= minG), later = opp.filter(o => o.singles > 0 && o.singles < minG);
      if (counted.length < cfg.achievement_all_beaten_min) lines.push(`Es braucht mindestens ${cfg.achievement_all_beaten_min} Gegner mit je ${minG} Einzeln, bisher ${counted.length}.`);
      lines.push(`Ein Gegner zählt ab ${minG} Einzeln. Ab dann braucht es ${need} Siege gegen diesen Gegner. Wer dazukommt, kann das Abzeichen also auch schwerer machen.`);
      groups.push({ title: `Zählen schon (ab ${minG} Einzeln)`, rows: counted.sort((x, y) => (x.singleWins >= need) - (y.singleWins >= need) || y.singleWins - x.singleWins)
        .map(o => row(o, `${Math.min(o.singleWins, need)} von ${need} Siegen · ${o.singles} Einzel`, o.singleWins >= need)) });
      groups.push({ title: `Zählen noch nicht (unter ${minG} Einzeln)`, rows: later.sort((x, y) => y.singles - x.singles)
        .map(o => row(o, `${o.singles} Einzel, ${pl(o.singleWins, 'Sieg', 'Siege')}${o.singleWins >= need ? ', schon genug Siege' : ''}`, o.singleWins >= need)) });
      break;
    }
    case 'win_streak':
      lines.push(d.winStreak ? `Serie gerade: ${pl(d.winStreak, 'Sieg', 'Siege')} in Folge. ${target}: ${next}.` : `Gerade läuft keine Siegesserie. ${target}: ${next} Siege in Folge.`);
      break;
    case 'comeback': {
      const n = cfg.achievement_comeback_losses;
      lines.push(d.lossStreak >= n ? `Gerade ${d.lossStreak} Niederlagen in Folge. Der nächste Sieg bringt das Abzeichen.`
        : `Gerade ${pl(d.lossStreak, 'Niederlage', 'Niederlagen')} in Folge. Das Comeback braucht erst ${n}.`);
      break;
    }
    case 'subscription': {
      const n = cfg.achievement_subscription_wins;
      lines.push(`${n} Einzelsiege in Folge gegen denselben Gegner. Eine Niederlage gegen diesen Gegner setzt die Folge zurück.`);
      groups.push({ title: 'Laufende Folgen', rows: opp.filter(o => o.abo > 0).sort((x, y) => y.abo - x.abo).map(o => row(o, `${o.abo} von ${n}`)) });
      break;
    }
    case 'perfect_week': {
      const n = cfg.achievement_perfect_week_wins;
      if (!d.week) lines.push(`Diese Woche noch kein Spiel. Es braucht ${n} Siege vor der ersten Niederlage.`);
      else if (d.week.lost) lines.push('Diese Woche gab es schon eine Niederlage. Am Montag geht es von vorne los.');
      else lines.push(`Diese Woche: ${pl(d.week.wins, 'Sieg', 'Siege')}, noch keine Niederlage. Es fehlen ${n - d.week.wins}.`);
      break;
    }
    case 'beat_leader':
    case 'regicide': {
      if (!top) { lines.push('Gerade steht niemand auf Platz 1.'); break; }
      if (top.id === id) { lines.push('Selbst gerade Platz 1.'); break; }
      const pW = winProbability(d.rating, top.rating);
      lines.push(`Gerade auf Platz 1: ${nameOf(top.id)} (${fmt.elo(top.rating)}). Siegchance im Einzel: ${fmt.pct(pW)}.`);
      if (b === 'regicide') {
        if (!ranked) { lines.push(rankLine()); break; }
        const delta = cfg.k_single * (1 - pW);
        const others = A.ranking.filter(r => r.id !== id && r.id !== top.id).map(r => r.rating);
        const mine = d.rating + delta, best = Math.max(top.rating - delta, ...others);
        lines.push(mine > best ? `Ein Einzelsieg gegen ${nameOf(top.id)} brächte Platz 1 (+${fmt.int(Math.round(delta))}).`
          : `Ein Einzelsieg brächte +${fmt.int(Math.round(delta))}. Für Platz 1 fehlten dann noch ${fmt.int(Math.ceil(best - mine))} Punkte.`);
      }
      break;
    }
    case 'giant': {
      lines.push(`${target}: ein Sieg mit höchstens ${fmt.pct(next)} Siegchance. So steht es im Einzel mit den Elo-Werten von heute:`);
      const rows = activeIds.filter(j => j !== id).map(j => ({ id: j, p: winProbability(d.rating, ratingOf(j)) }))
        .filter(x => x.p <= next).sort((x, y) => x.p - y.p);
      if (!rows.length) lines.push('Gerade ist niemand so viel stärker. Im Doppel zählt die Siegchance des Teams.');
      groups.push({ title: 'Gegner, bei denen ein Sieg zählt', rows: rows.map(x => ({ id: x.id, text: `Siegchance ${fmt.pct(x.p)}`, done: false, link: 'h2h' })) });
      break;
    }
    case 'underdog':
      lines.push(`${cfg.achievement_underdog_streak} Siege in Folge, jeweils mit Siegchance unter 50 %. Gerade: ${d.underdog}.`);
      break;
    case 'unlucky': {
      const rows = activeIds.filter(j => j !== id).map(j => ({ id: j, p: winProbability(d.rating, ratingOf(j)) }))
        .filter(x => x.p >= cfg.achievement_unlucky_chance).sort((x, y) => y.p - x.p);
      lines.push(rows.length ? 'Hier droht es (Einzel, Siegchance heute):' : 'Gerade gegen niemanden so klarer Favorit.');
      groups.push({ title: 'Gegner', rows: rows.map(x => ({ id: x.id, text: `Siegchance ${fmt.pct(x.p)}`, done: false, link: 'h2h' })) });
      break;
    }
    case 'podium':
    case 'leader': {
      lines.push(rankLine());
      const want = b === 'podium' ? cfg.achievement_podium_rank : 1;
      if (ranked && A.ranking[want - 1] && d.rank > want) lines.push(`Bis Platz ${want} fehlen ${fmt.int(Math.ceil(A.ranking[want - 1].rating - d.rating))} Punkte.`);
      break;
    }
    case 'throne': {
      const r = A.reigns.find(x => x.current);
      if (r?.id === id) lines.push(`Seit ${pl(Math.floor(r.days), 'Tag', 'Tagen')} auf Platz 1. ${target}: ${pl(next, 'Tag', 'Tage')}. Platz 1 geht nach ${d.rankedDays} Tagen ohne Spiel verloren.`);
      else { lines.push(rankLine()); if (top && ranked) lines.push(`Bis Platz 1 fehlen ${fmt.int(Math.ceil(top.rating - d.rating))} Punkte.`); }
      break;
    }
    case 'elo':
      lines.push(`Elo-Wert gerade: ${fmt.elo(d.rating)}. Bis ${fmt.elo(next)} fehlen ${fmt.int(Math.ceil(next - d.rating))} Punkte.`);
      break;
    case 'rocket':
      lines.push(d.week ? `Diese Woche: ${fmt.signed(d.week.gain)} Elo-Punkte. Es fehlen ${fmt.int(Math.ceil(cfg.achievement_rocket_points - d.week.gain))}.`
        : `Diese Woche noch kein Spiel. Gezählt wird ab dem ersten Spiel der Woche.`);
      break;
    case 'rising_star': {
      const r = A.running;
      lines.push(d.week ? `Diese Woche: ${fmt.signed(d.week.gain)} aus ${pl(d.week.games, 'Spiel', 'Spielen')} (nötig: ${cfg.rising_star_min_games}).` : 'Diese Woche noch kein Spiel.');
      if (r?.id && r.id !== id) lines.push(`Es führt ${nameOf(r.id)} mit ${fmt.signed(r.gain)}.`);
      else if (r?.id === id) lines.push('Führt diese Woche. Entschieden wird am Montag um 0 Uhr.');
      if (!ranked && d.played < d.rankedGames) lines.push(`Außerdem braucht es ${d.rankedGames} Spiele insgesamt.`);
      break;
    }
    case 'month_riser': {
      const r = A.runningMonth;
      lines.push(d.month ? `Diesen Monat: ${fmt.signed(d.month.gain)} aus ${pl(d.month.games, 'Spiel', 'Spielen')} (nötig: ${cfg.monthly_min_games}).` : 'Diesen Monat noch kein Spiel.');
      if (r?.riser && r.riser.id !== id) lines.push(`Es führt ${nameOf(r.riser.id)} mit ${fmt.signed(r.riser.gain)}.`);
      else if (r?.riser?.id === id) lines.push('Führt diesen Monat. Entschieden wird am Monatsende.');
      if (!ranked && d.played < d.rankedGames) lines.push(`Außerdem braucht es ${d.rankedGames} Spiele insgesamt.`);
      break;
    }
    case 'month_leader': {
      lines.push(rankLine());
      if (top?.id === id) lines.push('Gerade auf Platz 1. Zählt, wer am letzten Tag des Monats um Mitternacht vorne liegt.');
      else if (top && ranked) lines.push(`Bis Platz 1 fehlen ${fmt.int(Math.ceil(top.rating - d.rating))} Punkte. Entschieden wird am Monatsende.`);
      break;
    }
    case 'nemesis': {
      if (!d.nemesis) { lines.push(`Noch kein Angstgegner (es braucht ${cfg.h2h_min_games} Begegnungen mit jemandem).`); break; }
      const o = opp.find(x => x.id === d.nemesis);
      lines.push(`Angstgegner gerade: ${nameOf(d.nemesis)}. Ein Einzelsieg in diesem Duell bringt das Abzeichen.`);
      groups.push({ title: 'Angstgegner', rows: [row(o, `${half(o.meetingWins)} : ${half(o.meetings - o.meetingWins)} in Begegnungen`)] });
      break;
    }
    case 'revenge': {
      const rows = opp.filter(o => o.lostLast).sort(byName).map(o => row(o, 'letztes Einzel verloren'));
      lines.push(rows.length ? 'Gegen diese Gegner ging das letzte Einzel verloren. Der nächste Einzelsieg gegen sie ist eine Revanche.'
        : 'Gerade ist keine Revanche offen.');
      groups.push({ title: 'Revanche offen', rows });
      break;
    }
    case 'balanced': {
      const m0 = cfg.h2h_min_games;
      lines.push(`„Siege fehlen“ heißt: so viele Einzelsiege in Folge gegen diesen Gegner, dann ist die Bilanz positiv und es sind mindestens ${m0} Einzel.`);
      const all = opp.filter(o => o.singles > 0).map(o => {
        const done = o.singles >= m0 && 2 * o.singleWins > o.singles;
        const k = Math.max(o.singles - 2 * o.singleWins + 1, m0 - o.singles, 0);
        return { o, done, k };
      });
      groups.push({ title: 'Noch nicht positiv', rows: all.filter(x => !x.done).sort((x, y) => x.k - y.k)
        .map(x => row(x.o, `${x.o.singleWins} : ${x.o.singles - x.o.singleWins} · ${pl(x.k, 'Sieg fehlt', 'Siege fehlen')}`)) });
      groups.push({ title: 'Positiv', rows: all.filter(x => x.done).sort((x, y) => byName(x.o, y.o)).map(x => row(x.o, `${x.o.singleWins} : ${x.o.singles - x.o.singleWins}`, true)) });
      break;
    }
    case 'duel':
      groups.push({ title: `Meiste Einzel (${target}: ${next})`, rows: opp.filter(o => o.singles > 0).sort((x, y) => y.singles - x.singles).slice(0, 5)
        .map(o => row(o, `${o.singles} Einzel`)) });
      break;
    case 'team_player': {
      lines.push(`${target}: Doppelsiege mit ${pl(next, 'Partner', 'verschiedenen Partnern')}, bisher ${d.partners.length}.`);
      const won = new Set(d.partners.map(x => x.id));
      groups.push({ title: 'Noch kein Doppelsieg zusammen', rows: activeIds.filter(j => j !== id && !won.has(j)).map(j => ({ id: j, text: '', done: false, link: 'team' })) });
      groups.push({ title: 'Schon zusammen gewonnen', rows: d.partners.slice().sort(byName).map(x => ({ id: x.id, text: pl(x.wins, 'Sieg', 'Siege'), done: true, link: 'team' })) });
      break;
    }
    case 'dream_team':
      groups.push({ title: `Doppelsiege pro Partner (nötig: ${cfg.achievement_dream_team_wins})`, rows: d.partners.slice().sort((x, y) => y.wins - x.wins)
        .map(x => ({ id: x.id, text: `${x.wins} von ${cfg.achievement_dream_team_wins}`, done: false, link: 'team' })) });
      break;
    case 'king_single':
    case 'king_double': {
      const R = A.modeRanks[b] || [], i = R.findIndex(r => r.id === id), w = b === 'king_single' ? 'Einzel' : 'Doppel';
      if (i < 0) lines.push(`In der Wertung ${w} gerade nicht gewertet (${d.rankedGames} Spiele dort und ein Spiel in den letzten ${d.rankedDays} Tagen).`);
      else lines.push(`In der Wertung ${w} gerade Platz ${i + 1}.${i > 0 ? ` Bis Platz 1 fehlen ${fmt.int(Math.ceil(R[0].rating - R[i].rating))} Punkte.` : ''}`);
      break;
    }
    case 'all_weekdays': {
      const missing = WEEKDAYS.filter((_, i) => !d.weekdays.includes(i));
      lines.push(`Noch nie gespielt (Formulareinträge): ${missing.join(', ')}.`);
      break;
    }
    case 'lucky': {
      const r = Math.round(d.rating), nums = cfg.achievement_lucky_numbers.slice().sort((x, y) => Math.abs(x - r) - Math.abs(y - r));
      lines.push(`Elo-Wert gerade: ${fmt.elo(r)}. Die nächste Schnapszahl ist ${fmt.elo(nums[0])} (${fmt.int(Math.abs(nums[0] - r))} Punkte ${nums[0] > r ? 'darüber' : 'darunter'}).`);
      break;
    }
    case 'even': {
      const diff = d.wins - d.losses;
      if (d.played < cfg.achievement_balance_min_games) lines.push(`Zählt erst ab ${cfg.achievement_balance_min_games} Spielen, bisher ${d.played}.`);
      lines.push(diff === 0 ? 'Die Bilanz ist gerade genau ausgeglichen.'
        : `Bilanz ${d.wins} : ${d.losses}. Für den Gleichstand braucht es ${pl(Math.abs(diff), diff > 0 ? 'Niederlage' : 'Sieg', diff > 0 ? 'Niederlagen' : 'Siege')} mehr.`);
      break;
    }
    case 'jubilee': {
      const n = cfg.achievement_jubilee_games;
      if (d.played >= n) return null;
      lines.push(`Noch ${pl(n - d.played, 'Spiel', 'Spiele')} bis zum ${n}. Spiel. Das muss ein Sieg werden.`);
      break;
    }
    default:
      return null;    // pure counts (Stammgast, Spieltage, Marathon …): the bar says it all
  }
  const gs = groups.filter(g => g.rows.length);
  return lines.length || gs.length ? { lines, groups: gs } : null;
}
