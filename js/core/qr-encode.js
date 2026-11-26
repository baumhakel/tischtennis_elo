// QR code encoder (Phase 18c), pure: text → module matrix. Byte mode (UTF-8), versions 1–10, error correction
// L, M, Q or H (H by default, so the rounded modules and the racket eyes of ui/qr.js stay readable). No library:
// none draws racket-shaped finder patterns, and the code is small. Follows ISO/IEC 18004 (same steps as the
// well-known Nayuki implementation): data bits → Reed–Solomon blocks → interleave → place → best of 8 masks.
//
//   encodeQr(text, { ecl = 'H', minVersion = 1, mask = null }) → { version, size, ecl, mask, modules: boolean[][] (row, col),
//                                                       isFinder(row, col) }   throws if the text is too long
//   rsRemainder(data, n), formatBits(ecl, mask), CAPACITY   (exported for the tests)

const ECL_BITS = { L: 1, M: 0, Q: 3, H: 2 };
// per version 1–10 and level: [ec codewords per block, blocks in group 1, data codewords per block in group 1, blocks in group 2]
// (group 2 blocks have one data codeword more)
const BLOCKS = {
  L: [[7, 1, 19, 0], [10, 1, 34, 0], [15, 1, 55, 0], [20, 1, 80, 0], [26, 1, 108, 0], [18, 2, 68, 0], [20, 2, 78, 0], [24, 2, 97, 0], [30, 2, 116, 0], [18, 2, 68, 2]],
  M: [[10, 1, 16, 0], [16, 1, 28, 0], [26, 1, 44, 0], [18, 2, 32, 0], [24, 2, 43, 0], [16, 4, 27, 0], [18, 4, 31, 0], [22, 2, 38, 2], [22, 3, 36, 2], [26, 4, 43, 1]],
  Q: [[13, 1, 13, 0], [22, 1, 22, 0], [18, 2, 17, 0], [26, 2, 24, 0], [18, 2, 15, 2], [24, 4, 19, 0], [18, 2, 14, 4], [22, 4, 18, 2], [20, 4, 16, 4], [24, 6, 19, 2]],
  H: [[17, 1, 9, 0], [28, 1, 16, 0], [22, 2, 13, 0], [16, 4, 9, 0], [22, 2, 11, 2], [28, 4, 15, 0], [26, 4, 13, 1], [26, 4, 14, 2], [24, 4, 12, 4], [28, 6, 15, 2]],
};
const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const dataCodewords = (v, ecl) => { const [, b1, d1, b2] = BLOCKS[ecl][v - 1]; return b1 * d1 + b2 * (d1 + 1); };
/** Bytes that fit, per level and version 1–10 (byte mode). */
export const CAPACITY = Object.fromEntries(Object.keys(BLOCKS).map(e => [e, Array.from({ length: 10 }, (_, i) => {
  const bits = dataCodewords(i + 1, e) * 8 - 4 - (i + 1 < 10 ? 8 : 16);
  return Math.floor(bits / 8);
})]));

// ───────── Reed–Solomon over GF(256), polynomial 0x11D ─────────

const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
{ let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function generator(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= mul(g[j], EXP[i]); }
    g = next;
  }
  return g;   // highest degree first, g[0] = 1
}

/** The n error correction codewords of `data` (array of bytes). */
export function rsRemainder(data, n) {
  const g = generator(n);
  const rem = new Array(n).fill(0);
  for (const b of data) {
    const f = b ^ rem[0];
    rem.shift(); rem.push(0);
    for (let i = 0; i < n; i++) rem[i] ^= mul(g[i + 1], f);
  }
  return rem;
}

// ───────── format and version information ─────────

/** 15 format bits for level and mask (BCH, then the fixed mask 0x5412). */
export function formatBits(ecl, mask) {
  const data = (ECL_BITS[ecl] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | (rem & 0x3FF)) ^ 0x5412;
}
function versionBits(v) {
  let rem = v;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
  return (v << 12) | (rem & 0xFFF);
}
const bit = (x, i) => ((x >>> i) & 1) === 1;

// ───────── encoding ─────────

function utf8(text) {
  if (typeof TextEncoder !== 'undefined') return [...new TextEncoder().encode(text)];
  return [...Buffer.from(text, 'utf8')];
}

