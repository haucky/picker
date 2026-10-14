// Study-Logik ohne DOM: alle TILs einer Vorlesung (VL = Datum in einem Stapel) als ein Fließtext-Dokument
// und der Abgleich dieses Dokuments mit den Dateien (ändern, neu anlegen, löschen).
import { parseFrontmatter, setFrontmatterFields, splitFrontmatter, parseTags } from '../core.js';
import { inDeck, isConfig, dayToTagDate } from './srs.js';

export const ORDER_FIELD = 'study-order';
const TODO_RE = /<!!!(.*)$/;
const FORBIDDEN_RE = /[\\/:*"<>|?]/;
const MAX_TITLE = 200;

/* ---------- Todos ---------- */

/** Offene Todos (`<!!! Text bis Zeilenende`) einer Notiz als Texte. */
export function todos(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = TODO_RE.exec(line);
    if (m) out.push(m[1].trim());
  }
  return out;
}

/** Spalte, ab der eine Zeile ein Todo ist, sonst -1. */
export function todoStart(line) {
  return line.indexOf('<!!!');
}

/* ---------- Notizen ---------- */

/** Reihenfolge aus dem Study-Editor (Frontmatter `study-order`), sonst Infinity. */
export function studyOrder(text) {
  const v = parseFloat(parseFrontmatter(text)[ORDER_FIELD]);
  return Number.isFinite(v) ? v : Infinity;
}

/** Datum einer Notiz als Kalendertag (wie in srs.js) oder null. */
export const dayOfNote = (note) => (note.date == null ? null : Math.round(note.date / 864e5));

/**
 * Teilt eine Notiz in Kopf und Inhalt: { bom, front, head, content }. `head` ist die Tag-Zeile samt
 * folgender Leerzeilen (oder nur Leerzeilen). bom + front + head + content === text.
 */
