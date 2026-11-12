// Siegchance: one range of pre-game win chances (a calibration bin). Do sides with this chance win
// as often as Elo says, and who beats the odds here? URL: #/siegchance?chance=0.2-0.3&art=singles.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { tile, viewHead, nameOf, plainTable, linkTo } from './common.js';
import { chanceRange, binRange } from './insights.js';

const KINDS = { all: '', singles: 'Einzel', doubles: 'Doppel' };
const ART = { all: null, singles: 'einzel', doubles: 'doppel' };   // → Alle Spiele `art`

export default {
  id: 'siegchance',
  title: 'Siegchance',
  mount(el, ctx) {
    const update = c => render(el, page(c));
    update(ctx);
    return { update, unmount() {} };
  },
};

function page(ctx) {
  const { model } = ctx;
  const bins = model.dataset.config.calibration_bins;
  const kind = ctx.mode === 'alle' && KINDS[ctx.params.art] !== undefined ? ctx.params.art : 'all';   // in Einzel/Doppel the mode is the split
  let lo, hi;
  const m = /^(\d*\.?\d+)-(\d*\.?\d+)$/.exec(ctx.params.chance || '');
  if (m && Number(m[1]) < Number(m[2]) && Number(m[2]) <= 1) { lo = Number(m[1]); hi = Number(m[2]); }
  else ({ lo, hi } = binRange(Math.floor(bins * 0.3), bins));
  const width = hi - lo;
  const r = chanceRange(model, lo, hi, kind);
  const range = `${fmt.pct(lo)} bis ${fmt.pct(hi)}`;
  const role = hi <= 0.5 + 1e-9 ? 'als Außenseiter' : lo >= 0.5 - 1e-9 ? 'als Favorit' : '';
  const chanceParam = `${+lo.toFixed(4)}-${+hi.toFixed(4)}`;
  const neighbour = d => {
    const l = +(lo + d * width).toFixed(4), u = +(hi + d * width).toFixed(4);
    return l >= -1e-9 && u <= 1 + 1e-9 ? linkTo(ctx, 'siegchance', { chance: `${Math.max(0, l)}-${Math.min(1, u)}`, art: kind === 'all' ? null : kind }) : null;
  };
  const prev = neighbour(-1), next = neighbour(1);
  const sgn = v => fmt.signed(v, 1).replace('±0,0', '±0');
  const players = r.players.filter(p => ctx.visible.listed.includes(p.k));

  return [
    viewHead(`Siegchance ${range}`, `Gewinnen Seiten mit dieser Chance so oft, wie Elo sagt?`, { back: true, info: [`Alle ${KINDS[kind] ? KINDS[kind] + ' ' : ''}Spiele, in denen eine Seite vor dem Spiel laut Elo eine Siegchance von ${range} hatte${role ? ` (also ${role})` : ''}. Gleiche Einteilung wie in der Kalibrierung.`, 'Pro Spieler: Siege minus erwartete Siege in diesem Bereich. Im Doppel zählt jedes Spiel für beide Partner. Tippe auf eine Zeile für die Spiele.'] }),
    h('div', { class: 'pager' },
      prev ? h('a', { class: 'secondary-btn', ...prev }, '‹ Niedriger') : h('span'),
      next ? h('a', { class: 'secondary-btn', ...next }, 'Höher ›') : h('span')),
    r.sides
      ? [h('div', { class: 'tiles' },
          tile({ label: 'Spiele', value: fmt.int(r.games), sub: r.sides === r.games ? 'alle ansehen' : `${fmt.int(r.sides)} Seiten in diesem Bereich, alle ansehen`,
            link: linkTo(ctx, 'spiele', { chance: chanceParam, art: ART[kind] }) }),
          tile({ label: 'Erwartete Siege', value: fmt.pct(r.expected / r.sides), sub: `${fmt.dec1(r.expected)} von ${fmt.int(r.sides)}` }),
          tile({ label: 'Tatsächliche Siege', value: fmt.pct(r.actual / r.sides), sub: `${fmt.int(r.actual)} von ${fmt.int(r.sides)}` }),
          tile({ label: 'Über Erwartung', value: sgn(r.actual - r.expected), tone: r.actual - r.expected > 0.5 ? 'up' : r.actual - r.expected < -0.5 ? 'down' : null, sub: 'Siege insgesamt' })),
        h('h2', {}, `Wer schlägt die Erwartung${role ? ' ' + role : ''}?`),
        plainTable(['Spieler', 'Spiele', 'Erwartet', 'Gewonnen', 'Über Erwartung'],
          players.map(p => [nameOf(ctx, p.k), String(p.n), fmt.dec1(p.expected), String(p.actual),
            h('span', { class: p.diff > 0.5 ? 'up' : p.diff < -0.5 ? 'down' : null }, sgn(p.diff))]),
          [1, 2, 3, 4],
          players.map(p => linkTo(ctx, 'spiele', { spieler: model.elo.ids[p.k], chance: chanceParam, art: ART[kind] })))]
      : h('p', { class: 'empty' }, 'In diesem Bereich gibt es keine Spiele.'),
  ];
}
