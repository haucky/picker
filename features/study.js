// Feature: Vorlesungen durcharbeiten. Stapel aus Review.md → VLs (Datum) → alle TILs einer VL als ein
// Fließtext-Dokument („Frage?“-Zeile + Inhalt). Speichern ändert, legt an und verschiebt in den Papierkorb.
import { h, stableView } from './dom.js';
import { createEditor } from './editor.js';
import { printVL, exportName, withoutTodos } from './export.js';
import { CONFIG_PATH, parseDecks, isConfig, today, dayToGerman, reviewState, nextReviewState, countStates } from './srs.js';
import {
  todos, todoStart, todoText, groupByDay, buildDoc, parseDoc, planSave, roundtripIssues, baseTags, parseQuestion,
} from './studydoc.js';

const DRAFT_PREFIX = 'study-draft:';

let ui, core, root;
let listEl, editEl, listView;
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

const STATE_LABEL = { open: 'offen', ready: 'bereit', skip: 'nicht abfragen' };

/** Kleiner Stern, der wie eine Fee herumhüpft und Sternenstaub verliert (eigener Takt je Eintrag). */
let fairySeed = 0;
function fairy() {
  // fester Takt pro Position (nicht zufällig), damit ein Neuzeichnen ohne Änderung die Liste nicht austauscht
  const n = ++fairySeed;
  const delay = (max) => `${-(((n * 0.618034 * max) % max)).toFixed(2)}s`;
  const dust = [[-7, 5], [6, 7], [-2, 9]].map(([dx, dy]) =>
    h('span', { class: 'fairy-dust', style: `--dx: ${dx}px; --dy: ${dy}px; animation-delay: ${delay(2.5)}` }));
  return h('span', { class: 'fairy', 'aria-label': 'alles bearbeitet' },
    ...dust, h('span', { class: 'fairy-star', style: `animation-delay: ${delay(5)}` }, '✦'));
}

/** Keine offenen Fragen mehr (alle bereit oder nicht abfragen)? Dann wird der Eintrag hervorgehoben. */
const allSet = (notes) => notes.length > 0 && countStates(notes).open === 0;

/** Review-Status der Fragen: schmaler Balken (offen/bereit/nicht abfragen) plus „N offen“ bzw. ✦. */
function stateBar(deck, notes) {
  if (!notes.length) return null;
  const c = countStates(notes);
  const title = `${c.open} offen · ${c.ready} bereit · ${c.skip} nicht abfragen`;
  return h('span', { class: 'state-info', title },
    c.open ? h('span', { class: 'state-open-count' }, `${c.open} offen`) : fairy(),
    h('span', { class: 'state-bar' }, ...['ready', 'open', 'skip'].filter((k) => c[k])
      .map((k) => h('span', { class: 'state-seg ' + k, style: `flex-grow: ${c[k]}` }))));
}

/* ---------- Übersicht: Stapel ---------- */

