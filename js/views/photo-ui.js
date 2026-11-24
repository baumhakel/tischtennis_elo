// Photo parts the pages share (Phase 18b): a strip of previews with „Foto hinzufügen“, the viewer with caption and
// actions, and the upload sheet (camera or album → crop / caption → upload). Uses ctx.photos (app/photos.js) and
// ctx.actions.uploadPhoto / removePhoto.
import { h, render } from '../ui/dom.js';
import * as fmt from '../ui/format.js';
import { openSheet } from '../ui/sheet.js';
import { openViewer } from '../ui/viewer.js';
import { decodeImage, prepareUpload } from '../ui/image.js';
import { squareCrop, uploaderName } from '../core/photos.js';
import { findGame } from './game-query.js';
import { resultSentence } from './enter-logic.js';
import { linkTo } from './common.js';

const CAPTION_MAX = 80;

/** What a photo shows, in words: „Anna schlägt Bernd · 24.11.2026“ / „Profilbild von Anna“. */
export function photoTitle(ctx, p) {
  const ds = ctx.baseModel.dataset, name = id => ctx.names.get(id) ?? ds.players.get(id)?.name ?? id;
  if (p.kind === 'spieler') return `Profilbild von ${name(p.ref)}`;
  if (p.kind === 'turnier' || p.kind === 'turnier_spiel') {   // Phase 18: ref = tournament id, or `id#nr`
    const [id, nr] = p.ref.split('#');
    const T = ds.tournaments?.find(t => t.id === id);
    const m = nr && T?.ok ? T.matches.find(x => x.nr === Number(nr)) : null;
    const side = s => (s?.id ? name(s.id) : s?.name || '?');
    if (m) return `${T.name}, Spiel ${m.nr}: ${side(m.a)} gegen ${side(m.b)}`;
    return T ? `${T.name}${T.date != null ? ` · ${fmt.date(T.date)}` : ''}` : 'Turnier';
  }
  if (p.kind === 'spiel') {
    const g = findGame(ds, p.ref);
    if (g >= 0) { const x = ds.games[g]; return `${resultSentence(x.winners, x.losers, name)} · ${fmt.date(x.t)}`; }
  }
  return 'Foto';
}

/** Open the viewer on `list` at `index`. */
export function showPhotos(ctx, list, index = 0) {
  const ds = ctx.baseModel.dataset;
  openViewer({
    photos: list, index,
    preview: p => ctx.photos.url(p.id, 'thumb'),
    load: (p, size) => ctx.photos.load(p.id, size),
    caption: p => {
      const who = uploaderName(ds, p.by);
      return [h('strong', {}, photoTitle(ctx, p)), p.caption ? h('span', {}, ` · „${p.caption}“`) : null,
        h('span', { class: 'muted' }, [p.at && p.kind !== 'spiel' ? ` · ${fmt.date(p.at)}` : '', who ? ` · Foto: ${who}` : ''].join(''))];
    },
    actions: (p, close) => {
      const out = [];
      if (p.kind === 'spiel' && !(ctx.state.view === 'spiel' && ctx.params.ref === p.ref)) {
        const l = linkTo(ctx, 'spiel', { ref: p.ref });
        out.push({ label: 'Zum Spiel', href: l.href, onclick: e => { e.preventDefault(); close(); ctx.navigate('spiel', { ref: p.ref }); } });
      }
      if (p.kind === 'spieler' && !(ctx.state.view === 'player' && ctx.params.id === p.ref)) {
        out.push({ label: 'Zum Profil', onclick: () => { close(); ctx.navigate('player', { id: p.ref }); } });
      }
      if ((p.kind === 'turnier' || p.kind === 'turnier_spiel') && !['turnier', 'turnierspiel'].includes(ctx.state.view)) {
        const [id, nr] = p.ref.split('#');
        out.push({ label: nr ? 'Zum Turnierspiel' : 'Zum Turnier', onclick: () => { close(); ctx.navigate(nr ? 'turnierspiel' : 'turnier', nr ? { id, nr } : { id }); } });
      }
      if (p.kind === 'turnier' && ctx.photos.canSetWinner && ctx.tournaments?.list.find(t => t.id === p.ref)?.winnerPhoto !== p.id) {
        out.push({ label: 'Als Siegerfoto', onclick: async e => {
          const b = e.currentTarget; b.disabled = true; b.textContent = 'Wird gesetzt …';
          try { await ctx.actions.setWinnerPhoto(p.id, p.ref); close(); ctx.actions.notify('Siegerfoto gesetzt.'); }
          catch (err) { b.disabled = false; b.textContent = 'Als Siegerfoto'; ctx.actions.notify(err?.message || 'Das hat nicht geklappt.'); }
        } });
      }
      out.push({ label: 'Teilen', onclick: () => sharePhoto(ctx, p) });
      if (ctx.photos.canDelete(p)) {
        out.push({ label: 'Löschen', danger: true, onclick: async e => {
          const b = e.currentTarget;
          if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Wirklich löschen?'; return; }
          b.disabled = true; b.textContent = 'Wird gelöscht …';
          try { await ctx.actions.removePhoto(p.id); close(); ctx.actions.notify('Foto gelöscht.'); }
          catch (err) { b.disabled = false; b.textContent = 'Löschen'; ctx.actions.notify(err?.message || 'Löschen hat nicht geklappt.'); }
        } });
      }
      return out;
    },
  });
}

