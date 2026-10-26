// Gemeinsamer Fragen-Editor für Study (VL) und Diary (neue Einträge): CodeMirror mit Markierungen für Fragen,
// Datumszeilen, Antwort-Daten, Todos, Fehler und Hinweise, dazu die Kästen mit Fehlern/Hinweisen. Was nur ein Modus
// braucht (Review-Status-Punkt, Sperre bereiter Fragen, Menü), kommt über Optionen. Die Logik ohne DOM steht in
// studydoc.js (parseDoc, planSave).
import { h } from './dom.js';
import { createEditor } from './editor.js';
import { parseDoc, parseQuestion, parseDayLine, todoStart, todoPrio } from './studydoc.js';

const FENCE_RE = /^\s*(`{3,}|~{3,})/;

/** Ruft `fn(line, i)` für jede Zeile außerhalb von Codeblöcken auf (Zaunzeilen selbst ausgenommen). */
function eachLine(lines, fn) {
  let fence = null;
  lines.forEach((line, i) => {
    const f = FENCE_RE.exec(line);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; return; }
    if (f) { fence = f[1]; return; }
    fn(line, i);
  });
}

/** Frage-Zeilen außerhalb von Codeblöcken: [{ line, title, tagsAt }]. */
export function questionLines(lines) {
  const out = [];
  eachLine(lines, (line, i) => {
    const q = parseQuestion(line);
    if (q) out.push({ line: i, title: q.title, tagsAt: q.tagsAt });
  });
  return out;
}

/**
 * Markierungen: Fragen, Datumszeilen, Antwort-Daten, Todos (nach Priorität), Fehler- und Hinweis-Zeilen.
 * `questionExtra(q, line)` liefert zusätzliche Markierungen für eine Frage-Zeile (z. B. den Status-Punkt).
 */
export function questionMarks(text, questionExtra) {
  const { errors, warnings } = parseDoc(text);
  const out = [
    ...errors.map((e) => ({ line: e.line, class: 'cm-err' })),
    ...warnings.map((w) => ({ line: w.line, class: 'cm-warn' })),
  ];
  eachLine(text.split('\n'), (line, i) => {
    const q = parseQuestion(line);
    if (q) {
      out.push({ line: i, from: 0, to: q.tagsAt, class: 'cm-q' });
      if (questionExtra) out.push(...questionExtra(q, i));
      return;
    }
    if (parseDayLine(line)) { out.push({ line: i, from: 0, to: line.trimEnd().length, class: 'cm-dayline' }); return; }
    if (/^::\d{2}\.\d{2}\.\d{4}::\s*$/.test(line)) { out.push({ line: i, from: 0, to: line.length, class: 'cm-date' }); return; }
    const t = todoStart(line);
    if (t >= 0) out.push({ line: i, from: t, to: line.length, class: 'cm-todo' + (todoPrio(line) > 1 ? ' cm-todo-' + todoPrio(line) : '') });
  });
  return out;
}

/**
 * Kästen für Fehler („So kann nicht gespeichert werden“) und Hinweise; `jump(line)` springt zur Zeile.
 * Gibt { errors, warnings (Elemente), show({ errors, warnings }) } zurück.
 */
export function createIssues(jump) {
  const errors = h('div', { class: 'notice err', hidden: true });
  const warnings = h('div', { class: 'notice', hidden: true });
  const list = (title, entries) => [
    h('strong', {}, title),
    h('ul', {}, ...[...entries].sort((a, b) => a.line - b.line).map((e) =>
      h('li', {}, h('button', { type: 'button', class: 'link', onclick: () => jump(e.line) }, `Zeile ${e.line + 1}`), ': ' + e.msg))),
  ];
  return {
    errors, warnings,
    show(parsed) {
      errors.hidden = !parsed.errors.length;
      errors.replaceChildren(...(parsed.errors.length ? list('So kann nicht gespeichert werden:', parsed.errors) : []));
      warnings.hidden = !parsed.warnings.length;
      warnings.replaceChildren(...(parsed.warnings.length ? list('Hinweis:', parsed.warnings) : []));
    },
  };
}

/**
 * CodeMirror-Editor für ein Fragen-Dokument mit allem, was der Notiz-Editor auch kann (Links, Bilder, Tag-Vorschläge,
 * Korrektur, KI). opts: { parent, doc, placeholder, onChange, questionExtra, locked, onLocked, folder (für Bilder),
 * conflicts (siehe conflicts.js: Fragen, die es schon gibt) }.
 */
export function createQuestionEditor(ui, opts) {
  const folder = () => (typeof opts.folder === 'function' ? opts.folder() : opts.folder) || '';
  const { conflicts } = opts;
  const extra = conflicts
    ? (q, line) => [...(opts.questionExtra ? opts.questionExtra(q, line) : []), ...conflicts.marks(q, line)]
    : opts.questionExtra;
  const cm = createEditor({
    parent: opts.parent,
    doc: opts.doc,
    placeholder: opts.placeholder,
    onChange: opts.onChange,
    decorate: (text) => questionMarks(text, extra),
    onCursorLine: conflicts ? (line) => conflicts.setActive(line) : undefined,
    // [[Links]]: mit Konflikt-Erkennung im Nebenfenster (peek.js), sonst im normalen Editor
    openLink: (target) => (conflicts ? conflicts.openLink(target) : ui.openLink(target)),
    saveImage: ui.saveImage,
    spell: ui.spell,
    ai: ui.ai,
    prompt: ui.desktop ? ui.prompts : null, // Eingabefeld beim Markieren nur am Computer
    tags: ui.tags,
    locked: opts.locked,
    onLocked: opts.onLocked,
    // Bilder relativ zum Ordner der neuen bzw. bearbeiteten Notizen auflösen
    resolveImage: (link) => ui.resolveImage(link, folder() ? folder() + '/_.md' : '_.md'),
  });
  conflicts?.attach(cm);
  return cm;
}

/* ---------- Kleines Menü (z. B. am Punkt oder am „!“ einer Frage) ---------- */

let menuEl = null;

export function closeMenu() {
  if (!menuEl) return;
  menuEl.remove();
  document.removeEventListener('pointerdown', menuEl._outside, true);
  document.removeEventListener('keydown', menuEl._key, true);
  menuEl = null;
}

/**
 * Öffnet ein Menü unter `rect`; `fill(el)` setzt den Inhalt (und darf ihn später austauschen), `cls` = zusätzliche
 * Klasse, `keep(node)` → true für Stellen außerhalb, an denen ein Klick das Menü nicht schließt. Gibt das Element zurück.
 */
export function popMenu(rect, fill, cls = '', keep = () => false) {
  closeMenu();
  const el = h('div', { class: 'qmenu' + (cls ? ' ' + cls : ''), role: 'menu' });
  fill(el);
  document.body.append(el);
  const w = el.offsetWidth;
  el.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8)) + 'px';
  el.style.top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - el.offsetHeight - 8)) + 'px';
  el._outside = (e) => { if (!el.contains(e.target) && !keep(e.target)) closeMenu(); };
  el._key = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeMenu(); } };
  document.addEventListener('pointerdown', el._outside, true);
  document.addEventListener('keydown', el._key, true);
  menuEl = el;
  return el;
}
