// Card specs for sharing (ui/cards.js draws them): Spielerprofil, Spiel, Rangliste, a player's Abzeichen; since
// Phase 20 also Direktvergleich, Serie, Rekorde, Überraschung, Aufsteiger, Monatssieger and Turniersieg. The result
// comes first (big number, title), badges small and second; every card says who, what and when.
// They show the current Wertung (named in the kicker when it isn't „Alle“); Abzeichen always count all games.
import * as fmt from '../ui/format.js';
import { DEFS, badgeLabel, badgeHasLevels, earnedCount, totalLevels } from './badge-defs.js';
import { gameFacts } from './game-query.js';
import { yearWindow } from './review-logic.js';
import { serialToParts } from '../core/normalize.js';
import { findGame } from './game-query.js';
import { monthLabel } from '../core/window.js';
import { isoWeek } from './badge-defs.js';

const WERTUNG = { alle: '', einzel: ' · Wertung Einzel', doppel: ' · Wertung Doppel' };
const nameOf = (ctx, id) => ctx.names.get(id) ?? id;

export const medalSpec = (cfg, e) => ({ motif: DEFS[e.badge].motif, level: badgeHasLevels(e.badge) ? e.level : -1, title: badgeLabel(cfg, e.badge, e.level) });

/** Platz in the current Wertung with the current filters, as on the Übersicht. */
export function placeOf(ctx, k) {
  const ranked = ctx.model.stats.get('leaderboard').filter(r => ctx.visible.isShown(r.k)).map(r => r.k);
  const pos = ranked.indexOf(k);
  return pos < 0 ? null : { pos: pos + 1, of: ranked.length };
}

export function playerSpec(ctx, id) {
  const { model } = ctx, elo = model.elo, k = elo.index.get(id);
  const cfg = model.dataset.config;
  const pl = placeOf(ctx, k);
  const h = elo.history[k];
  // the curve: this calendar year, or the last 50 games if the year has fewer than 10
  const { from } = yearWindow(serialToParts(ctx.now).y);
  let i0 = h.g.findIndex(g => model.dataset.games[g].t >= from);
  if (i0 < 0 || h.g.length - i0 < 10) i0 = Math.max(0, h.g.length - 50);
  const spark = [i0 > 0 ? h.r[i0 - 1] : elo.start[k], ...Array.from(h.r.subarray(i0))];
  const t0 = i0 > 0 ? model.dataset.games[h.g[i0 - 1]].t : model.dataset.games[h.g[0]].t;
  const A = ctx.badges, p = A?.players.get(id);
  const partners = elo.ids.map((pid, j) => ({ pid, games: elo.partner.games[k * elo.ids.length + j], wins: elo.partner.wins[k * elo.ids.length + j] }))
    .filter(x => x.games >= cfg.team_min_games).sort((a, b) => b.wins / b.games - a.wins / a.games);
  return {
    kicker: 'Spielerprofil' + WERTUNG[ctx.mode],
    title: nameOf(ctx, id),
    avatar: faceOf(ctx, id),
    big: fmt.elo(elo.final[k]), bigLabel: 'Elo-Wert',
    sub: [pl ? `Platz ${pl.pos} von ${pl.of}` : null, `${elo.wins[k]} Siege, ${elo.losses[k]} Niederlagen`, `Siegquote ${fmt.pct(elo.wins[k] / elo.played[k])}`].filter(Boolean).join(' · '),
    spark, sparkLabels: [`seit ${fmt.date(t0)}`, 'heute'],
    medals: p ? p.earned.slice(-4).reverse().map(e => medalSpec(cfg, e)) : [],
    lines: partners.length ? [{ label: 'Bester Doppelpartner', value: `${nameOf(ctx, partners[0].pid)} · ${partners[0].wins} : ${partners[0].games - partners[0].wins}` }] : [],
  };
}

/** Phase 18b: loaders for the images on share cards (null without photos). */
function faceOf(ctx, id) {
  const p = ctx.photos?.faces ? ctx.photos.avatar(id) : null;
  return p ? () => ctx.photos.load(p.id, 'thumb') : null;
}
function gamePhoto(ctx, ref) {
  const p = ctx.photos?.on ? ctx.photos.list('spiel', ref)[0] : null;
  return p ? () => ctx.photos.load(p.id, 'full') : null;
}