export function encodeQr(text, { ecl = 'H', minVersion = 1, mask = null } = {}) {
  const bytes = utf8(String(text));
  let v = Math.max(1, minVersion);
  while (v <= 10 && CAPACITY[ecl][v - 1] < bytes.length) v++;
  if (v > 10) throw new Error(`QR: ${bytes.length} Bytes sind zu lang (höchstens ${CAPACITY[ecl][9]} bei Stufe ${ecl}).`);
  const capacity = dataCodewords(v, ecl);

  // data bits: mode 0100 (byte), count, bytes, terminator, pad to bytes, pad codewords
  const bits = [];
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xEC; data.length < capacity; pad ^= 0xEC ^ 0x11) data.push(pad);

  // blocks, error correction, interleaving
  const [ec, b1, d1, b2] = BLOCKS[ecl][v - 1];
  const blocks = [];
  let k = 0;
  for (let i = 0; i < b1 + b2; i++) {
    const len = d1 + (i >= b1 ? 1 : 0);
    const d = data.slice(k, k + len); k += len;
    blocks.push({ d, e: rsRemainder(d, ec) });
  }
  const out = [];
  for (let i = 0; i < d1 + 1; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.e[i]);

  // function patterns
  const size = 17 + 4 * v;
  const M = Array.from({ length: size }, () => new Array(size).fill(false));
  const F = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (r, c, dark) => { M[r][c] = dark; F[r][c] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }   // timing
  const finder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
      const r = r0 + dr, c = c0 + dc;
      if (r < 0 || c < 0 || r >= size || c >= size) continue;
      const d = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
      set(r, c, d !== 2 && d !== 4);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  const al = ALIGN[v - 1];
  for (const r of al) for (const c of al) {
    if ((r === 6 && c === 6) || (r === 6 && c === al.at(-1)) || (r === al.at(-1) && c === 6)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  drawFormat(M, F, size, ecl, 0);                     // reserve (real bits after the mask is chosen)
  if (v >= 7) {
    const vb = versionBits(v);
    for (let i = 0; i < 18; i++) { const a = size - 11 + (i % 3), b = Math.floor(i / 3); set(b, a, bit(vb, i)); set(a, b, bit(vb, i)); }
  }

  // data placement: two columns at a time, zig-zag from the bottom right, skipping the timing column
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j, up = ((right + 1) & 2) === 0, r = up ? size - 1 - vert : vert;
        if (F[r][c]) continue;
        M[r][c] = i < out.length * 8 ? bit(out[i >>> 3], 7 - (i & 7)) : false;
        i++;
      }
    }
  }

  // masks: the one with the lowest penalty (or the one asked for)
  let best = null;
  for (let m = 0; m < 8; m++) {
    if (mask != null && m !== mask) continue;
    const X = M.map(row => row.slice());
    applyMask(X, F, m);
    drawFormat(X, F, size, ecl, m);
    const p = mask != null ? 0 : penalty(X);
    if (!best || p < best.p) best = { p, X, m };
  }
  const fin = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= size - 7) || (r >= size - 7 && c < 7);
  return { version: v, size, ecl, mask: best.m, modules: best.X, isFinder: fin };
}

function drawFormat(M, F, size, ecl, mask) {
  const b = formatBits(ecl, mask);
  const set = (r, c, d) => { M[r][c] = d; F[r][c] = true; };
  for (let i = 0; i <= 5; i++) set(i, 8, bit(b, i));
  set(7, 8, bit(b, 6)); set(8, 8, bit(b, 7)); set(8, 7, bit(b, 8));
  for (let i = 9; i < 15; i++) set(8, 14 - i, bit(b, i));
  for (let i = 0; i < 8; i++) set(8, size - 1 - i, bit(b, i));
  for (let i = 8; i < 15; i++) set(size - 15 + i, 8, bit(b, i));
  set(size - 8, 8, true);                              // the dark module
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];
function applyMask(M, F, m) {
  const f = MASKS[m];
  for (let r = 0; r < M.length; r++) for (let c = 0; c < M.length; c++) if (!F[r][c] && f(r, c)) M[r][c] = !M[r][c];
}

/** The four penalty rules of the standard (runs, 2×2 blocks, finder-like patterns, dark balance). */
function penalty(M) {
  const n = M.length;
  let p = 0, dark = 0;
  const lines = [];
  for (let r = 0; r < n; r++) lines.push(M[r]);
  for (let c = 0; c < n; c++) lines.push(M.map(row => row[c]));
  const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && line[i] === line[i - 1]) run++;
      else { if (run >= 5) p += 3 + run - 5; run = 1; }
    }
    for (let i = 0; i + 11 <= n; i++) {
      let a = true, b = true;
      for (let k = 0; k < 11; k++) { const x = line[i + k] ? 1 : 0; if (x !== pat1[k]) a = false; if (x !== pat2[k]) b = false; }
      if (a) p += 40; if (b) p += 40;
    }
  }
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (M[r][c]) dark++;
    if (r + 1 < n && c + 1 < n && M[r][c] === M[r][c + 1] && M[r][c] === M[r + 1][c] && M[r][c] === M[r + 1][c + 1]) p += 3;
  }
  p += 10 * Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5);
  return p;
}
