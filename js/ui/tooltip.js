// One shared tooltip element for all charts. Content goes in as DOM nodes (text via text nodes).
import { render } from './dom.js';

let el = null;

function ensure() {
  if (!el) {
    el = document.createElement('div');
    el.className = 'tip';
    el.setAttribute('role', 'tooltip');
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}

/** Show content near viewport point (x, y); keeps the tooltip inside the viewport. */
export function showTip(content, x, y) {
  const t = ensure();
  render(t, content);
  t.hidden = false;
  const r = t.getBoundingClientRect();
  const pad = 12;
  let left = x + pad, top = y + pad;
  if (left + r.width > innerWidth - 8) left = Math.max(8, x - r.width - pad);
  if (top + r.height > innerHeight - 8) top = Math.max(8, y - r.height - pad);
  t.style.left = left + 'px';
  t.style.top = top + 'px';
}

export function hideTip() { if (el) el.hidden = true; }
