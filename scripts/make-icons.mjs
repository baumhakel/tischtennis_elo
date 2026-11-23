// Renders icons/icon.svg to the PNG icons the manifest and iOS need (headless Chrome, no installs):
//   icons/icon-192.png, icons/icon-512.png (purpose any), icons/icon-maskable-512.png, icons/apple-touch-icon.png (180)
// The drawing keeps everything inside the central 80 % circle, so the maskable icon is the same picture.
//   node scripts/make-icons.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launch, ROOT } from '../test/browser.mjs';

const svg = await readFile(join(ROOT, 'icons/icon.svg'), 'utf8');
const SIZES = [['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-512.png', 512], ['apple-touch-icon.png', 180]];
const browser = await launch();
const page = await browser.newPage();
await page.goto('?icons');
for (const [file, size] of SIZES) {
  const data = await page.evaluate(async (src, n) => {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = n;
    c.getContext('2d').drawImage(img, 0, 0, n, n);
    return c.toDataURL('image/png');
  }, svg, size);
  await writeFile(join(ROOT, 'icons', file), Buffer.from(data.split(',')[1], 'base64'));
  console.log(`icons/${file} (${size} px)`);
}
await browser.close();