export function gameSpec(ctx, g) {
  const f = gameFacts(ctx.model, g);
  const x = f.game;
  const W = x.winners.map(id => nameOf(ctx, id)).join(' & '), L = x.losers.map(id => nameOf(ctx, id)).join(' & ');
  const when = x.approxTime ? `ca. ${fmt.date(x.t)}` : `${fmt.date(x.t)}, ${fmt.time(x.t)} Uhr`;
  const upset = f.eW < 0.5 ? ': eine Überraschung' : '';
  const medals = gameMedals(ctx, x.ref, x.winners);
  // Phase 20: from the winner's view when „Ich“ won this game („Sieg gegen Bernd“, my Elo-Punkte first)
  const mine = ctx.me?.id && x.winners.includes(ctx.me.id) ? f.players.find(p => p.id === ctx.me.id) : null;
  if (mine) {
    const partner = x.winners.filter(id => id !== ctx.me.id).map(id => nameOf(ctx, id));
    return {
      kicker: `${nameOf(ctx, ctx.me.id)} · ${x.double ? 'Doppel' : 'Einzel'} · ${when}${WERTUNG[ctx.mode]}`,
      title: `Sieg gegen ${L}${partner.length ? ` (mit ${partner.join(' & ')})` : ''}`,
      photo: gamePhoto(ctx, x.ref), avatar: faceOf(ctx, ctx.me.id),
      big: fmt.signed(mine.delta, 1), tone: 'up', bigLabel: 'Elo-Punkte',
      sub: `Siegchance vorher ${fmt.pct(f.eW)}${upset} · Elo-Wert jetzt ${fmt.elo(mine.after)}`,
      lines: f.players.filter(p => p.id !== ctx.me.id).map(p => ({ label: nameOf(ctx, p.id), value: `${fmt.elo(p.before)} → ${fmt.elo(p.after)}  ${fmt.signed(p.delta)}`, tone: p.delta > 0 ? 'up' : 'down' })),
      medals,
    };
  }
  return {
    kicker: `${x.double ? 'Doppel' : 'Einzel'} · ${when}${WERTUNG[ctx.mode]}`,
    title: `${W} ${x.winners.length > 1 ? 'schlagen' : 'schlägt'} ${L}`,
    photo: gamePhoto(ctx, x.ref),
    big: fmt.pct(f.eW), bigLabel: `Siegchance vor dem Spiel${upset}`,
    lines: f.players.map(p => ({ label: nameOf(ctx, p.id), value: `${fmt.elo(p.before)} → ${fmt.elo(p.after)}  ${fmt.signed(p.delta)}`, tone: p.delta > 0 ? 'up' : 'down' })),
    medals,
  };
}

/** Badges the winners earned in this game (small, under the result). */
function gameMedals(ctx, ref, winners) {
  const A = ctx.badges;
  if (!A) return [];
  const g = findGame(ctx.baseModel.dataset, ref);
  const cfg = ctx.baseModel.dataset.config;
  return (A.byGame.get(g) || []).filter(e => !e.id || winners.includes(e.id)).slice(0, 8).map(e => medalSpec(cfg, e));
}

export function boardSpec(ctx) {
  const rows = ctx.model.stats.get('leaderboard').filter(r => ctx.visible.isShown(r.k));
  return {
    kicker: `Rangliste · ${fmt.date(ctx.now)}${WERTUNG[ctx.mode]}`,
    title: 'Tischtennis Elo',
    lines: rows.slice(0, 10).map((r, i) => ({ label: `${i + 1}. ${nameOf(ctx, r.id)}`, value: fmt.elo(r.rating) })),
  };
}

export function collectionSpec(ctx, id) {
  const A = ctx.badges, cfg = ctx.baseModel.dataset.config, p = A.players.get(id);
  return {
    kicker: `Abzeichen · Stand ${fmt.date(ctx.now)}`,
    medalsFirst: true,                       // the badge card is about the badges
    title: nameOf(ctx, id),
    avatar: faceOf(ctx, id),
    big: String(earnedCount(p)), bigLabel: `von ${totalLevels(A)} Stufen`,
    medals: p.earned.slice(-10).reverse().map(e => medalSpec(cfg, e)),
    lines: p.earned.slice(-3).reverse().map(e => ({ label: badgeLabel(cfg, e.badge, e.level), value: fmt.date(e.t) })),
  };
}

// ───────── Phase 20: more things to brag about ─────────