function renderList() {
  if (ed) return;
  fairySeed = 0;
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
      return h('li', {}, h('button', { type: 'button', class: 'deck' + (allSet(all) ? ' all-set' : ''), onclick: () => openDeck(i) },
        h('div', { class: 'deck-main' },
          h('div', { class: 'deck-title' }, d.name),
          h('div', { class: 'deck-sub' }, '#' + d.tag)),
        h('div', { class: 'deck-counts' },
          todoBadge(countTodos(all)),
          stateBar(d, all),
          h('span', { class: 'muted' }, `${plural(groups.filter((g) => g.day != null).length, 'VL', 'VLs')} · ${plural(all.length, 'Frage', 'Fragen')}`))));
    })));
  }
  listView.show(children);
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
    h('button', { type: 'button', class: 'btn', onclick: (e) => openVL(deck, day, null, e.currentTarget) },
      hasToday ? `Heutige VL öffnen (${dayToGerman(day)})` : `+ Neue VL heute (${dayToGerman(day)})`),
  ];

  const open = [];
  for (const g of groups) {
    for (const n of g.notes) for (const t of todos(n.text)) open.push({ g, n, t });
  }
  if (open.length) {
    children.push(h('h2', { class: 'section' }, `Offene Todos (${open.length})`),
      h('ul', { class: 'todo-list' }, ...open.map(({ g, n, t }) => h('li', {},
        h('button', { type: 'button', class: 'todo-item', onclick: (e) => openVL(deck, g.day, { title: n.title, todo: t }, e.currentTarget) },
          h('span', { class: 'todo-text' }, t || '(ohne Text)'),
          h('span', { class: 'todo-where' }, `${dayLabel(g.day)} · ${n.title}?`))))));
  }

  children.push(h('h2', { class: 'section' }, 'Vorlesungen'));
  if (!groups.length) children.push(h('p', { class: 'hint left' }, `Noch keine Notizen mit #${deck.tag}.`));
  children.push(h('ul', { class: 'decks' }, ...groups.map((g) => h('li', {},
    h('button', { type: 'button', class: 'deck' + (allSet(g.notes) ? ' all-set' : ''), onclick: (e) => openVL(deck, g.day, null, e.currentTarget) },
      h('div', { class: 'deck-main' },
        h('div', { class: 'deck-title' }, dayLabel(g.day)),
        h('div', { class: 'deck-sub' }, plural(g.notes.length, 'Frage', 'Fragen'))),
      h('div', { class: 'deck-counts' }, todoBadge(countTodos(g.notes)), stateBar(deck, g.notes)))))));
  listView.show(children);
}

/* ---------- VL-Editor ---------- */

