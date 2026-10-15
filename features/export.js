// Export einer VL als Druckansicht im Stil eines LaTeX-Dokuments (wie latex.css): Titel, Name, Datum, dann jede
// Frage als Abschnitt mit ihrem Inhalt. „Als PDF speichern“ im Druckdialog macht daraus das PDF.
import { h } from './dom.js';
import { renderMarkdown } from './markdown.js';
import { parseDoc, todoStart } from './studydoc.js';

const NAME_KEY = 'export-name';
const ANSWER_DATE_RE = /^::(\d{2}\.\d{2}\.\d{4})::$/;

/** Name des Exporteurs (Settings), steht unter dem Titel. */
export function exportName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
}

export function setExportName(name) {
  try {
    if (name.trim()) localStorage.setItem(NAME_KEY, name.trim()); else localStorage.removeItem(NAME_KEY);
  } catch { /* egal */ }
}

/** Inhalt ohne Todos (`!!! …` bis Zeilenende; Zeilen, die nur ein Todo sind, fallen ganz weg). Codeblöcke bleiben. */
export function withoutTodos(body) {
  let fence = null;
  const out = [];
  for (const line of body.split('\n')) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
    } else if (f) {
      fence = f[1];
    } else {
      const t = todoStart(line);
      if (t >= 0) {
        const rest = line.slice(0, t).trimEnd();
        if (!rest.trim() || /^\s*([-*+]|\d+[.)])$/.test(rest)) continue;
        out.push(rest);
        continue;
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

const longDate = (day) => new Date(day * 864e5).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * Druckt eine VL. `text` = Dokument aus dem VL-Editor (auch ungespeichert), `day` = Kalendertag oder null,
 * `resolveImage(link)` → Promise<URL|null>. Wartet, bis alle Bilder geladen sind, damit sie im PDF landen.
 */
export async function printVL({ deck, day, text, resolveImage }) {
  const { items } = parseDoc(text);
  const pending = [];
  const ctx = { resolveImage: (link) => { const p = resolveImage(link); pending.push(p.catch(() => null)); return p; } };
  const name = exportName();
  const doc = h('article', { class: 'print-doc', lang: 'de' },
    h('header', { class: 'print-title' },
      h('h1', {}, deck.name),
      name ? h('p', { class: 'print-author' }, name) : null,
      day != null ? h('p', { class: 'print-date' }, `Vorlesung vom ${longDate(day)}`) : null),
    ...items.map((it) => {
      const md = renderMarkdown(withoutTodos(it.body), ctx);
      for (const p of md.querySelectorAll('p')) {
        const m = ANSWER_DATE_RE.exec(p.textContent.trim());
        if (m) { p.className = 'print-answer-date'; p.textContent = `Antwort vom ${m[1]}`; }
      }
      return h('section', { class: 'print-q' }, h('h2', {}, it.title + '?'), md);
    }));

  document.body.append(doc);
  // Schriften vorher laden: die Druckansicht ist bis zum Drucken unsichtbar, sonst fehlt der Text im PDF.
  await Promise.all(['', 'bold ', 'italic ', 'italic bold '].map((s) => document.fonts.load(s + '11pt "LM Roman"'))
    .concat(document.fonts.load('10pt "LM Mono"'))).catch(() => {});
  await Promise.all(pending);
  await new Promise((r) => requestAnimationFrame(r)); // src wird in .then() gesetzt
  await Promise.all([...doc.querySelectorAll('img')].filter((i) => i.src).map((i) => i.decode().catch(() => {})));

  const title = document.title;
  document.title = [deck.name, day != null ? 'VL ' + new Date(day * 864e5).toISOString().slice(0, 10) : null, name]
    .filter(Boolean).join(' – '); // Vorschlag für den Dateinamen des PDFs
  document.body.classList.add('printing');
  const cleanup = () => {
    document.body.classList.remove('printing');
    document.title = title;
    doc.remove();
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
}
