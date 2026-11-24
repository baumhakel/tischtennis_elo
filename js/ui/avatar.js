// Faces (Phase 18b). A player's profile picture as a small round image, or their initials in a neutral circle of the
// same size, so a row with some faces and some initials still looks tidy. Nothing at all when photos aren't set up
// or faces are switched off on this device (then the app looks exactly as before).
//
//   avatar(ctx, id, { size, ring, label }) → <span class="avatar"> | null
//   faces(ctx, ids, { size }) → overlapping avatars (a team) | null
//   withFace(ctx, id, text, { size }) → [avatar, text] for a name in a list
// ring = a CSS colour for the edge (the player's highlight slot), label = accessible name when the face stands alone.
import { h } from './dom.js';
import { initials } from '../core/photos.js';

export function avatar(ctx, id, { size = 24, ring = null, label = null } = {}) {
  const ph = ctx.photos;
  if (!ph?.faces || !id) return null;
  const name = ctx.names?.get(id) ?? ctx.baseModel?.dataset.players.get(id)?.name ?? id;
  const url = ph.avatarUrl(id);
  const style = `--av:${size}px${ring ? `;--av-ring:${ring}` : ''}`;
  const props = { class: 'avatar' + (ring ? ' ringed' : '') + (url ? '' : ' initials'), style,
    ...(label ? { role: 'img', 'aria-label': name } : { 'aria-hidden': 'true' }) };
  return url
    ? h('span', props, h('img', { src: url, alt: '', decoding: 'async', width: String(size), height: String(size) }))
    : h('span', props, initials(name));
}

export function faces(ctx, ids, { size = 22 } = {}) {
  if (!ctx.photos?.faces || !ids?.length) return null;
  return h('span', { class: 'faces', 'aria-hidden': 'true' }, ids.map(id => avatar(ctx, id, { size })));
}

/** The Siegchance bar with the two sides' faces at its ends (the bar alone without faces). */
export function withEnds(ctx, A, B, bar) {
  const a = faces(ctx, A, { size: 30 }), b = faces(ctx, B, { size: 30 });
  return a ? h('div', { class: 'chance-row' }, a, bar, b) : bar;
}

/** A face for the end of a chart line (ui/charts/line.js draws it): the decoded image, or the initials. */
export function chartFace(ctx, id) {
  if (!ctx.photos?.faces || !id) return null;
  const name = ctx.names?.get(id) ?? ctx.baseModel?.dataset.players.get(id)?.name ?? id;
  return { img: ctx.photos.avatarImage(id), text: initials(name) };
}

export function withFace(ctx, id, text, { size = 24 } = {}) {
  const a = avatar(ctx, id, { size });
  return a ? h('span', { class: 'with-face' }, a, h('span', { class: 'name' }, text)) : text;
}
