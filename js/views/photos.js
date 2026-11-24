// Fotos (Phase 18b, #/fotos?spieler=): every game photo, newest first, as a grid; tap → the viewer, which swipes
// through all of them. With a player: the photos of their games, plus their profile pictures (the current one first).
import { h, render } from '../ui/dom.js';
import { viewHead } from './common.js';
import { photoGrid, uploadButton } from './photo-ui.js';
import { avatar } from '../ui/avatar.js';

export default {
  id: 'fotos',
  title: 'Fotos',
  mount(el, ctx) {
    const update = c => render(el, page(c));
    update(ctx);
    return { update, unmount() {} };
  },
};

function page(ctx) {
  const ds = ctx.baseModel.dataset;
  const id = ds.players.has(ctx.params.spieler) ? ctx.params.spieler : null;
  const name = id ? ctx.names.get(id) ?? ds.players.get(id).name : null;
  const head = viewHead(id ? `Fotos mit ${name}` : 'Fotos', null, { back: !!id, info: [
    'Fotos von Spielen und Profilbilder. Sehen können sie alle, die auch die Spiele sehen. Hinzufügen: auf der Seite eines Spiels „Foto hinzufügen“, das eigene Profilbild im eigenen Profil.',
    'Löschen kann, wer ein Foto hochgeladen hat (im Foto auf „Löschen“). Wer auf einem Foto ist und es nicht dort haben möchte, meldet das bitte über „Problem melden“.'] });
  if (!ctx.photos?.on) return [head, h('p', { class: 'empty' }, 'Fotos sind noch nicht eingerichtet.')];

  let games = ctx.photos.all('spiel');
  if (id) {
    const refs = new Set(ds.games.filter(g => g.winners.includes(id) || g.losers.includes(id)).map(g => g.ref));
    games = games.filter(p => refs.has(p.ref));
  }
  const profile = id ? ctx.photos.list('spieler', id) : [];
  return [
    head,
    id ? h('div', { class: 'photo-person' }, avatar(ctx, id, { size: 64 }),
      ctx.photos.canSetAvatar(id) ? uploadButton(ctx, { kind: 'spieler', ref: id, square: true, label: profile.length ? 'Profilbild ändern' : 'Profilbild hinzufügen' }) : null) : null,
    games.length ? [id ? h('h3', {}, 'Spiele') : null, photoGrid(ctx, games)]
      : h('p', { class: 'empty' }, id ? `Noch keine Fotos von Spielen mit ${name}.` : 'Noch keine Fotos. Auf der Seite eines Spiels: „Foto hinzufügen“.'),
    profile.length ? [h('h3', {}, profile.length > 1 ? 'Profilbilder (das neueste zuerst)' : 'Profilbild'), photoGrid(ctx, profile)] : null,
  ];
}
