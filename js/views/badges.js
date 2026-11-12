// Abzeichen: the catalogue (who has what, how rare), one badge in detail (?id=), and one player's
// collection with progress (?spieler=). Badges are computed in the background (app/achievements.js);
// until then the page says so and fills in by itself.
// Badges always count all games (Einzel and Doppel as each badge says); the Wertung switch does not change them.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { viewHead, plainTable, tableView, linkTo } from './common.js';
import { medal } from '../ui/medal.js';
import { hintsFor } from './badge-hints.js';
import { DEFS, ORDER, CATEGORIES, SCOPE, tierName, badgeLabel, badgeHasLevels, progressOf, badgeStats, earnedCount, totalLevels, noteOf } from './badge-defs.js';

export default {
  id: 'abzeichen',
  title: 'Abzeichen',
  mount(el, ctx) {
    const update = c => render(el, page(c));
    update(ctx);
    return { update, unmount() {} };
  },
};

const RULE = 'Ein Abzeichen gibt es in dem Moment, in dem die Bedingung zum ersten Mal erfüllt ist, und es bleibt für immer. Was danach passiert, nimmt nichts weg. Abzeichen zählen immer alle Spiele, unabhängig von der gewählten Wertung.';

function page(ctx) {
  const A = ctx.badges;
  if (!A) return [viewHead('Abzeichen'), h('p', { class: 'empty' }, 'Abzeichen werden berechnet …')];
  if (ctx.params.id && DEFS[ctx.params.id]) return detail(ctx, A, ctx.params.id, A.players.has(ctx.params.spieler) ? ctx.params.spieler : null);
  if (ctx.params.spieler && A.players.has(ctx.params.spieler)) return collection(ctx, A, ctx.params.spieler);
  return catalogue(ctx, A);
}

// ───────── building blocks (also used by the profile, the Übersicht and the game page) ─────────

/** Medal of `badge` at `level` (0 = not earned). */
export function badgeMedal(cfg, badge, level, size = 48, title = null) {
  return medal(DEFS[badge].motif, level ? (badgeHasLevels(badge) ? level : -1) : 0, { size, title });
}

const bar = ratio => h('span', { class: 'bar', role: 'presentation' }, h('span', { style: `width:${Math.round(100 * Math.max(0, Math.min(1, ratio)))}%` }));

export const badgeLink = (ctx, id) => linkTo(ctx, 'abzeichen', { id });
export const collectionLink = (ctx, spieler) => linkTo(ctx, 'abzeichen', { spieler });
const gameLinkBase = (ctx, g) => linkTo(ctx, 'spiel', { ref: ctx.baseModel.dataset.games[g].ref });
const nameOfId = (ctx, id) => ctx.names.get(id) ?? id;
const playersWithGames = ctx => ctx.baseModel.elo.played.filter(n => n > 0).length;

/** What one level asks for, e.g. „250 Spiele gespielt“. */
const condText = (A, cfg, b, i) => DEFS[b].cond(cfg, A.levels[b][i]);

/** Badges a player earned, newest first, optionally only after `since`. */
export const newestOf = (p, since = -Infinity) => (p ? p.earned.filter(e => e.t > since).slice().reverse() : []);

/** One earned entry as a compact card (medal, label, date); link to the game if there is one. */
export function earnedCard(ctx, A, e, { isNew = false } = {}) {
  const cfg = ctx.baseModel.dataset.config;
  const link = e.g != null ? gameLinkBase(ctx, e.g) : badgeLink(ctx, e.badge);
  return h('a', { class: 'earned-card tap', ...link },
    badgeMedal(cfg, e.badge, e.level, 40),
    h('span', { class: 'ec-text' },
      h('span', { class: 'ec-name' }, badgeLabel(cfg, e.badge, e.level), isNew ? h('span', { class: 'neu' }, 'neu') : null),
      h('span', { class: 'ec-sub' }, `${condText(A, cfg, e.badge, badgeHasLevels(e.badge) ? e.level - 1 : 0)} · ${fmt.date(e.t)}`)));
}

