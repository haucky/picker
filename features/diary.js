// Tab Diary: fasst die Funktionen für die persönlichen Diary-Einträge zusammen – Taggen und Streams – mit
// einem Umschalter oben. Der zuletzt gewählte Bereich wird gemerkt.
import { h } from './dom.js';
import tagging from './tagging.js';
import streams from './streams.js';

const SUBS = [tagging, streams];
const STORE = 'diary-sub';

let roots = new Map();
let switcher;
let current = 'streams';

function select(id) {
  current = SUBS.some((f) => f.id === id) ? id : SUBS[0].id;
  try { localStorage.setItem(STORE, current); } catch { /* egal */ }
  for (const [fid, el] of roots) el.hidden = fid !== current;
  for (const b of switcher.children) b.classList.toggle('on', b.dataset.id === current);
  window.scrollTo(0, 0);
  SUBS.find((f) => f.id === current).show?.();
}

export default {
  id: 'diary',
  title: 'Diary',

  mount(root, ui) {
    try { current = localStorage.getItem(STORE) || current; } catch { /* egal */ }
    switcher = h('div', { class: 'subtabs', role: 'tablist' }, ...SUBS.map((f) =>
      h('button', { type: 'button', role: 'tab', 'data-id': f.id, onclick: () => select(f.id) }, f.title)));
    root.append(switcher);
    for (const f of SUBS) {
      const el = h('section', { class: 'subpanel', hidden: true });
      root.append(el);
      roots.set(f.id, el);
      f.mount(el, ui);
    }
  },

  show() { select(current); },

  /** Tab verlassen: Unterbereiche verstecken, damit sie im Hintergrund nicht neu zeichnen. */
  hide() { for (const el of roots.values()) el.hidden = true; },
};
