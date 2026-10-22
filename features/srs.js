// Review-Logik ohne DOM: Spaced Repetition wie im Obsidian-Plugin „Spaced Repetition“ (SM-2-OSR,
// Notiz-Review), feste Intervalle (#review/weekly, #review/3m, … + #reviewed/JJJJ/MM/TT) und Stapel aus Review.md.
import { parseTags, parseFrontmatter, setFrontmatterFields, splitFrontmatter, addTagsToText } from '../core.js';

export const CONFIG_PATH = 'Review.md';

// Standardwerte des Plugins
export const SETTINGS = {
  baseEase: 250,
  easyBonus: 1.3,
  lapsesIntervalChange: 0.5,
  maximumInterval: 36525,
};

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

// Intervall = { n, unit } mit unit d (Tage), w (Wochen), m (Monate), y (Jahre). Monate und Jahre zählen nach dem
// Kalender (15.01. + 1 Monat = 15.02.; am Monatsende wird gekürzt). Tags: #review/daily|weekly|monthly|yearly
// oder #review/<n><einheit>, z. B. #review/3d, #review/2w, #review/3m, #review/2y.
const NAMED = { daily: { n: 1, unit: 'd' }, weekly: { n: 1, unit: 'w' }, monthly: { n: 1, unit: 'm' }, yearly: { n: 1, unit: 'y' } };
const MAX_N = 999;

/** Intervall aus dem Teil hinter #review/ ('weekly', '3m' …) oder null. */
export function parseInterval(s) {
  const k = String(s || '').toLowerCase();
  if (Object.hasOwn(NAMED, k)) return { ...NAMED[k] };
  const m = /^(\d{1,3})([dwmy])$/.exec(k);
  if (!m) return null;
  const n = +m[1];
  return n >= 1 && n <= MAX_N ? { n, unit: m[2] } : null;
}

/** Tag-Teil hinter #review/: die alten Namen für 1 Tag/Woche/Monat/Jahr (wie im Obsidian-Snippet), sonst z. B. 3m. */
export function intervalTag(iv) {
  if (iv.n === 1) return { d: 'daily', w: 'weekly', m: 'monthly', y: 'yearly' }[iv.unit];
  return iv.n + iv.unit;
}

export const sameInterval = (a, b) => !!a && !!b && a.n === b.n && a.unit === b.unit;

/** Tag `day` + Intervall (Monate/Jahre nach dem Kalender). */
export function addInterval(day, iv) {
  const n = iv.n;
  if (iv.unit === 'd') return day + n;
  if (iv.unit === 'w') return day + 7 * n;
  const d = new Date(day * 864e5);
  const months = iv.unit === 'm' ? n : 12 * n;
  const y = d.getUTCFullYear() + Math.floor((d.getUTCMonth() + months) / 12);
  const mo = (d.getUTCMonth() + months) % 12;
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return dayOf(y, mo + 1, Math.min(d.getUTCDate(), last));
}

/** „täglich“, „wöchentlich“, „alle 3 Monate“ … */
export function formatFixed(iv) {
  if (iv.n === 1) return { d: 'täglich', w: 'wöchentlich', m: 'monatlich', y: 'jährlich' }[iv.unit];
  const word = { d: 'Tage', w: 'Wochen', m: 'Monate', y: 'Jahre' }[iv.unit];
  return `alle ${iv.n} ${word}`;
}

/** Kurzform für Knöpfe: „1 W“, „3 M“, „1 J“. */
export const formatIntervalShort = (iv) => `${iv.n} ${{ d: 'T', w: 'W', m: 'M', y: 'J' }[iv.unit]}`;

/** Festes Intervall aus den Tags oder null. */
export function fixedInterval(tags) {
  for (const t of tags) {
    const k = t.toLowerCase();
    if (!k.startsWith(REVIEW_PREFIX)) continue;
    const iv = parseInterval(k.slice(REVIEW_PREFIX.length));
    if (iv) return iv;
  }
  return null;
}