/** Badges earned in one game (pooled index), as links to the badges. */
export function earnedInGame(ctx, A, g) {
  const cfg = ctx.baseModel.dataset.config;
  const list = A.byGame.get(g);
  if (!list?.length) return null;
  return [h('h3', { class: 'sec' }, 'In diesem Spiel verdient'),
    h('div', { class: 'earned-list' }, list.map(e => h('a', { class: 'earned-card tap', ...badgeLink(ctx, e.badge) },
      badgeMedal(cfg, e.badge, e.level, 40),
      h('span', { class: 'ec-text' },
        h('span', { class: 'ec-name' }, badgeLabel(cfg, e.badge, e.level)),
        h('span', { class: 'ec-sub' }, `${nameOfId(ctx, e.id)}: ${condText(A, cfg, e.badge, badgeHasLevels(e.badge) ? e.level - 1 : 0)}`)))))];
}

/** The next goals of a player: badges not complete yet, most advanced first. */
export function nextGoals(cfg, A, p, n = 3) {
  return ORDER.map(b => ({ b, pr: progressOf(cfg, A.levels, b, p) }))
    .filter(x => x.pr.ratio > 0 && x.pr.ratio < 1 && x.pr.text)
    .sort((x, y) => y.pr.ratio - x.pr.ratio)
    .slice(0, n);
}

/** Progress towards the next level; links to the badge page for that player (spieler = false: no link). */
export function goalRow(ctx, A, b, pr, spieler = null) {
  const cfg = ctx.baseModel.dataset.config;
  const target = badgeHasLevels(b) ? `${tierName(cfg, pr.level + 1)}: ${condText(A, cfg, b, pr.level)}` : condText(A, cfg, b, 0);
  const wrap = spieler === false ? ['div', { class: 'goal' }] : ['a', { class: 'goal tap', ...linkTo(ctx, 'abzeichen', spieler ? { id: b, spieler } : { id: b }) }];
  return h(wrap[0], wrap[1],
    badgeMedal(cfg, b, pr.level, 36),
    h('span', { class: 'goal-text' },
      h('span', { class: 'goal-name' }, DEFS[b].name),
      h('span', { class: 'goal-sub' }, target),
      bar(pr.ratio),
      h('span', { class: 'goal-sub' }, pr.text)));
}

// ───────── Katalog ─────────

function catalogue(ctx, A) {
  const cfg = ctx.baseModel.dataset.config;
  const total = totalLevels(A), people = playersWithGames(ctx);
  const me = ctx.me?.id && A.players.get(ctx.me.id);
  const collectors = [...A.players.entries()].map(([id, p]) => ({ id, n: earnedCount(p), last: p.earned.at(-1)?.t ?? 0 }))
    .filter(x => x.n > 0).sort((a, b) => b.n - a.n || a.last - b.last);
  const mine = me ? h('a', { class: 'me-card tap', ...collectionLink(ctx, ctx.me.id) },
    h('span', { class: 'me-top' }, h('span', { class: 'me-name' }, 'Deine Abzeichen'), h('span', { class: 'me-elo' }, `${earnedCount(me)} / ${total}`)),
    h('span', { class: 'me-line' }, earnedCount(me) ? `Zuletzt: ${badgeLabel(cfg, me.earned.at(-1).badge, me.earned.at(-1).level)}` : 'Noch keines. Das erste kommt bestimmt bald.'),
    h('span', { class: 'me-sub' }, 'Alle mit Fortschritt ansehen')) : null;

  return [
    viewHead('Abzeichen', 'Für Meilensteine, Serien, große Siege und Kurioses.', { info: [RULE,
      `Viele Abzeichen haben Stufen: ${cfg.achievement_tier_names.join(', ')}. Wo es Platz 1 oder das Podest braucht, zählen nur Spieler mit mindestens ${cfg.achievement_rank_min_games} Spielen, die in den ${cfg.achievement_rank_active_days} Tagen davor gespielt haben.`,
      'Bei jedem Abzeichen steht, ob Einzel, Doppel oder beides zählt.'] }),
    mine,
    h('nav', { class: 'links' }, h('a', { class: 'tap', ...linkTo(ctx, 'ruhmeshalle') }, 'Ruhmeshalle: Aufsteiger jeder Woche und Platz 1 über die Zeit')),
    collectors.length ? [
      h('h3', { class: 'sec' }, 'Sammler'),
      plainTable(['Spieler', 'Stufen', 'zuletzt'],
        collectors.slice(0, 5).map(x => [nameOfId(ctx, x.id), `${x.n} / ${total}`, fmt.date(x.last)]), [1, 2],
        collectors.slice(0, 5).map(x => collectionLink(ctx, x.id))),
      collectors.length > 5 ? tableView(`Alle ${collectors.length} Sammler`, ['Spieler', 'Stufen', 'zuletzt'],
        collectors.map(x => [nameOfId(ctx, x.id), `${x.n} / ${total}`, fmt.date(x.last)]), [1, 2],
        collectors.map(x => collectionLink(ctx, x.id))) : null,
    ] : null,
    CATEGORIES.map(cat => h('section', { class: 'hub-group' },
      h('h3', {}, cat),
      h('ul', { class: 'badge-list' }, ORDER.filter(b => DEFS[b].cat === cat).map(b => {
        const s = badgeStats(A, b);
        const L = A.levels[b];
        const myLevel = me ? me.level[b] || 0 : null;
        const shownLevel = myLevel ?? (s.holders[0]?.level || 0);
        const short = badgeHasLevels(b) ? `${condText(A, cfg, b, 0)} · ${L.length} Stufen` : condText(A, cfg, b, 0);
        const rare = s.holders.length ? `${s.holders.length} von ${people}` : 'noch niemand';
        return h('li', {}, h('a', { class: 'badge-row tap', ...badgeLink(ctx, b) },
          badgeMedal(cfg, b, shownLevel, 44),
          h('span', { class: 'br-text' },
            h('span', { class: 'br-name' }, DEFS[b].name, myLevel ? h('span', { class: 'br-mine' }, badgeHasLevels(b) ? tierName(cfg, myLevel) : 'hast du') : null),
            h('span', { class: 'br-sub' }, short),
            h('span', { class: 'br-rare' }, rare))));
      })))),
  ];
}

