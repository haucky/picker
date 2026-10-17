// Streams-Logik ohne DOM: Streams aus Streams.md (Tag + Kapitel), Einträge über die Zeit, eigene Antworten
// („Heute sehe ich das so …“), auffällige Wörter pro Zeitraum und Wort-Fäden durch den Stream.
import { splitFrontmatter, parseTags } from '../core.js';
import { cardBody, splitAnswers, isoToDay, dayToIso } from './srs.js';

export const STREAMS_PATH = 'Streams.md';
const CHAPTER_RE = /^(\d{4}-\d{2}-\d{2})\s+bis\s+(\d{4}-\d{2}-\d{2}|heute)\s+(.+)$/i;
const ANSWER_RE = /^::(\d{2}\.\d{2}\.\d{4})::\s*$/;
const WORD_RE = /[\p{L}](?:[\p{L}]|['’-](?=\p{L}))*/gu;
const MIN_WORD = 4;

export const isStreamsConfig = (path) => path.toLowerCase() === STREAMS_PATH.toLowerCase();
export const dayOfNote = (n) => (n.date == null ? null : Math.round(n.date / 864e5));

/* ---------- Streams.md ---------- */

/**
 * Jede Überschrift ist ein Stream, darunter `tag: #a` und beliebig viele
 * `kapitel: JJJJ-MM-TT bis JJJJ-MM-TT|heute Name`. → [{ name, tag, chapters: [{ from, to (null = heute), name }] }]
 */
export function parseStreams(text) {
  const out = [];
  let cur = null;
  for (const line of splitFrontmatter(text).body.split(/\r?\n/)) {
    const hm = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (hm) { cur = { name: hm[1], tag: null, chapters: [] }; out.push(cur); continue; }
    const km = /^\s*(?:[-*+]\s+)?(tags?|kapitel)\s*:\s*(.*)$/i.exec(line);
    if (!km || !cur) continue;
    if (km[1].toLowerCase() === 'kapitel') {
      const m = CHAPTER_RE.exec(km[2].trim());
      const from = m && isoToDay(m[1]);
      if (from != null) cur.chapters.push({ from, to: m[2].toLowerCase() === 'heute' ? null : isoToDay(m[2]), name: m[3].trim() });
    } else {
      cur.tag ??= parseTags(' ' + km[2])[0] || null;
    }
  }
  for (const s of out) s.chapters.sort((a, b) => a.from - b.from);
  return out.filter((s) => s.tag);
}

export function newStreamsFile() {
  return '# Streams\n\nJede Überschrift ist ein Stream (Tab Diary → Streams), darunter „- tag: #…“ (Untertags zählen mit)\n' +
    'und optional Kapitel: „- kapitel: 2026-01-12 bis 2026-02-20 Prüfungsphase“ („bis heute“ für ein offenes Kapitel).\n';
}

/** Hängt einen Stream an (bzw. legt den Inhalt einer neuen Streams.md an). */
export function addStream(text, name, tag) {
  const base = (text ?? newStreamsFile()).replace(/\s+$/, '');
  return `${base}\n\n## ${name}\n- tag: #${tag}\n`;
}

export const chapterLine = (c) => `- kapitel: ${dayToIso(c.from)} bis ${c.to == null ? 'heute' : dayToIso(c.to)} ${c.name}`;

/** Fügt ein Kapitel unter dem Stream `streamName` ein (nach dessen letzter Zeile). */
export function addChapter(text, streamName, chapter) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => { const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(l); return m && m[1] === streamName; });
  if (start < 0) throw new Error(`Stream „${streamName}“ nicht in ${STREAMS_PATH}`);
  let end = lines.findIndex((l, i) => i > start && /^#{1,6}\s/.test(l));
  if (end < 0) end = lines.length;
  let at = end;
  while (at > start + 1 && !lines[at - 1].trim()) at--;
  lines.splice(at, 0, chapterLine(chapter));
  return lines.join(nl);
}

/* ---------- Einträge ---------- */

const hasTag = (n, tag) => { const t = tag.toLowerCase(); return n.tagsLower.some((x) => x === t || x.startsWith(t + '/')); };

/** Notizen des Streams (Tag oder Untertag, mit #date/…), neueste zuerst: [{ note, day }]. */
export function streamEntries(notes, stream) {
  return notes.filter((n) => !isStreamsConfig(n.path) && n.date != null && hasTag(n, stream.tag))
    .map((note) => ({ note, day: dayOfNote(note) }))
    .sort((a, b) => b.day - a.day || a.note.path.localeCompare(b.note.path, 'de'));
}

/** Inhalt ohne Frontmatter/Tag-Zeile und eigene Antworten: { body, answers: [{ date: 'TT.MM.JJJJ', text }] }. */
export function entryParts(text) {
  const { back, answers } = splitAnswers(cardBody(text));
  const list = [];
  for (const line of answers.split(/\r?\n/)) {
    const m = ANSWER_RE.exec(line);
    if (m) list.push({ date: m[1], lines: [] });
    else if (list.length) list.at(-1).lines.push(line);
  }
  return { body: back.trim(), answers: list.map((a) => ({ date: a.date, text: a.lines.join('\n').trim() })).filter((a) => a.text) };
}

/** Einträge pro Woche, die letzten `n` Wochen bis `today` (Index n-1 = diese Woche). */
export function weekCounts(entries, today, n) {
  const out = new Array(n).fill(0);
  for (const e of entries) {
    const w = Math.floor((today - e.day) / 7);
    if (w >= 0 && w < n) out[n - 1 - w]++;
  }
  return out;
}

/** Häufigste #diary/<x>-Tags (Untertags zählen zum Tag der 2. Ebene), ohne `exclude`: [{ tag, count }]. */
export function topDiaryTags(notes, exclude = [], limit = 10) {
  const counts = new Map();
  const skip = new Set(exclude.map((t) => t.toLowerCase()));
  for (const n of notes) {
    const seen = new Set();
    for (const t of n.tags) {
      const m = /^diary\/([^/]+)/i.exec(t);
      if (!m) continue;
      const tag = 'diary/' + m[1];
      if (seen.has(tag.toLowerCase())) continue;
      seen.add(tag.toLowerCase());
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts].filter(([t]) => !skip.has(t.toLowerCase()))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de')).slice(0, limit).map(([tag, count]) => ({ tag, count }));
}

/** Eintrag am nächsten an `day` (höchstens `within` Tage entfernt) oder null. */
export function nearestEntry(entries, day, within = 7) {
  let best = null;
  for (const e of entries) {
    const d = Math.abs(e.day - day);
    if (d <= within && (!best || d < Math.abs(best.day - day))) best = e;
  }
  return best;
}

/* ---------- Wörter ---------- */

/** Wörter eines Eintrags (ohne Antworten, Links, Tags, Füllwörter): Map klein → Schreibweise. */
export function entryWords(text, stop) {
  const body = entryParts(text).body
    .replace(/!?\[\[[^\]]*\]\]/g, ' ')
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/(^|\s)#[^\s#]+/g, ' ')
    .replace(/`[^`]*`/g, ' ');
  const out = new Map();
  for (const m of body.matchAll(WORD_RE)) {
    const w = m[0];
    const k = w.toLowerCase();
    if (k.length < MIN_WORD || stop.has(k)) continue;
    if (!out.has(k) || (w[0] !== w[0].toLowerCase() && out.get(k)[0] === out.get(k)[0].toLowerCase())) out.set(k, w);
  }
  return out;
}

const QUARTER = ['Jan–Mär', 'Apr–Jun', 'Jul–Sep', 'Okt–Dez'];

/**
 * Zeiträume für „auffällige Wörter“: die Kapitel und für Einträge außerhalb von Kapiteln Quartale, neueste zuerst.
 * → [{ label, entries }]
 */
export function periods(entries, chapters, today) {
  const out = [];
  const inChapter = new Set();
  for (const c of chapters) {
    const to = c.to ?? today;
    const es = entries.filter((e) => e.day >= c.from && e.day <= to);
    es.forEach((e) => inChapter.add(e));
    out.push({ label: c.name, from: c.from, entries: es });
  }
  const quarters = new Map();
  for (const e of entries) {
    if (inChapter.has(e)) continue;
    const d = new Date(e.day * 864e5);
    const key = d.getUTCFullYear() * 4 + Math.floor(d.getUTCMonth() / 3);
    if (!quarters.has(key)) quarters.set(key, { label: `${QUARTER[key % 4]} ${Math.floor(key / 4)}`, from: e.day, entries: [] });
    const q = quarters.get(key);
    q.entries.push(e);
    q.from = Math.min(q.from, e.day);
  }
  return [...out, ...quarters.values()].sort((a, b) => b.from - a.from);
}

/**
 * Wörter, die im Zeitraum deutlich häufiger vorkommen als im Rest des Streams (Anteil der Einträge mit dem Wort,
 * mindestens 2 Einträge im Zeitraum). `words`: Map Eintrag → entryWords. → [{ word, score }]
 */
export function distinctiveWords(period, all, words, limit = 6) {
  const nIn = period.entries.length;
  if (nIn < 3) return [];
  const inSet = new Set(period.entries);
  const nOut = all.length - nIn;
  const dfIn = new Map();
  const dfOut = new Map();
  const spelling = new Map();
  for (const e of all) {
    const target = inSet.has(e) ? dfIn : dfOut;
    for (const [k, w] of words.get(e)) {
      target.set(k, (target.get(k) || 0) + 1);
      if (!spelling.has(k)) spelling.set(k, w);
    }
  }
  const out = [];
  for (const [k, c] of dfIn) {
    if (c < 2) continue;
    const score = (c / nIn) / (((dfOut.get(k) || 0) + 1) / (nOut + 1));
    if (score >= 1.5) out.push({ word: spelling.get(k), score, count: c });
  }
  return out.sort((a, b) => b.score - a.score || b.count - a.count).slice(0, limit);
}

/** Wort-Vorschläge für „Damals ↔ Heute“: kommen im ersten und im letzten Drittel je mindestens zweimal vor. */
export function threadWords(entries, words, limit = 3) {
  const asc = [...entries].sort((a, b) => a.day - b.day);
  const third = Math.max(1, Math.floor(asc.length / 3));
  const df = (list) => {
    const m = new Map();
    for (const e of list) for (const k of words.get(e).keys()) m.set(k, (m.get(k) || 0) + 1);
    return m;
  };
  const early = df(asc.slice(0, third));
  const late = df(asc.slice(-third));
  const all = df(asc);
  const spelling = (k) => { for (const e of asc) { const w = words.get(e).get(k); if (w) return w; } return k; };
  let cands = [...all.keys()].filter((k) => (early.get(k) || 0) >= 2 && (late.get(k) || 0) >= 2);
  if (!cands.length) cands = [...all.keys()].filter((k) => all.get(k) >= 2);
  return cands.sort((a, b) => all.get(b) - all.get(a)).slice(0, limit).map(spelling);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Einträge (älteste zuerst), in denen ein Wort mit `word` beginnt (z. B. „schlaf“ → Schlaf, schlafen). */
export function threadEntries(entries, word) {
  const w = word.trim();
  if (!w) return [];
  const re = new RegExp(`(^|[^\\p{L}])${escapeRe(w)}`, 'iu');
  return entries.filter((e) => re.test(entryParts(e.note.text).body)).sort((a, b) => a.day - b.day);
}
