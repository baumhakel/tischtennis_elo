// Stand-in for views that are built in a later phase.
import { h, render } from '../ui/dom.js';

export function placeholder(def) {
  return {
    id: def.id,
    title: def.title,
    mount(el, ctx) {
      render(el, h('section', { class: 'placeholder' },
        h('h2', {}, def.title),
        h('p', { class: 'muted' }, 'Diese Ansicht folgt in einer späteren Version.'),
        h('button', { class: 'secondary', onclick: () => ctx.navigate('dashboard') }, 'Zur Übersicht')));
      return { update() {}, unmount() {} };
    },
  };
}
