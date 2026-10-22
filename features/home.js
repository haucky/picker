// Tab Home: Startbildschirm. Oben die Suche (features/search.js; während gesucht wird, nur die Treffer), darunter
// die Liste der wichtigen Todos (!!!! wichtig, !!!!! unbedingt schnell) aus allen Notizen – antippen springt im
// Study-Editor zur Stelle (bzw. öffnet die Notiz, wenn sie zu keinem Stapel gehört) – und die angepinnten Fragen
// (#pinned; #pinned/recent-answer = nur neueste Antwort; mit festem Intervall: nur wenn fällig, mit Antwortfeld).
// Weitere Bereiche kommen als eigene Abschnitte dazu.
import { h, stableView } from './dom.js';
import { todoItems, dayOfNote, PRIO_IMPORTANT, PRIO_LABEL } from './studydoc.js';
import {
  parseDecks, inDeck, isConfig, dayToGerman, today, fixedInterval, reviewedDay, addInterval, formatFixed,
  appendAnswer, setReviewed,
} from './srs.js';
import { entryParts } from './streamsdoc.js';
import { renderMarkdown } from './markdown.js';
import study from './study.js';
import { createSearch } from './search.js';

let ui, core, root, view, search, content;
const openPins = new Set(); // aufgeklappte angepinnte Fragen (Pfad), bleibt beim Neuzeichnen
const drafts = new Map();   // angefangene Antworten (Pfad → Text)
let saving = false;

const PIN = 'pinned';
const PIN_RECENT = 'pinned/recent-answer';

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

/* ---------- Angepinnt ---------- */

/**
 * Angepinnte Notizen: [{ note, recent, fixed: { interval, due } | null }]. Mit festem Intervall nur, wenn fällig
 * (die zuerst), sonst nach Titel.
 */
function pinnedNotes(day) {
  const out = [];
  for (const n of core.list()) {
    if (!n.tagsLower.some((t) => t === PIN || t.startsWith(PIN + '/'))) continue;
    const recent = n.tagsLower.includes(PIN_RECENT);
    const iv = fixedInterval(n.tags);
    let fixed = null;
    if (iv) {
      const last = reviewedDay(n.tags);
      const due = last == null ? day : addInterval(last, iv);
      if (due > day) continue;
      fixed = { interval: iv, due };
    }
    out.push({ note: n, recent, fixed });
  }
  return out.sort((a, b) => !!b.fixed - !!a.fixed || a.note.title.localeCompare(b.note.title, 'de'));
}

function mdCtx(path) {
  return { openNote: ui.openLink, resolveImage: (link) => ui.resolveImage(link, path) };
}

function answersEl(answers, path) {
  return h('div', { class: 'st-answers' }, ...answers.map((a) =>
    h('div', { class: 'st-answer' }, h('div', { class: 'st-answer-date' }, a.date), renderMarkdown(a.text, mdCtx(path)))));
}

/** Inhalt und eigene Antworten, eingeklappt (Zustand in openPins). */
function contentDetails(note, summary, sub = false) {
  const { body, answers } = entryParts(note.text);
  const details = h('details', { class: 'pin-details' + (sub ? ' sub' : ''), open: openPins.has(note.path) },
    h('summary', {}, summary),
    body ? renderMarkdown(body, mdCtx(note.path)) : h('p', { class: 'hint left' }, '(kein Inhalt)'),
    answers.length ? answersEl(answers, note.path) : null,
    sub ? null : h('button', { type: 'button', class: 'link', onclick: () => ui.openNote(note.path) }, '✏️ Bearbeiten'));
  details.addEventListener('toggle', () => { if (details.open) openPins.add(note.path); else openPins.delete(note.path); });
  return details;
}

function pinCard({ note, recent, fixed }, day) {
  const title = h('button', { type: 'button', class: 'st-card-title', title: 'Notiz öffnen', onclick: () => ui.openNote(note.path) }, note.title + '?');
  if (!fixed && !recent) return h('li', { class: 'st-card pin-card' }, contentDetails(note, note.title + '?'));

  const parts = [title];
  if (fixed) {
    const late = day - fixed.due;
    parts.push(h('div', { class: 'pin-meta' }, `📅 ${formatFixed(fixed.interval)} · ${late > 0 ? `🔥 ${late} Tag${late === 1 ? '' : 'e'} überfällig` : 'heute fällig'}`));
  }
  if (recent) {
    const last = entryParts(note.text).answers.at(-1);
    parts.push(last ? answersEl([last], note.path) : h('div', { class: 'pin-meta' }, 'Noch keine Antwort.'));
  }
  if (fixed) parts.push(answerForm(note, fixed));
  if (fixed && !recent) parts.push(contentDetails(note, 'Inhalt & Antworten', true));
  return h('li', { class: 'st-card pin-card' + (fixed ? ' due' : '') }, ...parts);
}

/** Antwortfeld für eine fällige Karte mit festem Intervall: Bestätigen hängt die Antwort an und setzt #reviewed. */
function answerForm(note, fixed) {
  const ta = h('textarea', { class: 'answer-input', rows: 3, placeholder: 'Antwort …', 'aria-label': 'Antwort' }, drafts.get(note.path) || '');
  ta.addEventListener('input', () => { if (ta.value) drafts.set(note.path, ta.value); else drafts.delete(note.path); });
  const confirmBtn = h('button', { type: 'button', class: 'btn small', onclick: () => confirmAnswer(note.path, fixed, ta.value) }, 'Bestätigen');
  return h('div', { class: 'answer-box' }, ta, h('div', { class: 'btn-row' }, confirmBtn));
}

async function confirmAnswer(path, fixed, answer) {
  if (saving) return;
  if (!answer.trim() && !confirm('Ohne Antwort als erledigt markieren?')) return;
  saving = true;
  const day = today();
  try {
    await core.update(path, (text) => setReviewed(answer.trim() ? appendAnswer(text, answer, day) : text, day));
    drafts.delete(path);
    ui.toast(`Gespeichert ✓ – wieder am ${dayToGerman(addInterval(day, fixed.interval))}`);
  } catch (err) {
    ui.toast('Speichern fehlgeschlagen: ' + err.message, 5000);
  } finally {
    saving = false;
    if (document.activeElement && content.contains(document.activeElement)) document.activeElement.blur();
    view.request(render);
  }
}

/* ---------- Seite ---------- */

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

  const day = today();
  const pins = pinnedNotes(day);
  if (pins.length) {
    children.push(h('h2', { class: 'section' }, `Angepinnt (${pins.length})`),
      h('ul', { class: 'pin-list' }, ...pins.map((p) => pinCard(p, day))));
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
    // nicht neu zeichnen, solange in einem Antwortfeld getippt wird (sonst ginge der Fokus verloren)
    view = stableView(content, { hold: () => saving || (document.activeElement?.tagName === 'TEXTAREA' && content.contains(document.activeElement)) });
    content.addEventListener('focusout', () => setTimeout(() => view.flush()));
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