/** The image itself (Web Share with the file where the phone can, else a download). */
async function sharePhoto(ctx, p) {
  const url = await ctx.photos.load(p.id, 'full');
  if (!url) return;
  const blob = await (await fetch(url)).blob();
  const file = new File([blob], `tischtennis-${p.id}.jpg`, { type: 'image/jpeg' });
  document.dispatchEvent(new CustomEvent('tt-usage', { detail: 'foto-teilen' }));
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: photoTitle(ctx, p) }); } catch { /* cancelled */ }
    return;
  }
  const a = h('a', { href: url, download: file.name });
  document.body.append(a); a.click(); a.remove();
}

/** A row of previews (tap → viewer) plus the add button. Nothing when photos aren't set up. */
export function photoStrip(ctx, kind, ref, { title = 'Fotos', add = true, addLabel = 'Foto hinzufügen', square = false } = {}) {
  if (!ctx.photos?.on) return null;
  const list = ctx.photos.list(kind, ref);
  if (!list.length && !(add && ctx.photos.canUpload)) return null;
  return h('section', { class: 'photo-strip' },
    list.length ? h('h3', {}, title) : null,
    list.length ? h('div', { class: 'thumbs' }, list.map((p, i) => thumbButton(ctx, p, () => showPhotos(ctx, list, i)))) : null,
    add && ctx.photos.canUpload ? h('div', { class: 'menu-actions' }, uploadButton(ctx, { kind, ref, label: addLabel, square })) : null);
}

/** One preview as a button (the image, or a placeholder of the same size until it is there). */
export function thumbButton(ctx, p, onclick, size = 88) {
  const url = ctx.photos.url(p.id, 'thumb');
  return h('button', { type: 'button', class: 'thumb', style: `--th:${size}px`, 'aria-label': `Foto ansehen: ${photoTitle(ctx, p)}`, onclick },
    url ? h('img', { src: url, alt: '', decoding: 'async' }) : null);
}

export function uploadButton(ctx, o) {
  return h('button', { type: 'button', class: 'secondary small', onclick: () => openUpload(ctx, o) }, o.label || 'Foto hinzufügen');
}

/**
 * The upload sheet. square = a profile picture (crop to a square, front camera), else a game photo (caption,
 * rotate, rear camera).
 */
