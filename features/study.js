// Feature: Vorlesungen durcharbeiten. Stapel aus Review.md → VLs (Datum) → alle TILs einer VL als ein
// Fließtext-Dokument („Frage?“-Zeile + Inhalt). Speichern ändert, legt an und verschiebt in den Papierkorb.
import { h } from './dom.js';
import { createEditor } from './editor.js';
import { CONFIG_PATH, parseDecks, isConfig, today, dayToGerman } from './srs.js';
import {
  todos, todoStart, todoText, groupByDay, buildDoc, parseDoc, planSave, roundtripIssues, baseTags, parseQuestion,
} from './studydoc.js';

const DRAFT_PREFIX = 'study-draft:';

let ui, core, root;
let listEl, editEl;
let deckIndex = null;   // geöffneter Stapel (Index in decks())
let ed = null;          // offener VL-Editor, siehe openVL()
let busy = false;

/* ---------- Daten ---------- */

function decks() {
  const cfg = core.list().find((n) => isConfig(n.path));
  return cfg ? parseDecks(cfg.text) : [];
}

function dayLabel(day) {
  if (day == null) return 'Ohne Datum';
  const wd = new Date(day * 864e5).toLocaleDateString('de-DE', { weekday: 'short', timeZone: 'UTC' });
  return `${wd} ${dayToGerman(day)}`;
}

const countTodos = (notes) => notes.reduce((s, n) => s + todos(n.text).length, 0);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function todoBadge(n) {
  return n ? h('span', { class: 'todo-badge' }, plural(n, 'Todo', 'Todos')) : null;
}

/* ---------- Übersicht: Stapel ---------- */

function renderList() {
  if (ed) return;
  const ds = decks();
  const notes = core.list();
  if (deckIndex != null && !ds[deckIndex]) deckIndex = null;
  if (deckIndex != null) { renderDeck(ds[deckIndex], notes); return; }

  const children = [h('header', { class: 'bar' }, h('h1', {}, 'Study'))];
  if (!core.notes.size) {
    children.push(h('p', { class: 'hint left' }, core.syncing ? 'Index wird aufgebaut …' : 'Keine Notizen.'));
  } else if (!ds.length) {
    children.push(h('p', { class: 'hint left' },
      `Die Stapel kommen aus ${CONFIG_PATH} (Tab Review). Dort ist noch kein Stapel mit „tag:“ eingetragen.`));
  } else {
    children.push(h('ul', { class: 'decks' }, ...ds.map((d, i) => {
      const groups = groupByDay(notes, d);
      const all = groups.flatMap((g) => g.notes);
      return h('li', {}, h('button', { type: 'button', class: 'deck', onclick: () => openDeck(i) },
        h('div', { class: 'deck-main' },
          h('div', { class: 'deck-title' }, d.name),
          h('div', { class: 'deck-sub' }, '#' + d.tag)),
        h('div', { class: 'deck-counts' },
          todoBadge(countTodos(all)),
          h('span', { class: 'muted' }, `${plural(groups.filter((g) => g.day != null).length, 'VL', 'VLs')} · ${plural(all.length, 'Frage', 'Fragen')}`))));
    })));
  }
  listEl.replaceChildren(...children);
}

/* ---------- Stapel: VLs und Todos ---------- */

function openDeck(i) {
  deckIndex = i;
  history.pushState({ study: 'deck' }, '');
  window.scrollTo(0, 0);
  renderList();
}

