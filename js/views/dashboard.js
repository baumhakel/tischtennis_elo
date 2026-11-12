// Übersicht: „Ich“ card (or „Wer bist du?“), highlight tiles, recent Elo curves, last games, leaderboard.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { seriesColor, seriesVar, css } from '../ui/colors.js';
import { ratingSeries, recentStart } from '../ui/series.js';
import { lineChart } from '../ui/charts/line.js';
import { focusLegend, tile, nameOf, linkTo } from './common.js';
import { recentGames } from './games.js';
import { SNOOZE_DAYS } from '../app/me.js';
import { earnedCard, newestOf, collectionLink } from './badges.js';

export default {
  id: 'dashboard',
  title: 'Übersicht',
  mount(el, ctx) {
    const tiles = h('div', { class: 'tiles' });
    const legend = h('div');
    const chartEl = h('div');
    const note = h('p', { class: 'chart-note' });
    const board = h('div');
    const meBox = h('div');
    const recent = recentGames();
    render(el, meBox, tiles, h('h2', {}, 'Aktueller Verlauf'), legend, chartEl, note, recent.el, board);
    let chart = null;

    function update(c) {
      render(meBox, c.me.ask ? askCard(c) : c.me.id ? [meCard(c), meBadge(c)] : null);
      render(tiles, highlights(c));
      render(legend, focusLegend(c));
      const spec = curves(c);
      render(note, spec.note);
      if (!chart) chart = lineChart(chartEl, spec); else chart.update(spec);
      recent.update(c);
      render(board, leaderboard(c));
    }
    update(ctx);
    return { update, unmount() { chart?.destroy(); } };
  },
};

// ───────── „Ich“ ─────────