// ───────── one badge ─────────

function detail(ctx, A, b, who) {
  const cfg = ctx.baseModel.dataset.config;
  const def = DEFS[b], L = A.levels[b];
  const s = badgeStats(A, b);
  const people = playersWithGames(ctx);
  const me = ctx.me?.id && A.players.get(ctx.me.id);
  const info = [noteOf(cfg, b), RULE].filter(Boolean);

  const levels = h('ul', { class: 'level-list' }, (badgeHasLevels(b) ? L : [L[0]]).map((_, i) => h('li', {},
    badgeMedal(cfg, b, badgeHasLevels(b) ? i + 1 : 1, 44),
    h('span', { class: 'lv-text' },
      badgeHasLevels(b) ? h('span', { class: 'lv-name' }, tierName(cfg, i + 1)) : null,
      h('span', {}, condText(A, cfg, b, i)),
      h('span', { class: 'lv-count' }, s.perLevel[i] ? `${s.perLevel[i]} von ${people} Spielern` : 'noch niemand')))));

  let extra = null;
  if (b === 'rising_star') extra = runningWeek(ctx, A);
  if (b === 'throne' || b === 'leader') {
    const r = A.reigns.find(x => x.current);
    extra = h('p', { class: 'note-line' }, r ? `Gerade auf Platz 1: ${nameOfId(ctx, r.id)}, seit ${fmt.date(r.from)} (${fmt.int(Math.floor(r.days))} Tage).` : 'Gerade steht niemand auf Platz 1.',
      ' ', h('a', { ...linkTo(ctx, 'ruhmeshalle') }, 'Alle in der Ruhmeshalle'));
  }

  // one player's progress: the one in the URL (?spieler=), else „Ich“
  const subj = who || (me ? ctx.me.id : null);
  const sp = subj && A.players.get(subj);
  const isMe = subj === ctx.me?.id;
  const pr = sp ? progressOf(cfg, A.levels, b, sp) : null;
  const mine = sp ? h('div', { class: 'mine' },
    h('h3', { class: 'sec' }, isMe ? 'Du' : nameOfId(ctx, subj)),
    pr.ratio >= 1 ? h('p', {}, badgeHasLevels(b) ? 'Alle Stufen geschafft.' : 'Geschafft.')
      : pr.text ? h('ul', { class: 'goal-list' }, h('li', {}, goalRow(ctx, A, b, pr, false)))
        : h('p', { class: 'muted' }, pr.level ? `Erreicht: ${tierName(cfg, pr.level)}.` : 'Noch nicht geschafft.'),
    hintsBlock(ctx, A, b, subj)) : null;

  // who comes closest (not complete yet, some progress)
  const close = def.unit ? [...A.players.entries()]
    .filter(([id]) => id !== subj)
    .map(([id, p]) => ({ id, pr: progressOf(cfg, A.levels, b, p) }))
    .filter(x => x.pr.ratio > 0 && x.pr.ratio < 1)
    .sort((x, y) => y.pr.ratio - x.pr.ratio).slice(0, 5) : [];

  return [
    viewHead(def.name, `Zählt: ${SCOPE[def.scope]}.`, { back: true, key: 'badge', info }),
    levels,
    extra,
    mine,
    h('h3', { class: 'sec' }, s.holders.length ? `Geschafft (${s.holders.length})` : 'Geschafft'),
    s.holders.length
      ? plainTable(['Spieler', badgeHasLevels(b) ? 'Stufe' : '', 'am'],
          s.holders.map(x => [nameOfId(ctx, x.id), badgeHasLevels(b) ? tierName(cfg, x.level) : '',
            x.topG != null ? h('a', { ...gameLinkBase(ctx, x.topG) }, fmt.date(x.top)) : fmt.date(x.top)]),
          [2], s.holders.map(x => collectionLink(ctx, x.id)))
      : h('p', { class: 'empty' }, 'Noch hat es niemand geschafft.'),
    close.length ? [h('h3', { class: 'sec' }, 'Am nächsten dran'),
      h('ul', { class: 'goal-list' }, close.map(x => h('li', {}, h('a', { class: 'goal tap', ...linkTo(ctx, 'abzeichen', { id: b, spieler: x.id }) },
        h('span', { class: 'goal-text' },
          h('span', { class: 'goal-name' }, nameOfId(ctx, x.id)),
          bar(x.pr.ratio),
          h('span', { class: 'goal-sub' }, x.pr.text))))))] : null,
  ];
}

