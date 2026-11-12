// Spielerprofil: one player's curve, key figures, records, opponents and doubles partners.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { seriesColor, css, withAlpha } from '../ui/colors.js';
import { ratingSeries, smoothSeries } from '../ui/series.js';
import { lineChart } from '../ui/charts/line.js';
import { tile, viewHead, nameOf, byName, tableView, linkTo, modeNote, missingInMode, MODE_WORD } from './common.js';
import { ownRange } from './insights.js';
import { formatRef } from '../core/normalize.js';
import { opponents, partnersOf } from './duels.js';
import { recentGames } from './games.js';
import { earnedCard, newestOf, nextGoals, collectionLink, goalRow } from './badges.js';
import { earnedCount, totalLevels } from './badge-defs.js';

export default {
  id: 'player',
  title: 'Spielerprofil',
  mount(el, ctx) {
    const head = h('div'), tiles = h('div', { class: 'tiles' }), chartEl = h('div'), note = h('p', { class: 'chart-note' }), rest = h('div');
    const recent = recentGames();
    render(el, head, tiles, h('h2', {}, 'Verlauf'), chartEl, note, recent.el, rest);
    let chart = null;

    function update(c) {
      const { model } = c;
      const { elo } = model;
      const candidates = byName(c, [...c.visible.listed]);
      if (missingInMode(c, c.params.id)) {
        const who = c.names.get(c.params.id) ?? c.params.id;
        render(head, viewHead(who), modeNote(`${who} hat noch kein ${MODE_WORD[c.mode]} gespielt.`));
        tiles.replaceChildren(); recent.el.replaceChildren(); rest.replaceChildren(); chartEl.hidden = true; note.hidden = true;
        return;
      }
      chartEl.hidden = false; note.hidden = false;
      let k = elo.index.get(c.params.id);
      if (k === undefined) k = c.focus.slots.find(x => x != null) ?? candidates[0];
      if (k === undefined) { render(head, h('p', { class: 'empty' }, 'Keine Spieler sichtbar.')); return; }

      render(head, viewHead(nameOf(c, k), null, { key: 'player', info: [
        'Treppenlinie: Elo-Wert nach jedem Spiel. Glatte Linie mit Band: geglätteter Verlauf (wie unter „Verlauf“, „Geglättet“).',
        `Angst- und Lieblingsgegner: niedrigste und höchste Siegquote gegen jemanden, ab ${c.model.dataset.config.h2h_min_games} Begegnungen. Bester Partner: meiste Siege über Erwartung pro Doppel, ab ${c.model.dataset.config.team_min_games} gemeinsamen Doppeln.`,
        'Tippe auf eine Kachel oder Zeile für die Spiele dahinter.'] }),
        h('div', { class: 'toolbar' },
          h('label', { for: 'pick-player' }, 'Spieler'),
          h('select', { id: 'pick-player', onchange: e => c.setParams({ id: e.target.value }) },
            byName(c, [...new Set([...candidates, k])]).map(j => h('option', { value: elo.ids[j], selected: j === k ? true : null }, nameOf(c, j))))));

      render(tiles, figures(c, k));

      const spec = curve(c, k);
      if (!chart) chart = lineChart(chartEl, spec); else chart.update(spec);
      note.textContent = '';

      recent.update(c, { as: elo.ids[k] });
      render(rest, records(c, k), badgeSection(c, elo.ids[k]), rivals(c, k), c.mode === 'einzel' ? null : partners(c, k));
    }
    update(ctx);
    return { update, unmount() { chart?.destroy(); } };
  },
};

