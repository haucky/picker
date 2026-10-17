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

/**
 * Für Listen, die bei Hintergrund-Änderungen (Abgleich) neu gezeichnet werden, ohne Tipps zu verschlucken:
 * show() ersetzt den Inhalt nur, wenn er sich wirklich geändert hat; request(render) zeichnet erst, wenn kein
 * Finger/keine Maus auf der Liste liegt und hold() false ist (sonst wird es nachgeholt, flush()).
 * Hintergrund: Wird ein Eintrag zwischen Drücken und Loslassen ersetzt, kommt der Klick nie an.
 */
export function stableView(el, { hold = () => false } = {}) {
  let pressing = false;
  let pending = null;
  const flush = () => {
    if (!pending || pressing || hold()) return;
    const render = pending;
    pending = null;
    render();
  };
  el.addEventListener('pointerdown', () => { pressing = true; });
  const release = () => {
    if (!pressing) return;
    pressing = false;
    if (pending) setTimeout(flush, 400); // erst nach dem click-Event
  };
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);
  return {
    show(children) {
      const next = h('div', {}, ...children);
      if (next.innerHTML !== el.innerHTML) el.replaceChildren(...next.childNodes);
    },
    request(render) { pending = render; flush(); },
    flush,
  };
}
