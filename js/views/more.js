// Mehr: every view in one list.
import { h, render } from '../ui/dom.js';
import { VIEWS } from './index.js';

export default {
  id: 'more',
  title: 'Mehr',
  mount(el, ctx) {
    const update = c => render(el,
      h('nav', { class: 'menu', 'aria-label': 'Alle Ansichten' },
        h('ul', {}, VIEWS.filter(v => v.id !== 'more' && v.menu !== false).map(v =>
          h('li', {}, h('a', { href: `#/${v.id}`, onclick: e => { e.preventDefault(); c.navigate(v.id); } },
            h('span', {}, v.title),
            v.phase ? h('span', { class: 'muted' }, 'folgt') : null))))));
    update(ctx);
    return { update, unmount() {} };
  },
};