const draftKey = (deck, day) => `${DRAFT_PREFIX}${deck.name}:${day ?? 'ohne'}`;
function loadDraft(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function storeDraft() {
  try {
    if (!isDirty()) localStorage.removeItem(ed.draftKey);
    else localStorage.setItem(ed.draftKey, JSON.stringify({ text: ed.cm.value, base: ed.base, states: Object.fromEntries(ed.states), renames: Object.fromEntries(ed.renames) }));
  } catch { /* egal */ }
}
function dropDraft(key) {
  try { localStorage.removeItem(key); } catch { /* egal */ }
}

/**
 * Stand der TILs der VL für den Abgleich beim Speichern – aus dem Zwischenspeicher (den der Abgleich aktuell hält),
 * ohne jede Datei neu zu lesen; das dauerte auf dem Handy pro Datei spürbar. Ob eine Datei seitdem außerhalb
 * geändert wurde, prüft save() vor dem Überschreiben direkt auf der Platte.
 */
function loadOriginals(deck, day) {
  const group = groupByDay(core.list(), deck).find((g) => g.day === day);
  return (group ? group.notes : []).map((n) => ({ path: n.path, title: n.title, text: n.text }));
}

function folderFor(deck, originals) {
  const pick = originals[0] || groupByDay(core.list(), deck).flatMap((g) => g.notes)[0];
  return pick && pick.path.includes('/') ? pick.path.slice(0, pick.path.lastIndexOf('/')) : '';
}

/** Öffnet den Editor einer VL; `focus` = { title, todo } springt zu einem Todo. */
async function openVL(deck, day, focus, btn) {
  if (busy) return;
  busy = true;
  btn?.classList.add('loading'); // sofort sichtbar: das Einlesen dauert auf dem Handy etwas
  let originals;
  try {
    originals = await loadOriginals(deck, day);
  } catch (err) {
    ui.toast('Konnte VL nicht laden: ' + err.message, 4000);
    return;
  } finally {
    busy = false;
    btn?.classList.remove('loading');
    setTimeout(() => listView.flush());
  }
  const tags = baseTags(originals.map((o) => o.text), deck.tag, day);
  const base = buildDoc(originals, tags);
  const key = draftKey(deck, day);
  const draft = loadDraft(key);
  const states = new Map(originals.map((o) => [o.title, reviewState(o.text)]));
  const restore = draft && (draft.text !== base || statesDiffer(new Map(Object.entries(draft.states || {})), states));
  ed = {
    deck, day, originals, base, draftKey: key,
    states: restore && draft.states ? new Map([...states, ...Object.entries(draft.states)]) : new Map(states),
    statesBase: states,
    renames: new Map(restore && draft.renames ? Object.entries(draft.renames) : []), // neuer Titel → alter Titel
    folder: folderFor(deck, originals),
    tags,
    issues: roundtripIssues(originals, tags),
  };
  history.pushState({ study: 'edit' }, '');
  document.body.classList.add('study-editing');
  listEl.hidden = true;
  editEl.hidden = false;
  renderEditor(restore ? draft.text : base);
  if (restore) {
    ui.toast(draft.base === base ? 'Ungespeicherter Entwurf wiederhergestellt' :
      'Entwurf wiederhergestellt – die Dateien wurden inzwischen geändert, bitte prüfen', 5000);
  }
  window.scrollTo(0, 0);
  if (focus) requestAnimationFrame(() => jumpTo(focus));
}

function renderEditor(text) {
  const title = h('h1', { class: 'ellipsis' }, `${ed.deck.name} · ${dayLabel(ed.day)}`);
  ed.save = h('button', { type: 'button', class: 'btn small', onclick: save }, 'Speichern');
  const pdf = h('button', { type: 'button', class: 'btn small', onclick: exportPDF, title: 'Als PDF exportieren (Drucken → Als PDF speichern)' }, 'PDF');
  ed.count = h('span', { class: 'count' });
  ed.errors = h('div', { class: 'notice err', hidden: true });
  ed.warnings = h('div', { class: 'notice', hidden: true });
  const host = h('div', { class: 'md-editor', 'aria-label': 'Fragen und Inhalte' });

  const info = [h('span', {}, `Neue Fragen: ${ed.folder || '(oberster Ordner)'} · ${ed.tags.map((t) => '#' + t).join(' ')} – weitere Tags hinter die Frage`)];
  const parts = [
    h('header', { class: 'bar' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zurück', onclick: leave }, '←'),
      title, ed.count, pdf, ed.save),
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
    ai: ui.ai,
    prompt: ui.desktop ? ui.prompts : null, // Eingabefeld beim Markieren nur am Computer
    tags: ui.tags,
    locked: lockedQuestions,
    onLocked: () => lockedHint(),
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
  const open = items.filter((it) => stateOf(it.title) === 'open').length;
  ed.count.textContent = plural(items.length, 'Frage', 'Fragen') + (open ? ` · ${open} offen` : '');
  const list = (title, entries) => [
    h('strong', {}, title),
    h('ul', {}, ...entries.sort((a, b) => a.line - b.line).map((e) =>
      h('li', {}, h('button', { type: 'button', class: 'link', onclick: () => jumpToLine(e.line) }, `Zeile ${e.line + 1}`), ': ' + e.msg))),
  ];
  ed.errors.hidden = !errors.length;
  ed.errors.replaceChildren(...(errors.length ? list('So kann nicht gespeichert werden:', errors) : []));
  ed.warnings.hidden = !warnings.length;
  ed.warnings.replaceChildren(...(warnings.length ? list('Hinweis:', warnings) : []));
  ed.save.disabled = busy || !isDirty();
}

/* ---------- Review-Status der Fragen (offen → bereit → nicht abfragen) ---------- */

const stateOf = (title) => ed.states.get(title) || 'open';

function statesDiffer(a, b) {
  for (const k of new Set([...a.keys(), ...b.keys()])) if ((a.get(k) || 'open') !== (b.get(k) || 'open')) return true;
  return false;
}

/** Schaltet den Status der Frage in Zeile `line` weiter; gespeichert wird mit dem ganzen Dokument. */
function cycleState(line) {
  if (!ed) return;
  const q = parseQuestion(ed.cm.value.split('\n')[line] || '');
  if (!q) return;
  ed.states.set(q.title, nextReviewState(stateOf(q.title)));
  storeDraft();
  ed.cm.refresh();
  update();
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
    if (q) {
      out.push({ line: i, from: 0, to: q.tagsAt, class: 'cm-q' });
      if (ed) {
        const st = stateOf(q.title);
        out.push({ line: i, dot: { class: st, title: `Review: ${STATE_LABEL[st]} – antippen zum Ändern, lang drücken bzw. Rechtsklick für mehr`,
          onClick: cycleState, onMenu: openQuestionMenu } });
        if (st !== 'open') out.push({ line: i, class: 'cm-q-' + st });
      }
      return;
    }
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

const isDirty = () => !!ed && !!ed.cm && (ed.cm.value !== ed.base || statesDiffer(ed.states, ed.statesBase));

function closeEditor({ discard = false } = {}) {
  closeQuestionMenu();
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

/* ---------- Fragen: Sperre, Kontextmenü (KI-Aktionen, Umbenennen) ---------- */

/** Frage-Zeilen außerhalb von Codeblöcken: [{ line, title, tagsAt }]. */
function questionLines(lines) {
  const out = [];
  let fence = null;
  lines.forEach((line, i) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; return; }
    if (f) { fence = f[1]; return; }
    const q = parseQuestion(line);
    if (q) out.push({ line: i, title: q.title, tagsAt: q.tagsAt });
  });
  return out;
}

/** Fragen mit Status „bereit“ sind gesperrt (Text bis einschließlich „?“); ändern nur über „Umbenennen“. */
function lockedQuestions(text) {
  if (!ed) return [];
  const lines = text.split('\n');
  const starts = [];
  let pos = 0;
  for (const l of lines) { starts.push(pos); pos += l.length + 1; }
  return questionLines(lines).filter((q) => stateOf(q.title) === 'ready')
    .map((q) => ({ from: starts[q.line], to: starts[q.line] + q.tagsAt }));
}

let lockedHintAt = 0;
function lockedHint() {
  if (Date.now() - lockedHintAt < 3000) return;
  lockedHintAt = Date.now();
  ui.toast('Frage ist „bereit“ – ändern über den Punkt: lang drücken bzw. Rechtsklick → Umbenennen', 4000);
}

/** Frage `title` im aktuellen Text: { line, title, text (Frage + Inhalt ohne Todos), end (Position nach dem Inhalt) }. */
function questionBlock(title) {
  const lines = ed.cm.value.split('\n');
  const qs = questionLines(lines);
  const k = qs.findIndex((q) => q.title === title);
  if (k < 0) return null;
  const start = qs[k].line;
  let last = (k + 1 < qs.length ? qs[k + 1].line : lines.length) - 1;
  while (last > start && !lines[last].trim()) last--;
  const end = lines.slice(0, last + 1).reduce((n, l) => n + l.length + 1, 0) - 1;
  const body = withoutTodos(lines.slice(start + 1, last + 1).join('\n')).trim();
  return { line: start, title, text: title + '?' + (body ? '\n' + body : ''), end };
}

let menuEl = null;
function closeQuestionMenu() {
  if (!menuEl) return;
  menuEl.remove();
  document.removeEventListener('pointerdown', menuEl._outside, true);
  document.removeEventListener('keydown', menuEl._key, true);
  menuEl = null;
}

/** Kontextmenü am Punkt einer Frage: oberste 3 Prompts aus Prompts.md, eigener Prompt, Umbenennen. */
function openQuestionMenu(line, rect) {
  if (!ed) return;
  closeQuestionMenu();
  const q = parseQuestion(ed.cm.value.split('\n')[line] || '');
  if (!q) return;
  const title = q.title;
  const el = h('div', { class: 'qmenu', role: 'menu' });
  const ai = ui.prompts && ui.prompts.available();
  const runPrompt = (input) => {
    if (!input.trim()) return;
    const block = questionBlock(title);
    if (!block) return;
    closeQuestionMenu();
    ui.prompts.run({
      input, text: block.text,
      // ans Ende der Frage (im dann aktuellen Text, falls sich inzwischen etwas verschoben hat)
      insert: (out) => {
        const b = questionBlock(title);
        if (!b || !out) return;
        ed.cm.view.dispatch({ changes: { from: b.end, insert: '\n' + out }, selection: { anchor: b.end + 1 + out.length }, scrollIntoView: true });
      },
      focusBack: () => {},
    });
  };
  const item = (label, onclick, attrs = {}) => h('button', { type: 'button', class: 'qmenu-item', role: 'menuitem', onclick, ...attrs }, label);
  const showMain = () => {
    const parts = [];
    if (ai) {
      const input = h('input', { type: 'text', class: 'qmenu-input', placeholder: '✦ Eigener Prompt oder Abkürzung …',
        enterkeyhint: 'send', onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); runPrompt(input.value); } } });
      parts.push(input, ...ui.prompts.list().slice(0, 3).map((pr) => item('✦ ' + pr.name, () => runPrompt(pr.name), { title: pr.prompt })));
    } else if (ui.prompts) {
      parts.push(h('div', { class: 'qmenu-note' }, navigator.onLine ? 'KI: Tinfoil-Key unter Settings eintragen' : 'KI: offline'));
    }
    parts.push(h('div', { class: 'qmenu-sep' }), item('✎ Umbenennen', showRename));
    el.replaceChildren(...parts);
  };
  const showRename = () => {
    const input = h('input', { type: 'text', class: 'qmenu-input', value: title, 'aria-label': 'Neue Frage' });
    const ok = () => { if (renameQuestion(title, input.value)) closeQuestionMenu(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
    el.replaceChildren(h('div', { class: 'qmenu-label' }, 'Frage umbenennen (Lernstand bleibt)'), input,
      h('div', { class: 'qmenu-row' }, item('Abbrechen', closeQuestionMenu), item('Umbenennen', ok, { class: 'qmenu-item accent' })));
    setTimeout(() => { input.focus(); input.select(); });
  };
  showMain();
  document.body.append(el);
  const w = el.offsetWidth;
  el.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8)) + 'px';
  el.style.top = Math.min(rect.bottom + 6, window.innerHeight - el.offsetHeight - 8) + 'px';
  el._outside = (e) => { if (!el.contains(e.target)) closeQuestionMenu(); };
  el._key = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeQuestionMenu(); } };
  document.addEventListener('pointerdown', el._outside, true);
  document.addEventListener('keydown', el._key, true);
  menuEl = el;
}

