// Tiny DOM helper. Text always goes in via text nodes (never innerHTML): names come from form input.

/**
 * h('button', { class: 'x', onclick: fn, 'aria-label': '…' }, 'Text', childNode, [more, children])
 * Props: class, style (string), on* (listeners), dataset (object), any other → attribute.
 * Boolean true → empty attribute; false/null/undefined → omitted.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Replace all children of el. */
export function render(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}