const team = (ctx, ids) => ids.map(id => nameOf(ctx, id)).join(' & ');
const gameWhen = x => (x.approxTime ? `ca. ${fmt.date(x.t)}` : fmt.date(x.t));

/** Direktvergleich: the Bilanz first, then today's Siegchance and the last games. d = duel(model, A, B). */
export function h2hSpec(ctx, A, B, d) {
  const games = ctx.model.dataset.games, delta = ctx.model.elo.perGame.delta;
  const lead = d.aWins >= d.bWins ? A : B;
  return {
    kicker: `Direktvergleich · Stand ${fmt.date(ctx.now)}${WERTUNG[ctx.mode]}`,
    title: `${team(ctx, A)} gegen ${team(ctx, B)}`,
    avatar: A.length === 1 ? faceOf(ctx, lead[0]) : null,
    big: `${fmt.int(d.aWins)} : ${fmt.int(d.bWins)}`, bigLabel: d.games.length ? `Bilanz aus ${d.games.length} Begegnungen` : 'Noch nie gegeneinander gespielt',
    sub: Number.isFinite(d.pA) ? `Siegchance heute für ${team(ctx, A)}: ${fmt.pct(d.pA)}` : null,
    lines: d.games.slice(-5).reverse().map(({ g, aWon }) => ({ label: `${gameWhen(games[g])} · ${aWon ? team(ctx, A) : team(ctx, B)} gewinnt`, value: fmt.signed(aWon ? delta[g] : -delta[g], 1), tone: aWon ? 'up' : 'down' })),
  };
}

/** A current win streak: n first, then its games. s = { k, n, win } (views/insights.js streaks). */
export function streakSpec(ctx, s) {
  const { elo, dataset } = ctx.model, id = elo.ids[s.k];
  const gs = Array.from(elo.history[s.k].g.slice(-s.n));   // a typed array would turn the mapped lines into numbers
  const x0 = dataset.games[gs[0]];
  return {
    kicker: `Serie · Stand ${fmt.date(ctx.now)}${WERTUNG[ctx.mode]}`,
    title: nameOf(ctx, id), avatar: faceOf(ctx, id),
    big: String(s.n), tone: 'up', bigLabel: s.n === 1 ? 'Sieg in Folge' : 'Siege in Folge',
    sub: `seit ${gameWhen(x0)} · Elo-Wert jetzt ${fmt.elo(elo.final[s.k])}`,
    lines: gs.slice(-6).reverse().map(g => { const x = dataset.games[g]; return { label: `${gameWhen(x)} · gegen ${team(ctx, x.losers)}`, value: fmt.signed(elo.perGame.delta[g], 1), tone: 'up' }; }),
  };
}

/** Rekorde: the record tiles as lines („Höchster Elo-Wert: Anna“ … „1612“). tiles = [{ label, value, who }]. */
export function recordsSpec(ctx, tiles) {
  const top = tiles[0];
  return {
    kicker: `Rekorde · Stand ${fmt.date(ctx.now)}${ctx.window ? ` · ${ctx.window.label}` : ''}${WERTUNG[ctx.mode]}`,
    title: 'Tischtennis-Rekorde',
    big: top?.value, bigLabel: top ? `${top.label}: ${top.who}` : null,
    lines: tiles.slice(1, 11).map(t => ({ label: `${t.label}: ${t.who}`, value: t.value, tone: t.tone })),
  };
}

/** Überraschungen: the biggest upset first (its Siegchance), then the next ones. */
export function upsetSpec(ctx, list) {
  const { games } = ctx.model.dataset, { perGame } = ctx.model.elo;
  const g = list[0], x = games[g];
  return {
    kicker: `Größte Überraschung · ${gameWhen(x)}${WERTUNG[ctx.mode]}`,
    title: `${team(ctx, x.winners)} ${x.winners.length > 1 ? 'schlagen' : 'schlägt'} ${team(ctx, x.losers)}`,
    photo: gamePhoto(ctx, x.ref),
    big: fmt.pct(perGame.eW[g]), bigLabel: 'Siegchance vor dem Spiel', sub: `Elo-Werte vorher ${fmt.elo(perGame.rW[g])} gegen ${fmt.elo(perGame.rL[g])}, gewonnen hat trotzdem ${team(ctx, x.winners)} (${fmt.signed(perGame.delta[g], 1)})`,
    lines: list.slice(1, 6).map(h => ({ label: `${gameWhen(games[h])} · ${team(ctx, games[h].winners)} gegen ${team(ctx, games[h].losers)}`, value: fmt.pct(perGame.eW[h]) })),
  };
}

