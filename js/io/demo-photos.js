// Demo stand-in for the photo web app (Phase 18b): nothing goes over the network. The made-up photos of
// io/demo.js are drawn here (colourful shapes and initials, a table-tennis table; no real faces); uploads and
// deletions go to demoForms (io/demo.js), so they appear in the demo data on the next read. Browser only (canvas).
import { initials } from '../core/photos.js';

const HUES = [152, 210, 28, 280, 350, 190, 45, 120, 320, 240, 10, 170, 260, 80, 300];

function hash(s) { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

function canvasBlob(c) { return new Promise(r => c.toBlob(r, 'image/jpeg', 0.85)); }

/** A profile picture: a coloured disc pattern with the initials. */
function drawAvatar(name, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'), h = hash(name), hue = HUES[h % HUES.length];
  const grad = g.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, `hsl(${hue} 65% 58%)`);
  grad.addColorStop(1, `hsl(${(hue + 40) % 360} 70% 38%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 5; i++) {
    g.fillStyle = `hsla(${(hue + i * 50) % 360} 80% 80% / 0.25)`;
    g.beginPath();
    g.arc(((h >> (i * 3)) % 100) / 100 * size, ((h >> (i * 4 + 1)) % 100) / 100 * size, size * (0.15 + i * 0.05), 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#fff';
  g.font = `700 ${Math.round(size * 0.42)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(initials(name), size / 2, size / 2 + size * 0.03);
  return c;
}

/** A game photo: a table-tennis table seen from above, a net, a ball, and the caption as a sign. */
function drawGame(id, w, h, caption) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d'), k = hash(id);
  g.fillStyle = `hsl(${30 + k % 20} 25% ${70 + k % 10}%)`;
  g.fillRect(0, 0, w, h);
  const tw = w * 0.7, th = h * 0.55, tx = (w - tw) / 2, ty = (h - th) / 2;
  g.fillStyle = '#1d5c3f';
  g.fillRect(tx, ty, tw, th);
  g.strokeStyle = '#fff';
  g.lineWidth = Math.max(4, w / 200);
  g.strokeRect(tx, ty, tw, th);
  g.beginPath(); g.moveTo(tx, ty + th / 2); g.lineTo(tx + tw, ty + th / 2); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillRect(w / 2 - g.lineWidth, ty - h * 0.04, g.lineWidth * 2, th + h * 0.08);
  g.fillStyle = '#ff8a1f';
  g.beginPath();
  g.arc(tx + tw * (0.2 + (k % 60) / 100), ty + th * (0.2 + (k % 50) / 100), Math.min(w, h) * 0.025, 0, Math.PI * 2);
  g.fill();
  if (caption) {
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(0, h - h * 0.12, w, h * 0.12);
    g.fillStyle = '#fff';
    g.font = `600 ${Math.round(h * 0.05)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(caption, w / 2, h - h * 0.06);
  }
  return c;
}

/**
 * @param {ReturnType<import('./demo.js').demoForms>} demo
 * @param {() => import('../types.js').Dataset | null} dataset   the current data, to know what a made-up photo shows
 */
export function demoPhotoClient(demo, dataset) {
  return {
    async upload(o) { return demo.addPhoto(o); },
    async remove(id) { demo.removePhoto(id); },
    async get(ids, size = 'thumb') {
      const out = new Map(), ds = dataset();
      for (const id of ids) {
        const own = demo.photoFile(id, size);
        if (own) { out.set(id, own); continue; }
        const p = ds?.photos?.list.find(x => x.id === id);
        if (!p) continue;
        const name = p.kind === 'spieler' ? ds.players.get(p.ref)?.name || '?' : '';
        const c = p.kind === 'spieler'
          ? drawAvatar(name, size === 'full' ? 512 : 256)
          : size === 'full' ? drawGame(id, p.width || 1200, p.height || 900, p.caption) : drawGame(id, 256, 256, '');
        out.set(id, await canvasBlob(c));
      }
      return out;
    },
  };
}