// Erster #review/<intervall>-Tag im Text (nicht #review/<etwas anderes>, nicht #reviewed/…).
const FIXED_TAG_RE = /(^|[\s(,])#review\/([\p{L}\p{N}_-]+)(?![\p{L}\p{N}_\-/])/giu;
function findFixedTag(text) {
  for (const m of text.matchAll(FIXED_TAG_RE)) {
    if (parseInterval(m[2])) return { index: m.index + m[1].length, length: m[0].length - m[1].length };
  }
  return null;
}

/** Setzt das feste Intervall: ersetzt den vorhandenen #review/…-Tag, sonst an die Tag-Zeile. */
export function setFixedInterval(text, iv) {
  const tag = '#' + REVIEW_PREFIX + intervalTag(iv);
  const hit = findFixedTag(text);
  if (hit) return text.slice(0, hit.index) + tag + text.slice(hit.index + hit.length);
  return addTagsToText(text, [tag.slice(1)]);
}

/** Letztes Review-Datum (Tag) aus #reviewed/JJJJ/MM/TT oder null. */
export function reviewedDay(tags) {
  for (const t of tags) {
    const m = REVIEWED_TAG_RE.exec(t);
    if (m) return dayOf(+m[1], +m[2], +m[3]);
  }
  return null;
}

/** Setzt #reviewed/… auf `day`: ersetzt den vorhandenen Tag, sonst hinter #review/<intervall>, sonst an die Tag-Zeile. */
export function setReviewed(text, day) {
  const tag = '#reviewed/' + dayToTagDate(day);
  if (REVIEWED_RE.test(text)) return text.replace(REVIEWED_RE, tag);
  const hit = findFixedTag(text);
  if (hit) return text.slice(0, hit.index + hit.length) + ' ' + tag + text.slice(hit.index + hit.length);
  return addTagsToText(text, [tag.slice(1)]);
}

/** Erledigt am Tag `day`, wieder fällig nach `iv` (wird zum neuen Intervall der Notiz). */
export function markDone(text, iv, day) {
  return setReviewed(setFixedInterval(text, iv), day);
}

/* ---------- Review.md ---------- */

/**
 * Stapel aus Review.md: jede Überschrift ist ein Stapel, darunter `tag: #a` (genau ein Tag; `tags:` geht auch,
 * dann zählt der erste). Alte `ohne:`-Zeilen werden ignoriert (ersetzt durch den Review-Status „skip“).
 * Gibt [{ name, tag (Originalschreibweise) }] zurück (nur Stapel mit Tag).
 */
export function parseDecks(text) {
  const decks = [];
  let cur = null;
  for (const line of splitFrontmatter(text).body.split(/\r?\n/)) {
    const hm = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (hm) { cur = { name: hm[1], tag: null }; decks.push(cur); continue; }
    const km = /^\s*(?:[-*+]\s+)?tags?\s*:\s*(.*)$/i.exec(line);
    if (km && cur) cur.tag ??= parseTags(' ' + km[1])[0] || null;
  }
  return decks.filter((d) => d.tag);
}

const hasTag = (tagsLower, wanted) => tagsLower.some((t) => wanted.some((w) => t === w || t.startsWith(w + '/')));

/** Gehört die Notiz zum Stapel? */
export function inDeck(note, deck) {
  return hasTag(note.tagsLower, [deck.tag.toLowerCase()]);
}

/* ---------- Review-Status ---------- */

// Pro Frage: open (unbearbeitet, Standard), ready (wird abgefragt), skip (nicht abfragen, z. B. Orga-Fragen).
export const STATE_FIELD = 'review-state';
export const STATES = ['open', 'ready', 'skip'];

/** Status ohne Feld: Notizen mit SR-Stand wurden schon wiederholt und gelten als ready, sonst open. */
const implicitState = (text) => (srState(text) ? 'ready' : 'open');

/** Status aus der Frontmatter (`review-state`), ohne Feld siehe implicitState. */
export function reviewState(text) {
  const v = String(parseFrontmatter(text)[STATE_FIELD] || '').toLowerCase();
  return STATES.includes(v) ? v : implicitState(text);
}

/** Setzt den Status; das Feld steht nur in der Datei, wenn es vom Standard abweicht (open meist ohne Feld). */
export function setReviewState(text, state) {
  const without = setFrontmatterFields(text, { [STATE_FIELD]: null });
  return reviewState(without) === state ? without : setFrontmatterFields(text, { [STATE_FIELD]: state });
}

export const nextReviewState = (state) => STATES[(STATES.indexOf(state) + 1) % STATES.length];

/** { open, ready, skip } über Notizen. */
export function countStates(notes) {
  const out = { open: 0, ready: 0, skip: 0 };
  for (const n of notes) out[reviewState(n.text)]++;
  return out;
}

export const isConfig = (path) => path.toLowerCase() === CONFIG_PATH.toLowerCase();

/* ---------- Karten ---------- */

/**
 * Alle Karten am Tag `day`. Feste Intervalle haben Vorrang: eine Notiz mit #review/<intervall>
 * ist nie zusätzlich eine SR-Karte. Aus den Stapeln zählen nur Notizen mit Review-Status ready.
 * Karte: { path, kind: 'sr'|'fixed', decks: [Index], isNew, due, overdue, interval, unseeded }
 */
export function buildCards(notes, decks, day) {
  const cards = [];
  for (const n of notes) {
    if (isConfig(n.path)) continue;
    const iv = fixedInterval(n.tags);
    if (iv) {
      const last = reviewedDay(n.tags);
      const due = last == null ? day : addInterval(last, iv);
      cards.push({ path: n.path, kind: 'fixed', decks: [], interval: iv, isNew: false,
        unseeded: last == null, due, overdue: day - due });
      continue;
    }
    if (reviewState(n.text) !== 'ready') continue;
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
export function seedDay(iv, day, rand = Math.random) {
  return day - Math.floor(rand() * (addInterval(day, iv) - day));
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