/** Abzeichen of 2 or 4 players side by side (Direktvergleich). Differences first, all of them folded. */
export function badgeCompare(ctx, ids) {
  const A = ctx.badges;
  const head = h('h2', {}, 'Abzeichen');
  if (!A) return [head, h('p', { class: 'muted' }, 'Werden berechnet …')];
  const cfg = ctx.baseModel.dataset.config;
  const P = ids.map(id => A.players.get(id) || { level: {}, earned: [] });
  const cols = ['', ...ids.map(id => nameOfId(ctx, id))];
  const cell = (b, p) => {
    const lv = p.level[b] || 0;
    return h('span', { class: 'cmp-cell' }, badgeMedal(cfg, b, lv, 30, lv ? badgeLabel(cfg, b, lv) : 'noch nicht'),
      badgeHasLevels(b) && lv ? h('span', { class: 'cmp-lv' }, String(lv)) : null);
  };
  const rowsFor = list => list.map(b => [DEFS[b].name, ...P.map(p => cell(b, p))]);
  const differ = ORDER.filter(b => new Set(P.map(p => p.level[b] || 0)).size > 1);
  const total = totalLevels(A);
  const table = list => h('div', { class: 'cmp' }, plainTable(cols, [[`Stufen (von ${total})`, ...P.map(p => String(earnedCount(p)))], ...rowsFor(list)], [],
    [linkTo(ctx, 'abzeichen'), ...list.map(b => linkTo(ctx, 'abzeichen', { id: b }))]));
  return [head,
    h('p', { class: 'muted' }, 'Gezählt über alle Spiele. Die Zahl neben der Medaille ist die Stufe.'),
    differ.length ? table(differ) : h('p', {}, 'Bei den Abzeichen sind alle gleichauf.'),
    h('details', { class: 'hints' }, h('summary', {}, `Alle ${ORDER.length} Abzeichen`), table(ORDER))];
}

