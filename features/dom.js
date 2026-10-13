// Kleine DOM-Helfer für Feature-Module.

/** h('div', { class: 'x', onclick: fn, hidden: true }, 'Text', childNode, …) */
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'hidden') node.hidden = !!v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

export function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Text mit <mark> für Treffer von `re` (global), ohne innerHTML. */
export function highlighted(text, re) {
  const frag = document.createDocumentFragment();
  let last = 0;
  re.lastIndex = 0;
  for (let m; (m = re.exec(text)); ) {
    if (!m[0]) { re.lastIndex++; continue; }
    if (m.index > last) frag.append(text.slice(last, m.index));
    frag.append(h('mark', {}, m[0]));
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}
