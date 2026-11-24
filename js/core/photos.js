// Fotos (Phase 18b), pure: the tab „fotos“ → photos by game, by player and the profile pictures; who may do what;
// the size and crop arithmetic for preparing an upload. No DOM, no network.
//
//   parsePhotos(grid, players) → { list, byRef: Map 'kind|ref' → [photo], avatar: Map playerId → photo, count, rev }
//   photosFor(dataset, kind, ref) → [photo] newest first        avatarOf(dataset, playerId) → photo | null
//   canDelete(photo, email, cfg)                                 canSetAvatar(dataset, playerId, email)
//   fitSize(w, h, maxEdge) → { w, h }                            squareCrop(w, h, { zoom, x, y }) → { sx, sy, size }
//   initials(name) → 'AB'                                       uploaderName(dataset, email) → display name | null
//
// photo = { id, kind, ref, width, height, caption, by (e-mail), at (sheet serial) }; deleted rows are dropped.
import { readTable, cell, clean, norm, toNumber, parseTime } from './normalize.js';

export const PHOTO_COLUMNS = {
  id: ['id'], kind: ['kind'], ref: ['ref'], width: ['width'], height: ['height'], caption: ['caption'],
  uploaded_by: ['uploaded_by'], uploaded_at: ['uploaded_at'], deleted_at: ['deleted_at'],
};
const OPTIONAL = ['width', 'height', 'caption', 'uploaded_by', 'uploaded_at', 'deleted_at'];

const EMPTY = () => ({ list: [], byRef: new Map(), avatar: new Map(), count: 0, rev: '' });

/** A game_ref may come back from the sheet as text or as a date cell: always the text form. */
export const refKey = (kind, ref) => `${kind}|${ref}`;

export function parsePhotos(grid, players) {
  if (!grid || grid.length < 2) return EMPTY();
  const t = readTable(grid, PHOTO_COLUMNS, OPTIONAL);
  if (t.missing.length) return EMPTY();
  const list = [];
  let deleted = 0;
  for (const { cells } of t.rows) {
    const id = clean(cell(cells, t.col.id));
    if (!id) continue;
    if (clean(cell(cells, t.col.deleted_at))) { deleted++; continue; }
    list.push({
      id, kind: clean(cell(cells, t.col.kind)), ref: clean(cell(cells, t.col.ref)),
      width: toNumber(cell(cells, t.col.width)) || 0, height: toNumber(cell(cells, t.col.height)) || 0,
      caption: clean(cell(cells, t.col.caption)), by: norm(cell(cells, t.col.uploaded_by)),
      at: parseTime(cell(cells, t.col.uploaded_at)) ?? 0,
    });
  }
  list.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
  const byRef = new Map(), avatar = new Map();
  for (const p of list) {
    const k = refKey(p.kind, p.ref);
    if (!byRef.has(k)) byRef.set(k, []);
    byRef.get(k).push(p);
    if (p.kind === 'spieler' && players?.has(p.ref) && !avatar.has(p.ref)) avatar.set(p.ref, p);
  }
  return { list, byRef, avatar, count: list.length, rev: `${list.length}:${deleted}:${list[0]?.id || ''}` };
}

export const photosFor = (dataset, kind, ref) => dataset.photos?.byRef.get(refKey(kind, ref)) || [];
export const avatarOf = (dataset, id) => dataset.photos?.avatar.get(id) || null;

/** The uploader and the management accounts may delete (decided 24 Nov 2026). */
export function canDelete(photo, email, cfg) {
  const e = norm(email);
  if (!e || !photo) return false;
  return photo.by === e || (Array.isArray(cfg?.management_accounts) && cfg.management_accounts.some(x => norm(x) === e));
}

/** Only the player themselves sets a profile picture: the signed-in account must be one of the player's accounts. */
export function canSetAvatar(dataset, playerId, email) {
  const p = dataset.players.get(playerId);
  return !!p && !!email && (p.accounts || []).includes(norm(email));
}

/** The player whose account uploaded it, for „Foto: Clara“ (never the e-mail address). */
export function uploaderName(dataset, email) {
  if (!email) return null;
  for (const p of dataset.players.values()) if ((p.accounts || []).includes(email)) return p.name;
  return null;
}

/** Scale so the longer edge is at most maxEdge (never up). */
export function fitSize(w, h, maxEdge) {
  const s = Math.min(1, maxEdge / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/**
 * The square cut out of a w × h image. zoom ≥ 1 (1 = the largest square), x / y in −1 … 1 move the square
 * from one edge to the other (0 = centred).
 */
export function squareCrop(w, h, { zoom = 1, x = 0, y = 0 } = {}) {
  const size = Math.min(w, h) / Math.max(1, zoom);
  const clamp = v => Math.max(-1, Math.min(1, v));
  const sx = (w - size) / 2 * (1 + clamp(x));
  const sy = (h - size) / 2 * (1 + clamp(y));
  return { sx, sy, size };
}

/** „Anna Berger“ → „AB“, „Clara“ → „C“, „Bernd 2“ → „B2“. */
export function initials(name) {
  const parts = clean(name).split(' ').filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts.at(-1)[0]).toUpperCase();
}