/** „Wer bist du?“: never a dialog; stays until answered or snoozed. */
function askCard(ctx) {
  const set = patch => ctx.actions.setMe({ ...ctx.state.me, ...patch });
  const players = [...ctx.baseModel.dataset.players.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const sel = h('select', { 'aria-label': 'Spieler' }, h('option', { value: '' }, 'Spieler wählen …'),
    players.map(p => h('option', { value: p.id }, p.name)));
  return h('section', { class: 'me-card ask' },
    h('h2', {}, 'Wer bist du?'),
    h('p', {}, 'Dann zeigt die Übersicht zuerst deinen Platz und deinen Abstand nach oben. Wird nur auf diesem Gerät gespeichert.'),
    h('div', { class: 'menu-actions' }, sel,
      h('button', { type: 'button', class: 'small', onclick: () => { if (sel.value) set({ choice: 'player', id: sel.value }); } }, 'Das bin ich'),
      h('button', { type: 'button', class: 'secondary small', onclick: () => set({ choice: 'observer', id: null }) }, 'Ich schaue nur zu'),
      h('button', { type: 'button', class: 'link', onclick: () => set({ snoozeUntil: Date.now() + SNOOZE_DAYS * 864e5 }) }, 'Später')));
}

/** Newest Abzeichen under the „Ich“ card; „neu“ if earned since the app was last opened. No pop-ups. */
function meBadge(ctx) {
  const p = ctx.badges?.players.get(ctx.me.id);
  if (!p?.earned.length) return null;
  const fresh = newestOf(p, ctx.badgeSeen);
  const e = p.earned.at(-1);
  return h('div', { class: 'me-badge' },
    earnedCard(ctx, ctx.badges, e, { isNew: fresh.length > 0 }),
    h('a', { class: 'me-badge-more', ...collectionLink(ctx, ctx.me.id) },
      fresh.length > 1 ? `${fresh.length - 1} weitere neu · alle Abzeichen` : 'Alle deine Abzeichen'));
}

/** Personal card: Platz in the current Wertung, distance up and down, streak. Tappable → my profile. */
function meCard(ctx) {
  const { model, visible, filters, me } = ctx;
  const id = me.id, k = model.elo.index.get(id);
  const name = ctx.names.get(id) ?? id;
  const link = linkTo(ctx, 'player', { id });
  const word = { einzel: 'Im Einzel', doppel: 'Im Doppel', alle: '' }[ctx.mode];
  if (k === undefined) {
    return h('a', { class: 'me-card tap', ...link }, h('span', { class: 'me-name' }, name),
      h('span', { class: 'me-line' }, `${word} hast du noch nicht gespielt.`));
  }
  const elo = model.elo;
  const rating = elo.final[k];
  const ranked = model.stats.get('leaderboard').filter(r => visible.isShown(r.k)).map(r => r.k);
  const pos = ranked.indexOf(k);
  const form = model.stats.get('form');
  const streak = form.streak[k];
  let line, sub = null;
  if (visible.inactive.has(k)) {
    line = `${word ? word + ': s' : 'S'}eit über ${filters.inactivityDays} Tagen kein Spiel – deshalb nicht in der Rangliste.`;
  } else if (visible.provisional.has(k)) {
    line = `${word ? word + ' bist du' : 'Du bist'} noch vorläufig: ${elo.played[k]} von ${filters.minGames} Spielen.`;
  } else {
    line = `Platz ${pos + 1} von ${ranked.length}${word ? ' ' + word.replace('Im ', 'im ') : ''}`;
    const up = pos > 0 ? Math.max(1, Math.ceil(elo.final[ranked[pos - 1]] - rating)) : null;
    const down = pos < ranked.length - 1 ? Math.floor(rating - elo.final[ranked[pos + 1]]) : null;
    sub = [up != null ? `noch ${up} ${up === 1 ? 'Punkt' : 'Punkte'} bis Platz ${pos}` : 'ganz vorne',
      down != null ? `${down} ${down === 1 ? 'Punkt' : 'Punkte'} Vorsprung auf Platz ${pos + 2}` : null].filter(Boolean).join(' · ');
  }
  const streakText = streak > 1 ? `${streak} Siege in Folge` : streak < -1 ? `${-streak} Niederlagen in Folge` : streak > 0 ? 'zuletzt gewonnen' : streak < 0 ? 'zuletzt verloren' : null;
  return h('a', { class: 'me-card tap', ...link },
    h('span', { class: 'me-top' }, h('span', { class: 'me-name' }, name), h('span', { class: 'me-elo' }, fmt.elo(rating))),
    h('span', { class: 'me-line' }, line),
    sub ? h('span', { class: 'me-sub' }, sub) : null,
    streakText ? h('span', { class: 'me-sub' }, streakText) : null);
}

// ───────── highlight tiles ─────────

function highlights(ctx) {
  const { model, visible } = ctx;
  const { config, games } = model.dataset;
  const ok = k => visible.isShown(k);   // provisional and inactive players are not eligible

  const week = d => `(letzte ${d} Tage)`;   // rolling; the badge „Aufsteiger der Woche“ uses calendar weeks
  const rs = model.stats.get('risingStar').filter(r => ok(r.k))[0];
  const rising = rs
    ? tile({ label: `Aufsteiger ${week(config.rising_star_days)}`, value: fmt.signed(rs.delta), tone: rs.delta > 0 ? 'up' : 'down',
        who: nameOf(ctx, rs.k), sub: `Elo-Punkte aus ${rs.games} Spielen`, link: linkTo(ctx, 'aufsteiger') })
    : tile({ label: `Aufsteiger ${week(config.rising_star_days)}`, value: '–',
        sub: `Niemand hat in dieser Zeit ${config.rising_star_min_games} Spiele bestritten.`, link: linkTo(ctx, 'aufsteiger') });

  const form = model.stats.get('form');
  let best = -1;
  for (const k of visible.shown) if (form.streak[k] > 0 && (best < 0 || form.streak[k] > form.streak[best])) best = k;
  const streak = best >= 0
    ? tile({ label: 'Aktuelle Siegesserie', value: `${form.streak[best]} Siege`, who: nameOf(ctx, best), sub: 'in Folge, seither ungeschlagen',
        link: linkTo(ctx, 'serien', { id: model.elo.ids[best] }) })
    : tile({ label: 'Aktuelle Siegesserie', value: '–', sub: 'Gerade hat niemand eine Siegesserie.', link: linkTo(ctx, 'serien') });

  const recent = model.stats.get('recent');
  const up = model.stats.get('upsets');
  let g = -1;
  for (const i of up.order) if (i >= recent.firstGame) { g = i; break; }
  const upset = g >= 0
    ? tile({ label: `Überraschung ${week(config.dashboard_days)}`, value: fmt.pct(model.elo.perGame.eW[g]),
        who: teamNames(ctx, games[g].winners), sub: `Siegchance gegen ${teamNames(ctx, games[g].losers)} am ${fmt.date(games[g].t)}`,
        link: linkTo(ctx, 'spiel', { ref: games[g].ref }) })
    : tile({ label: `Überraschung ${week(config.dashboard_days)}`, value: '–', sub: 'In dieser Zeit wurde nicht gespielt.' });

  const mv = model.stats.get('movement');
  const LEVELS = { calm: ['ruhig', 1], normal: ['normal', 2], turbulent: ['turbulent', 3] };
  const [word, bars] = LEVELS[mv.level] || ['–', 0];
  const movement = tile({
    label: 'Elo-Bewegung',
    value: h('span', { class: 'level' }, word,
      h('i', { 'aria-hidden': 'true' }, [1, 2, 3].map(b => h('b', { class: b <= bars ? 'on' : null })))),
    sub: Number.isFinite(mv.percentile) ? `bewegter als ${Math.round(mv.percentile)} % der bisherigen Zeit` : 'Noch zu wenige Spiele.',
    link: linkTo(ctx, 'movement'),
  });
  return [rising, streak, upset, movement];
}

export const teamNames = (ctx, ids) => ids.map(id => ctx.names.get(id) ?? id).join(' & ');

// ───────── recent curves ─────────

function curves(ctx) {
  const { model, visible, focus, filters } = ctx;
  const axis = filters.xAxis === 'own' ? 'game' : filters.xAxis;   // own-game axis makes no sense for a time window
  const start = recentStart(model);
  const context = visible.shown.filter(k => !focus.slotOf.has(k));
  const focused = [...focus.slotOf.keys()];
  const ks = [...context, ...focused];
  const { x, ys } = ratingSeries(model, ks, axis, start);
  const ctxColor = css('--context-line');
  const series = ks.map((k, i) => {
    const slot = focus.slotOf.get(k);
    return { label: nameOf(ctx, k), values: ys[i], stepped: true, context: slot == null,
      color: slot == null ? ctxColor : seriesColor(slot), width: slot == null ? 1 : 2 };
  });
  const N = model.dataset.games.length;
  return {
    x, xType: axis === 'date' ? 'time' : 'num', series, height: 240, y: {},
    note: N ? [h('a', { class: 'inline-link', ...linkTo(ctx, 'spiele', { von: model.dataset.games[start].ref }) },
      `${N - start} Spiele seit dem ${fmt.date(model.dataset.games[start].t)}`), '.',
      filters.xAxis === 'own' ? ' Die x-Achse zeigt hier die Spielnummer.' : ''] : '',
  };
}

// ───────── leaderboard ─────────

function leaderboard(ctx) {
  const { model, visible, filters, names, navigate, focus } = ctx;
  const { config } = model.dataset;
  const rows = model.stats.get('leaderboard').filter(r => !visible.inactive.has(r.k));
  if (!rows.length) {
    return h('p', { class: 'empty' }, 'Niemand sichtbar: Alle Spieler waren länger inaktiv, als der Filter erlaubt. Unter „Filter“ mehr Tage zulassen.');
  }
  let rank = 0;
  const body = rows.map(r => {
    const prov = visible.provisional.has(r.k);
    if (!prov) rank++;
    const slot = focus.slotOf.get(r.k);
    return h('tr', { class: 'tap-row' + (prov ? ' provisional' : '') + (r.id === ctx.me.id ? ' me' : ''), onclick: () => navigate('player', { id: r.id }) },
      h('td', { class: 'rank' }, prov ? '' : String(rank)),
      h('td', { class: 'name' },
        h('span', { class: 'player' },
          slot != null ? h('span', { class: 'fkey', style: `background:${seriesVar(slot)}` }) : null,
          names.get(r.id)),
        h('span', { class: 'sub' },
          prov ? `vorläufig: ${r.games} von ${filters.minGames} Spielen` : formStrip(r.last))),
      h('td', { class: 'num score' }, fmt.elo(r.rating)),
      h('td', { class: 'num delta ' + (r.delta > 0.5 ? 'up' : r.delta < -0.5 ? 'down' : '') }, fmt.signed(r.delta)),
      h('td', { class: 'num wide' }, fmt.int(r.games)),
      h('td', { class: 'num wide' }, `${r.wins}:${r.losses}`),
      h('td', { class: 'num wide' }, fmt.pct(r.winRate)),
      h('td', { class: 'num wide muted' }, fmt.ago(r.lastT, ctx.now)));
  });
  return h('section', { class: 'board' },
    h('h2', {}, 'Rangliste'),
    h('table', {},
      h('thead', {}, h('tr', {},
        h('th', { class: 'rank' }, h('span', { class: 'sr' }, 'Rang')),
        h('th', {}, 'Spieler'),
        h('th', { class: 'num' }, 'Elo'),
        h('th', { class: 'num' }, h('a', { class: 'th-link', ...linkTo(ctx, 'aufsteiger') }, config.dashboard_days === 7 ? 'Woche' : `${config.dashboard_days} Tage`)),
        h('th', { class: 'num wide' }, 'Spiele'),
        h('th', { class: 'num wide' }, 'S:N'),
        h('th', { class: 'num wide' }, 'Siegquote'),
        h('th', { class: 'num wide' }, 'Zuletzt'))),
      h('tbody', {}, body)));
}

/** Last results as a row of small marks, oldest first. */
function formStrip(last) {
  return h('span', { class: 'form', 'aria-label': `Letzte Spiele: ${[...last].map(c => (c === 'W' ? 'Sieg' : 'Niederlage')).join(', ')}` },
    [...last].map(c => h('i', { class: c === 'W' ? 'w' : 'l' })));
}