/** Benennt eine Frage im Text um; beim Speichern zieht die Notiz mit Frontmatter (SR-Stand, Status) und Tags um. */
function renameQuestion(oldTitle, value) {
  const next = value.trim().replace(/\?+$/, '').trim();
  if (!next || next === oldTitle) return true;
  const q = parseQuestion(next + '?');
  if (!q || q.title !== next) { ui.toast('Das ist keine gültige Frage (eine Zeile, „?“ nur am Ende)', 4000); return false; }
  const lines = ed.cm.value.split('\n');
  const qs = questionLines(lines);
  if (qs.some((x) => x.title === next)) { ui.toast('Diese Frage gibt es in der VL schon', 4000); return false; }
  const hit = qs.find((x) => x.title === oldTitle);
  if (!hit) return true;
  const from = lines.slice(0, hit.line).reduce((n, l) => n + l.length + 1, 0);
  ed.cm.view.dispatch({ changes: { from, to: from + oldTitle.length, insert: next } }); // ohne userEvent: an der Sperre vorbei
  const orig = ed.renames.get(oldTitle) ?? (ed.originals.some((o) => o.title === oldTitle) ? oldTitle : null);
  ed.renames.delete(oldTitle);
  if (orig && orig !== next) ed.renames.set(next, orig);
  if (ed.states.has(oldTitle)) { ed.states.set(next, ed.states.get(oldTitle)); ed.states.delete(oldTitle); }
  storeDraft();
  ed.cm.refresh();
  update();
  return true;
}

