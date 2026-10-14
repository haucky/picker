// Review-Logik ohne DOM: Spaced Repetition wie im Obsidian-Plugin „Spaced Repetition“ (SM-2-OSR,
// Notiz-Review), feste Intervalle (#review/daily|weekly|monthly + #reviewed/JJJJ/MM/TT) und Stapel aus Review.md.
import { parseTags, parseFrontmatter, setFrontmatterFields, splitFrontmatter, addTagsToText } from '../core.js';

export const CONFIG_PATH = 'Review.md';

// Standardwerte des Plugins
export const SETTINGS = {
  baseEase: 250,
  easyBonus: 1.3,
  lapsesIntervalChange: 0.5,
  maximumInterval: 36525,
};

export const FIXED_INTERVALS = { daily: 1, weekly: 7, monthly: 30 };
const REVIEW_PREFIX = 'review/';
const REVIEWED_RE = /#reviewed\/\d{4}\/\d{2}\/\d{2}/;
const REVIEWED_TAG_RE = /^reviewed\/(\d{4})\/(\d{2})\/(\d{2})$/i;

/* ---------- Datum (lokale Kalendertage als ganze Zahlen) ---------- */

export const dayOf = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / 864e5);
export function today(now = new Date()) {
  return dayOf(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
export function dayToIso(day) {
  return new Date(day * 864e5).toISOString().slice(0, 10);
}
export function isoToDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? dayOf(+m[1], +m[2], +m[3]) : null;
}
export const dayToTagDate = (day) => dayToIso(day).replace(/-/g, '/');
export const dayToGerman = (day) => dayToIso(day).split('-').reverse().join('.');

/* ---------- Algorithmus (SM-2-OSR) ---------- */

export const RESPONSES = ['hard', 'good', 'easy'];

/**
 * Wie `schedule()` im Plugin. `delay` = Tage seit Fälligkeit, `dueDates` = { Tage ab heute: Anzahl Notizen }
 * für den Lastausgleich (wird verändert). Gibt { interval, ease } zurück; interval in ganzen Tagen.
 */
export function schedule(response, interval, ease, delay, dueDates, s = SETTINGS) {
  delay = Math.max(0, Math.floor(delay));
  if (response === 'easy') {
    ease += 20;
    interval = ((interval + delay) * ease) / 100;
    interval *= s.easyBonus;
  } else if (response === 'good') {
    interval = ((interval + delay / 2) * ease) / 100;
  } else if (response === 'hard') {
    ease = Math.max(130, ease - 20);
    interval = Math.max(1, (interval + delay / 4) * s.lapsesIntervalChange);
  }

  // Lastausgleich statt Zufall: im Fuzz-Bereich den Tag mit den wenigsten Notizen nehmen
  if (dueDates) {
    interval = Math.round(interval);
    if (!Object.hasOwn(dueDates, interval)) {
      dueDates[interval] = 0;
    } else if (interval > 4) {
      let fuzz;
      if (interval < 7) fuzz = 1;
      else if (interval < 30) fuzz = Math.max(2, Math.floor(interval * 0.15));
      else fuzz = Math.max(4, Math.floor(interval * 0.05));
      const original = interval;
      outer: for (let i = 1; i <= fuzz; i++) {
        for (const ivl of [original - i, original + i]) {
          if (!Object.hasOwn(dueDates, ivl)) { dueDates[ivl] = 0; interval = ivl; break outer; }
          if (dueDates[ivl] < dueDates[interval]) interval = ivl;
        }
      }
    }
    dueDates[interval]++;
  }

  interval = Math.min(interval, s.maximumInterval);
  interval = Math.round(interval * 10) / 10;
  return { interval, ease };
}

/** SR-Felder aus der Frontmatter: { due (Tag), interval, ease } oder null für eine neue Karte. */
export function srState(text) {
  const fm = parseFrontmatter(text);
  const due = isoToDay(fm['sr-due']);
  const interval = parseFloat(fm['sr-interval']);
  const ease = parseFloat(fm['sr-ease']);
  if (due == null || !(interval > 0) || !(ease > 0)) return null;
  return { due, interval, ease };
}

/** Nächster Stand einer Karte nach einer Bewertung. */
export function nextState(state, response, day, dueDates) {
  const interval = state ? state.interval : 1;
  const ease = state ? state.ease : SETTINGS.baseEase;
  const delay = state ? day - state.due : 0;
  const r = schedule(response, interval, ease, delay, dueDates);
  return { due: day + Math.max(1, Math.round(r.interval)), interval: r.interval, ease: r.ease };
}

/** Schreibt den Stand wie das Plugin in die Frontmatter. */
export function writeState(text, st) {
  return setFrontmatterFields(text, {
    'sr-due': dayToIso(st.due),
    'sr-interval': String(st.interval),
    'sr-ease': String(st.ease),
  });
}

/** { Tage ab heute: Anzahl } über alle Notizen mit SR-Stand (außer `exceptPath`). */
export function dueDateCounts(notes, day, exceptPath) {
  const out = {};
  for (const n of notes) {
    if (n.path === exceptPath) continue;
    const st = srState(n.text);
    if (!st) continue;
    const k = st.due - day;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/** Abstand für die Anzeige auf den Knöpfen. */
export function formatInterval(days) {
  if (days < 60) return `${days} T`;
  if (days < 365) return `${(days / 30).toFixed(1).replace('.', ',')} Mon.`;
  return `${(days / 365).toFixed(1).replace('.', ',')} J.`;
}

/* ---------- Feste Intervalle ---------- */

/** Art des festen Intervalls ('daily'|'weekly'|'monthly') oder null. */
export function fixedType(tags) {
  for (const t of tags) {
    const k = t.toLowerCase();
    if (k.startsWith(REVIEW_PREFIX) && Object.hasOwn(FIXED_INTERVALS, k.slice(REVIEW_PREFIX.length))) {
      return k.slice(REVIEW_PREFIX.length);
    }
  }
  return null;
}

/** Letztes Review-Datum (Tag) aus #reviewed/JJJJ/MM/TT oder null. */
export function reviewedDay(tags) {
  for (const t of tags) {
    const m = REVIEWED_TAG_RE.exec(t);
    if (m) return dayOf(+m[1], +m[2], +m[3]);
  }
  return null;
}

/** Setzt #reviewed/… auf `day`: ersetzt den vorhandenen Tag, sonst hinter #review/<typ>, sonst an die Tag-Zeile. */
export function setReviewed(text, day) {
  const tag = '#reviewed/' + dayToTagDate(day);
  if (REVIEWED_RE.test(text)) return text.replace(REVIEWED_RE, tag);
  const typeRe = new RegExp(`#${REVIEW_PREFIX}(${Object.keys(FIXED_INTERVALS).join('|')})(?![\\p{L}\\p{N}_\\-/])`, 'iu');
  if (typeRe.test(text)) return text.replace(typeRe, `$& ${tag}`);
  return addTagsToText(text, [tag.slice(1)]);
}

/* ---------- Review.md ---------- */

/**
 * Stapel aus Review.md: jede Überschrift ist ein Stapel, darunter `tag: #a` (genau ein Tag; `tags:` geht auch,
 * dann zählt der erste) und optional `ohne: #c #d`.
 * Gibt [{ name, tag (Originalschreibweise), without: [klein] }] zurück (nur Stapel mit Tag).
 */
export function parseDecks(text) {
  const decks = [];
  let cur = null;
  for (const line of splitFrontmatter(text).body.split(/\r?\n/)) {
    const hm = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (hm) { cur = { name: hm[1], tag: null, without: [] }; decks.push(cur); continue; }
    const km = /^\s*(?:[-*+]\s+)?(tags?|ohne)\s*:\s*(.*)$/i.exec(line);
    if (!km || !cur) continue;
    const tags = parseTags(' ' + km[2]);
    if (km[1].toLowerCase() === 'ohne') cur.without.push(...tags.map((t) => t.toLowerCase()));
    else cur.tag ??= tags[0] || null;
  }
  return decks.filter((d) => d.tag);
}

const hasTag = (tagsLower, wanted) => tagsLower.some((t) => wanted.some((w) => t === w || t.startsWith(w + '/')));

/** Gehört die Notiz zum Stapel? */
export function inDeck(note, deck) {
  return hasTag(note.tagsLower, [deck.tag.toLowerCase()]) && !hasTag(note.tagsLower, deck.without);
}

export const isConfig = (path) => path.toLowerCase() === CONFIG_PATH.toLowerCase();

/* ---------- Karten ---------- */

/**
 * Alle Karten am Tag `day`. Feste Intervalle haben Vorrang: eine Notiz mit #review/daily|weekly|monthly
 * ist nie zusätzlich eine SR-Karte.
 * Karte: { path, kind: 'sr'|'fixed', decks: [Index], isNew, due, overdue, fixedType, unseeded }
 */
export function buildCards(notes, decks, day) {
  const cards = [];
  for (const n of notes) {
    if (isConfig(n.path)) continue;
    const ft = fixedType(n.tags);
    if (ft) {
      const last = reviewedDay(n.tags);
      const due = last == null ? day : last + FIXED_INTERVALS[ft];
      cards.push({ path: n.path, kind: 'fixed', decks: [], fixedType: ft, isNew: false,
        unseeded: last == null, due, overdue: day - due });
      continue;
    }
    const idx = [];
    decks.forEach((d, i) => { if (inDeck(n, d)) idx.push(i); });
    if (!idx.length) continue;
    const st = srState(n.text);
    cards.push({ path: n.path, kind: 'sr', decks: idx, isNew: !st, due: st ? st.due : null,
      overdue: st ? day - st.due : 0, unseeded: false });
  }
  return cards;
}

/** Zufälliges Startdatum für ein festes Intervall ohne #reviewed/… (wie im Obsidian-Snippet). */
export function seedDay(type, day, rand = Math.random) {
  return day - Math.floor(rand() * FIXED_INTERVALS[type]);
}

/* ---------- Antworten ---------- */

const ANSWER_RE = /^::\d{2}\.\d{2}\.\d{4}::\s*$/;

/** Teilt den Inhalt in Rückseite und eigene Antworten (ab der ersten Zeile `::TT.MM.JJJJ::`). */
export function splitAnswers(body) {
  const lines = body.split(/\r?\n/);
  const i = lines.findIndex((l) => ANSWER_RE.test(l));
  if (i < 0) return { back: body, answers: '', count: 0 };
  return {
    back: lines.slice(0, i).join('\n'),
    answers: lines.slice(i).join('\n'),
    count: lines.filter((l) => ANSWER_RE.test(l)).length,
  };
}

/** Hängt eine Antwort wie das Snippet („New Answer“) ans Dateiende an. */
export function appendAnswer(text, answer, day) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = answer.trim().split(/\r?\n/);
  const item = '- ' + lines.join(nl + '  ');
  const base = text.replace(/\s+$/, '');
  return base + nl + nl + `::${dayToGerman(day)}::` + nl + item + nl;
}

/** Text ohne Frontmatter und ohne Tag-Zeile am Anfang. */
export function cardBody(text) {
  const lines = splitFrontmatter(text).body.split(/\r?\n/);
  if (lines.length && /^\s*#[^\s#]/.test(lines[0])) lines.shift();
  return lines.join('\n').replace(/^\s*\n/, '');
}
