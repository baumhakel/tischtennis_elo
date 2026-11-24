// Preparing a photo for upload, on the phone (Phase 18b): decode (rotation of phone photos respected), scale,
// crop, re-encode as JPEG. Re-encoding drops all metadata, including the GPS location.
//
//   decodeImage(file) → { source (ImageBitmap | HTMLImageElement), width, height, close() }
//   prepareUpload(img, { maxEdge, thumbEdge, quality, crop, rotate }) → { image: Blob, thumb: Blob, width, height }
//     crop = { zoom, x, y } (core/photos.js squareCrop) for a profile picture: then the full image is that square too;
//     without crop the preview is the centre square of the photo. rotate = quarter turns clockwise (0–3).
import { fitSize, squareCrop } from '../core/photos.js';

export async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close?.() };
    } catch { /* fall back to <img> below (older Safari) */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } catch {
    throw new Error('Dieses Bild kann der Browser nicht öffnen. Bitte ein anderes Foto wählen (JPEG oder PNG).');
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

const toBlob = (canvas, quality) => new Promise((resolve, reject) =>
  canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Das Bild konnte nicht umgewandelt werden.'))), 'image/jpeg', quality));

/** Draw (a part of) the image into a w × h canvas, turned by `rotate` quarter turns. */
function draw(img, { sx = 0, sy = 0, sw, sh, w, h, rotate = 0 }) {
  const c = document.createElement('canvas');
  const turned = rotate % 2 === 1;
  c.width = turned ? h : w;
  c.height = turned ? w : h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);         // JPEG has no transparency: white behind PNGs
  g.imageSmoothingQuality = 'high';
  g.translate(c.width / 2, c.height / 2);
  g.rotate(rotate * Math.PI / 2);
  g.drawImage(img.source, sx, sy, sw ?? img.width, sh ?? img.height, -w / 2, -h / 2, w, h);
  return c;
}

export async function prepareUpload(img, { maxEdge, thumbEdge, quality, crop = null, rotate = 0 }) {
  const turned = rotate % 2 === 1;
  if (crop) {
    const { sx, sy, size } = squareCrop(img.width, img.height, crop);
    const edge = Math.min(Math.round(size), maxEdge);
    const full = draw(img, { sx, sy, sw: size, sh: size, w: edge, h: edge, rotate });
    const thumb = draw(img, { sx, sy, sw: size, sh: size, w: thumbEdge, h: thumbEdge, rotate });
    return { image: await toBlob(full, quality), thumb: await toBlob(thumb, quality), width: edge, height: edge };
  }
  const { w, h } = fitSize(img.width, img.height, maxEdge);
  const full = draw(img, { w, h, rotate });
  const sq = squareCrop(img.width, img.height);
  const thumb = draw(img, { sx: sq.sx, sy: sq.sy, sw: sq.size, sh: sq.size, w: thumbEdge, h: thumbEdge, rotate });
  return { image: await toBlob(full, quality), thumb: await toBlob(thumb, quality), width: turned ? h : w, height: turned ? w : h };
}