/* ---------- Export ---------- */

/** Druckansicht der VL im aktuellen Stand des Editors (auch ungespeichert) → „Als PDF speichern“. */
async function exportPDF() {
  if (!ed) return;
  if (!parseDoc(ed.cm.value).items.length) return ui.toast('Keine Fragen zum Exportieren.');
  if (!exportName()) ui.toast('Tipp: Deinen Namen für den Export unter Settings eintragen.', 4000);
  try {
    await printVL({
      deck: ed.deck, day: ed.day, text: ed.cm.value,
      resolveImage: (link) => ui.resolveImage(link, ed.folder ? ed.folder + '/_.md' : '_.md'),
    });
  } catch (err) {
    ui.toast('Export fehlgeschlagen: ' + err.message, 4000);
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
  const states = new Map(ed.states);
  const plan = planSave(text, ed.originals, { folder: ed.folder, base: ed.tags, exists, states, renames: ed.renames });
  if (plan.errors.length) {
    update();
    ui.toast(plan.errors[0].msg + (plan.errors.length > 1 ? ` (+${plan.errors.length - 1})` : ''), 4000);
    return;
  }
  const { updates, creates, moves, deletes } = plan;
  if (!updates.length && !creates.length && !moves.length && !deletes.length) {
    ed.base = text;
    ed.statesBase = states;
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
    const touched = [...updates, ...deletes, ...moves.map((m) => ({ path: m.from }))].map((c) => ed.originals.find((o) => o.path === c.path));
    const changed = (await Promise.all(touched.map(async (o) => {
      try {
        return (await core.read(o.path)) !== o.text ? o.title : null;
      } catch (err) {
        if (err.name !== 'NotFoundError') throw err;
        return o.title + ' (gelöscht)';
      }
    }))).filter(Boolean);
    if (changed.length && !confirm('Seit dem Öffnen außerhalb geändert:\n\n' + changed.map((t) => `• ${t}`).join('\n') +
      '\n\nTrotzdem mit deinem Stand überschreiben?')) return;

    const done = { updated: 0, created: 0, moved: 0, deleted: 0 };
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
    // Umbenennen: neue Datei mit dem bisherigen Inhalt (Frontmatter, Tags), dann die alte entfernen
    for (const m of moves) {
      try {
        await core.create(m.path, m.text);
        await core.remove(m.from);
        ed.originals = ed.originals.filter((o) => o.path !== m.from);
        ed.originals.push({ path: m.path, title: m.title, text: m.text });
        done.moved++;
      } catch (err) {
        fail.push(`${m.oldTitle} → ${m.title}: ${err.message}`);
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
      done.updated && `${done.updated} geändert`, done.created && `${done.created} neu`, done.moved && `${done.moved} umbenannt`,
      done.deleted && `${done.deleted} gelöscht`,
    ].filter(Boolean).join(', ');
    if (fail.length) {
      alert('Nicht alles wurde gespeichert' + (summary ? ` (${summary})` : '') + ':\n\n' + fail.join('\n'));
    } else {
      ed.base = text;
      ed.statesBase = states;
      ed.renames = new Map();
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
    listView = stableView(listEl, { hold: () => busy }); // nicht neu zeichnen, während eine VL geöffnet wird
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
      requestAnimationFrame(() => { queued = false; listView.request(renderList); });
    });
  },

  show() {
    if (ed) update(); else renderList();
  },
};