function figures(ctx, k) {
  const { model, visible, filters } = ctx;
  const { elo } = model;
  const cfg = model.dataset.config;
  const prov = visible.provisional.has(k);
  const ranked = visible.shown.slice().sort((a, b) => elo.final[b] - elo.final[a]);
  const rank = ranked.indexOf(k) + 1;
  const recent = model.stats.get('recent');
  const form = model.stats.get('form');
  const streak = form.streak[k];
  const id = elo.ids[k];
  return [
    tile({ label: 'Elo-Wert', value: fmt.elo(elo.final[k]),
      sub: prov ? `vorläufig: ${elo.played[k]} von ${filters.minGames} Spielen` : rank ? `Platz ${rank} von ${ranked.length}` : 'nicht in der Rangliste',
      link: linkTo(ctx, 'history', {}, { focus: [id] }) }),
    tile({ label: cfg.dashboard_days === 7 ? 'Diese Woche' : `Letzte ${cfg.dashboard_days} Tage`,
      value: recent.games[k] ? fmt.signed(recent.delta[k]) : '–', tone: recent.delta[k] > 0.5 ? 'up' : recent.delta[k] < -0.5 ? 'down' : null,
      sub: recent.games[k] ? `aus ${recent.games[k]} ${recent.games[k] === 1 ? 'Spiel' : 'Spielen'}` : 'nicht gespielt',
      link: recent.games[k] ? linkTo(ctx, 'spiele', { spieler: id, von: formatRef(recent.from) }) : null }),
    tile({ label: 'Bilanz', value: `${elo.wins[k]} : ${elo.losses[k]}`,
      sub: `Siegquote ${fmt.pct(elo.wins[k] / elo.played[k])}, ${elo.singles[k]} Einzel, ${elo.doubles[k]} Doppel`,
      link: linkTo(ctx, 'spiele', { spieler: id }) }),
    tile({ label: `Form, letzte ${form.games[k]} Spiele`, value: fmt.signed(form.delta[k]), tone: form.delta[k] > 0.5 ? 'up' : form.delta[k] < -0.5 ? 'down' : null,
      sub: streak > 1 ? `${streak} Siege in Folge` : streak < -1 ? `${-streak} Niederlagen in Folge` : streak > 0 ? 'zuletzt gewonnen' : 'zuletzt verloren',
      link: linkTo(ctx, 'spiele', { spieler: id, letzte: String(form.games[k]) }) }),
  ];
}

function curve(ctx, k) {
  const axis = ctx.filters.xAxis;
  const slot = ctx.focus.slotOf.get(k) ?? 0;
  const color = seriesColor(slot);
  const raw = ratingSeries(ctx.model, [k], axis, 0);
  const sm = smoothSeries(ctx.model, [k], axis, 0);
  // merge the two x grids: raw has every game (or own game), smoothed has the player's own games
  const xs = [...new Set([...raw.x, ...sm.x])].sort((a, b) => a - b);
  const at = (x, ys) => { const m = new Map(x.map((v, i) => [v, ys[i]])); return xs.map(v => m.get(v) ?? null); };
  const rawY = at(raw.x, raw.ys[0]);
  // carry the step line through x values that only the smoothed grid has
  for (let i = 1; i < rawY.length; i++) if (rawY[i] == null && rawY[i - 1] != null && axis === 'own') rawY[i] = rawY[i - 1];
  return {
    x: xs, xType: axis === 'date' ? 'time' : 'num', height: 260, y: {},
    xLabel: axis === 'own' ? v => `${v}. eigenes Spiel` : undefined,
    series: [
      { label: 'oben', values: at(sm.x, sm.hi[0]), spanGaps: true, context: true },
      { label: 'unten', values: at(sm.x, sm.lo[0]), spanGaps: true, context: true },
      { label: 'Elo-Wert', values: rawY, stepped: axis !== 'own', color: withAlpha(color, 0.55), width: 1, spanGaps: axis !== 'own' },
      { label: 'geglättet', values: at(sm.x, sm.mean[0]), spanGaps: true, color, width: 2.5 },
    ],
    bands: [{ upper: 0, lower: 1, color: withAlpha(color, Number(css('--band')) || 0.16) }],
  };
}

