// Card specs for sharing (ui/cards.js draws them): Spielerprofil, Spiel, Rangliste, a player's Abzeichen.
// They show the current Wertung (named in the kicker when it isn't „Alle“); Abzeichen always count all games.
import * as fmt from '../ui/format.js';
import { DEFS, badgeLabel, badgeHasLevels, earnedCount, totalLevels } from './badge-defs.js';
import { gameFacts } from './game-query.js';
import { yearWindow } from './review-logic.js';
import { serialToParts } from '../core/normalize.js';

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
    big: fmt.elo(elo.final[k]), bigLabel: 'Elo-Wert',
    sub: [pl ? `Platz ${pl.pos} von ${pl.of}` : null, `${elo.wins[k]} Siege, ${elo.losses[k]} Niederlagen`, `Siegquote ${fmt.pct(elo.wins[k] / elo.played[k])}`].filter(Boolean).join(' · '),
    spark, sparkLabels: [`seit ${fmt.date(t0)}`, 'heute'],
    medals: p ? p.earned.slice(-5).reverse().map(e => medalSpec(cfg, e)) : [],
    lines: partners.length ? [{ label: 'Bester Doppelpartner', value: `${nameOf(ctx, partners[0].pid)} · ${partners[0].wins} : ${partners[0].games - partners[0].wins}` }] : [],
  };
}

export function gameSpec(ctx, g) {
  const f = gameFacts(ctx.model, g);
  const x = f.game;
  const W = x.winners.map(id => nameOf(ctx, id)).join(' & '), L = x.losers.map(id => nameOf(ctx, id)).join(' & ');
  return {
    kicker: `${x.double ? 'Doppel' : 'Einzel'} · ${x.approxTime ? `ca. ${fmt.date(x.t)}` : `${fmt.date(x.t)}, ${fmt.time(x.t)} Uhr`}${WERTUNG[ctx.mode]}`,
    title: `${W} ${x.winners.length > 1 ? 'schlagen' : 'schlägt'} ${L}`,
    big: fmt.pct(f.eW), bigLabel: `Siegchance vor dem Spiel${f.eW < 0.5 ? ': eine Überraschung' : ''}`,
    lines: f.players.map(p => ({ label: nameOf(ctx, p.id), value: `${fmt.elo(p.before)} → ${fmt.elo(p.after)}  ${fmt.signed(p.delta)}`, tone: p.delta > 0 ? 'up' : 'down' })),
  };
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
    kicker: 'Abzeichen',
    title: nameOf(ctx, id),
    big: String(earnedCount(p)), bigLabel: `von ${totalLevels(A)} Stufen`,
    medals: p.earned.slice(-10).reverse().map(e => medalSpec(cfg, e)),
    lines: p.earned.slice(-3).reverse().map(e => ({ label: badgeLabel(cfg, e.badge, e.level), value: fmt.date(e.t) })),
  };
}