function renderDeck(deck, notes) {
  const groups = groupByDay(notes, deck);
  const day = today();
  const hasToday = groups.some((g) => g.day === day);
  const children = [
    h('header', { class: 'bar' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zurück', onclick: leave }, '←'),
      h('h1', { class: 'ellipsis' }, deck.name)),
    h('button', { type: 'button', class: 'btn', onclick: () => openVL(deck, day) },
      hasToday ? `Heutige VL öffnen (${dayToGerman(day)})` : `+ Neue VL heute (${dayToGerman(day)})`),
  ];

  const open = [];
  for (const g of groups) {
    for (const n of g.notes) for (const t of todos(n.text)) open.push({ g, n, t });
  }
  if (open.length) {
    children.push(h('h2', { class: 'section' }, `Offene Todos (${open.length})`),
      h('ul', { class: 'todo-list' }, ...open.map(({ g, n, t }) => h('li', {},
        h('button', { type: 'button', class: 'todo-item', onclick: () => openVL(deck, g.day, { title: n.title, todo: t }) },
          h('span', { class: 'todo-text' }, t || '(ohne Text)'),
          h('span', { class: 'todo-where' }, `${dayLabel(g.day)} · ${n.title}?`))))));
  }

  children.push(h('h2', { class: 'section' }, 'Vorlesungen'));
  if (!groups.length) children.push(h('p', { class: 'hint left' }, `Noch keine Notizen mit #${deck.tag}.`));
  children.push(h('ul', { class: 'decks' }, ...groups.map((g) => h('li', {},
    h('button', { type: 'button', class: 'deck', onclick: () => openVL(deck, g.day) },
      h('div', { class: 'deck-main' },
        h('div', { class: 'deck-title' }, dayLabel(g.day)),
        h('div', { class: 'deck-sub' }, plural(g.notes.length, 'Frage', 'Fragen'))),
      h('div', { class: 'deck-counts' }, todoBadge(countTodos(g.notes))))))));
  listEl.replaceChildren(...children);
}

/* ---------- VL-Editor ---------- */

const draftKey = (deck, day) => `${DRAFT_PREFIX}${deck.name}:${day ?? 'ohne'}`;
function loadDraft(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function storeDraft() {
  try {
    if (ed.cm.value === ed.base) localStorage.removeItem(ed.draftKey);
    else localStorage.setItem(ed.draftKey, JSON.stringify({ text: ed.cm.value, base: ed.base }));
  } catch { /* egal */ }
}
function dropDraft(key) {
  try { localStorage.removeItem(key); } catch { /* egal */ }
}

/** Liest die TILs der VL frisch ein (Stand für den Abgleich beim Speichern). */
async function loadOriginals(deck, day) {
  const group = groupByDay(core.list(), deck).find((g) => g.day === day);
  const notes = group ? group.notes : [];
  const originals = [];
  for (const n of notes) {
    try {
      originals.push({ path: n.path, title: n.title, text: await core.read(n.path) });
    } catch (err) {
      if (err.name !== 'NotFoundError') throw err;
    }
  }
  return originals;
}

function folderFor(deck, originals) {
  const pick = originals[0] || groupByDay(core.list(), deck).flatMap((g) => g.notes)[0];
  return pick && pick.path.includes('/') ? pick.path.slice(0, pick.path.lastIndexOf('/')) : '';
}

/** Öffnet den Editor einer VL; `focus` = { title, todo } springt zu einem Todo. */
async function openVL(deck, day, focus) {
  if (busy) return;
  busy = true;
  let originals;
  try {
    originals = await loadOriginals(deck, day);
  } catch (err) {
    ui.toast('Konnte VL nicht laden: ' + err.message, 4000);
    return;
  } finally {
    busy = false;
  }
  const tags = baseTags(originals.map((o) => o.text), deck.tag, day);
  const base = buildDoc(originals, tags);
  const key = draftKey(deck, day);
  const draft = loadDraft(key);
  ed = {
    deck, day, originals, base, draftKey: key,
    folder: folderFor(deck, originals),
    tags,
    issues: roundtripIssues(originals, tags),
  };
  history.pushState({ study: 'edit' }, '');
  document.body.classList.add('study-editing');
  listEl.hidden = true;
  editEl.hidden = false;
  renderEditor(draft && draft.text !== base ? draft.text : base);
  if (draft && draft.text !== base) {
    ui.toast(draft.base === base ? 'Ungespeicherter Entwurf wiederhergestellt' :
      'Entwurf wiederhergestellt – die Dateien wurden inzwischen geändert, bitte prüfen', 5000);
  }
  window.scrollTo(0, 0);
  if (focus) requestAnimationFrame(() => jumpTo(focus));
}

function renderEditor(text) {
  const title = h('h1', { class: 'ellipsis' }, `${ed.deck.name} · ${dayLabel(ed.day)}`);
  ed.save = h('button', { type: 'button', class: 'btn small', onclick: save }, 'Speichern');
  ed.count = h('span', { class: 'count' });
  ed.errors = h('div', { class: 'notice err', hidden: true });
  ed.warnings = h('div', { class: 'notice', hidden: true });
  const host = h('div', { class: 'md-editor', 'aria-label': 'Fragen und Inhalte' });

  const info = [h('span', {}, `Neue Fragen: ${ed.folder || '(oberster Ordner)'} · ${ed.tags.map((t) => '#' + t).join(' ')} – weitere Tags hinter die Frage`)];
  const parts = [
    h('header', { class: 'bar' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zurück', onclick: leave }, '←'),
      title, ed.count, ed.save),
    h('p', { class: 'path' }, ...info),
  ];
  if (ed.issues.length) {
    parts.push(h('div', { class: 'notice' },
      h('strong', {}, 'Achtung: Inhalt mit Frage-Zeilen'),
      h('p', {}, 'In diesen Notizen gibt es Zeilen, die als neue Frage gelten würden (oder der Dateiname ist keine ' +
        'gültige Frage-Zeile). Beim Speichern würden sie aufgeteilt: ' + ed.issues.map((t) => `„${t}“`).join(', ') +
        '. Zeile mit „- “ beginnen oder das „?“ am Ende entfernen.')));
  }
  parts.push(ed.errors, ed.warnings, host);
  editEl.replaceChildren(...parts);
  ed.cm = createEditor({
    parent: host,
    doc: text,
    placeholder: 'Erste Frage?\n- Inhalt …\n\nZweite Frage? #tag\n- …\n!!! Todo bis Zeilenende',
    onChange: onInput,
    decorate: studyMarks,
    openLink: (target) => ui.openLink(target),
    saveImage: ui.saveImage,
    spell: ui.spell,
    // Bilder relativ zum Ordner der TILs dieser VL auflösen
    resolveImage: (link) => ui.resolveImage(link, ed.folder ? ed.folder + '/_.md' : '_.md'),
  });
  update();
}

let raf = 0;
function onInput() {
  storeDraft();
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(); });
}

/** Fehler, Hinweise, Zähler und Speichern-Knopf aktualisieren (Markierungen im Text: studyMarks). */
function update() {
  if (!ed || !ed.cm) return;
  const text = ed.cm.value;
  const { items, errors, warnings } = parseDoc(text);
  ed.count.textContent = plural(items.length, 'Frage', 'Fragen');
  const list = (title, entries) => [
    h('strong', {}, title),
    h('ul', {}, ...entries.sort((a, b) => a.line - b.line).map((e) =>
      h('li', {}, h('button', { type: 'button', class: 'link', onclick: () => jumpToLine(e.line) }, `Zeile ${e.line + 1}`), ': ' + e.msg))),
  ];
  ed.errors.hidden = !errors.length;
  ed.errors.replaceChildren(...(errors.length ? list('So kann nicht gespeichert werden:', errors) : []));
  ed.warnings.hidden = !warnings.length;
  ed.warnings.replaceChildren(...(warnings.length ? list('Hinweis:', warnings) : []));
  ed.save.disabled = busy || text === ed.base;
}

/** Markierungen für den Editor: Fragen, Antwort-Daten, Todos, Fehler- und Hinweis-Zeilen (nicht in Codeblöcken). */
function studyMarks(text) {
  const { errors, warnings } = parseDoc(text);
  const out = [
    ...errors.map((e) => ({ line: e.line, class: 'cm-err' })),
    ...warnings.map((w) => ({ line: w.line, class: 'cm-warn' })),
  ];
  let fence = null;
  text.split('\n').forEach((line, i) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; return; }
    if (f) { fence = f[1]; return; }
    const q = parseQuestion(line);
    if (q) { out.push({ line: i, from: 0, to: q.tagsAt, class: 'cm-q' }); return; }
    if (/^::\d{2}\.\d{2}\.\d{4}::\s*$/.test(line)) { out.push({ line: i, from: 0, to: line.length, class: 'cm-date' }); return; }
    const t = todoStart(line);
    if (t >= 0) out.push({ line: i, from: t, to: line.length, class: 'cm-todo' });
  });
  return out;
}