function records(ctx, k) {
  const { model } = ctx;
  const r = model.stats.get('records', { minGames: ctx.filters.minGames });
  const runs = model.stats.get('bestRuns');
  const cfg = model.dataset.config;
  const N = Math.min(cfg.form_games, cfg.best_run_max_games);
  const games = model.dataset.games;
  const when = g => (g >= 0 ? `${games[g].approxTime ? 'ca. ' : ''}${fmt.date(games[g].t)}` : '');
  const game = g => (g >= 0 ? linkTo(ctx, 'spiel', { ref: games[g].ref }) : null);
  const span = (endG, len) => { const p = endG >= 0 ? ownRange(model, k, endG, len) : null; return p ? linkTo(ctx, 'spiele', p) : null; };
  return [h('h2', {}, 'Bestwerte'), h('div', { class: 'tiles' },
    tile({ label: 'Höchster Elo-Wert', value: fmt.elo(r.highest[k]), sub: when(r.highestG[k]), link: game(r.highestG[k]) }),
    tile({ label: 'Tiefster Elo-Wert', value: fmt.elo(r.lowest[k]), sub: when(r.lowestG[k]), link: game(r.lowestG[k]) }),
    tile({ label: 'Längste Siegesserie', value: String(r.longestWin[k]), sub: r.longestWin[k] ? `bis ${when(r.longestWinG[k])}` : '', link: span(r.longestWinG[k], r.longestWin[k]) }),
    tile({ label: 'Längste Niederlagenserie', value: String(r.longestLoss[k]), sub: r.longestLoss[k] ? `bis ${when(r.longestLossG[k])}` : '', link: span(r.longestLossG[k], r.longestLoss[k]) }),
    tile({ label: `Größter Zuwachs in ${N} Spielen`, value: fmt.signed(runs.best[k][N - 1]), tone: 'up', sub: runs.bestEnd[k][N - 1] >= 0 ? `bis ${when(runs.bestEnd[k][N - 1])}` : `noch keine ${N} Spiele`, link: span(runs.bestEnd[k][N - 1], N) }),
    tile({ label: `Größter Einbruch in ${N} Spielen`, value: fmt.signed(runs.worst[k][N - 1]), tone: 'down', sub: runs.worstEnd[k][N - 1] >= 0 ? `bis ${when(runs.worstEnd[k][N - 1])}` : `noch keine ${N} Spiele`, link: span(runs.worstEnd[k][N - 1], N) }),
    tile({ label: 'Tage auf Platz 1', value: fmt.int(Math.round(r.leaderDays[k])), sub: `längste Serie: ${r.leaderRun[k]} Ligaspiele`, link: linkTo(ctx, 'rank', {}, { focus: [model.elo.ids[k]] }) }),
    tile({ label: 'Größter Gewinn in einem Spiel', value: fmt.signed(r.maxGain[k], 1), tone: 'up', sub: when(r.maxGainG[k]), link: game(r.maxGainG[k]) }),
  )];
}

/** Abzeichen: newest ones, the next goals, link to the whole collection. Counted over all games. */
function badgeSection(ctx, id) {
  const A = ctx.badges;
  const head = h('h2', {}, 'Abzeichen');
  if (!A) return [head, h('p', { class: 'muted' }, 'Werden berechnet …')];
  const p = A.players.get(id);
  if (!p) return null;
  const cfg = ctx.baseModel.dataset.config;
  const isMe = ctx.me?.id === id;
  const goals = nextGoals(cfg, A, p, 2);
  return [head,
    h('p', { class: 'muted' }, `${earnedCount(p)} von ${totalLevels(A)} Stufen, gezählt über alle Spiele.`),
    p.earned.length ? h('div', { class: 'earned-list' }, newestOf(p).slice(0, 3).map(e => earnedCard(ctx, A, e, { isNew: isMe && e.t > ctx.badgeSeen }))) : null,
    goals.length ? h('ul', { class: 'goal-list' }, goals.map(x => h('li', {}, goalRow(ctx, A, x.b, x.pr, id)))) : null,
    h('nav', { class: 'links' }, h('a', { class: 'tap', ...collectionLink(ctx, id) }, isMe ? 'Alle deine Abzeichen' : 'Alle Abzeichen'))];
}