/** „Was fehlt noch?“: folded, so the page stays short. Opponents → Direktvergleich, partners → Team. */
function hintsBlock(ctx, A, b, id) {
  const cfg = ctx.baseModel.dataset.config;
  const players = ctx.baseModel.dataset.players;
  const active = new Set([...players.values()].filter(p => p.active).map(p => p.id));
  const elo = ctx.baseModel.elo;
  const H = hintsFor(cfg, A, b, id, {
    nameOf: j => nameOfId(ctx, j),
    ratingOf: j => elo.final[elo.index.get(j)],
    isActive: j => active.has(j),
    activeIds: elo.ids.filter(j => active.has(j) && elo.played[elo.index.get(j)] > 0),
  });
  if (!H) return null;
  const link = (r) => r.link === 'team' ? linkTo(ctx, 'team', { a: id, b: r.id }) : linkTo(ctx, 'h2h', { a: id, b: r.id });
  return h('details', { class: 'hints' },
    h('summary', {}, 'Was fehlt noch?'),
    H.lines.map(t => h('p', {}, t)),
    H.groups.map(g => [h('h4', {}, g.title),
      h('ul', { class: 'hint-list' }, g.rows.map(r => h('li', {}, h('a', { class: 'tap' + (r.done ? ' done' : ''), ...link(r) },
        h('span', { class: 'hint-name' }, nameOfId(ctx, r.id)), r.text ? h('span', { class: 'hint-text' }, r.text) : null))))]),
    h('p', { class: 'muted small' }, 'Stand jetzt. Was einmal verdient ist, bleibt.'));
}

/** „Läuft noch“: who leads the current calendar week (no badge until Monday 0 Uhr). */
export function runningWeek(ctx, A) {
  const r = A.running;
  return h('p', { class: 'note-line' },
    r?.id ? `Diese Woche führt bisher ${nameOfId(ctx, r.id)} mit ${fmt.signed(r.gain)} Punkten. Das Abzeichen gibt es erst, wenn die Woche vorbei ist.`
      : 'Diese Woche hat bisher niemand genug Spiele für den Aufsteiger der Woche.',
    ' ', h('a', { ...linkTo(ctx, 'ruhmeshalle') }, 'Ruhmeshalle'));
}

// ───────── one player's collection ─────────

function collection(ctx, A, id) {
  const cfg = ctx.baseModel.dataset.config;
  const p = A.players.get(id);
  const isMe = ctx.me?.id === id;
  const total = totalLevels(A);
  const newest = newestOf(p).slice(0, 3);
  const goals = nextGoals(cfg, A, p, 3);
  return [
    viewHead(isMe ? 'Deine Abzeichen' : `Abzeichen von ${nameOfId(ctx, id)}`, `${earnedCount(p)} von ${total} Stufen`, { back: true, key: 'collection', info: [RULE, 'Der Balken zeigt, wie weit es noch bis zur nächsten Stufe ist.'] }),
    h('nav', { class: 'links' }, h('a', { class: 'tap', ...linkTo(ctx, 'player', { id }) }, isMe ? 'Dein Profil' : `Profil von ${nameOfId(ctx, id)}`),
      h('a', { class: 'tap', ...linkTo(ctx, 'abzeichen') }, 'Alle Abzeichen')),
    newest.length ? [h('h3', { class: 'sec' }, 'Zuletzt'),
      h('div', { class: 'earned-list' }, newest.map(e => earnedCard(ctx, A, e, { isNew: isMe && e.t > ctx.badgeSeen })))] : null,
    goals.length ? [h('h3', { class: 'sec' }, 'Als Nächstes'), h('ul', { class: 'goal-list' }, goals.map(x => h('li', {}, goalRow(ctx, A, x.b, x.pr, id))))] : null,
    CATEGORIES.map(cat => h('section', { class: 'hub-group' },
      h('h3', {}, cat),
      h('ul', { class: 'badge-list' }, ORDER.filter(b => DEFS[b].cat === cat).map(b => {
        const lv = p.level[b] || 0, pr = progressOf(cfg, A.levels, b, p);
        const status = lv ? (badgeHasLevels(b) ? `${tierName(cfg, lv)}${pr.ratio >= 1 ? ', alle Stufen' : ''}` : 'geschafft') : 'noch nicht';
        return h('li', {}, h('a', { class: 'badge-row tap' + (lv ? '' : ' locked'), ...linkTo(ctx, 'abzeichen', { id: b, spieler: id }) },
          badgeMedal(cfg, b, lv, 44),
          h('span', { class: 'br-text' },
            h('span', { class: 'br-name' }, DEFS[b].name, h('span', { class: 'br-mine' }, status)),
            pr.ratio < 1 ? h('span', { class: 'br-sub' }, badgeHasLevels(b) ? `${tierName(cfg, lv + 1)}: ${condText(A, cfg, b, lv)}` : condText(A, cfg, b, 0)) : null,
            pr.ratio > 0 && pr.ratio < 1 ? bar(pr.ratio) : null,
            pr.ratio < 1 && pr.text ? h('span', { class: 'br-rare' }, pr.text) : null)));
      })))),
  ];
}
