// Turniere (Phase 18, #/turniere): every tournament the app shows, newest first, with its winner.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { viewHead, linkTo } from './common.js';
import { sideLabel, STATUS_TEXT, MODE_TEXT } from './tournament-ui.js';

export default {
  id: 'turniere',
  title: 'Turniere',
  mount(el, ctx) {
    const update = c => render(el, page(c));
    update(ctx);
    return { update, unmount() {} };
  },
};

function page(ctx) {
  const list = ctx.tournaments?.list || [];
  const head = viewHead('Turniere', null, { info: 'Turniere mit Gruppen oder Schweizer System und K.-o.-Runde, im Einzel oder Doppel. Spiele ohne Gast zählen auch für Elo.' });
  if (!list.length) return [head, h('p', { class: 'empty' }, 'Noch kein Turnier.')];
  return [head, h('ul', { class: 'hub' }, list.map(T => {
    const w = T.ok && T.winner ? T.participants.find(p => p.key === T.winner) : null;
    return h('li', {}, h('a', { class: 'hub-card tap', ...linkTo(ctx, 'turnier', { id: T.id }) },
      h('span', { class: 'hub-title' }, T.name),
      h('span', { class: 'hub-desc' }, [T.date != null ? fmt.date(T.date) : null, STATUS_TEXT[T.status],
        T.ok ? MODE_TEXT(T) : null, T.ok ? `${T.participants.length} ${T.art === 'doppel' ? 'Teams' : 'Teilnehmer'}` : null].filter(Boolean).join(' · ')),
      w ? h('span', { class: 'hub-desc' }, 'Sieger: ', sideLabel(ctx, w, { size: 20 })) : null));
  }))];
}