function rivals(ctx, k) {
  const { model } = ctx;
  const cfg = model.dataset.config;
  const opp = opponents(model, k).filter(o => !ctx.visible.inactive.has(o.j));
  const enough = opp.filter(o => o.n >= cfg.h2h_min_games);
  const toughest = enough.slice().sort((a, b) => a.ratio - b.ratio || b.n - a.n)[0];
  const easiest = enough.slice().sort((a, b) => b.ratio - a.ratio || b.n - a.n)[0];
  const duel = j => linkTo(ctx, 'h2h', { a: model.elo.ids[k], b: model.elo.ids[j] });
  const num = v => fmt.dec1(v).replace(',0', '');
  return [
    h('h2', {}, 'Gegner'),
    enough.length ? h('div', { class: 'tiles' },
      tile({ label: 'Angstgegner', value: fmt.pct(toughest.ratio), who: nameOf(ctx, toughest.j),
        sub: `Siegquote in ${num(toughest.n)} Begegnungen`, link: duel(toughest.j) }),
      tile({ label: 'Lieblingsgegner', value: fmt.pct(easiest.ratio), who: nameOf(ctx, easiest.j),
        sub: `Siegquote in ${num(easiest.n)} Begegnungen`, link: duel(easiest.j) }))
      : h('p', { class: 'muted' }, `Gegen niemanden mindestens ${cfg.h2h_min_games} Begegnungen.`),
    tableView('Alle Gegner anzeigen', ['Gegner', 'Begegnungen', 'Bilanz', 'Siegquote', 'Über Erwartung'],
      opp.map(o => [nameOf(ctx, o.j), num(o.n), `${num(o.wins)} : ${num(o.losses)}`, fmt.pct(o.ratio), fmt.signed(o.overExp, 1)]),
      [1, 2, 3, 4], opp.map(o => duel(o.j))),
  ];
}

function partners(ctx, k) {
  const { model } = ctx;
  const cfg = model.dataset.config;
  const par = partnersOf(model, k).filter(p => !ctx.visible.inactive.has(p.j));
  if (!par.length) return [h('h2', {}, 'Doppelpartner'), h('p', { class: 'muted' }, 'Noch kein Doppel gespielt.')];
  const enough = par.filter(p => p.n >= cfg.team_min_games);
  const best = enough.slice().sort((a, b) => b.perGame - a.perGame)[0];
  const often = par[0];
  const team = j => linkTo(ctx, 'team', { a: model.elo.ids[k], b: model.elo.ids[j] });
  return [
    h('h2', {}, 'Doppelpartner'),
    h('div', { class: 'tiles' },
      best ? tile({ label: 'Bester Partner', value: fmt.signed(best.perGame, 1).replace('±0,0', '±0'), who: nameOf(ctx, best.j),
        sub: `Siege über Erwartung pro Spiel, ${best.n} Doppel zusammen`, link: team(best.j) })
        : tile({ label: 'Bester Partner', value: '–', sub: `mit niemandem ${cfg.team_min_games} Doppel zusammen` }),
      tile({ label: 'Häufigster Partner', value: String(often.n), who: nameOf(ctx, often.j), sub: `Doppel zusammen, Siegquote ${fmt.pct(often.ratio)}`, link: team(often.j) })),
    tableView('Alle Partner anzeigen', ['Partner', 'Doppel', 'Siege', 'Siegquote', 'Über Erwartung'],
      par.map(p => [nameOf(ctx, p.j), String(p.n), String(p.wins), fmt.pct(p.ratio), fmt.signed(p.chem, 1)]),
      [1, 2, 3, 4], par.map(p => team(p.j))),
  ];
}