/** Aufsteiger (rolling window): the best one first, then the next ones. rows from insights.risers, best first. */
export function risersSpec(ctx, winner, rows, days) {
  const id = ctx.model.elo.ids[winner.k];
  return {
    kicker: `Aufsteiger der letzten ${days === 7 ? 'sieben' : days} Tage · Stand ${fmt.date(ctx.now)}${WERTUNG[ctx.mode]}`,
    title: nameOf(ctx, id), avatar: faceOf(ctx, id),
    big: fmt.signed(winner.delta), tone: 'up', bigLabel: `Elo-Punkte aus ${winner.games} Spielen (${winner.wins} : ${winner.losses})`,
    lines: rows.filter(x => x !== winner).slice(0, 5).map(x => ({ label: nameOf(ctx, ctx.model.elo.ids[x.k]), value: fmt.signed(x.delta), tone: x.delta > 0.5 ? 'up' : x.delta < -0.5 ? 'down' : null })),
  };
}

/** Ruhmeshalle: the newest Monatssieger first, then the last Aufsteiger der Woche and earlier months. */
export function hallSpec(ctx, A) {
  const months = A.monthly.filter(m => m.riser || m.leader);
  const weeks = A.weekly.filter(w => w.id);
  const label = m => { const p = serialToParts(m.from); return monthLabel(p.y, p.mo); };
  const m = months[0], w = weeks[0];
  const lines = [];
  if (m?.leader) lines.push({ label: `Platz 1 am Ende von ${label(m)}`, value: nameOf(ctx, m.leader) });
  if (w) { const k = isoWeek(w.from); lines.push({ label: `Aufsteiger der Woche (KW ${k.week})`, value: `${nameOf(ctx, w.id)} ${fmt.signed(w.gain)}` }); }
  for (const x of months.slice(1, 5)) if (x.riser) lines.push({ label: `Monatsaufsteiger ${label(x)}`, value: `${nameOf(ctx, x.riser.id)} ${fmt.signed(x.riser.gain)}` });
  return {
    kicker: `Ruhmeshalle · Stand ${fmt.date(ctx.now)}`,
    title: m?.riser ? `${nameOf(ctx, m.riser.id)}: Monatsaufsteiger ${label(m)}` : 'Ruhmeshalle',
    avatar: m?.riser ? faceOf(ctx, m.riser.id) : null,
    big: m?.riser ? fmt.signed(m.riser.gain) : null, tone: 'up', bigLabel: m?.riser ? `Elo-Punkte im ${label(m)} aus ${m.riser.games} Spielen` : null,
    lines,
  };
}

/** Turniersieg: the winner and the final first, the winner photo, then the podium. */
export function tournamentSpec(ctx, T, sideName) {
  const side = key => T.participants.find(p => p.key === key);
  const final = T.matches.find(m => m.label === 'Finale' && m.result);
  const winnerSide = side(T.winner);
  const shot = T.winnerPhoto && ctx.photos?.on ? T.winnerPhoto : null;
  const r = final?.result, aWon = r?.winner === 'a';
  return {
    kicker: `${T.name} · ${T.date != null ? fmt.date(T.date) : ''}`,
    title: `${sideName(ctx, winnerSide)} gewinnt`,
    photo: shot ? () => ctx.photos.load(shot, 'full') : null,
    avatar: !shot && winnerSide?.id ? faceOf(ctx, winnerSide.id) : null,
    big: r && !r.wo ? `${aWon ? r.setsA : r.setsB} : ${aWon ? r.setsB : r.setsA}` : '1.', tone: 'up',
    bigLabel: r ? `im Finale gegen ${sideName(ctx, aWon ? final.b : final.a)}${r.wo ? ' (kampflos)' : ''}` : 'Turniersieg',
    sub: r && !r.wo ? `Sätze ${r.sets.map(([a, b]) => (aWon ? `${a}:${b}` : `${b}:${a}`)).join(' · ')}` : null,
    lines: [['1.', T.winner], ['2.', T.second], ...(T.third || []).map(k => ['3.', k])].filter(([, k]) => k).map(([p, k]) => ({ label: p, value: sideName(ctx, side(k)) })),
    foot: `${T.participants.length} ${T.art === 'doppel' ? 'Teams' : 'Teilnehmer'}`,
  };
}