export function openUpload(ctx, { kind, ref, square = false, title = null }) {
  const cfg = ctx.baseModel.dataset.config;
  let img = null;
  const sheet = openSheet(pickStep());

  function pickStep(error = null) {
    const input = capture => h('input', { type: 'file', accept: 'image/*', ...(capture ? { capture } : {}), class: 'visually-hidden',
      onchange: async e => {
        const file = e.target.files?.[0];
        if (!file) return;
        sheet.set({ title: title || (square ? 'Profilbild' : 'Foto hinzufügen'), body: h('p', { class: 'muted' }, 'Wird geöffnet …'), actions: [{ label: 'Abbrechen' }] });
        try { img = await decodeImage(file); sheet.set(editStep()); }
        catch (err) { sheet.set(pickStep(err.message)); }
      } });
    return {
      title: title || (square ? 'Profilbild' : 'Foto hinzufügen'),
      body: [
        error ? h('p', { class: 'error' }, error) : null,
        h('div', { class: 'pick-source' },
          h('label', { class: 'btn primary file-btn' }, 'Foto aufnehmen', input(square ? 'user' : 'environment')),
          h('label', { class: 'btn file-btn' }, 'Aus Fotos wählen', input(null))),
        h('p', { class: 'muted small' }, 'Nur Fotos von Leuten, die einverstanden sind. Wer drauf ist, kann jederzeit um Löschung bitten. Sehen können die Fotos alle, die auch die Spiele sehen.'),
      ],
      actions: [{ label: 'Abbrechen' }],
    };
  }

  function editStep() {
    const state = { zoom: 1, x: 0, y: 0, rotate: 0 };
    const error = h('p', { class: 'error', hidden: true });
    const VIEW = 260;
    const canvas = h('canvas', { class: square ? 'crop' : 'preview-canvas', 'aria-label': square ? 'Ausschnitt: zum Verschieben ziehen' : 'Vorschau' });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    function draw() {
      const g = canvas.getContext('2d');
      if (square) {
        canvas.width = canvas.height = VIEW * dpr;
        const c = squareCrop(img.width, img.height, state);
        g.drawImage(img.source, c.sx, c.sy, c.size, c.size, 0, 0, canvas.width, canvas.height);
        // the round profile picture: dim what lies outside the circle
        g.fillStyle = 'rgba(0,0,0,0.45)';
        g.beginPath();
        g.rect(0, 0, canvas.width, canvas.height);
        g.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2, true);
        g.fill('evenodd');
      } else {
        const turned = state.rotate % 2 === 1;
        const w = turned ? img.height : img.width, hh = turned ? img.width : img.height;
        const s = Math.min(1, (VIEW * 1.3 * dpr) / Math.max(w, hh));
        canvas.width = Math.round(w * s); canvas.height = Math.round(hh * s);
        g.save();
        g.translate(canvas.width / 2, canvas.height / 2);
        g.rotate(state.rotate * Math.PI / 2);
        const dw = img.width * s, dh = img.height * s;
        g.drawImage(img.source, -dw / 2, -dh / 2, dw, dh);
        g.restore();
      }
    }
    if (square) {
      let drag = null;
      canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, s: { ...state } }; canvas.setPointerCapture(e.pointerId); });
      canvas.addEventListener('pointermove', e => {
        if (!drag) return;
        const c = squareCrop(img.width, img.height, drag.s);
        const per = c.size / VIEW;                   // source pixels per screen pixel
        const half = v => (v > 0 ? v / 2 : 1);
        const hw = half(img.width - c.size), hh = half(img.height - c.size);
        state.x = Math.max(-1, Math.min(1, drag.s.x - (e.clientX - drag.x) * per / hw));
        state.y = Math.max(-1, Math.min(1, drag.s.y - (e.clientY - drag.y) * per / hh));
        draw();
      });
      const stop = () => { drag = null; };
      canvas.addEventListener('pointerup', stop);
      canvas.addEventListener('pointercancel', stop);
      canvas.addEventListener('wheel', e => { e.preventDefault(); state.zoom = Math.max(1, Math.min(4, state.zoom * (e.deltaY < 0 ? 1.1 : 0.9))); zoom.value = String(state.zoom); draw(); }, { passive: false });
    }
    const zoom = h('input', { type: 'range', min: '1', max: '4', step: '0.01', value: '1', 'aria-label': 'Vergrößern',
      oninput: e => { state.zoom = Number(e.target.value); draw(); } });
    const caption = h('input', { type: 'text', maxlength: String(CAPTION_MAX), placeholder: 'Bildunterschrift (optional)', 'aria-label': 'Bildunterschrift' });
    requestAnimationFrame(draw);
    return {
      title: square ? 'Ausschnitt wählen' : 'Foto hinzufügen',
      body: [
        h('div', { class: 'edit-photo' }, canvas),
        square
          ? h('div', { class: 'form-field' }, h('label', {}, 'Ziehen zum Verschieben, Regler zum Vergrößern'), zoom)
          : [h('div', { class: 'menu-actions' }, h('button', { type: 'button', class: 'secondary small', onclick: () => { state.rotate = (state.rotate + 1) % 4; draw(); } }, 'Drehen')),
            h('div', { class: 'form-field' }, caption)],
        error,
      ],
      actions: [
        { label: 'Anderes Foto', onclick: () => { img?.close(); sheet.set(pickStep()); return false; } },
        { label: 'Hochladen', primary: true, onclick: e => { upload(e.currentTarget, state, caption.value, error); return false; } },
      ],
    };
  }

  async function upload(btn, state, caption, error) {
    btn.disabled = true; btn.textContent = 'Wird hochgeladen …';
    error.hidden = true;
    try {
      const prepared = await prepareUpload(img, {
        maxEdge: cfg.photos_max_edge, thumbEdge: cfg.photos_thumb_edge, quality: cfg.photos_jpeg_quality,
        crop: square ? state : null, rotate: square ? 0 : state.rotate,
      });
      await ctx.actions.uploadPhoto({ kind, ref, ...prepared, caption: square ? '' : caption.trim().slice(0, CAPTION_MAX) });
      img.close();
      sheet.close();
      document.dispatchEvent(new CustomEvent('tt-usage', { detail: square ? 'foto-profilbild' : 'foto-hochladen' }));
      ctx.actions.notify(square ? 'Profilbild gespeichert.' : 'Foto hochgeladen.');
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Hochladen';
      error.textContent = err?.message || 'Hochladen hat nicht geklappt.';
      error.hidden = false;
    }
  }
}

/** A list of photos as a grid of previews (Fotos page). */
export function photoGrid(ctx, list) {
  return h('div', { class: 'thumbs grid' }, list.map((p, i) => thumbButton(ctx, p, () => showPhotos(ctx, list, i), 110)));
}

export { render };