export function splitNote(text) {
  const { bom, front, body } = splitFrontmatter(text);
  const head = body.match(/^(?:[ \t]*#[^\s#].*(?:\r?\n|$))?(?:[ \t]*\r?\n)*/)[0];
  return { bom, front, head, content: body.slice(head.length) };
}

/** Inhalt ohne führende Leerzeilen und ohne Leerraum am Ende, mit \n als Zeilenumbruch. */
export function normBody(s) {
  return s.replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '').trimEnd();
}

/** Tags aus der Tag-Zeile (ohne '#'). */
export function tagLineTags(text) {
  const { head } = splitNote(text);
  return parseTags(head.split(/\r?\n/)[0] || '');
}

/** Notizen eines Stapels nach VL: [{ day (null = ohne Datum), notes }], neueste VL zuerst. */
export function groupByDay(notes, deck) {
  const groups = new Map();
  for (const n of notes) {
    if (isConfig(n.path) || !inDeck(n, deck)) continue;
    const day = dayOfNote(n);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(n);
  }
  return [...groups].map(([day, ns]) => ({ day, notes: sortNotes(ns) }))
    .sort((a, b) => (a.day == null) - (b.day == null) || b.day - a.day);
}

/** Reihenfolge im Dokument: study-order, dann Titel. */
export function sortNotes(notes) {
  return notes.map((n) => ({ n, o: studyOrder(n.text) }))
    .sort((a, b) => (a.o - b.o || 0) || a.n.title.localeCompare(b.n.title, 'de'))
    .map((x) => x.n);
}

/**
 * Tag-Zeile für neue Fragen einer VL: Tags, die alle bisherigen TILs der VL in der Tag-Zeile haben
 * (ohne #review/… und #reviewed/…), mindestens aber der Stapel-Tag und #date/… der VL.
 */
export function tagLineFor(texts, deckTag, day) {
  let tags = null;
  for (const text of texts) {
    const t = tagLineTags(text);
    const lower = new Set(t.map((x) => x.toLowerCase()));
    tags = tags ? tags.filter((x) => lower.has(x.toLowerCase())) : t;
  }
  tags = (tags || []).filter((t) => !/^reviewed?\//i.test(t));
  const dt = deckTag.toLowerCase();
  if (!tags.some((t) => t.toLowerCase() === dt || t.toLowerCase().startsWith(dt + '/'))) tags.unshift(deckTag);
  if (day != null && !tags.some((t) => /^date\//i.test(t))) tags.push('date/' + dayToTagDate(day));
  return tags.map((t) => '#' + t).join(' ');
}

/* ---------- Dokument ---------- */

/**
 * Ist die Zeile eine Frage? Nicht eingerückt, endet mit '?' und ist kein Markdown-Element
 * (Liste, Zitat, Überschrift/Tag, Tabelle, Code, Bild, HTML/Todo, Antwort-Datum).
 */
export function isQuestionLine(line) {
  const t = line.trimEnd();
  if (!t.endsWith('?') || /^\s/.test(t)) return false;
  if (/^(?:[-*+>#|`!<~]|::|\d+[.)](?:\s|$))/.test(t)) return false;
  return /[^?]/.test(t);
}

const titleOf = (line) => line.trim().replace(/\?+$/, '').trim();

/** Dokument aus Notizen (in dieser Reihenfolge). */
export function buildDoc(notes) {
  if (!notes.length) return '';
  return notes.map((n) => {
    const body = normBody(splitNote(n.text).content);
    return n.title + '?' + (body ? '\n' + body : '');
  }).join('\n\n') + '\n';
}

/**
 * Zerlegt das Dokument in Fragen: { items: [{ title, body, line }], errors: [{ line, msg }] }.
 * `line` ist der 0-basierte Zeilenindex. Zeilen in Codeblöcken sind nie Fragen.
 */
export function parseDoc(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const items = [];
  const errors = [];
  const pre = [];
  let cur = null;
  let fence = null;
  lines.forEach((line, i) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
    } else if (f) {
      fence = f[1];
    } else if (isQuestionLine(line)) {
      cur = { title: titleOf(line), line: i, lines: [] };
      items.push(cur);
      return;
    }
    (cur ? cur.lines : pre).push(i);
  });

  const firstText = pre.find((i) => lines[i].trim());
  if (firstText != null) errors.push({ line: firstText, msg: 'Text vor der ersten Frage gehört zu keiner Frage' });

  const seen = new Map();
  for (const it of items) {
    it.body = normBody(it.lines.map((i) => lines[i]).join('\n'));
    delete it.lines;
    const bad = it.title.match(FORBIDDEN_RE);
    if (bad) errors.push({ line: it.line, msg: `„${bad[0]}“ ist im Dateinamen nicht erlaubt` });
    else if (it.title.startsWith('.')) errors.push({ line: it.line, msg: 'Dateiname darf nicht mit „.“ beginnen' });
    else if (it.title.length > MAX_TITLE) errors.push({ line: it.line, msg: `Frage zu lang für einen Dateinamen (max. ${MAX_TITLE} Zeichen)` });
    const key = it.title.toLowerCase();
    if (seen.has(key)) errors.push({ line: it.line, msg: `Frage kommt doppelt vor (auch Zeile ${seen.get(key) + 1})` });
    else seen.set(key, it.line);
  }
  return { items, errors };
}

/** Titel von Notizen, die sich nicht verlustfrei als Dokument darstellen lassen (z. B. Inhalt mit Frage-Zeile). */
export function roundtripIssues(notes) {
  return notes.filter((n) => {
    const body = normBody(splitNote(n.text).content);
    const { items, errors } = parseDoc(n.title + '?\n' + body);
    return errors.length || items.length !== 1 || items[0].title !== n.title || items[0].body !== body;
  }).map((n) => n.title);
}

/* ---------- Abgleich ---------- */

/** Notiz mit neuem Inhalt und Reihenfolge; Frontmatter (SR-Stand), Tag-Zeile und Zeilenumbrüche bleiben. */
export function applyBody(text, body, order) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  let out = text;
  const { bom, front, head, content } = splitNote(text);
  if (normBody(content) !== body) {
    const h = head && !/\n$/.test(head) && body ? head + nl : head;
    out = bom + front + h + (body ? body.replace(/\n/g, nl) + nl : '');
  }
  if (parseFrontmatter(out)[ORDER_FIELD] !== String(order)) out = setFrontmatterFields(out, { [ORDER_FIELD]: String(order) });
  return out;
}

export function newNoteText(tagLine, body, order) {
  return `---\n${ORDER_FIELD}: ${order}\n---\n${tagLine}\n${body ? body + '\n' : ''}`;
}

/**
 * Plant das Speichern. `originals`: [{ path, title, text }] = Stand der VL beim Öffnen.
 * ctx: { folder, tagLine, exists(path) → bool (Groß-/Kleinschreibung egal) }.
 * Gibt { errors, updates, creates, deletes } zurück; jede Änderung als { path, title, text? }.
 */
export function planSave(doc, originals, ctx) {
  const { items, errors } = parseDoc(doc);
  const updates = [];
  const creates = [];
  const byTitle = new Map(originals.map((o) => [o.title, o]));
  const used = new Set();
  items.forEach((it, i) => {
    const o = byTitle.get(it.title);
    if (o) {
      used.add(o.path);
      const text = applyBody(o.text, it.body, i + 1);
      if (text !== o.text) updates.push({ path: o.path, title: o.title, text });
    } else {
      const path = (ctx.folder ? ctx.folder + '/' : '') + it.title + '.md';
      creates.push({ path, title: it.title, line: it.line, text: newNoteText(ctx.tagLine, it.body, i + 1) });
    }
  });
  const deletes = originals.filter((o) => !used.has(o.path)).map((o) => ({ path: o.path, title: o.title }));
  const freed = new Set(deletes.map((d) => d.path.toLowerCase()));
  for (const c of creates) {
    if (ctx.exists(c.path) && !freed.has(c.path.toLowerCase())) {
      errors.push({ line: c.line, msg: `„${c.path}“ gibt es schon im Vault (in einer anderen VL oder einem anderen Stapel)` });
    }
  }
  return { errors, updates, creates, deletes };
}