function jumpToLine(line) {
  ed.cm.jumpToLine(line);
}

function jumpTo({ title, todo }) {
  if (!ed) return;
  const lines = ed.cm.value.split('\n');
  let start = lines.findIndex((l) => parseQuestion(l)?.title === title);
  if (start < 0) start = 0;
  const i = lines.findIndex((l, k) => k >= start && todoText(l) === todo);
  jumpToLine(i >= 0 ? i : start);
}

const isDirty = () => !!ed && !!ed.cm && ed.cm.value !== ed.base;

function closeEditor({ discard = false } = {}) {
  if (discard) dropDraft(ed.draftKey);
  ed.cm?.destroy();
  ed = null;
  document.body.classList.remove('study-editing');
  editEl.hidden = true;
  editEl.replaceChildren();
  listEl.hidden = false;
  renderList();
}

function leave() {
  if (history.state && (history.state.study === 'edit' || history.state.study === 'deck')) { history.back(); return; }
  if (ed) {
    if (isDirty() && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
    closeEditor({ discard: true });
  } else {
    deckIndex = null;
    renderList();
  }
}

/* ---------- Speichern ---------- */

async function save() {
  if (!ed || busy) return;
  const text = ed.cm.value;
  const exists = (path) => {
    const p = path.toLowerCase();
    for (const k of core.notes.keys()) if (k.toLowerCase() === p) return true;
    return false;
  };
  const plan = planSave(text, ed.originals, { folder: ed.folder, base: ed.tags, exists });
  if (plan.errors.length) {
    update();
    ui.toast(plan.errors[0].msg + (plan.errors.length > 1 ? ` (+${plan.errors.length - 1})` : ''), 4000);
    return;
  }
  const { updates, creates, deletes } = plan;
  if (!updates.length && !creates.length && !deletes.length) {
    ed.base = text;
    dropDraft(ed.draftKey);
    update();
    ui.toast('Nichts zu speichern');
    return;
  }
  if (deletes.length && !confirm(
    `${plural(deletes.length, 'Frage fehlt', 'Fragen fehlen')} im Dokument und ${deletes.length === 1 ? 'wird' : 'werden'} ` +
    'in den Papierkorb (.trash) verschoben:\n\n' + deletes.map((d) => `• ${d.title}?`).join('\n') + '\n\nSpeichern?')) return;

  busy = true;
  ed.save.disabled = true;
  try {
    // Wurde etwas außerhalb geändert (Obsidian Sync, anderer Tab)?
    const touched = [...updates, ...deletes].map((c) => ed.originals.find((o) => o.path === c.path));
    const changed = [];
    for (const o of touched) {
      try {
        if ((await core.read(o.path)) !== o.text) changed.push(o.title);
      } catch (err) {
        if (err.name !== 'NotFoundError') throw err;
        changed.push(o.title + ' (gelöscht)');
      }
    }
    if (changed.length && !confirm('Seit dem Öffnen außerhalb geändert:\n\n' + changed.map((t) => `• ${t}`).join('\n') +
      '\n\nTrotzdem mit deinem Stand überschreiben?')) return;

    const done = { updated: 0, created: 0, deleted: 0 };
    const fail = [];
    // Erst löschen (frei gewordene Namen, z. B. bei geänderter Groß-/Kleinschreibung), dann ändern, dann anlegen.
    for (const d of deletes) {
      try {
        await core.trash(d.path);
        ed.originals = ed.originals.filter((o) => o.path !== d.path);
        done.deleted++;
      } catch (err) {
        if (err.name === 'NotFoundError') { ed.originals = ed.originals.filter((o) => o.path !== d.path); continue; }
        fail.push(`${d.title}: ${err.message}`);
      }
    }
    for (const u of updates) {
      try {
        await core.update(u.path, u.text);
        ed.originals.find((o) => o.path === u.path).text = u.text;
        done.updated++;
      } catch (err) {
        fail.push(`${u.title}: ${err.message}`);
      }
    }
    for (const c of creates) {
      try {
        await core.create(c.path, c.text);
        ed.originals.push({ path: c.path, title: c.title, text: c.text });
        done.created++;
      } catch (err) {
        fail.push(`${c.title}: ${err.message}`);
      }
    }
    const summary = [
      done.updated && `${done.updated} geändert`, done.created && `${done.created} neu`, done.deleted && `${done.deleted} gelöscht`,
    ].filter(Boolean).join(', ');
    if (fail.length) {
      alert('Nicht alles wurde gespeichert' + (summary ? ` (${summary})` : '') + ':\n\n' + fail.join('\n'));
    } else {
      ed.base = text;
      dropDraft(ed.draftKey);
      ed.issues = [];
      ui.toast(`Gespeichert ✓ ${summary}`);
    }
  } catch (err) {
    ui.toast('Speichern fehlgeschlagen: ' + err.message, 5000);
  } finally {
    busy = false;
    update();
  }
}

/* ---------- Modul ---------- */

export default {
  id: 'study',
  title: 'Study',

  mount(_root, _ui) {
    root = _root;
    ui = _ui;
    core = ui.core;
    listEl = h('div', { class: 'study-list' });
    editEl = h('div', { class: 'study-edit', hidden: true });
    root.append(listEl, editEl);

    // Zurück-Geste: Editor → Stapel → Übersicht
    window.addEventListener('popstate', () => {
      const st = history.state && history.state.study;
      if (ed && st !== 'edit') {
        if (isDirty() && !confirm('Ungespeicherte Änderungen verwerfen?')) {
          history.pushState({ study: 'edit' }, '');
          return;
        }
        closeEditor({ discard: true });
      }
      if (!ed && deckIndex != null && st !== 'deck' && st !== 'edit') {
        deckIndex = null;
        renderList();
      }
    });
    window.addEventListener('beforeunload', (e) => { if (isDirty()) e.preventDefault(); });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && ed && !root.hidden) { e.preventDefault(); save(); }
    });

    let queued = false;
    core.on('change', () => {
      if (root.hidden || ed || queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; renderList(); });
    });
  },

  show() {
    if (ed) update(); else renderList();
  },
};
