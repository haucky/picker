// Study-Logik ohne DOM: alle TILs einer Vorlesung (VL = Datum in einem Stapel) als ein Fließtext-Dokument
// und der Abgleich dieses Dokuments mit den Dateien (ändern, neu anlegen, löschen).
import { parseFrontmatter, setFrontmatterFields, splitFrontmatter, parseTags } from '../core.js';
import { inDeck, isConfig, dayToTagDate, reviewState, setReviewState } from './srs.js';

export const ORDER_FIELD = 'study-order';
const TODO_RE = /(^|\s)(!{3,})/;
const FORBIDDEN_RE = /[\\/:*"<>|?]/;
const MAX_TITLE = 200;

/* ---------- Todos ---------- */

// Priorität nach Zahl der Ausrufezeichen: !!! normal, !!!! wichtig, !!!!! (oder mehr) unbedingt schnell.
export const PRIO_NORMAL = 1;
export const PRIO_IMPORTANT = 2;
export const PRIO_URGENT = 3;
export const PRIO_LABEL = { 1: 'Normal', 2: 'Wichtig', 3: 'Unbedingt schnell' };

/** Spalte, ab der eine Zeile ein Todo ist (`!!!` am Zeilenanfang oder nach Leerraum), sonst -1. */
export function todoStart(line) {
  const m = TODO_RE.exec(line);
  return m ? m.index + m[1].length : -1;
}

/** Priorität eines Todos (1–3, siehe oben) oder 0, wenn die Zeile kein Todo ist. */
export function todoPrio(line) {
  const m = TODO_RE.exec(line);
  return m ? Math.min(PRIO_URGENT, m[2].length - 2) : 0;
}

/** Text eines Todos (alles nach den Ausrufezeichen bis Zeilenende) oder null. */
export function todoText(line) {
  const m = TODO_RE.exec(line);
  return m ? line.slice(m.index + m[0].length).trim() : null;
}

/** Offene Todos (`!!! Text bis Zeilenende`) einer Notiz als Texte. */
export function todos(text) {
  return text.split(/\r?\n/).map(todoText).filter((t) => t != null);
}

/** Offene Todos einer Notiz mit Priorität: [{ text, prio }]. */
export function todoItems(text) {
  return text.split(/\r?\n/).map((l) => ({ text: todoText(l), prio: todoPrio(l) })).filter((t) => t.text != null);
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

/**
 * Notizen eines Stapels nach VL: [{ day (null = ohne Datum), notes }], neueste VL zuerst.
 */
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
 * Grund-Tags einer VL (ohne '#'): Stapel-Tag (bzw. der Untertag, den alle TILs der VL haben) und #date/….
 * Alle anderen Tags einer Notiz stehen im Dokument hinter ihrer Frage; neue Fragen bekommen nur die Grund-Tags.
 */
export function baseTags(texts, deckTag, day) {
  const dt = deckTag.toLowerCase();
  const isBase = (t) => { const k = t.toLowerCase(); return k === dt || k.startsWith(dt + '/') || k.startsWith('date/'); };
  let tags = null;
  for (const text of texts) {
    const t = tagLineTags(text).filter(isBase);
    const lower = new Set(t.map((x) => x.toLowerCase()));
    tags = tags ? tags.filter((x) => lower.has(x.toLowerCase())) : t;
  }
  tags = tags || [];
  if (!tags.some((t) => !t.toLowerCase().startsWith('date/'))) tags.unshift(deckTag);
  if (day != null && !tags.some((t) => /^date\//i.test(t))) tags.push('date/' + dayToTagDate(day));
  return tags;
}

/** Tags der Tag-Zeile, die nicht zu den Grund-Tags gehören. */
export function extraTags(text, base) {
  const lower = new Set(base.map((t) => t.toLowerCase()));
  return tagLineTags(text).filter((t) => !lower.has(t.toLowerCase()));
}

/** Ersetzt die Tag-Zeile (bzw. legt sie an); Frontmatter und Inhalt bleiben. */
export function setTagLine(text, tags) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const { bom, front, head, content } = splitNote(text);
  const line = tags.map((t) => '#' + t).join(' ');
  const first = head.split(/\r?\n/)[0];
  if (/^[ \t]*#[^\s#]/.test(first)) {
    const rest = head.slice(first.length);
    return bom + front + (line ? line + rest : rest.replace(/^\r?\n/, '')) + content;
  }
  if (!line) return text;
  return bom + front + line + nl + head + content;
}

/* ---------- Dokument ---------- */

const QUESTION_RE = /^(.*?\?)((?:[ \t]+#(?=[\p{L}\p{N}_\-/]*[\p{L}_\-])[\p{L}\p{N}_\-/]+)*)[ \t]*$/u;

/**
 * Frage-Zeile → { title, tags, tagsAt } oder null. Eine Frage ist nicht eingerückt, endet mit '?' (danach
 * höchstens noch Tags: „Frage? #not-for-exam“) und ist kein Markdown-Element (Liste, Zitat, Überschrift/Tag,
 * Tabelle, Code, Bild, HTML/Todo, Antwort-Datum). `tagsAt` = Spalte, ab der die Tags stehen.
 */
/** Kann die Zeile vom Anfang her eine Frage sein (nicht eingerückt, kein Markdown-Element)? */
const isQuestionCandidate = (line) => !/^\s/.test(line) && !/^(?:[-*+>#|`!<~]|::|\d+[.)](?:\s|$))/.test(line);

export function parseQuestion(line) {
  if (!isQuestionCandidate(line)) return null;
  const m = QUESTION_RE.exec(line);
  if (!m) return null;
  const title = m[1].replace(/\?+$/, '').trim();
  if (!title) return null;
  const tags = m[2].split(/\s+/).filter(Boolean).map((t) => t.slice(1).replace(/\/+$/, ''));
  return { title, tags, tagsAt: m[1].length };
}

export const isQuestionLine = (line) => !!parseQuestion(line);

/** Dokument aus Notizen (in dieser Reihenfolge); abweichende Tags stehen hinter der Frage. */
export function buildDoc(notes, base) {
  if (!notes.length) return '';
  return notes.map((n) => {
    const body = normBody(splitNote(n.text).content);
    const tags = extraTags(n.text, base).map((t) => ' #' + t).join('');
    return n.title + '?' + tags + (body ? '\n' + body : '');
  }).join('\n\n') + '\n';
}

/**
 * Zerlegt das Dokument in Fragen: { items: [{ title, tags, body, line }], errors, warnings }, Fehler und
 * Warnungen als [{ line, msg }]. `line` ist der 0-basierte Zeilenindex. Zeilen in Codeblöcken sind nie Fragen.
 * Warnung (speichern geht trotzdem): Zeile sieht nach Frage mit Tags aus, ist aber keine (z. B. „Frage? #a b“).
 */
export function parseDoc(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const items = [];
  const errors = [];
  const warnings = [];
  const pre = [];
  let cur = null;
  let fence = null;
  lines.forEach((line, i) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
    } else if (f) {
      fence = f[1];
    } else if (parseQuestion(line)) {
      const q = parseQuestion(line);
      cur = { title: q.title, tags: q.tags, line: i, lines: [] };
      items.push(cur);
      return;
    } else if (/\?[ \t]+#/.test(line) && isQuestionCandidate(line)) {
      warnings.push({ line: i, msg: 'Keine Frage: hinter dem „?“ dürfen nur Tags stehen – die Zeile gehört zum Inhalt der Frage davor' });
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
  return { items, errors, warnings };
}

/** Titel von Notizen, die sich nicht verlustfrei als Dokument darstellen lassen (z. B. Inhalt mit Frage-Zeile). */
export function roundtripIssues(notes, base) {
  return notes.filter((n) => {
    const body = normBody(splitNote(n.text).content);
    const { items, errors } = parseDoc(buildDoc([n], base));
    return errors.length || items.length !== 1 || items[0].title !== n.title || items[0].body !== body
      || items[0].tags.join(' ') !== extraTags(n.text, base).join(' ');
  }).map((n) => n.title);
}

/* ---------- Abgleich ---------- */

/**
 * Notiz mit neuem Inhalt, neuen abweichenden Tags, Reihenfolge und ggf. Review-Status (`state`, siehe srs.js).
 * Frontmatter (SR-Stand) und Zeilenumbrüche bleiben; die Tag-Zeile wird nur angefasst, wenn sich die abweichenden
 * Tags geändert haben.
 */
export function applyItem(text, { body, tags }, order, base, state) {
  const lower = new Set(base.map((t) => t.toLowerCase()));
  const keep = tagLineTags(text).filter((t) => lower.has(t.toLowerCase()));
  if (extraTags(text, base).join(' ') !== tags.join(' ')) text = setTagLine(text, [...keep, ...tags]);
  if (state && reviewState(text) !== state) text = setReviewState(text, state);
  return applyBody(text, body, order);
}

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

export function newNoteText(tags, body, order, state = 'open') {
  const text = `---\n${ORDER_FIELD}: ${order}\n---\n${tags.map((t) => '#' + t).join(' ')}\n${body ? body + '\n' : ''}`;
  return state === 'open' ? text : setReviewState(text, state);
}

/**
 * Plant das Speichern. `originals`: [{ path, title, text }] = Stand der VL beim Öffnen.
 * ctx: { folder, base (Grund-Tags), exists(path) → bool (Groß-/Kleinschreibung egal),
 *        states: Map Frage-Titel → Review-Status (optional; fehlende Titel bleiben wie sie sind bzw. open),
 *        renames: Map neuer Titel → alter Titel (optional; über „Umbenennen“: die Notiz zieht mit Frontmatter
 *        und Tags um, statt neu angelegt zu werden – der SR-Stand bleibt) }.
 * Gibt { errors, updates, creates, moves, deletes } zurück; jede Änderung als { path, title, text? },
 * moves zusätzlich mit `from` (alter Pfad) und `oldTitle`.
 */
export function planSave(doc, originals, ctx) {
  const { items, errors } = parseDoc(doc);
  const updates = [];
  const creates = [];
  const moves = [];
  const byTitle = new Map(originals.map((o) => [o.title, o]));
  const titles = new Set(items.map((it) => it.title));
  const used = new Set();
  const baseLower = new Set(ctx.base.map((t) => t.toLowerCase()));
  items.forEach((it, i) => {
    const seen = new Set(baseLower);
    it = { ...it, tags: it.tags.filter((t) => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase())) };
    const state = ctx.states?.get(it.title);
    let o = byTitle.get(it.title);
    if (!o && ctx.renames?.has(it.title)) {
      const old = byTitle.get(ctx.renames.get(it.title));
      if (old && !titles.has(old.title) && !used.has(old.path)) o = old;
    }
    if (o && o.title !== it.title) {
      used.add(o.path);
      const dir = o.path.includes('/') ? o.path.slice(0, o.path.lastIndexOf('/') + 1) : '';
      moves.push({ from: o.path, path: dir + it.title + '.md', title: it.title, oldTitle: o.title, line: it.line,
        text: applyItem(o.text, it, i + 1, ctx.base, state) });
    } else if (o) {
      used.add(o.path);
      const text = applyItem(o.text, it, i + 1, ctx.base, state);
      if (text !== o.text) updates.push({ path: o.path, title: o.title, text });
    } else {
      const path = (ctx.folder ? ctx.folder + '/' : '') + it.title + '.md';
      creates.push({ path, title: it.title, line: it.line, text: newNoteText([...ctx.base, ...it.tags], it.body, i + 1, state) });
    }
  });
  const deletes = originals.filter((o) => !used.has(o.path)).map((o) => ({ path: o.path, title: o.title }));
  const freed = new Set([...deletes, ...moves.map((m) => ({ path: m.from }))].map((d) => d.path.toLowerCase()));
  for (const c of [...creates, ...moves]) {
    if (ctx.exists(c.path) && !freed.has(c.path.toLowerCase())) {
      errors.push({ line: c.line, msg: `„${c.path}“ gibt es schon im Vault (in einer anderen VL oder einem anderen Stapel)` });
    }
  }
  return { errors, updates, creates, moves, deletes };
}
