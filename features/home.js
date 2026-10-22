// Tab Home: Startbildschirm. Oben die Suche (features/search.js; während gesucht wird, nur die Treffer), darunter
// die Liste der wichtigen Todos (!!!! wichtig, !!!!! unbedingt schnell) aus allen
// Notizen; antippen springt im Study-Editor zur Stelle (bzw. öffnet die Notiz, wenn sie zu keinem Stapel gehört).
// Weitere Bereiche kommen als eigene Abschnitte dazu.
import { h, stableView } from './dom.js';
import { todoItems, dayOfNote, PRIO_IMPORTANT, PRIO_LABEL } from './studydoc.js';
import { parseDecks, inDeck, isConfig, dayToGerman } from './srs.js';
import study from './study.js';
import { createSearch } from './search.js';

let ui, core, root, view, search, content;

/** Todos ab „wichtig“ aus allen Notizen: dringendste zuerst, dann älteste Notiz zuerst. */
function importantTodos() {
  const notes = core.list();
  const cfg = notes.find((n) => isConfig(n.path));
  const decks = cfg ? parseDecks(cfg.text) : [];
  const out = [];
  for (const n of notes) {
    if (isConfig(n.path)) continue;
    for (const t of todoItems(n.text)) {
      if (t.prio < PRIO_IMPORTANT) continue;
      out.push({ ...t, note: n, deck: decks.find((d) => inDeck(n, d)) || null });
    }
  }
  const time = (n) => n.date ?? n.mtime ?? 0;
  return out.sort((a, b) => b.prio - a.prio || time(a.note) - time(b.note) || a.note.path.localeCompare(b.note.path, 'de'));
}

function where({ note, deck }) {
  const day = dayOfNote(note);
  return [deck?.name, day != null ? dayToGerman(day) : null, note.title + (deck ? '?' : '')].filter(Boolean).join(' · ');
}

function open(item) {
  ui.selectTab('study');
  study.openTodo(item.note.path, item.text);
}

function render() {
  const children = [];
  if (!core.notes.size) {
    children.push(h('p', { class: 'hint left' }, core.syncing ? 'Index wird aufgebaut …' : 'Keine Notizen.'));
    view.show(children);
    return;
  }

  const items = importantTodos();
  children.push(h('h2', { class: 'section first' }, items.length ? `Wichtige Todos (${items.length})` : 'Wichtige Todos'));
  if (!items.length) {
    children.push(h('p', { class: 'hint left' }, 'Nichts Dringendes 🎉 – wichtige Todos mit !!!!, ganz dringende mit !!!!!.'));
  } else {
    children.push(h('ul', { class: 'todo-list' }, ...items.map((it) => h('li', {},
      h('button', { type: 'button', class: 'todo-item', onclick: () => open(it) },
        h('span', { class: 'todo-text prio-' + it.prio }, h('span', { class: 'prio-tag' }, PRIO_LABEL[it.prio]), it.text || '(ohne Text)'),
        h('span', { class: 'todo-where' }, where(it)))))));
  }
  view.show(children);
}

export default {
  id: 'home',
  title: 'Home',

  mount(_root, _ui) {
    root = _root;
    ui = _ui;
    core = ui.core;
    content = h('div', { class: 'home' });
    view = stableView(content);
    search = createSearch(ui, { onQuery: (active) => { content.hidden = active; search.hits.hidden = !active; } });
    search.hits.hidden = true;
    root.classList.add('home-panel');
    root.append(search.bar, search.hits, content, search.footer);

    let queued = false;
    core.on('change', () => {
      if (root.hidden || queued || content.hidden) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; view.request(render); });
    });
  },

  show() {
    search.refresh();
    if (!content.hidden) render();
  },
};
